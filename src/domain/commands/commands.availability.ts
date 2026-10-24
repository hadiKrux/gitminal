import { gateRepository, hasOperationMarker } from "@/domain/repository/repository.states";
import { getCommandDescriptor } from "./commands.registry";
import type {
  CommandAvailability,
  CommandAvailabilityReason,
  CommandContext,
  CommandDescriptor,
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
 * and that the target is still valid, for example that a branch is not the current branch.
 *
 * @param commandId - Stable command id.
 * @param context - Repository state, signals, target, region, and operation flag.
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
  stash: validateNamedTarget("objectName"),
  worktree: validateNamedTarget("path"),
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
 * command must not act on a branch the user is no longer viewing.
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

  if (descriptor.id === "branch.delete" && context.signals.branch === target.name) {
    return "cannot-delete-current-branch";
  }

  if (CURRENT_BRANCH_ACTIONS.has(descriptor.id) && context.signals.branch !== target.name) {
    return "invalid-target";
  }

  return null;
}

/**
 * Validates a remote branch target.
 *
 * @param _descriptor - Command descriptor, unused for this target kind.
 * @param target - Command target.
 * @param context - Command context.
 * @returns A blocked reason, or null when the target is valid.
 */
function validateRemoteBranchTarget(
  _descriptor: CommandDescriptor,
  target: CommandTarget,
  context: CommandContext,
): CommandAvailabilityReason | null {
  if (target.kind !== "remoteBranch") {
    return null;
  }

  if (target.remote.length === 0 || target.branch.length === 0) {
    return "invalid-target";
  }

  return context.signals.remotes.includes(target.remote) ? null : "unknown-remote";
}

/**
 * Validates a tag target and its optional remote.
 *
 * @param _descriptor - Command descriptor, unused for this target kind.
 * @param target - Command target.
 * @param context - Command context.
 * @returns A blocked reason, or null when the target is valid.
 */
function validateTagTarget(
  _descriptor: CommandDescriptor,
  target: CommandTarget,
  context: CommandContext,
): CommandAvailabilityReason | null {
  if (target.kind !== "tag") {
    return null;
  }

  if (target.name.length === 0) {
    return "invalid-target";
  }

  if (target.remote === undefined) {
    return null;
  }

  return context.signals.remotes.includes(target.remote) ? null : "unknown-remote";
}

/**
 * Builds a validator for a target kind identified by one required string field.
 *
 * @param field - Field that must be non-empty.
 * @returns A validator for that target kind.
 */
function validateNamedTarget(
  field: "objectName" | "path" | "oid" | "formId",
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
function readTargetField(
  target: CommandTarget,
  field: "objectName" | "path" | "oid" | "formId",
): string | null {
  if (field === "objectName" && target.kind === "stash") {
    return target.objectName;
  }

  if (field === "path" && target.kind === "worktree") {
    return target.path;
  }

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
    readConflictStateReason(descriptor, context)
  );
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
