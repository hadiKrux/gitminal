import { getStashCreateAvailability } from "@/domain/git/git.stashes";
import type { RemoteBranchRecord, TagRowRecord } from "@/domain/git/git.types";
import { gateRepository, hasOperationMarker } from "@/domain/repository/repository.states";
import {
  isDiffBulkCommand,
  isDiffFormReadOnly,
  readDiffCommandSections,
  readDiffFormPaths,
  readDiffFormSection,
} from "./commands.diff";
import { getCommandDescriptor } from "./commands.registry";
import type {
  CommandAvailability,
  CommandAvailabilityReason,
  CommandContext,
  CommandDescriptor,
  CommandFormValues,
  CommandPanelFacts,
  CommandTarget,
  CommandTargetKind,
} from "./commands.types";

/**
 * Commands whose branch target must be the current branch.
 *
 * Pull, push, and their variants operate on the checked-out branch, so the explicit target is a
 * stale-target guard: a target captured before a checkout in another worktree must not push or pull
 * a branch the user is no longer on.
 */
const CURRENT_BRANCH_ACTIONS: ReadonlySet<string> = new Set([
  "remote.pull",
  "remote.push",
  "remote.pushForceSafe",
  "remote.pushForceOverwrite",
  "remote.pushNoVerify",
]);

/**
 * Command combinations whose repository-wide gate reason is reworded for the diff actions.
 *
 * The repository gate reports a merge, rebase, or cherry-pick per operation. The diff panel uses one
 * "merge state" reason for all three, because the block and remedy are identical from its point of
 * view and F-11 names that exact reason.
 */
const OPERATION_MARKER_GATE_REASONS: ReadonlySet<CommandAvailabilityReason> = new Set([
  "merge-in-progress",
  "rebase-in-progress",
  "cherry-pick-in-progress",
]);

/** Commands driven by `config.remote.fetchScope`. */
const FETCH_SCOPE_COMMANDS: ReadonlySet<string> = new Set(["remote.fetchPrune"]);

/** Commit commands that create a normal commit and therefore need staged files. */
const STAGED_COMMIT_ACTIONS: ReadonlySet<string> = new Set([
  "commit.submit",
  "commit.submitNoVerify",
]);

/** Commit commands that rewrite HEAD and therefore need at least one commit. */
const AMEND_COMMIT_ACTIONS: ReadonlySet<string> = new Set(["commit.amend", "commit.amendNoVerify"]);

/**
 * Combines repository-wide gates with target validation for one command.
 *
 * The repository gate runs first, so a whole-shell state such as not-a-repository or bare explains
 * the block before a target ever matters. The fetch commands then apply the effective scope: with
 * `current`, a repository whose only missing piece is that the checked-out branch has no upstream
 * is reported as `no-current-upstream` instead of the wider `no-local-upstreams` reason. Read-only
 * diff mode is checked before that gate, because a commit or stash selection makes every diff action
 * unavailable even while an operation marker is present. The authoritative `readOnly` context flag
 * is checked with the form flag, so a palette or direct dispatch that omits the feature-owned form
 * value is still refused. A mutation is also blocked while another mutation runs. Target validation
 * then checks that the explicit target matches the kind the descriptor requires and that the target
 * is still valid, for example that a branch is not the current branch. Panel facts, when supplied,
 * let a check compare the target with the rows the panels render.
 *
 * @param commandId - Stable command id.
 * @param context - Repository state, signals, target, region, operation flag, and panel facts.
 * @returns Availability with a machine-readable reason when the command cannot run.
 */
export function getAvailability(commandId: string, context: CommandContext): CommandAvailability {
  const descriptor = getCommandDescriptor(commandId);

  if (descriptor === undefined) {
    return blocked("command-not-found");
  }

  if (readDiffCommandSections(commandId) !== undefined && isReadOnlyDiffContext(context)) {
    return blocked("read-only");
  }

  const gate = gateRepository(commandId, context.state, context.signals);

  if (!gate.available) {
    return {
      available: false,
      reason: readBlockedGateReason(descriptor, context, gate.reason),
    };
  }

  if (commandId === "remote.fetch") {
    const remote = context.formValues?.remote ?? "origin";

    if (typeof remote !== "string" || !context.signals.remotes.includes(remote)) {
      return blocked("unknown-remote");
    }
  }

  const fetchScopeReason = readFetchScopeReason(descriptor, context);

  if (fetchScopeReason !== null) {
    return blocked(fetchScopeReason);
  }

  if (descriptor.kind === "mutation" && context.operation === "running") {
    return blocked("operation-in-progress");
  }

  const targetReason = validateTarget(descriptor, context);

  if (targetReason !== null) {
    return blocked(targetReason);
  }

  const stateReason = readStateReason(descriptor, context);

  if (stateReason !== null) {
    return blocked(stateReason);
  }

  return { available: true };
}

/**
 * Reads the reason for a command the repository gate blocked.
 *
 * A `current`-scope fetch whose repository has no local upstream at all reports the narrower
 * `no-current-upstream` reason, because the checked-out branch is certainly one of the branches
 * without an upstream. Every other gate reason is preserved.
 *
 * @param descriptor - Command descriptor.
 * @param context - Command context.
 * @param reason - Gate reason, when the gate blocked the command.
 * @returns The availability reason to report.
 */
function readBlockedGateReason(
  descriptor: CommandDescriptor,
  context: CommandContext,
  reason: CommandAvailabilityReason | undefined,
): CommandAvailabilityReason {
  if (
    reason === "no-local-upstreams" &&
    FETCH_SCOPE_COMMANDS.has(descriptor.id) &&
    context.fetchScope === "current"
  ) {
    return "no-current-upstream";
  }

  return readGateReason(descriptor.id, reason);
}

/**
 * Reads the scope-specific block for the fetch commands.
 *
 * The current scope needs the checked-out branch's own upstream. An absent projection stays
 * permissive, because a direct call without provider data must not invent a missing upstream.
 *
 * @param descriptor - Command descriptor.
 * @param context - Command context.
 * @returns `no-current-upstream`, or null when the scope allows the command.
 */
function readFetchScopeReason(
  descriptor: CommandDescriptor,
  context: CommandContext,
): CommandAvailabilityReason | null {
  if (!FETCH_SCOPE_COMMANDS.has(descriptor.id) || context.fetchScope !== "current") {
    return null;
  }

  return context.currentBranchHasUpstream === false ? "no-current-upstream" : null;
}

/**
 * Reads the reason a repository-wide gate reports for one command.
 *
 * A diff bulk action that a merge, rebase, or cherry-pick blocks reports the panel's "merge state"
 * wording instead of the per-operation gate wording. Every other command keeps its gate reason.
 *
 * @param commandId - Stable command id.
 * @param reason - Gate reason, when the gate blocked the command.
 * @returns The availability reason to report.
 */
function readGateReason(
  commandId: string,
  reason: CommandAvailabilityReason | undefined,
): CommandAvailabilityReason {
  if (
    reason !== undefined &&
    OPERATION_MARKER_GATE_REASONS.has(reason) &&
    readDiffCommandSections(commandId) !== undefined
  ) {
    return "merge-state";
  }

  return reason ?? "operation-in-progress";
}

/**
 * Validates the explicit target against the descriptor.
 *
 * @param descriptor - Command descriptor.
 * @param context - Command context.
 * @returns A blocked reason, or null when the target is valid.
 */
function validateTarget(
  descriptor: CommandDescriptor,
  context: CommandContext,
): CommandAvailabilityReason | null {
  const target = context.target;

  if (descriptor.targetKind === "none") {
    return target.kind === "none" ? null : "invalid-target";
  }

  if (target.kind !== descriptor.targetKind) {
    return "missing-target";
  }

  return TARGET_VALUE_VALIDATORS[target.kind](descriptor, target, context);
}

/**
 * Table of value validators, one per target kind.
 *
 * Each validator receives the full union and returns `null` for a target of another kind, so the
 * table stays type-safe without a dispatch switch.
 */
const TARGET_VALUE_VALIDATORS: Readonly<
  Record<
    CommandTargetKind,
    (
      descriptor: CommandDescriptor,
      target: CommandTarget,
      context: CommandContext,
    ) => CommandAvailabilityReason | null
  >
> = Object.freeze({
  none: () => null,
  branch: validateBranchTarget,
  remoteBranch: validateRemoteBranchTarget,
  tag: validateTagTarget,
  stash: validateStashTarget,
  worktree: validateWorktreeTarget,
  commit: validateNamedTarget("oid"),
  pending: () => null,
  diffFile: validateDiffFileTarget,
  form: validateNamedTarget("formId"),
});

/**
 * Validates a branch target.
 *
 * A remote command's target must be the current branch. The top bar always passes the current
 * branch, so a mismatch means the target is stale, for example after an external checkout, and the
 * command must not act on a branch the user is no longer viewing. A branch delete additionally
 * refuses the current branch and any branch checked out in another worktree.
 *
 * @param descriptor - Command descriptor.
 * @param target - Command target.
 * @param context - Command context.
 * @returns A blocked reason, or null when the target is valid.
 */
function validateBranchTarget(
  descriptor: CommandDescriptor,
  target: CommandTarget,
  context: CommandContext,
): CommandAvailabilityReason | null {
  if (target.kind !== "branch") {
    return null;
  }

  if (target.name.length === 0) {
    return "invalid-target";
  }

  if (descriptor.id === "branch.delete") {
    return validateBranchDeleteTarget(target.name, context);
  }

  if (CURRENT_BRANCH_ACTIONS.has(descriptor.id) && context.signals.branch !== target.name) {
    return "invalid-target";
  }

  return null;
}

/**
 * Validates that a branch may be deleted.
 *
 * The current branch is refused first so the reason names the stronger condition. A branch checked
 * out in another worktree is refused next, because deleting it would leave that worktree without its
 * branch. Neither check runs without the branch list, so a caller with no panel projection stays
 * permissive.
 *
 * @param name - Branch the command targets.
 * @param context - Command context.
 * @returns A blocked reason, or null when the branch may be deleted.
 */
function validateBranchDeleteTarget(
  name: string,
  context: CommandContext,
): CommandAvailabilityReason | null {
  if (context.signals.branch === name) {
    return "cannot-delete-current-branch";
  }

  const branch = context.panel?.branches?.find((record) => record.name === name);

  return branch !== undefined && branch.worktreePath !== null ? "checked-out-in-worktree" : null;
}

/**
 * Validates a remote branch target.
 *
 * @param descriptor - Command descriptor.
 * @param target - Command target.
 * @param context - Command context.
 * @returns A blocked reason, or null when the target is valid.
 */
function validateRemoteBranchTarget(
  descriptor: CommandDescriptor,
  target: CommandTarget,
  context: CommandContext,
): CommandAvailabilityReason | null {
  if (target.kind !== "remoteBranch") {
    return null;
  }

  if (target.remote.length === 0 || target.branch.length === 0) {
    return "invalid-target";
  }

  if (!context.signals.remotes.includes(target.remote)) {
    return "unknown-remote";
  }

  if (descriptor.id !== "remote.createLocal") {
    return null;
  }

  const exists = readRemoteBranchExists(context.panel, target.remote, target.branch);

  return exists === false ? "no-remote-branch" : null;
}

/**
 * Reports whether a remote-tracking ref is present in the snapshot.
 *
 * @param panel - Panel facts, when the caller supplies them.
 * @param remote - Configured remote name.
 * @param branch - Branch name inside that remote.
 * @returns True when present, false when the read snapshot proves absence, null when unknown.
 */
function readRemoteBranchExists(
  panel: CommandPanelFacts | undefined,
  remote: string,
  branch: string,
): boolean | null {
  const remoteBranches: readonly RemoteBranchRecord[] | undefined = panel?.remoteBranches;

  if (remoteBranches === undefined) {
    return null;
  }

  return remoteBranches.some((record) => record.remote === remote && record.branch === branch);
}

/**
 * Validates a tag target and its optional remote.
 *
 * @param descriptor - Command descriptor.
 * @param target - Command target.
 * @param context - Command context.
 * @returns A blocked reason, or null when the target is valid.
 */
function validateTagTarget(
  descriptor: CommandDescriptor,
  target: CommandTarget,
  context: CommandContext,
): CommandAvailabilityReason | null {
  if (target.kind !== "tag") {
    return null;
  }

  if (target.name.length === 0) {
    return "invalid-target";
  }

  if (target.remote !== undefined && !context.signals.remotes.includes(target.remote)) {
    return "unknown-remote";
  }

  if (descriptor.id === "tag.push") {
    return validateTagPushTarget(target.name, target.remote, context);
  }

  if (descriptor.id === "tag.delete") {
    return validateTagDeleteTarget(target.name, context);
  }

  return null;
}

/**
 * Validates pushing one tag to a remote.
 *
 * The tag must exist locally, at least one remote must be configured, and the last known remote tag
 * set must confirm the tag is absent. A never-checked or failed remote check is `unknown`, never
 * `unpushed`, so missing knowledge disables the push with a refresh hint instead of overwriting a
 * remote tag the app cannot see.
 *
 * @param name - Tag the command targets.
 * @param remote - Explicit remote from the target, when the caller resolved one.
 * @param context - Command context.
 * @returns A blocked reason, or null when the tag may be pushed.
 */
function validateTagPushTarget(
  name: string,
  remote: string | undefined,
  context: CommandContext,
): CommandAvailabilityReason | null {
  const rows = context.panel?.tagRows;

  if (rows === undefined) {
    return null;
  }

  const row = rows.find((candidate) => candidate.name === name);

  if (row === undefined || !row.local) {
    return "invalid-target";
  }

  return readTagPushRemoteReason(row, remote, context.signals.remotes);
}

/**
 * Reads the remote-side block for a local tag row.
 *
 * @param row - Merged tag row for the target.
 * @param remote - Explicit remote from the target, when the caller resolved one.
 * @param remotes - Configured remote names.
 * @returns A blocked reason, or null when the remote state allows the push.
 */
function readTagPushRemoteReason(
  row: TagRowRecord,
  remote: string | undefined,
  remotes: readonly string[],
): CommandAvailabilityReason | null {
  if (remotes.length === 0) {
    return "no-remote";
  }

  if (remote !== undefined && row.remotes.includes(remote)) {
    return "tag-already-on-remote";
  }

  if (row.state === "unknown") {
    return "remote-tag-unknown";
  }

  return row.state === "both" ? "tag-already-on-remote" : null;
}

/**
 * Validates deleting one tag.
 *
 * A tag is deletable when it exists locally, remotely, or both. A target that no row describes is
 * stale, so the command must not run against a tag that disappeared from the last read.
 *
 * @param name - Tag the command targets.
 * @param context - Command context.
 * @returns A blocked reason, or null when the tag may be deleted.
 */
function validateTagDeleteTarget(
  name: string,
  context: CommandContext,
): CommandAvailabilityReason | null {
  const rows = context.panel?.tagRows;

  if (rows === undefined) {
    return null;
  }

  const row = rows.find((candidate) => candidate.name === name);

  return row === undefined || (!row.local && row.remotes.length === 0) ? "invalid-target" : null;
}

/**
 * Validates a stash target.
 *
 * Stash actions are keyed by the immutable object name, never by `stash@{n}`. An empty list has no
 * selection to act on, and a name the current list no longer holds means the stash changed outside
 * the app, so the action must abort and let the refresh reconcile the row.
 *
 * @param _descriptor - Command descriptor, unused for this target kind.
 * @param target - Command target.
 * @param context - Command context.
 * @returns A blocked reason, or null when the target is valid.
 */
function validateStashTarget(
  _descriptor: CommandDescriptor,
  target: CommandTarget,
  context: CommandContext,
): CommandAvailabilityReason | null {
  if (target.kind !== "stash") {
    return null;
  }

  if (target.objectName.length === 0) {
    return "invalid-target";
  }

  const stashes = context.panel?.stashes;

  if (stashes === undefined) {
    return null;
  }

  if (stashes.length === 0) {
    return "no-stash-selected";
  }

  return stashes.some((stash) => stash.objectName === target.objectName)
    ? null
    : "stash-changed-externally";
}

/**
 * Validates a worktree target.
 *
 * @param _descriptor - Command descriptor, unused for this target kind.
 * @param target - Command target.
 * @param context - Command context.
 * @returns A blocked reason, or null when the target is valid.
 */
function validateWorktreeTarget(
  _descriptor: CommandDescriptor,
  target: CommandTarget,
  context: CommandContext,
): CommandAvailabilityReason | null {
  if (target.kind !== "worktree") {
    return null;
  }

  if (target.path.length === 0) {
    return "invalid-target";
  }

  const worktrees = context.panel?.worktrees;

  if (worktrees === undefined) {
    return null;
  }

  const worktree = worktrees.find((record) => record.path === target.path);

  if (worktree === undefined) {
    return "worktree-missing";
  }

  return worktree.current ? "current-worktree" : null;
}

/**
 * Builds a validator for a target kind identified by one required string field.
 *
 * @param field - Field that must be non-empty.
 * @returns A validator for that target kind.
 */
function validateNamedTarget(
  field: "oid" | "formId",
): (
  descriptor: CommandDescriptor,
  target: CommandTarget,
  context: CommandContext,
) => CommandAvailabilityReason | null {
  return (_descriptor, target) => {
    const value = readTargetField(target, field);

    return value === null || value.length === 0 ? "invalid-target" : null;
  };
}

/**
 * Validates a diff-file target.
 *
 * @param _descriptor - Command descriptor, unused for this target kind.
 * @param target - Command target.
 * @returns A blocked reason, or null when the target is valid.
 */
function validateDiffFileTarget(
  _descriptor: CommandDescriptor,
  target: CommandTarget,
): CommandAvailabilityReason | null {
  if (target.kind !== "diffFile") {
    return null;
  }

  return target.path.length === 0 ? "invalid-target" : null;
}

/**
 * Reads a required string field from a named target kind.
 *
 * @param target - Command target.
 * @param field - Field name to read.
 * @returns The field value, or null when the target is another kind or does not carry it.
 */
function readTargetField(target: CommandTarget, field: "oid" | "formId"): string | null {
  if (field === "oid" && target.kind === "commit") {
    return target.oid;
  }

  if (field === "formId" && target.kind === "form") {
    return target.formId;
  }

  return null;
}

/**
 * Reads target-aware state blocks that the repository-wide gate does not own.
 *
 * @param descriptor - Command descriptor.
 * @param context - Command context.
 * @returns A blocked reason, or null when the command may proceed.
 */
function readStateReason(
  descriptor: CommandDescriptor,
  context: CommandContext,
): CommandAvailabilityReason | null {
  return (
    readDiffStateReason(descriptor, context) ??
    readCommitStateReason(descriptor, context) ??
    readComposerStateReason(descriptor, context) ??
    readOperationMarkerStateReason(descriptor, context) ??
    readConflictStateReason(descriptor, context) ??
    readPanelStateReason(descriptor, context)
  );
}

/**
 * Reads the right-pane requirement of the composer focus command.
 *
 * `commit.focus` focuses the composer textarea, which mounts only while the right pane renders the
 * composer. The provider derives the same boolean the focus handler uses, so the palette, help, and
 * footer report the reason instead of advertising a command whose target is not on screen. An absent
 * projection stays permissive, matching the other provider-backed checks.
 *
 * @param descriptor - Command descriptor.
 * @param context - Command context.
 * @returns `composer-hidden`, or null when the composer can receive focus.
 */
function readComposerStateReason(
  descriptor: CommandDescriptor,
  context: CommandContext,
): CommandAvailabilityReason | null {
  if (descriptor.id !== "commit.focus") {
    return null;
  }

  return context.composerVisible === false ? "composer-hidden" : null;
}

/**
 * Reads the staged-file and HEAD requirements of the commit commands.
 *
 * A normal commit needs at least one staged entry, because git would fail with nothing to commit;
 * the reason is the documented "nothing to commit" state, which the composer also renders as its
 * button label. Amend is allowed without staged changes because it replaces the last commit, but it
 * needs a HEAD, so an empty repository reports "no commits yet". Both checks are permissive when the
 * caller supplies no repository projection: the dispatcher's repository copy always does, while a
 * direct runner call keeps git as the authority.
 *
 * @param descriptor - Command descriptor.
 * @param context - Command context.
 * @returns A blocked reason, or null when the command may proceed.
 */
function readCommitStateReason(
  descriptor: CommandDescriptor,
  context: CommandContext,
): CommandAvailabilityReason | null {
  if (STAGED_COMMIT_ACTIONS.has(descriptor.id)) {
    const status = context.panel?.status;

    return status !== undefined && status !== null && status.stagedCount === 0
      ? "nothing-to-commit"
      : null;
  }

  if (AMEND_COMMIT_ACTIONS.has(descriptor.id) && !context.signals.headExists) {
    return "no-commits-yet";
  }

  return null;
}

/**
 * Reads the read-only, section, and empty-set blocks of a diff command.
 *
 * Read-only mode is a commit or stash selection, which repository signals cannot describe, so the
 * provider derives it from the selection and the dispatching feature may also pass it in the form
 * values. The section check keeps each action on the side
 * it can change: discard only on Working Directory, unstage only on Staged Files, delete only on
 * Untracked Files, and stage on Working Directory or Untracked Files. A bulk action whose section
 * path set is present and empty is unavailable because it has nothing to do; an absent path set is
 * permissive, so the footer and palette never guess at a scope the dispatching surface did not send.
 * Combined Stage All omits the section but still refuses an explicitly empty path set.
 *
 * @param descriptor - Command descriptor.
 * @param context - Command context.
 * @returns A blocked reason, or null when the command may proceed.
 */
function readDiffStateReason(
  descriptor: CommandDescriptor,
  context: CommandContext,
): CommandAvailabilityReason | null {
  const allowed = readDiffCommandSections(descriptor.id);

  if (allowed === undefined) {
    return null;
  }

  if (isDiffFormReadOnly(context.formValues)) {
    return "read-only";
  }

  const section = readRequestedDiffSection(context);

  if (section === null) {
    return readUnscopedDiffReason(descriptor.id, context.formValues);
  }

  if (!allowed.includes(section)) {
    return "invalid-target";
  }

  if (isDiffBulkCommand(descriptor.id)) {
    const paths = readDiffFormPaths(context.formValues);

    if (paths?.length === 0) {
      return "no-files";
    }
  }

  return null;
}

/**
 * Checks a diff request that does not identify a section.
 *
 * Per-file actions require a section. Bulk discovery queries may omit it, while combined Stage All
 * must still reject an explicitly empty path set.
 *
 * @param commandId - Diff command being evaluated.
 * @param formValues - Optional explicit paths supplied by the dispatching surface.
 * @returns A blocked reason, or null when the unscoped request is allowed.
 */
function readUnscopedDiffReason(
  commandId: string,
  formValues: CommandContext["formValues"],
): CommandAvailabilityReason | null {
  if (commandId === "diff.stageAll" && readDiffFormPaths(formValues)?.length === 0) {
    return "no-files";
  }

  return isDiffBulkCommand(commandId) ? null : "invalid-target";
}

/**
 * Reports whether a diff command runs in authoritative or caller-supplied read-only mode.
 *
 * The provider-derived flag is the authority: it comes from the right-pane selection, so a palette
 * or direct dispatch cannot make a commit or stash view writable by omitting the form value. The
 * form flag stays as an additional defense for a caller that dispatches its own request.
 *
 * @param context - Command context.
 * @returns True when the diff command must be refused as read-only.
 */
function isReadOnlyDiffContext(context: CommandContext): boolean {
  return context.readOnly === true || isDiffFormReadOnly(context.formValues);
}

/**
 * Reads the section a diff request targets.
 *
 * A per-file command carries the section in its explicit `diffFile` target. A bulk command carries
 * it in the form values, because its target kind is `none`.
 *
 * @param context - Command context.
 * @returns The requested section, or null when absent or unknown.
 */
function readRequestedDiffSection(
  context: CommandContext,
): "working" | "staged" | "untracked" | null {
  if (context.target.kind === "diffFile") {
    return readDiffFormSection({ section: context.target.section });
  }

  return readDiffFormSection(context.formValues);
}

/**
 * Reads the panel state blocks that only the snapshot can explain.
 *
 * Creating a stash is refused when the status snapshot has nothing to stash, which is the documented
 * remedy for the only-untracked case. Creating a worktree needs at least one commit, which the
 * repository-wide gate does not own for that command. Creating a local branch from a remote branch
 * has its own rule: it is only impossible when the repository has neither a commit nor a
 * remote-tracking ref, because an unborn local branch with a populated `refs/remotes` set can still
 * check the remote ref out through the atomic create.
 *
 * @param descriptor - Command descriptor.
 * @param context - Command context.
 * @returns A blocked reason, or null when the command may proceed.
 */
function readPanelStateReason(
  descriptor: CommandDescriptor,
  context: CommandContext,
): CommandAvailabilityReason | null {
  if (descriptor.id === "stash.create") {
    return getStashCreateAvailability(
      context.panel?.status ?? null,
      readIncludeUntracked(context.formValues),
    );
  }

  if (descriptor.id === "remote.createLocal") {
    return context.signals.headExists || hasRemoteTrackingRefs(context) ? null : "no-commits-yet";
  }

  if (descriptor.id !== "worktree.create") {
    return null;
  }

  return context.state.primary === "empty" ? "no-commits-yet" : null;
}

/**
 * Reports whether the snapshot holds at least one remote-tracking ref.
 *
 * A missing projection is treated as no refs, which matches the previous empty-repository behavior.
 * A partial read failure retains the previous remote-branch list, so only a first read can pass this
 * check an empty list; later failures keep the action available on the last known evidence.
 *
 * @param context - Command context.
 * @returns True when at least one remote-tracking ref is known.
 */
function hasRemoteTrackingRefs(context: CommandContext): boolean {
  const remoteBranches = context.panel?.remoteBranches;

  return remoteBranches !== undefined && remoteBranches.length > 0;
}

/**
 * Reads the include-untracked flag from the create-stash form values.
 *
 * The checkbox is the documented remedy for an only-untracked working tree, so the availability
 * check must evaluate the live form value instead of assuming the default. Only a true boolean or
 * the exact string `"true"` enables the flag; a missing form falls back to false.
 *
 * @param values - Form values collected by the owning modal, when any.
 * @returns True when untracked files are included.
 */
function readIncludeUntracked(values: CommandFormValues | undefined): boolean {
  return values?.includeUntracked === true || values?.includeUntracked === "true";
}

/**
 * Blocks index actions that conflict with an in-progress merge, rebase, or cherry-pick.
 *
 * @param descriptor - Command descriptor.
 * @param context - Command context.
 * @returns A blocked reason, or null when the command may proceed.
 */
function readOperationMarkerStateReason(
  descriptor: CommandDescriptor,
  context: CommandContext,
): CommandAvailabilityReason | null {
  if (!hasOperationMarker(context.state)) {
    return null;
  }

  if (isBulkIndexAction(descriptor.id)) {
    return "merge-state";
  }

  if (descriptor.id !== "diff.unstage") {
    return null;
  }

  const path = readDiffPath(context.target);

  return path !== null && context.signals.conflictedPaths.includes(path) ? "merge-state" : null;
}

/**
 * Blocks discarding a conflicted path until the conflicts are resolved.
 *
 * @param descriptor - Command descriptor.
 * @param context - Command context.
 * @returns A blocked reason, or null when the command may proceed.
 */
function readConflictStateReason(
  descriptor: CommandDescriptor,
  context: CommandContext,
): CommandAvailabilityReason | null {
  if (descriptor.id !== "diff.discard" && descriptor.id !== "diff.discardAll") {
    return null;
  }

  return hasConflictedTarget(descriptor.id, context) ? "resolve-conflicts-first" : null;
}

/**
 * Reports whether a command stages or unstages every path at once.
 *
 * @param commandId - Stable command id.
 * @returns True for the bulk index actions.
 */
function isBulkIndexAction(commandId: string): boolean {
  return commandId === "diff.stageAll" || commandId === "diff.unstageAll";
}

/**
 * Reads the path of a diff-file target.
 *
 * @param target - Command target.
 * @returns The selected path, or null for another target kind.
 */
function readDiffPath(target: CommandTarget): string | null {
  return target.kind === "diffFile" ? target.path : null;
}

/**
 * Reports whether a discard command touches a conflicted path.
 *
 * @param commandId - Stable command id.
 * @param context - Command context.
 * @returns True when the command must wait for conflict resolution.
 */
function hasConflictedTarget(commandId: string, context: CommandContext): boolean {
  if (context.signals.conflictedPaths.length === 0) {
    return false;
  }

  if (commandId === "diff.discardAll") {
    return true;
  }

  const path = readDiffPath(context.target);

  return path !== null && context.signals.conflictedPaths.includes(path);
}

/**
 * Builds a blocked availability result.
 *
 * @param reason - Machine-readable blocked reason.
 * @returns A frozen blocked result.
 */
function blocked(reason: CommandAvailabilityReason): CommandAvailability {
  return Object.freeze({ available: false, reason });
}
