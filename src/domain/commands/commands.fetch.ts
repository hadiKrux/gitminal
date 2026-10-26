import { createGitProgressParser } from "@/domain/git/git.progress";
import {
  buildFetchTrackingRefArgs,
  buildUpstreamGroupsArgs,
  isTruncatedOutput,
} from "@/domain/git/git.remotes";
import type { RemoteFetchGroup } from "@/domain/git/git.remotes.types";
import type { GitInvocationResult } from "@/domain/git/git.types";
import { readEmptyFetchScopeReason, readScopedUpstreamGroups } from "./commands.fetch.scope";
import type { RemoteFetchRun } from "./commands.fetch.types";
import { toCommandStep } from "./commands.steps";
import type {
  CommandExecutionOutcome,
  CommandHandlerContext,
  CommandRemoteResult,
  CommandStepResult,
} from "./commands.types";

/**
 * Executes the spec-conformant `remote.fetch` mutation.
 *
 * The request's effective scope decides the refs. `local`, the product default, fetches the upstream
 * refs of every local branch, while `current` fetches only the checked-out branch's upstream. Groups
 * are deduplicated by remote, so each remote is contacted once. Each explicit refspec is fetched
 * with `--progress` and the network operation class, so no invocation can hang and progress reaches
 * the status strip. One failed remote or ref does not stop the remaining groups. A scope with no
 * upstream refs is a blocked outcome: `no-current-upstream` for the current scope and
 * `no-local-upstreams` otherwise. A configured upstream whose remote ref is gone is a non-fatal
 * warning rather than a command failure. Each remote is reported through `remoteResults` so the app
 * layer records evidence only for remotes that were actually reached.
 *
 * @param context - Request, repository root, git client, signal, and progress callback.
 * @returns The ordered steps, per-remote results, warnings, and any cancellation, timeout, or
 * blocked flag.
 */
export async function executeRemoteFetch(
  context: CommandHandlerContext,
): Promise<CommandExecutionOutcome> {
  const upstreams = await context.client.invoke({
    args: buildUpstreamGroupsArgs(),
    cwd: context.cwd,
    signal: context.signal,
    operationClass: "read",
  });

  if (!upstreams.ok || isTruncatedOutput(upstreams)) {
    return { steps: [toCommandStep(upstreams)], failed: true };
  }

  const groups = readScopedUpstreamGroups(upstreams.stdout, context.request.formValues);

  if (groups.length === 0) {
    return {
      steps: [],
      blockedReason: readEmptyFetchScopeReason(context.request.formValues),
    };
  }

  const steps: CommandStepResult[] = [];
  const remoteResults: CommandRemoteResult[] = [];
  const warnings: string[] = [];

  for (const group of groups) {
    const run = await runFetchGroup(context, group);

    steps.push(...run.steps);
    warnings.push(...run.warnings);
    remoteResults.push(run.remoteResult);

    if (run.cancelled || run.timedOut) {
      return {
        steps,
        remoteResults,
        cancelled: run.cancelled,
        timedOut: run.timedOut,
        warnings,
      };
    }
  }

  return { steps, remoteResults, warnings };
}

/**
 * Fetches every ref in one remote group and derives that remote's result.
 *
 * @param context - Handler context carrying the root and signal.
 * @param group - Remote name and its distinct upstream refs.
 * @returns The steps, warnings, per-remote result, and termination flags for the group.
 */
async function runFetchGroup(
  context: CommandHandlerContext,
  group: RemoteFetchGroup,
): Promise<RemoteFetchRun> {
  const steps: CommandStepResult[] = [];
  const warnings: string[] = [];
  let succeeded = true;

  for (const descriptor of group.refs) {
    const args = buildFetchTrackingRefArgs(descriptor.remote, descriptor.branch);

    if (args === null) {
      succeeded = false;
      steps.push(createInvalidRefStep(descriptor.ref));

      continue;
    }

    const result = await fetchRef(context, args);
    const missingUpstream = isMissingRemoteRef(result);

    steps.push(toCommandStep(result, missingUpstream));

    if (missingUpstream) {
      warnings.push(`upstream not found for ${descriptor.ref}`);
    } else if (!result.ok) {
      succeeded = false;
    }

    if (result.cancelled || result.timedOut) {
      return {
        steps,
        warnings,
        remoteResult: { remote: group.remote, succeeded: false },
        cancelled: result.cancelled,
        timedOut: result.timedOut,
      };
    }
  }

  return {
    steps,
    warnings,
    remoteResult: { remote: group.remote, succeeded },
    cancelled: false,
    timedOut: false,
  };
}

/**
 * Reports whether one fetch failed because the remote branch no longer exists.
 *
 * A normal scoped Fetch treats a configured upstream whose remote ref is gone as a supported state,
 * not a failure: the branch is marked `[?] upstream not found`, the command keeps the step and
 * reports success with a warning, and the error surface stays closed.
 *
 * @param result - Settled fetch invocation.
 * @returns True for the documented missing-remote-ref outcomes.
 */
function isMissingRemoteRef(result: GitInvocationResult): boolean {
  if (result.ok) {
    return false;
  }

  return /couldn't find remote ref|could not find remote ref|remote ref does not exist/i.test(
    result.stderr,
  );
}

/**
 * Fetches one upstream ref with progress reporting.
 *
 * The destination is a remote-tracking ref with the forced-update prefix, which mirrors what a plain
 * `git fetch <remote>` does for `refs/remotes/**`. Without the prefix, an amended, rebased, or
 * force-pushed upstream is rejected as non-fast-forward and its tracking ref stays stale. A local
 * branch is never a destination.
 *
 * @param context - Handler context carrying the root and signal.
 * @param args - Validated fetch argument array.
 * @returns The settled invocation.
 */
async function fetchRef(
  context: CommandHandlerContext,
  args: readonly string[],
): Promise<GitInvocationResult> {
  const parser = createGitProgressParser();
  const result = await context.client.invoke({
    args,
    cwd: context.cwd,
    signal: context.signal,
    operationClass: "network",
    onStderr: (chunk) => {
      for (const event of parser.push(chunk)) {
        context.notifyProgress(event);
      }
    },
  });

  for (const event of parser.flush()) {
    context.notifyProgress(event);
  }

  return result;
}

/**
 * Builds a failed step for a configured upstream that is unsafe as one argv value.
 *
 * @param ref - Rejected upstream ref.
 * @returns A step with no argv and a naming error.
 */
function createInvalidRefStep(ref: string): CommandStepResult {
  return {
    argv: [],
    exitCode: 1,
    durationMs: 0,
    stdout: "",
    stderr: `fatal: invalid configured upstream "${ref}"`,
  };
}
