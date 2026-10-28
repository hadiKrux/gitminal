import type { RemoteFetchGroup } from "@/domain/git/git.remotes.types";
import type { GitInvocationResult } from "@/domain/git/git.types";
import type { UpstreamDescriptor } from "@/domain/repository/repository.types";
import type {
  RemotePruneAccumulator,
  RemotePruneGroupRun,
  RemotePruneRun,
} from "./commands.prune.types";
import type { CommandExecutionOutcome, CommandStepResult } from "./commands.types";

/**
 * Creates an empty accumulator for a prune run.
 *
 * @returns The mutable accumulator.
 */
export function createPruneRun(): RemotePruneAccumulator {
  return {
    steps: [],
    remoteResults: [],
    prunedRefs: [],
    unknownRefs: [],
    warnings: [],
    fetchedCount: 0,
    missingCount: 0,
    failedRemoteCount: 0,
  };
}

/**
 * Merges one group result into the accumulator.
 *
 * @param run - Accumulator to update.
 * @param group - Group result to merge.
 */
export function mergePruneGroup(run: RemotePruneAccumulator, group: RemotePruneGroupRun): void {
  run.steps.push(...group.steps);
  run.remoteResults.push(group.remoteResult);
  run.prunedRefs.push(...group.prunedRefs);
  run.unknownRefs.push(...group.unknownRefs);
  run.warnings.push(...group.warnings);
  run.fetchedCount += group.fetchedCount;
  run.missingCount += group.missingCount;

  if (!group.remoteResult.succeeded) {
    run.failedRemoteCount += 1;
  }
}

/**
 * Builds the final prune outcome and its partial-success warning.
 *
 * @param run - Accumulated result.
 * @param cancelled - True when the run was cancelled.
 * @param timedOut - True when the run timed out.
 * @returns The command outcome.
 */
export function buildPruneOutcome(
  run: RemotePruneRun,
  cancelled: boolean,
  timedOut: boolean,
): CommandExecutionOutcome {
  const summary = buildPruneSummary(run);
  const warnings = summary === null ? [...run.warnings] : [...run.warnings, summary];
  const totalFailure = isTotalPruneFailure(run);

  return {
    steps: run.steps,
    remoteResults: run.remoteResults,
    prunedUpstreamRefs: toRefList(run.prunedRefs),
    unknownUpstreamRefs: toRefList(run.unknownRefs),
    warnings,
    failed: totalFailure || undefined,
    cancelled: cancelled || undefined,
    timedOut: timedOut || undefined,
  };
}

/**
 * Builds a group result for a failed remote check.
 *
 * @param checkStep - Step for the failed check.
 * @param group - Remote group whose check failed.
 * @param warning - Per-remote warning naming the kept upstreams.
 * @param result - Raw check result, used for its termination flags.
 * @returns The unknown group result.
 */
export function buildUnknownGroup(
  checkStep: CommandStepResult,
  group: RemoteFetchGroup,
  warning: string,
  result: GitInvocationResult,
): RemotePruneGroupRun {
  return {
    steps: [checkStep],
    remoteResult: { remote: group.remote, succeeded: false },
    prunedRefs: [],
    unknownRefs: [...group.refs],
    warnings: [warning],
    fetchedCount: 0,
    missingCount: 0,
    cancelled: result.cancelled,
    timedOut: result.timedOut,
  };
}

/**
 * Dedupes upstream descriptors by remote and branch and sorts them by display ref.
 *
 * @param lists - Descriptor lists to merge.
 * @returns Sorted distinct descriptors.
 */
export function dedupeDescriptors(
  ...lists: readonly (readonly UpstreamDescriptor[])[]
): readonly UpstreamDescriptor[] {
  const unique = new Map<string, UpstreamDescriptor>();

  for (const list of lists) {
    for (const descriptor of list) {
      unique.set(`${descriptor.remote}\t${descriptor.branch}`, descriptor);
    }
  }

  return [...unique.values()].sort((left, right) => {
    if (left.ref < right.ref) {
      return -1;
    }

    return left.ref > right.ref ? 1 : 0;
  });
}

/**
 * Maps upstream descriptors to their sorted distinct display refs.
 *
 * @param descriptors - Descriptors to map.
 * @returns Sorted unique display refs such as `origin/main`.
 */
function toRefList(descriptors: readonly UpstreamDescriptor[]): readonly string[] {
  return [...new Set(descriptors.map((descriptor) => descriptor.ref))].sort();
}

/**
 * Reports whether every remote group failed without fetching or pruning anything.
 *
 * A partial failure stays a success with warnings. A run where nothing succeeded is a failure, so the
 * console and failure surface tell the truth instead of reporting a successful prune.
 *
 * @param run - Accumulated result.
 * @returns True when at least one group ran and no group succeeded with any effect.
 */
function isTotalPruneFailure(run: RemotePruneRun): boolean {
  return (
    run.remoteResults.length > 0 &&
    run.remoteResults.every((result) => !result.succeeded) &&
    run.fetchedCount === 0 &&
    run.prunedRefs.length === 0
  );
}

/**
 * Builds the one-line partial-success summary.
 *
 * A clean run has no summary. Missing upstream refs and failed remotes are reported together with
 * the refs that were fetched, so partial success never reads as a total failure or a total success.
 *
 * @param run - Accumulated result.
 * @returns The summary, or null when nothing needs reporting.
 */
function buildPruneSummary(run: RemotePruneRun): string | null {
  const parts: string[] = [];

  if (run.fetchedCount > 0) {
    parts.push(`Fetched ${countLabel(run.fetchedCount, "upstream")}`);
  }

  if (run.missingCount > 0) {
    parts.push(`${countLabel(run.missingCount, "upstream")} missing`);
  }

  if (run.failedRemoteCount > 0) {
    parts.push(`${countLabel(run.failedRemoteCount, "remote")} failed`);
  }

  return parts.length === 0 ? null : parts.join("; ");
}

/**
 * Formats a count with a singular or plural noun.
 *
 * @param count - Number of items.
 * @param noun - Singular noun.
 * @returns The count and the correctly pluralized noun.
 */
export function countLabel(count: number, noun: string): string {
  return count === 1 ? `1 ${noun}` : `${count} ${noun}s`;
}
