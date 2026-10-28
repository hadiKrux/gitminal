import {
  buildUpstreamGroupsArgs,
  isTruncatedOutput,
  planPruneDeletions,
} from "@/domain/git/git.remotes";
import type { PrunePlan, RemoteFetchGroup } from "@/domain/git/git.remotes.types";
import type { UpstreamDescriptor } from "@/domain/repository/repository.types";
import {
  readEmptyFetchScopeReason,
  readFetchScope,
  readScopedUpstreamGroups,
} from "./commands.fetch.scope";
import {
  buildPruneOutcome,
  buildUnknownGroup,
  countLabel,
  createPruneRun,
  dedupeDescriptors,
  mergePruneGroup,
} from "./commands.prune.outcome";
import {
  checkRemoteHeads,
  deletePlannedRefs,
  fetchPlanRefs,
  isCleanFetch,
  pruneStaleRemoteRefs,
} from "./commands.prune.phases";
import type {
  RemoteHeadsCheck,
  RemotePruneCleanupRun,
  RemotePruneDeleteRun,
  RemotePruneFetchRun,
  RemotePruneGroupRun,
  RemotePruneStepRun,
} from "./commands.prune.types";
import { toCommandStep } from "./commands.steps";
import type {
  CommandExecutionOutcome,
  CommandHandlerContext,
  CommandStepResult,
} from "./commands.types";

/**
 * Fetch --prune executor: confirm absence, fetch what is left, and clean up the tracking refs.
 *
 * The group flow is deliberately ordered. The remote check proves which in-scope refs are absent,
 * the scoped fetch updates the ones that still exist, and only then does cleanup run: first the
 * remote-wide `git remote prune -- <remote>`, then the explicit `git update-ref -d` deletes for the
 * refs whose absence the check confirmed. The prune runs first so a failed explicit delete really
 * leaves the ref kept locally instead of being removed by the prune that follows it, and so a
 * cancelled prune can skip the deletes for that group. The prune never relabels the operation: the
 * check and the fetch already succeeded, so a failed or timed-out prune is a warning, while
 * cancellation still stops the run.
 */

/**
 * Executes Fetch --prune.
 *
 * The request's effective scope selects the remotes exactly like `remote.fetch`: `local` uses the
 * upstreams of every local branch and `current` uses only the checked-out branch's upstream, with
 * `no-current-upstream` when it has none. Each remote group confirms its advertised heads with
 * `git ls-remote --heads`, fetches the still-advertised in-scope refs, and then runs the cleanup
 * phases described above.
 *
 * The prune is remote-wide because git defines it per remote, while the evidence lists report only
 * in-scope refs. Under `current` those two views cannot agree, so the prune is skipped and the exact
 * per-ref deletes remain the only cleanup: otherwise the prune would remove other branches' tracking
 * refs that no in-scope evidence list can report, and those upstreams would be misclassified as gone.
 *
 * A failed check or fetch makes that group unknown, skips its cleanup, and keeps its refs out of
 * `prunedUpstreamRefs`, so the app layer can record failure evidence instead of claiming a deletion.
 * Other groups still run. A group failure is marked non-fatal, which turns partial success into a
 * warning status instead of the error surface.
 *
 * @param context - Request, repository root, git client, signal, and progress callback.
 * @returns The steps, per-remote results, confirmed and unknown refs, warnings, and termination flags.
 */
export async function executeRemoteFetchPrune(
  context: CommandHandlerContext,
): Promise<CommandExecutionOutcome> {
  const groupsRead = await context.client.invoke({
    args: buildUpstreamGroupsArgs(),
    cwd: context.cwd,
    signal: context.signal,
    operationClass: "read",
  });

  if (!groupsRead.ok || isTruncatedOutput(groupsRead)) {
    return { steps: [toCommandStep(groupsRead)], failed: true };
  }

  const groups = readScopedUpstreamGroups(groupsRead.stdout, context.request.formValues);

  if (groups.length === 0) {
    return {
      steps: [],
      blockedReason: readEmptyFetchScopeReason(context.request.formValues),
    };
  }

  const run = createPruneRun();

  for (const group of groups) {
    const groupRun = await runPruneGroup(context, group);

    mergePruneGroup(run, groupRun);

    if (groupRun.cancelled || groupRun.timedOut) {
      return buildPruneOutcome(run, groupRun.cancelled, groupRun.timedOut);
    }
  }

  return buildPruneOutcome(run, false, false);
}

/**
 * Runs every phase for one remote group.
 *
 * The cleanup phases run only after a clean check and a clean fetch, because a partial fetch cannot
 * prove the group is safe to clean up.
 *
 * @param context - Handler context carrying the root, client, and signal.
 * @param group - Remote name and its distinct upstream refs.
 * @returns The group's steps, result, refs, warnings, counts, and termination flags.
 */
async function runPruneGroup(
  context: CommandHandlerContext,
  group: RemoteFetchGroup,
): Promise<RemotePruneGroupRun> {
  context.notifyProgress({ phase: `checking ${group.remote}` });

  const check = await checkRemoteHeads(context, group.remote);

  if (!check.ok) {
    return buildUnknownGroup(
      toCommandStep(check.result, !check.result.cancelled && !check.result.timedOut),
      group,
      `${group.remote}: remote check failed; kept ${countLabel(group.refs.length, "upstream")}`,
      check.result,
    );
  }

  const plan = planPruneDeletions(group.remote, group.refs, check.heads);
  const fetchRun = await fetchPlanRefs(context, group.remote, plan.fetchRefs);

  return isCleanFetch(fetchRun, plan.fetchRefs.length)
    ? await runPruneCleanupPhases(context, group, check, fetchRun, plan)
    : buildPruneFetchFailure(group.remote, plan, check, fetchRun);
}

/**
 * Builds the group result for a fetch phase that did not finish cleanly.
 *
 * Every ref the plan confirmed stale stays unknown, because a partial fetch cannot prove the group
 * is safe to clean up. Only the failing fetch step is marked non-fatal, so a partial failure becomes
 * a warning while each completed step keeps its real exit status.
 *
 * @param remote - Remote name, used verbatim, including any slash it contains.
 * @param plan - Fetch and delete plan for this group.
 * @param check - Successful remote check that produced the plan.
 * @param fetchRun - Settled fetch phase.
 * @returns The group result with no deletes and no prune.
 */
function buildPruneFetchFailure(
  remote: string,
  plan: PrunePlan,
  check: RemoteHeadsCheck,
  fetchRun: RemotePruneFetchRun,
): RemotePruneGroupRun {
  const unknownRefs = dedupeDescriptors(plan.deleteRefs, fetchRun.unknownRefs);

  return {
    steps: [toCommandStep(check.result), ...fetchRun.steps],
    remoteResult: { remote, succeeded: false },
    prunedRefs: [],
    unknownRefs,
    warnings: [`${remote}: fetch failed; kept ${countLabel(unknownRefs.length, "upstream")}`],
    fetchedCount: fetchRun.fetchedRefs.length,
    missingCount: plan.deleteRefs.length,
    cancelled: fetchRun.cancelled,
    timedOut: fetchRun.timedOut,
  };
}

/**
 * Runs the cleanup phases for a group whose check and fetch finished cleanly.
 *
 * The group's `remoteResult`, `prunedRefs`, and `unknownRefs` come from the per-ref deletes.
 * `timedOut` comes only from the deletes: the remote-wide prune is deliberately excluded, because
 * the fetch already succeeded. `cancelled` also includes a cancelled prune, which skips the deletes
 * for this group. The prune contributes steps and warnings only, so a prune that fails or times out
 * never turns a successful fetch into a failure or a timeout.
 *
 * @param context - Handler context carrying the root, client, and signal.
 * @param group - Remote and its in-scope upstream refs.
 * @param check - Successful remote check that produced the plan.
 * @param fetchRun - Clean fetch phase.
 * @param plan - Fetch and delete plan for this group.
 * @returns The group result with its steps, refs, warnings, and termination flags.
 */
async function runPruneCleanupPhases(
  context: CommandHandlerContext,
  group: RemoteFetchGroup,
  check: RemoteHeadsCheck,
  fetchRun: RemotePruneFetchRun,
  plan: PrunePlan,
): Promise<RemotePruneGroupRun> {
  const cleanup = await runCleanupPhases(context, group.remote, plan.deleteRefs);
  const deleteRun = cleanup.deleteRun;
  const failed = deleteRun.unknownRefs.length > 0 || deleteRun.cancelled || deleteRun.timedOut;

  return {
    steps: buildPruneSteps(check, fetchRun, cleanup),
    remoteResult: { remote: group.remote, succeeded: !failed },
    prunedRefs: deleteRun.prunedRefs,
    unknownRefs: deleteRun.unknownRefs,
    warnings: buildPruneWarnings(group.remote, deleteRun.unknownRefs, cleanup.pruneRun),
    fetchedCount: fetchRun.fetchedRefs.length,
    missingCount: plan.deleteRefs.length,
    cancelled: deleteRun.cancelled || cleanup.pruneRun?.cancelled === true,
    timedOut: deleteRun.timedOut,
  };
}

/**
 * Runs the remote-wide prune and the explicit per-ref deletes in that order.
 *
 * The prune is skipped entirely under the `current` scope, because it deletes refs that the scope's
 * evidence lists cannot report. A cancelled prune ends the group's cleanup: the explicit deletes are
 * skipped and every planned ref stays unknown instead of being reported as deleted.
 *
 * @param context - Handler context carrying the root, client, signal, and request.
 * @param remote - Remote name, used verbatim, including any slash it contains.
 * @param refs - Confirmed-stale upstream descriptors to delete explicitly.
 * @returns The settled prune and delete phases.
 */
async function runCleanupPhases(
  context: CommandHandlerContext,
  remote: string,
  refs: readonly UpstreamDescriptor[],
): Promise<RemotePruneCleanupRun> {
  const pruneRun = shouldPruneRemoteWide(context)
    ? await pruneStaleRemoteRefs(context, remote)
    : null;

  if (pruneRun?.cancelled === true) {
    return { pruneRun, deleteRun: buildSkippedDeleteRun(refs) };
  }

  return { pruneRun, deleteRun: await deletePlannedRefs(context, remote, refs) };
}

/**
 * Builds the delete phase for a group whose prune was cancelled.
 *
 * @param refs - Confirmed-stale upstream descriptors that never reached a delete invocation.
 * @returns A cancelled delete phase with no steps and every planned ref unknown.
 */
function buildSkippedDeleteRun(refs: readonly UpstreamDescriptor[]): RemotePruneDeleteRun {
  return {
    steps: [],
    prunedRefs: [],
    unknownRefs: [...refs],
    cancelled: true,
    timedOut: false,
  };
}

/**
 * Concatenates one group's steps in execution order.
 *
 * @param check - Successful remote check that produced the plan.
 * @param fetchRun - Clean fetch phase.
 * @param cleanup - Settled cleanup phases.
 * @returns Every step of the group, in the order the invocations ran.
 */
function buildPruneSteps(
  check: RemoteHeadsCheck,
  fetchRun: RemotePruneFetchRun,
  cleanup: RemotePruneCleanupRun,
): readonly CommandStepResult[] {
  return [
    toCommandStep(check.result),
    ...fetchRun.steps,
    ...(cleanup.pruneRun === null ? [] : [cleanup.pruneRun.step]),
    ...cleanup.deleteRun.steps,
  ];
}

/**
 * Reports whether the group may run the remote-wide prune.
 *
 * The prune removes every stale tracking ref of the remote, while the evidence lists report only
 * the in-scope refs of the effective fetch scope. Under `current` those lists cannot describe the
 * refs the prune would remove, so another local branch's tracking ref would be classified as gone
 * instead of deleted-by-prune. The `local` scope covers every local branch upstream, so it is the
 * only scope where a remote-wide prune and its evidence stay consistent.
 *
 * @param context - Handler context carrying the request form values.
 * @returns True only for the `local` fetch scope, which is also the documented default.
 */
function shouldPruneRemoteWide(context: CommandHandlerContext): boolean {
  return readFetchScope(context.request.formValues) === "local";
}

/**
 * Builds the per-ref and prune warnings for one group.
 *
 * A failed or timed-out prune is a warning only: the fetch already succeeded, so the group keeps its
 * result and its freshness evidence. A cancelled prune is reported by the result flags instead.
 * After a successful prune the refs are most likely already gone, so a failed explicit delete says
 * the removal could not be confirmed instead of claiming the ref was kept. The `kept it locally`
 * wording is reserved for a delete that failed while the prune did not run or did not succeed.
 *
 * @param remote - Remote name, used verbatim, including any slash it contains.
 * @param unknownRefs - Refs whose explicit deletion failed or never ran.
 * @param pruneRun - Settled prune phase, or null when the scope skipped it.
 * @returns The ordered warnings.
 */
function buildPruneWarnings(
  remote: string,
  unknownRefs: readonly UpstreamDescriptor[],
  pruneRun: RemotePruneStepRun | null,
): readonly string[] {
  const pruneSucceeded = pruneRun?.ok === true;
  const warnings = unknownRefs.map((descriptor) =>
    pruneSucceeded
      ? `${remote}: could not confirm removal of ${descriptor.ref}`
      : `${remote}: could not delete ${descriptor.ref}; kept it locally`,
  );

  if (pruneRun === null || pruneRun.ok || pruneRun.cancelled) {
    return warnings;
  }

  return [
    ...warnings,
    pruneRun.timedOut
      ? `${remote}: prune timed out; stale refs kept`
      : `${remote}: prune failed; stale refs kept`,
  ];
}
