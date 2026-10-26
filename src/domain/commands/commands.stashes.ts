import {
  buildListStashesArgs,
  getStashCreateAvailability,
  parseStashes,
  planApplyStash,
  planCreateStash,
  planDropStash,
  planPopStash,
  resolveStashRef,
} from "@/domain/git/git.stashes";
import { STATUS_ARGS } from "@/domain/git/git.status";
import type { GitArgPlan } from "@/domain/git/git.types";
import { parseStatus } from "@/domain/git/parsers/parse.status";
import {
  blockedOutcome,
  invokeCommandStep,
  readFormBoolean,
  readFormString,
} from "./commands.invoke";
import type { StashAction, StashResolution } from "./commands.stashes.types";
import { toCommandStep } from "./commands.steps";
import type { CommandExecutionOutcome, CommandHandlerContext } from "./commands.types";

/**
 * Executes `stash.create` with the exact action-time guard the create form needs.
 *
 * `git stash push` exits successfully without creating a stash when the only changes are untracked
 * files and `-u` is off, so the canonical status snapshot is read first and
 * `getStashCreateAvailability` decides whether the invocation may run. The form's own untracked flag
 * is used, which is why this guard lives in the executor and not in availability.
 *
 * @param context - Request, form values, client, and signal.
 * @returns The status step and the stash step, or a blocked outcome for an empty scope.
 */
export async function executeStashCreate(
  context: CommandHandlerContext,
): Promise<CommandExecutionOutcome> {
  const values = context.request.formValues;
  const includeUntracked = readFormBoolean(values, "includeUntracked");
  const statusStep = await context.client.invoke({
    args: STATUS_ARGS,
    cwd: context.cwd,
    signal: context.signal,
    operationClass: "read",
    touchesIndex: true,
  });

  if (!statusStep.ok) {
    return { steps: [toCommandStep(statusStep)], failed: true };
  }

  const reason = getStashCreateAvailability(parseStatus(statusStep.stdout), includeUntracked);

  if (reason !== null) {
    return blockedOutcome(reason);
  }

  const plan = planCreateStash(readFormString(values, "message"), includeUntracked);

  if (!plan.ok) {
    return blockedOutcome("invalid-target");
  }

  const step = await invokeCommandStep(context, plan.args, "write");

  return { steps: [toCommandStep(statusStep), step] };
}

/**
 * Executes `stash.apply` against the selector that currently holds the target object.
 *
 * @param context - Request, target object name, client, and signal.
 * @returns The resolution step and the apply step, or a blocked outcome for a changed stash.
 */
export async function executeStashApply(
  context: CommandHandlerContext,
): Promise<CommandExecutionOutcome> {
  return await executeStashAction(context, "apply");
}

/**
 * Executes `stash.pop` against the selector that currently holds the target object.
 *
 * `git stash pop` drops the stash only when the apply succeeds, so a conflict leaves it in place and
 * no separate drop is issued.
 *
 * @param context - Request, target object name, client, and signal.
 * @returns The resolution step and the pop step, or a blocked outcome for a changed stash.
 */
export async function executeStashPop(
  context: CommandHandlerContext,
): Promise<CommandExecutionOutcome> {
  return await executeStashAction(context, "pop");
}

/**
 * Executes `stash.delete` against the selector that currently holds the target object.
 *
 * @param context - Request, target object name, client, and signal.
 * @returns The resolution step and the drop step, or a blocked outcome for a changed stash.
 */
export async function executeStashDelete(
  context: CommandHandlerContext,
): Promise<CommandExecutionOutcome> {
  return await executeStashAction(context, "drop");
}

/**
 * Runs one stash action after resolving the immutable object name to a current selector.
 *
 * The index captured when the row was selected is never reused: an external `git stash push` or
 * `git stash drop` would otherwise make the action hit a different stash. A missing or reused
 * selector blocks the action with the documented "changed externally" reason and no mutation.
 *
 * @param context - Handler context.
 * @param action - Apply, pop, or drop.
 * @returns The resolution step and the action step, or a blocked outcome.
 */
async function executeStashAction(
  context: CommandHandlerContext,
  action: StashAction,
): Promise<CommandExecutionOutcome> {
  const target = context.target;

  if (target.kind !== "stash") {
    return blockedOutcome("missing-target");
  }

  const resolution = await resolveTarget(context, target.objectName);

  if (!resolution.ok) {
    return resolution.failed
      ? { steps: [resolution.step], failed: true }
      : blockedOutcome(resolution.reason);
  }

  const plan = planStashAction(action, resolution.index);

  if (!plan.ok) {
    return blockedOutcome("invalid-target");
  }

  const step = await invokeCommandStep(context, plan.args, "write");

  return { steps: [resolution.step, step] };
}

/**
 * Resolves an object name against a fresh stash list read at action time.
 *
 * A failed or truncated read is incomplete evidence, so it fails the command instead of claiming the
 * stash changed. A complete list that no longer holds the target object is the documented external
 * change, which blocks the action before any mutation.
 *
 * @param context - Handler context.
 * @param objectName - Immutable stash object name from the target.
 * @returns The resolution step and current index, or the reason the action must abort.
 */
async function resolveTarget(
  context: CommandHandlerContext,
  objectName: string,
): Promise<StashResolution> {
  const result = await context.client.invoke({
    args: buildListStashesArgs(),
    cwd: context.cwd,
    signal: context.signal,
    operationClass: "read",
  });
  const step = toCommandStep(result);

  if (!result.ok || result.stdoutTruncated === true) {
    return { ok: false, failed: true, step, reason: "stash-changed-externally" };
  }

  const resolution = resolveStashRef(parseStashes(result.stdout), objectName);

  if (resolution.status !== "found") {
    return { ok: false, failed: false, step, reason: "stash-changed-externally" };
  }

  return { ok: true, step, index: resolution.index };
}

/**
 * Plans one stash action for a resolved selector.
 *
 * @param action - Apply, pop, or drop.
 * @param index - Current selector such as `stash@{0}`.
 * @returns The planned argument array, or the planner error.
 */
function planStashAction(action: StashAction, index: string): GitArgPlan {
  if (action === "apply") {
    return planApplyStash(index);
  }

  return action === "pop" ? planPopStash(index) : planDropStash(index);
}
