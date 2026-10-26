import { getStashCreateAvailability } from "@/domain/git/git.stashes";
import type { RemoteBranchRecord, TagRowRecord } from "@/domain/git/git.types";
import { gateRepository, hasOperationMarker } from "@/domain/repository/repository.states";
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
 * Combines repository-wide gates with target validation for one command.
 *
 * The repository gate runs first, so a whole-shell state such as not-a-repository or bare explains
 * the block before a target ever matters. A mutation is also blocked while another mutation runs.
 * Target validation then checks that the explicit target matches the kind the descriptor requires
 * and that the target is still valid, for example that a branch is not the current branch. Panel
 * facts, when supplied, let a check compare the target with the rows the panels render.
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

  const gate = gateRepository(commandId, context.state, context.signals);

  if (!gate.available) {
    return { available: false, reason: gate.reason ?? "operation-in-progress" };
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
    readOperationMarkerStateReason(descriptor, context) ??
    readConflictStateReason(descriptor, context) ??
    readPanelStateReason(descriptor, context)
  );
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
