import { createGitProgressParser } from "@/domain/git/git.progress";
import {
  buildPullArgs,
  buildPushArgs,
  isSafeGitName,
  isTruncatedOutput,
  PUSH_AUTO_CREATE_REMOTE,
} from "@/domain/git/git.remotes";
import type { PushMode } from "@/domain/git/git.remotes.types";
import type { GitInvocationResult } from "@/domain/git/git.types";
import type { UpstreamDescriptor } from "@/domain/repository/repository.types";
import { parseUpstreamAtoms } from "@/domain/repository/repository.upstream";
import { invokeNetwork } from "./commands.invoke";
import { createFailureStep, createInvalidNameResult, toCommandStep } from "./commands.steps";
import type {
  CommandExecutionOutcome,
  CommandHandlerContext,
  CommandStepResult,
} from "./commands.types";

/**
 * Remote command executors: pull and push.
 *
 * The network invocation helper in `commands.invoke.ts` is shared by the fetch, prune, pull, and
 * push executors, while the synthetic step helpers in `commands.steps.ts` are shared by fetch,
 * prune, and push, so no module duplicates the step, warning, or termination vocabulary.
 */

/** Command ids that map to a push variant. */
const PUSH_COMMAND_MODES: ReadonlyMap<string, PushMode> = new Map([
  ["remote.push", "push"],
  ["remote.pushForceSafe", "forceSafe"],
  ["remote.pushForceOverwrite", "forceOverwrite"],
  ["remote.pushNoVerify", "noVerify"],
]);

/**
 * Executes a normal pull for the current branch and its upstream.
 *
 * The invocation uses the network class so the client applies the network timeout and the abort
 * path. Progress lines from `--progress` are forwarded as they arrive and once more after the
 * invocation settles, so a phase that never ends with a newline still reaches the status strip.
 *
 * @param context - Request, repository root, git client, signal, and progress callback.
 * @returns One step for the pull invocation.
 */
export async function executeRemotePull(
  context: CommandHandlerContext,
): Promise<CommandExecutionOutcome> {
  const result = await invokeNetwork(context, buildPullArgs(), createGitProgressParser());

  return { steps: [toCommandStep(result)] };
}

/**
 * Executes one push variant for the branch named by the explicit target.
 *
 * The upstream is read from branch configuration first, so a configured upstream whose remote branch
 * is gone is pushed to again instead of being replaced by `origin/<branch>`. Before any planning the
 * executor reads `git branch --show-current` and refuses to push when git's actual branch differs
 * from the captured target or is detached; this closes the window where a stale provider snapshot
 * plus an external checkout could push an unintended branch. The configured remotes are read only
 * when the branch has no upstream, which is the only case where auto-creation needs to know whether
 * `origin` exists. A truncated or failed upstream read is fatal, because a partial answer could turn
 * a configured upstream into an unintended auto-created one. A plan rejection becomes a synthetic
 * failed step, which the runner reports as a normal failure.
 *
 * @param context - Request, target, repository root, git client, signal, and progress callback.
 * @returns One step for the push invocation or the plan failure.
 */
export async function executeRemotePush(
  context: CommandHandlerContext,
): Promise<CommandExecutionOutcome> {
  const mode = PUSH_COMMAND_MODES.get(context.request.commandId);

  if (mode === undefined) {
    return { steps: [], blockedReason: "command-not-implemented" };
  }

  if (context.target.kind !== "branch") {
    return { steps: [], blockedReason: "missing-target" };
  }

  const branch = context.target.name;
  const currentBranch = await readCurrentBranch(context);

  if (currentBranch.kind === "failure") {
    return { steps: [currentBranch.step] };
  }

  if (currentBranch.branch !== branch) {
    return {
      steps: [
        createFailureStep(
          `fatal: current branch changed; expected ${branch}, found ${currentBranch.branch ?? "detached"}`,
        ),
      ],
    };
  }

  const upstreamRead = await readConfiguredUpstream(context, branch);

  if (upstreamRead.kind === "failure") {
    return { steps: [upstreamRead.step] };
  }

  let remotes: readonly string[] = [];

  if (upstreamRead.upstream === null) {
    const remotesRead = await readConfiguredRemotes(context);

    if (!remotesRead.ok) {
      return { steps: [toCommandStep(remotesRead.result)], failed: true };
    }

    remotes = remotesRead.remotes;
  }

  const plan = buildPushArgs({ mode, branch, upstream: upstreamRead.upstream, remotes });

  if (!plan.ok) {
    return { steps: [createFailureStep(plan.error)] };
  }

  if (upstreamRead.upstream === null) {
    context.notifyProgress({ phase: `creating ${PUSH_AUTO_CREATE_REMOTE}/${branch}` });
  }

  const result = await invokeNetwork(context, plan.args, createGitProgressParser());

  return { steps: [toCommandStep(result)] };
}

/**
 * Reads the branch git actually has checked out.
 *
 * The read is truncation-safe because a partial branch name would be as dangerous as a wrong one.
 * An empty result means a detached HEAD; the caller treats it as a mismatch.
 *
 * @param context - Handler context carrying the root, client, and signal.
 * @returns The current branch name, or a synthetic failure step.
 */
async function readCurrentBranch(
  context: CommandHandlerContext,
): Promise<
  | { readonly kind: "ok"; readonly branch: string | null }
  | { readonly kind: "failure"; readonly step: CommandStepResult }
> {
  const result = await context.client.invoke({
    args: ["branch", "--show-current"],
    cwd: context.cwd,
    signal: context.signal,
    operationClass: "read",
  });

  if (!result.ok) {
    return { kind: "failure", step: toCommandStep(result) };
  }

  if (isTruncatedOutput(result)) {
    return {
      kind: "failure",
      step: createFailureStep("fatal: the current branch read was truncated"),
    };
  }

  return { kind: "ok", branch: readFirstLine(result.stdout) };
}

/**
 * Reads the configured upstream of one branch.
 *
 * An empty result means the branch has no upstream. The read uses the explicit remotename and
 * remoteref atoms, so a remote name containing a slash is never split. A configured upstream that
 * does not yield both halves is a failure instead of being treated as absent, because auto-creating
 * `origin/<branch>` over a malformed configured upstream could push to an unintended place.
 *
 * @param context - Handler context carrying the root, client, and signal.
 * @param branch - Current branch name.
 * @returns The upstream descriptor, or a synthetic failure step.
 */
async function readConfiguredUpstream(
  context: CommandHandlerContext,
  branch: string,
): Promise<
  | { readonly kind: "ok"; readonly upstream: UpstreamDescriptor | null }
  | { readonly kind: "failure"; readonly step: CommandStepResult }
> {
  if (!isSafeGitName(branch)) {
    return { kind: "failure", step: createInvalidNameResult(`invalid branch name "${branch}"`) };
  }

  const result = await context.client.invoke({
    args: [
      "for-each-ref",
      "--format=%(upstream:remotename)%09%(upstream:remoteref)",
      `refs/heads/${branch}`,
    ],
    cwd: context.cwd,
    signal: context.signal,
    operationClass: "read",
  });

  if (!result.ok) {
    return { kind: "failure", step: toCommandStep(result) };
  }

  if (isTruncatedOutput(result)) {
    return {
      kind: "failure",
      step: createFailureStep("fatal: the configured upstream read was truncated"),
    };
  }

  const atoms = readFirstLine(result.stdout);

  if (atoms === null) {
    return { kind: "ok", upstream: null };
  }

  const upstream = parseUpstreamAtoms(atoms);

  if (upstream === null || !isSafeGitName(upstream.remote) || !isSafeGitName(upstream.branch)) {
    return {
      kind: "failure",
      step: createFailureStep(`fatal: could not read the configured upstream of "${branch}"`),
    };
  }

  return { kind: "ok", upstream };
}

/**
 * Reads the configured remote names with `git remote`.
 *
 * @param context - Handler context carrying the root, client, and signal.
 * @returns The remote names on success, or the failed invocation.
 */
async function readConfiguredRemotes(
  context: CommandHandlerContext,
): Promise<
  | { readonly ok: true; readonly remotes: readonly string[] }
  | { readonly ok: false; readonly result: GitInvocationResult }
> {
  const result = await context.client.invoke({
    args: ["remote"],
    cwd: context.cwd,
    signal: context.signal,
    operationClass: "read",
  });

  if (!result.ok || isTruncatedOutput(result)) {
    return { ok: false, result };
  }

  return { ok: true, remotes: readRemoteNames(result.stdout) };
}

/**
 * Splits `git remote` output into remote names.
 *
 * @param stdout - Captured output.
 * @returns Non-empty trimmed lines.
 */
function readRemoteNames(stdout: string): readonly string[] {
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * Reads the first non-empty line of captured output.
 *
 * @param stdout - Captured output.
 * @returns The trimmed first line, or null when the output is blank.
 */
function readFirstLine(stdout: string): string | null {
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();

    if (trimmed.length > 0) {
      return trimmed;
    }
  }

  return null;
}
