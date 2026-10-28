import { createGitProgressParser } from "@/domain/git/git.progress";
import {
  buildDeleteTrackingRefArgs,
  buildFetchTrackingRefArgs,
  buildLsRemoteHeadsArgs,
  buildRemotePruneArgs,
  isTruncatedOutput,
  parseLsRemoteHeads,
} from "@/domain/git/git.remotes";
import type { GitInvocationResult } from "@/domain/git/git.types";
import type { UpstreamDescriptor } from "@/domain/repository/repository.types";
import { invokeNetwork } from "./commands.invoke";
import { dedupeDescriptors } from "./commands.prune.outcome";
import type {
  RemoteHeadsCheck,
  RemotePruneDeleteRun,
  RemotePruneFetchRun,
  RemotePruneStepRun,
} from "./commands.prune.types";
import { createFailureStep, createInvalidNameResult, toCommandStep } from "./commands.steps";
import type { CommandHandlerContext, CommandStepResult } from "./commands.types";

/**
 * Confirms every head one remote advertises.
 *
 * A non-zero exit, a cancellation, a timeout, a truncated stream, or a non-empty but unparsable
 * output is a failed check. An empty clean response means the remote advertised no heads, which the
 * planner treats as confirmed absence for every in-scope ref. Truncation matters because the output
 * collector keeps only the head and tail: a branch listed in the dropped middle would otherwise look
 * absent and be deleted.
 *
 * @param context - Handler context carrying the root, client, and signal.
 * @param remote - Remote name.
 * @returns The parsed heads and the raw invocation result.
 */
export async function checkRemoteHeads(
  context: CommandHandlerContext,
  remote: string,
): Promise<RemoteHeadsCheck> {
  const args = buildLsRemoteHeadsArgs(remote);

  if (args === null) {
    return {
      ok: false,
      heads: [],
      result: createInvalidNameResult(`invalid remote name "${remote}"`),
    };
  }

  const result = await context.client.invoke({
    args,
    cwd: context.cwd,
    signal: context.signal,
    operationClass: "network",
  });
  const truncated = isTruncatedOutput(result);
  const heads = result.ok && !truncated ? parseLsRemoteHeads(result.stdout) : [];
  const malformed =
    result.ok && !truncated && heads.length === 0 && result.stdout.trim().length > 0;

  return { ok: result.ok && !truncated && !malformed, heads, result };
}

/**
 * Fetches every still-advertised in-scope ref of one remote.
 *
 * The first failure stops the fetch loop, because a later success could not make the group safe to
 * clean up. Every ref from the failure onward is reported unknown, and a failed fetch step is
 * non-fatal so a partial failure becomes a warning rather than the error surface.
 *
 * @param context - Handler context carrying the root, client, and signal.
 * @param remote - Remote name, used verbatim, including any slash it contains.
 * @param refs - In-scope upstream descriptors to fetch.
 * @returns The steps, fetched refs, unknown refs, and termination flags.
 */
export async function fetchPlanRefs(
  context: CommandHandlerContext,
  remote: string,
  refs: readonly UpstreamDescriptor[],
): Promise<RemotePruneFetchRun> {
  const steps: CommandStepResult[] = [];
  const fetchedRefs: UpstreamDescriptor[] = [];
  const unknownRefs: UpstreamDescriptor[] = [];

  for (const [index, descriptor] of refs.entries()) {
    const args = buildFetchTrackingRefArgs(remote, descriptor.branch);

    if (args === null) {
      unknownRefs.push(...refs.slice(index));

      return {
        steps,
        fetchedRefs,
        unknownRefs: dedupeDescriptors(unknownRefs),
        cancelled: false,
        timedOut: false,
      };
    }

    const result = await invokeNetwork(context, args, createGitProgressParser());

    steps.push(toCommandStep(result, !result.ok && !result.cancelled && !result.timedOut));

    if (result.ok) {
      fetchedRefs.push(descriptor);
      continue;
    }

    unknownRefs.push(...refs.slice(index));

    return {
      steps,
      fetchedRefs,
      unknownRefs: dedupeDescriptors(unknownRefs),
      cancelled: result.cancelled,
      timedOut: result.timedOut,
    };
  }

  return {
    steps,
    fetchedRefs,
    unknownRefs: dedupeDescriptors(unknownRefs),
    cancelled: false,
    timedOut: false,
  };
}

/**
 * Deletes every confirmed-stale tracking ref of one remote.
 *
 * A failed deletion marks only that ref unknown and keeps the remaining deletions running. The
 * invocation uses the write class because it mutates the local ref store.
 *
 * @param context - Handler context carrying the root, client, and signal.
 * @param remote - Remote name, used verbatim, including any slash it contains.
 * @param refs - Confirmed-stale upstream descriptors.
 * @returns The steps, deleted refs, unknown refs, and termination flags.
 */
export async function deletePlannedRefs(
  context: CommandHandlerContext,
  remote: string,
  refs: readonly UpstreamDescriptor[],
): Promise<RemotePruneDeleteRun> {
  const steps: CommandStepResult[] = [];
  const prunedRefs: UpstreamDescriptor[] = [];
  const unknownRefs: UpstreamDescriptor[] = [];

  for (const descriptor of refs) {
    const deletion = await deletePlannedRef(context, remote, descriptor);

    steps.push(deletion.step);

    if (deletion.ok) {
      prunedRefs.push(descriptor);
    } else {
      unknownRefs.push(descriptor);
    }

    if (deletion.cancelled || deletion.timedOut) {
      return {
        steps,
        prunedRefs,
        unknownRefs,
        cancelled: deletion.cancelled,
        timedOut: deletion.timedOut,
      };
    }
  }

  return { steps, prunedRefs, unknownRefs, cancelled: false, timedOut: false };
}

/**
 * Deletes one confirmed-stale tracking ref.
 *
 * @param context - Handler context carrying the root, client, and signal.
 * @param remote - Remote name, used verbatim, including any slash it contains.
 * @param descriptor - Confirmed-stale upstream descriptor.
 * @returns The step, success flag, and termination flags.
 */
async function deletePlannedRef(
  context: CommandHandlerContext,
  remote: string,
  descriptor: UpstreamDescriptor,
): Promise<RemotePruneStepRun> {
  const args = buildDeleteTrackingRefArgs(remote, descriptor.branch);

  if (args === null) {
    return {
      step: createFailureStep(`fatal: invalid remote-tracking ref "${descriptor.ref}"`),
      ok: false,
      cancelled: false,
      timedOut: false,
    };
  }

  const result = await context.client.invoke({
    args,
    cwd: context.cwd,
    signal: context.signal,
    operationClass: "write",
  });

  return {
    step: toCommandStep(result, !result.ok && !result.cancelled && !result.timedOut),
    ok: result.ok,
    cancelled: result.cancelled,
    timedOut: result.timedOut,
  };
}

/**
 * Removes every stale remote-tracking ref of one remote.
 *
 * The scoped fetch mirrors only the upstream refs, so a tracking ref whose branch no longer exists
 * on the remote outlives it when no local branch tracks that branch. `git remote prune` closes that
 * gap in one invocation: it compares the remote against the configured fetch refspecs and deletes
 * only refs whose source is gone, so a ref mapped from a still-existing namespace such as
 * `refs/pull/<n>/head` is kept. Deletion is remote-wide by design, which is why the caller runs it
 * only for a `local`-scoped remote whose check and fetch already succeeded, and always before the
 * explicit per-ref deletes.
 *
 * @param context - Handler context carrying the root, client, and signal.
 * @param remote - Remote name, used verbatim, including any slash it contains.
 * @returns The step, success flag, and termination flags.
 */
export async function pruneStaleRemoteRefs(
  context: CommandHandlerContext,
  remote: string,
): Promise<RemotePruneStepRun> {
  const args = buildRemotePruneArgs(remote);

  if (args === null) {
    // Defense-in-depth only; upstream remote names are already validated by the scope reader.
    return {
      step: createFailureStep(`fatal: invalid remote name "${remote}"`),
      ok: false,
      cancelled: false,
      timedOut: false,
    };
  }

  context.notifyProgress({ phase: `pruning ${remote}` });

  const result = await context.client.invoke({
    args,
    cwd: context.cwd,
    signal: context.signal,
    operationClass: "network",
  });

  return {
    step: toPruneStep(result),
    ok: result.ok,
    cancelled: result.cancelled,
    timedOut: result.timedOut,
  };
}

/**
 * Converts a settled remote-wide prune invocation into a non-fatal command step.
 *
 * The prune phase is excluded from the group's result and from its freshness evidence, so its step
 * must not be able to relabel the command either. A non-zero exit is marked non-fatal, which keeps
 * a failure or a timeout on the step and in the warnings instead of failing or timing out the
 * command. The step keeps its exact argv, exit status, duration, output, and termination flags, and
 * a cancellation still stops the run.
 *
 * @param result - Settled `git remote prune` invocation.
 * @returns The step, marked non-fatal for every non-zero outcome.
 */
function toPruneStep(result: GitInvocationResult): CommandStepResult {
  return toCommandStep(result, !result.ok);
}

/**
 * Reports whether every planned fetch succeeded.
 *
 * @param run - Fetch run for one group.
 * @param plannedCount - Number of refs the plan asked to fetch.
 * @returns True when every planned ref was fetched and nothing was cancelled or timed out.
 */
export function isCleanFetch(run: RemotePruneFetchRun, plannedCount: number): boolean {
  return (
    run.unknownRefs.length === 0 &&
    run.fetchedRefs.length === plannedCount &&
    !run.cancelled &&
    !run.timedOut
  );
}
