import { createGitProgressParser } from "@/domain/git/git.progress";
import {
  buildDeleteTrackingRefArgs,
  buildFetchTrackingRefArgs,
  buildLsRemoteHeadsArgs,
  buildPullArgs,
  buildPushArgs,
  buildUpstreamGroupsArgs,
  isSafeGitName,
  isTruncatedOutput,
  PUSH_AUTO_CREATE_REMOTE,
  parseLsRemoteHeads,
  planPruneDeletions,
} from "@/domain/git/git.remotes";
import type { PushMode, RemoteFetchGroup } from "@/domain/git/git.remotes.types";
import type { GitInvocationResult, GitProgressParser } from "@/domain/git/git.types";
import type { UpstreamDescriptor } from "@/domain/repository/repository.types";
import { parseUpstreamAtoms } from "@/domain/repository/repository.upstream";
import { readEmptyFetchScopeReason, readScopedUpstreamGroups } from "./commands.fetch.scope";
import type {
  RemoteHeadsCheck,
  RemotePruneDeleteRun,
  RemotePruneFetchRun,
  RemotePruneGroupRun,
  RemotePruneRun,
} from "./commands.remote.types";
import { toCommandStep } from "./commands.steps";
import type {
  CommandExecutionOutcome,
  CommandHandlerContext,
  CommandStepResult,
} from "./commands.types";

/**
 * Remote command executors: pull, push, and the two-phase Fetch --prune.
 *
 * Pull and push share the network invocation and synthetic-step helpers. Fetch --prune adds its own
 * per-remote accumulator and sharing the outcome types keeps the three commands in one place; the
 * prune orchestration is intentionally retained here rather than split into a second module, because
 * the pieces share the same step, warning, and termination vocabulary and a split would duplicate
 * that plumbing.
 *
 * Size debt: this module is past the file-review threshold. Extract the prune orchestration to
 * `commands.prune.ts` (and, if useful, the push and upstream readers to `commands.remote.push.ts`)
 * when a fourth composite remote command lands, or before the v1 freeze. The v1 extraction target is
 * recorded in `00-project-architecture.md` and `02-top-bar.md`.
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
 * Executes the two-phase Fetch --prune.
 *
 * The request's effective scope narrows the read exactly like `remote.fetch`: `local` uses the
 * upstreams of every local branch and `current` uses only the checked-out branch's upstream, with
 * `no-current-upstream` when it has none. Phase one confirms each affected remote's heads with
 * `git ls-remote --heads`. Phase two fetches the still-advertised in-scope refs and deletes only the
 * tracking refs whose absence was confirmed.
 * A failed check or fetch makes that group unknown, skips its delete phase, and keeps its refs out of
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

  if (!isCleanFetch(fetchRun, plan.fetchRefs.length)) {
    const unknownRefs = dedupeDescriptors(plan.deleteRefs, fetchRun.unknownRefs);

    return {
      steps: [toCommandStep(check.result), ...fetchRun.steps],
      remoteResult: { remote: group.remote, succeeded: false },
      prunedRefs: [],
      unknownRefs,
      warnings: [
        `${group.remote}: fetch failed; kept ${countLabel(unknownRefs.length, "upstream")}`,
      ],
      fetchedCount: fetchRun.fetchedRefs.length,
      missingCount: plan.deleteRefs.length,
      cancelled: fetchRun.cancelled,
      timedOut: fetchRun.timedOut,
    };
  }

  const deleteRun = await deletePlannedRefs(context, group.remote, plan.deleteRefs);
  const failed = deleteRun.unknownRefs.length > 0 || deleteRun.cancelled || deleteRun.timedOut;

  return {
    steps: [toCommandStep(check.result), ...fetchRun.steps, ...deleteRun.steps],
    remoteResult: { remote: group.remote, succeeded: !failed },
    prunedRefs: deleteRun.prunedRefs,
    unknownRefs: deleteRun.unknownRefs,
    warnings: deleteRun.unknownRefs.map(
      (descriptor) => `${group.remote}: could not delete ${descriptor.ref}; kept it locally`,
    ),
    fetchedCount: fetchRun.fetchedRefs.length,
    missingCount: plan.deleteRefs.length,
    cancelled: deleteRun.cancelled,
    timedOut: deleteRun.timedOut,
  };
}

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
async function checkRemoteHeads(
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
 * prune. Every ref from the failure onward is reported unknown, and a failed fetch step is
 * non-fatal so a partial failure becomes a warning rather than the error surface.
 *
 * @param context - Handler context carrying the root, client, and signal.
 * @param remote - Remote name, used verbatim, including any slash it contains.
 * @param refs - In-scope upstream descriptors to fetch.
 * @returns The steps, fetched refs, unknown refs, and termination flags.
 */
async function fetchPlanRefs(
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
async function deletePlannedRefs(
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
): Promise<{
  readonly step: CommandStepResult;
  readonly ok: boolean;
  readonly cancelled: boolean;
  readonly timedOut: boolean;
}> {
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

/**
 * Invokes git on the network class and forwards progress events.
 *
 * @param context - Handler context carrying the root, client, signal, and progress callback.
 * @param args - Argument array without the executable.
 * @param parser - Progress parser for this invocation, or null when the command has no progress.
 * @returns The settled invocation.
 */
async function invokeNetwork(
  context: CommandHandlerContext,
  args: readonly string[],
  parser: GitProgressParser | null,
): Promise<GitInvocationResult> {
  const result = await context.client.invoke({
    args,
    cwd: context.cwd,
    signal: context.signal,
    operationClass: "network",
    onStderr:
      parser === null
        ? undefined
        : (chunk) => {
            for (const event of parser.push(chunk)) {
              context.notifyProgress(event);
            }
          },
  });

  if (parser !== null) {
    for (const event of parser.flush()) {
      context.notifyProgress(event);
    }
  }

  return result;
}

/**
 * Builds a synthetic failed step for a plan rejection.
 *
 * @param stderr - Error text shown by the console and error surface.
 * @returns A step with no argv and no duration.
 */
function createFailureStep(stderr: string): CommandStepResult {
  return { argv: [], exitCode: 1, durationMs: 0, stdout: "", stderr };
}

/**
 * Builds a synthetic failed step for an unsafe remote or ref name.
 *
 * @param stderr - Error text shown by the console and error surface.
 * @returns A step with no argv and no duration.
 */
function createInvalidNameResult(stderr: string): GitInvocationResult {
  return {
    argv: [],
    cwd: "",
    exitCode: 1,
    terminationSignal: null,
    stdout: "",
    stderr,
    durationMs: 0,
    cancelled: false,
    timedOut: false,
    timedOutAfterMs: null,
    spawnError: null,
    ok: false,
  };
}

/**
 * Reports whether every planned fetch succeeded.
 *
 * @param run - Fetch run for one group.
 * @param plannedCount - Number of refs the plan asked to fetch.
 * @returns True when every planned ref was fetched and nothing was cancelled or timed out.
 */
function isCleanFetch(run: RemotePruneFetchRun, plannedCount: number): boolean {
  return (
    run.unknownRefs.length === 0 &&
    run.fetchedRefs.length === plannedCount &&
    !run.cancelled &&
    !run.timedOut
  );
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
function buildUnknownGroup(
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
 * Creates an empty accumulator for a prune run.
 *
 * @returns The mutable accumulator.
 */
function createPruneRun(): RemotePruneRun {
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
function mergePruneGroup(run: RemotePruneRun, group: RemotePruneGroupRun): void {
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
function buildPruneOutcome(
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
 * Dedupes upstream descriptors by remote and branch and sorts them by display ref.
 *
 * @param lists - Descriptor lists to merge.
 * @returns Sorted distinct descriptors.
 */
function dedupeDescriptors(
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
function countLabel(count: number, noun: string): string {
  return count === 1 ? `1 ${noun}` : `${count} ${noun}s`;
}
