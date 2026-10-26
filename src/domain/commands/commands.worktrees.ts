import type { WorktreeForceLevel, WorktreeRecord } from "@/domain/git/git.types";
import {
  buildListWorktreesArgs,
  markCurrentWorktree,
  planAddWorktreeExistingBranch,
  planAddWorktreeNewBranch,
  planRemoveWorktree,
} from "@/domain/git/git.worktrees";
import { parseWorktrees } from "@/domain/git/parsers/parse.worktrees";
import {
  blockedOutcome,
  invokeCommandStep,
  readFormBoolean,
  readFormChoice,
  readFormString,
} from "./commands.invoke";
import { toCommandStep } from "./commands.steps";
import type { CommandExecutionOutcome, CommandHandlerContext } from "./commands.types";

/** Branch modes offered by the New Worktree modal. */
const WORKTREE_MODES = Object.freeze(["new", "existing"] as const);

/**
 * Executes `worktree.create`.
 *
 * A new-branch worktree is one `worktree add -b <branch> <path> HEAD`, so the branch and the
 * worktree are created together; an existing-branch worktree is one `worktree add <path> <branch>`.
 * The path and branch are validated by the planner before git runs, and the branch ref is never
 * deleted by this command. The modal's pure validation stays in `git.worktrees.ts` because it needs
 * the caller's path-existence answer.
 *
 * @param context - Request, form values, client, and signal.
 * @returns The add step, or a blocked outcome for invalid form values.
 */
export async function executeWorktreeCreate(
  context: CommandHandlerContext,
): Promise<CommandExecutionOutcome> {
  const values = context.request.formValues;
  const mode = readFormChoice(values, "mode", WORKTREE_MODES);
  const input = {
    path: readFormString(values, "path"),
    branch: readFormString(values, "branch"),
  };

  if (mode === null) {
    return blockedOutcome("invalid-target");
  }

  const plan =
    mode === "new" ? planAddWorktreeNewBranch(input) : planAddWorktreeExistingBranch(input);

  if (!plan.ok) {
    return blockedOutcome("invalid-target");
  }

  return { steps: [await invokeCommandStep(context, plan.args, "write")] };
}

/**
 * Executes `worktree.delete` with the exact force flag set.
 *
 * The worktree list is read at action time so the flag set comes from the reported state, never from
 * raw user input: no flag for a clean worktree, one `--force` when the form acknowledged a dirty
 * worktree, and `-f -f` when the worktree is locked. Without the acknowledgement a dirty or locked
 * worktree is attempted with no flag, so git refuses it and nothing is removed silently. The branch
 * is never deleted.
 *
 * @param context - Request, target path, form values, client, and signal.
 * @returns The list step and the remove step, or a blocked outcome for a stale or current worktree.
 */
export async function executeWorktreeDelete(
  context: CommandHandlerContext,
): Promise<CommandExecutionOutcome> {
  const target = context.target;

  if (target.kind !== "worktree") {
    return blockedOutcome("missing-target");
  }

  const listed = await context.client.invoke({
    args: buildListWorktreesArgs(),
    cwd: context.cwd,
    signal: context.signal,
    operationClass: "read",
  });

  if (!listed.ok || listed.stdoutTruncated === true) {
    return { steps: [toCommandStep(listed)], failed: true };
  }

  const worktrees = markCurrentWorktree(parseWorktrees(listed.stdout), context.cwd);
  const worktree = worktrees.find((record) => record.path === target.path);

  if (worktree === undefined) {
    return blockedOutcome("worktree-missing");
  }

  if (worktree.current) {
    return blockedOutcome("current-worktree");
  }

  const force = readForceLevel(worktree, readFormBoolean(context.request.formValues, "force"));
  const plan = planRemoveWorktree(target.path, { force });

  if (!plan.ok) {
    return blockedOutcome("invalid-target");
  }

  const step = await invokeCommandStep(context, plan.args, "write");

  return { steps: [toCommandStep(listed), step] };
}

/**
 * Computes the exact number of force flags for one worktree removal.
 *
 * A locked worktree needs two flags because git refuses it with a single force. The acknowledgement
 * is what allows a force at all, so an unacknowledged dirty or locked worktree is attempted with no
 * flag and left to git's refusal.
 *
 * @param worktree - Worktree read at action time.
 * @param acknowledged - Whether the modal's force acknowledgement is set.
 * @returns The number of force flags, from 0 to 2.
 */
function readForceLevel(worktree: WorktreeRecord, acknowledged: boolean): WorktreeForceLevel {
  if (!acknowledged) {
    return 0;
  }

  return worktree.locked ? 2 : 1;
}
