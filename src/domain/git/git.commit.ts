import { classifyGitFailure } from "./git.errors";
import { planGitArgs, planGitError } from "./git.plan";
import type {
  CommitActionReason,
  CommitActionResult,
  CommitWriteOptions,
  GitArgPlan,
  GitClient,
  GitInvocationResult,
} from "./git.types";

/** Planner error reported for an empty or whitespace-only message. */
const EMPTY_MESSAGE_ERROR = "commit message is empty";

/** Planner error reported for a message that cannot become one argv value. */
const INVALID_MESSAGE_ERROR = "commit message contains a NUL";

/**
 * Builds one commit invocation from the message and the variant flags.
 *
 * The message is validated before it becomes an argv element: an empty or whitespace-only value is
 * refused, because git would either fail or open an editor the app cannot drive, and a NUL can never
 * be passed to a process. The message keeps its interior newlines and is passed as a single argv
 * value, so git's own `-m` cleanup handles the leading and trailing whitespace. No pathspec, `-a`,
 * or `-A` is ever added, so exactly the staged files are committed.
 *
 * @param input - Commit message plus the amend and no-verify flags.
 * @returns The planned argument array, or the planning error.
 */
export function buildCommitArgs(input: {
  readonly message: string;
  readonly amend?: boolean;
  readonly noVerify?: boolean;
}): GitArgPlan {
  const message = input.message;

  if (message.trim().length === 0) {
    return planGitError(EMPTY_MESSAGE_ERROR);
  }

  if (message.includes("\0")) {
    return planGitError(INVALID_MESSAGE_ERROR);
  }

  return planGitArgs([
    "commit",
    ...(input.amend === true ? ["--amend"] : []),
    ...(input.noVerify === true ? ["--no-verify"] : []),
    "-m",
    message,
  ]);
}

/**
 * Builds a normal `git commit -m <message>` invocation.
 *
 * @param message - Commit message as entered by the user.
 * @param options - Optional no-verify flag.
 * @returns The planned argument array, or the planning error.
 */
export function buildStagedCommitArgs(
  message: string,
  options: { readonly noVerify?: boolean } = {},
): GitArgPlan {
  return buildCommitArgs({ message, noVerify: options.noVerify });
}

/**
 * Builds a `git commit --amend -m <message>` invocation.
 *
 * @param message - Replacement message as entered by the user.
 * @param options - Optional no-verify flag.
 * @returns The planned argument array, or the planning error.
 */
export function buildAmendCommitArgs(
  message: string,
  options: { readonly noVerify?: boolean } = {},
): GitArgPlan {
  return buildCommitArgs({ message, amend: true, noVerify: options.noVerify });
}

/**
 * Commits exactly the staged files with the supplied message.
 *
 * @param client - Git client bound to the configured executable.
 * @param options - Message, no-verify flag, working directory, and signal.
 * @returns The commit result. Never throws.
 */
export async function commitStaged(
  client: GitClient,
  options: CommitWriteOptions,
): Promise<CommitActionResult> {
  return await runCommit(client, options, false);
}

/**
 * Amends the last commit with the supplied message and the staged files.
 *
 * @param client - Git client bound to the configured executable.
 * @param options - Message, no-verify flag, working directory, and signal.
 * @returns The amend result. Never throws.
 */
export async function amendCommit(
  client: GitClient,
  options: CommitWriteOptions,
): Promise<CommitActionResult> {
  return await runCommit(client, options, true);
}

/**
 * Plans and runs one commit variant.
 *
 * @param client - Git client bound to the configured executable.
 * @param options - Message, no-verify flag, working directory, and signal.
 * @param amend - True for the amend variants.
 * @returns The commit result, including a typed rejection for an unusable message.
 */
async function runCommit(
  client: GitClient,
  options: CommitWriteOptions,
  amend: boolean,
): Promise<CommitActionResult> {
  const plan = buildCommitArgs({
    message: options.message,
    amend,
    noVerify: options.noVerify === true,
  });

  if (!plan.ok) {
    return refusedResult("empty-message");
  }

  const step = await client.invoke({
    args: plan.args,
    cwd: options.cwd,
    signal: options.signal,
    operationClass: "write",
  });

  return step.ok ? successResult(step) : failedResult(step);
}

/**
 * Builds a successful commit result.
 *
 * @param step - Settled invocation.
 * @returns The result carrying the one step.
 */
function successResult(step: GitInvocationResult): CommitActionResult {
  return { ok: true, failure: null, steps: [step], reason: null };
}

/**
 * Builds a failed commit result.
 *
 * @param step - Settled invocation.
 * @returns The result carrying the classified failure.
 */
function failedResult(step: GitInvocationResult): CommitActionResult {
  return { ok: false, failure: classifyGitFailure(step), steps: [step], reason: null };
}

/**
 * Builds a refused commit result with no invocation.
 *
 * @param reason - Machine-readable rejection reason.
 * @returns The result with no steps.
 */
function refusedResult(reason: CommitActionReason): CommitActionResult {
  return { ok: false, failure: null, steps: [], reason };
}
