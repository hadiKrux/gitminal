import { createGitProgressParser } from "@/domain/git/git.progress";
import type { GitClient, GitInvocationResult } from "@/domain/git/git.types";
import { parseUpstreamRef } from "@/domain/repository/repository.upstream";
import type { RemoteFetchGroup, RemoteFetchRun } from "./commands.fetch.types";
import type {
  CommandExecutionOutcome,
  CommandHandlerContext,
  CommandRemoteResult,
  CommandStepResult,
} from "./commands.types";

/** Arguments that list the configured upstream of every local branch. */
const UPSTREAM_REFS_ARGS: readonly string[] = Object.freeze([
  "for-each-ref",
  "--format=%(refname:short) %(upstream:short)",
  "refs/heads",
]);

/**
 * Executes the spec-conformant `remote.fetch` mutation.
 *
 * Fetch is scoped to the upstream refs of local branches, grouped by remote and deduplicated, which
 * is the product default scope. Each explicit refspec is fetched with `--progress` and the network
 * operation class, so no invocation can hang and progress reaches the status strip. One failed
 * remote or ref does not stop the remaining groups. A scope with no upstream refs is a blocked
 * outcome, and a configured upstream whose remote ref is gone is a non-fatal warning rather than a
 * command failure. Each remote is reported through `remoteResults` so the app layer records evidence
 * only for remotes that were actually reached.
 *
 * @param context - Request, repository root, git client, signal, and progress callback.
 * @returns The ordered steps, per-remote results, warnings, and any cancellation, timeout, or
 * blocked flag.
 */
export async function executeRemoteFetch(
  context: CommandHandlerContext,
): Promise<CommandExecutionOutcome> {
  const upstreams = await context.client.invoke({
    args: UPSTREAM_REFS_ARGS,
    cwd: context.cwd,
    signal: context.signal,
    operationClass: "read",
  });

  if (!upstreams.ok) {
    return { steps: [toStep(upstreams)] };
  }

  const groups = readFetchGroups(upstreams.stdout);

  if (groups.length === 0) {
    return { steps: [], blockedReason: "no-local-upstreams" };
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

  for (const ref of group.refs) {
    const descriptor = parseUpstreamRef(ref);

    if (descriptor === null) {
      continue;
    }

    const result = await fetchRef(context.client, context, descriptor.remote, descriptor.branch);
    const missingUpstream = isMissingRemoteRef(result);

    steps.push(toStep(result, missingUpstream));

    if (missingUpstream) {
      warnings.push(`upstream not found for ${descriptor.branch}`);
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
 * @param client - Git client bound to the configured executable.
 * @param context - Handler context carrying the root and signal.
 * @param remote - Remote name.
 * @param branch - Branch name inside that remote.
 * @returns The settled invocation.
 */
async function fetchRef(
  client: GitClient,
  context: CommandHandlerContext,
  remote: string,
  branch: string,
): Promise<GitInvocationResult> {
  const parser = createGitProgressParser();
  const result = await client.invoke({
    args: ["fetch", "--progress", remote, `+refs/heads/${branch}:refs/remotes/${remote}/${branch}`],
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
 * Groups configured upstream refs by remote.
 *
 * @param stdout - Captured `for-each-ref` output.
 * @returns Remote groups in first-seen order with sorted distinct refs.
 */
function readFetchGroups(stdout: string): readonly RemoteFetchGroup[] {
  const grouped = new Map<string, Set<string>>();

  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();

    if (trimmed.length === 0) {
      continue;
    }

    const separator = trimmed.indexOf(" ");

    if (separator < 0) {
      continue;
    }

    const upstream = trimmed.slice(separator + 1).trim();
    const descriptor = parseUpstreamRef(upstream);

    if (descriptor === null) {
      continue;
    }

    const refs = grouped.get(descriptor.remote) ?? new Set<string>();
    refs.add(upstream);
    grouped.set(descriptor.remote, refs);
  }

  return [...grouped.entries()].map(([remote, refs]) => ({
    remote,
    refs: [...refs].sort(),
  }));
}

/**
 * Converts one invocation result into a command step.
 *
 * @param result - Settled invocation.
 * @param nonFatal - True when a non-zero exit is the documented missing-upstream outcome.
 * @returns The command step.
 */
function toStep(result: GitInvocationResult, nonFatal: boolean = false): CommandStepResult {
  return {
    argv: result.argv,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    stdout: result.stdout,
    stderr: result.stderr,
    cancelled: result.cancelled || undefined,
    timedOut: result.timedOut || undefined,
    nonFatal: nonFatal || undefined,
  };
}
