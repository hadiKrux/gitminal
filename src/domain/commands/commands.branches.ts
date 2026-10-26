import {
  planCheckoutBranch,
  planCreateBranch,
  planDeleteLocalBranch,
  planDeleteRemoteBranch,
} from "@/domain/git/git.branches";
import { planCreateLocalBranchFromRemote } from "@/domain/git/git.remote-branches";
import {
  blockedOutcome,
  didStepSucceed,
  invokeCommandStep,
  readFormBoolean,
  readFormChoice,
  readFormString,
} from "./commands.invoke";
import type {
  CommandExecutionOutcome,
  CommandHandlerContext,
  CommandStepResult,
} from "./commands.types";

/** Delete scopes offered by the Delete Branch modal. */
const DELETE_SCOPES = Object.freeze(["local", "local-remote"] as const);

/**
 * Executes `branch.create`.
 *
 * The form supplies the branch name, an optional start point, and whether to check the branch out.
 * With checkout the plan is one atomic `switch -c`, so a rejected checkout cannot leave an orphan
 * branch; without it the plan is a plain `branch`. An unsafe name or start point is refused before
 * git runs, because a revision expression with a space or a leading dash would change the command.
 *
 * @param context - Request, repository root, git client, and signal.
 * @returns The creation step, or a blocked outcome for invalid form values.
 */
export async function executeBranchCreate(
  context: CommandHandlerContext,
): Promise<CommandExecutionOutcome> {
  const values = context.request.formValues;
  const plan = planCreateBranch({
    name: readFormString(values, "name"),
    startPoint: readFormString(values, "startPoint"),
    checkout: readFormBoolean(values, "checkout"),
  });

  if (!plan.ok) {
    return blockedOutcome("invalid-target");
  }

  const step = await invokeCommandStep(context, plan.args, "write");

  return { steps: [step] };
}

/**
 * Executes `branch.checkout`.
 *
 * The explicit target comes from the selected row; the form supplies nothing. An unsafe name is
 * refused before git runs. Checking out the branch that is already current is allowed, because git
 * treats it as a no-op and the snapshot current-branch rule deliberately applies only to commands
 * whose target must be the current branch, such as Pull and Push.
 *
 * @param context - Request, target branch, git client, and signal.
 * @returns The checkout step, or a blocked outcome for an unusable target.
 */
export async function executeBranchCheckout(
  context: CommandHandlerContext,
): Promise<CommandExecutionOutcome> {
  const target = context.target;

  if (target.kind !== "branch") {
    return blockedOutcome("invalid-target");
  }

  const plan = planCheckoutBranch(target.name);

  if (!plan.ok) {
    return blockedOutcome("invalid-target");
  }

  const step = await invokeCommandStep(context, plan.args, "write");

  return { steps: [step] };
}

/**
 * Executes `branch.delete` with the local-first order the branches panel documents.
 *
 * The local branch is deleted first. A failed local delete stops the command, so no remote delete
 * runs and nothing is claimed as deleted. For the local-and-remote scope the resolved remote branch
 * is deleted next; a failed remote delete returns the real steps with `failed: true` and a warning
 * that names the surviving remote branch, so the app never reports the failed half as a success.
 *
 * @param context - Request, target branch, form values, client, and signal.
 * @returns Every step that ran, plus the remote result when the remote half was attempted.
 */
export async function executeBranchDelete(
  context: CommandHandlerContext,
): Promise<CommandExecutionOutcome> {
  const target = context.target;

  if (target.kind !== "branch") {
    return blockedOutcome("missing-target");
  }

  const values = context.request.formValues;
  const localPlan = planDeleteLocalBranch(target.name, readFormBoolean(values, "force"));

  if (!localPlan.ok) {
    return blockedOutcome("invalid-target");
  }

  const localStep = await invokeCommandStep(context, localPlan.args, "write");
  const steps: CommandStepResult[] = [localStep];

  if (!didStepSucceed(localStep)) {
    return { steps };
  }

  const scope = readFormChoice(values, "scope", DELETE_SCOPES) ?? "local";

  if (scope === "local") {
    return { steps };
  }

  return await deleteRemoteHalf(context, steps, target.name);
}

/**
 * Deletes the resolved remote branch after the local delete succeeded.
 *
 * @param context - Request, form values, client, and signal.
 * @param steps - Steps that already ran; the remote step is appended in place.
 * @param branchName - Local branch name, used when the form omits the remote branch.
 * @returns The full outcome, with the remote result the app layer records as evidence.
 */
async function deleteRemoteHalf(
  context: CommandHandlerContext,
  steps: CommandStepResult[],
  branchName: string,
): Promise<CommandExecutionOutcome> {
  const values = context.request.formValues;
  const remote = readFormString(values, "remote");
  const remoteBranch = readFormString(values, "remoteBranch") || branchName;
  const plan = planDeleteRemoteBranch(remote, remoteBranch);

  if (!plan.ok) {
    return remoteDeleteFailure(steps, remote, remoteBranch);
  }

  const remoteStep = await invokeCommandStep(context, plan.args, "network");

  steps.push(remoteStep);

  if (!didStepSucceed(remoteStep)) {
    return {
      ...remoteDeleteFailure(steps, remote, remoteBranch),
      remoteResults: [{ remote, succeeded: false }],
    };
  }

  return { steps, remoteResults: [{ remote, succeeded: true }] };
}

/**
 * Builds the partial-failure outcome for a remote branch that was not deleted.
 *
 * @param steps - Steps that ran.
 * @param remote - Remote the delete targeted.
 * @param remoteBranch - Branch inside that remote.
 * @returns A failed outcome with a warning naming the surviving remote branch.
 */
function remoteDeleteFailure(
  steps: readonly CommandStepResult[],
  remote: string,
  remoteBranch: string,
): CommandExecutionOutcome {
  return {
    steps,
    failed: true,
    warnings: [`remote branch ${remote}/${remoteBranch} was not deleted`],
  };
}

/**
 * Executes `remote.createLocal`.
 *
 * The remote-tracking ref is the base, and the local name comes from the form. With checkout the plan
 * is one atomic `switch -c`, so a failed checkout leaves no orphan branch; without it the plan is a
 * plain `branch`. Both the local name and the base ref are validated by the planner before git runs.
 *
 * @param context - Request, target remote branch, form values, client, and signal.
 * @returns The creation step, or a blocked outcome for an unusable target or form.
 */
export async function executeRemoteCreateLocal(
  context: CommandHandlerContext,
): Promise<CommandExecutionOutcome> {
  const target = context.target;

  if (target.kind !== "remoteBranch") {
    return blockedOutcome("missing-target");
  }

  const values = context.request.formValues;
  const plan = planCreateLocalBranchFromRemote({
    name: readFormString(values, "name"),
    remoteRef: `${target.remote}/${target.branch}`,
    checkout: readFormBoolean(values, "checkout"),
  });

  if (!plan.ok) {
    return blockedOutcome("invalid-target");
  }

  const step = await invokeCommandStep(context, plan.args, "write");

  return { steps: [step] };
}
