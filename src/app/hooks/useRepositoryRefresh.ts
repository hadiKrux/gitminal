import { type MutableRefObject, useCallback } from "react";
import {
  useRefreshFlagTask,
  useRepositoryRefreshRefs,
} from "@/app/hooks/useRepositoryRefresh.tasks";
import type {
  RepositoryRefreshCycle,
  RepositoryRefreshCycleInput,
} from "@/app/hooks/useRepositoryRefresh.types";
import {
  applyReadToStore,
  writeRepositoryGeneration,
} from "@/app/providers/RepositoryProvider.store";
import type {
  CommitNavigator,
  GraphWindowRefresher,
  RepositoryRefreshOptions,
  RepositoryRefreshResult,
} from "@/app/providers/RepositoryProvider.types";
import { isCommandRunning } from "@/domain/commands/commands.runner";
import type { EnsureLoadedResult } from "@/domain/graph/graph.types";
import { readRepositorySnapshot } from "@/domain/repository/repository.read";
import type {
  RepositoryReadResult,
  RepositorySnapshot,
} from "@/domain/repository/repository.types";
import { clearConfirmedPresence, formatUpstreamRef } from "@/domain/repository/repository.upstream";

/**
 * Owns the repository refresh lifecycle: coalescing, generation tokens, reads, and evidence.
 *
 * The provider supplies its store and refs so this hook owns no React state of its own. Each read
 * carries a monotonically increasing generation that stale graph pages compare against. Concurrent
 * requests join the in-flight promise instead of stacking, a failed read keeps the previous
 * snapshot, and only the mounted provider applies a result. The hook performs no I/O beyond the
 * domain read modules and never enters the command runner.
 *
 * @param input - Store, client, clock, and mount state from the provider.
 * @returns The refresh operations.
 */
export function useRepositoryRefreshCycle(
  input: RepositoryRefreshCycleInput,
): RepositoryRefreshCycle {
  const {
    commitNavigatorRef,
    followUpCombinedRef,
    followUpControllerRef,
    followUpStatusRef,
    generationRef,
    graphRefresherRef,
    readControllerRef,
  } = useRepositoryRefreshRefs();

  const { client, cwd, evidenceRef, mountedRef, now, setSelection, setStore } = input;

  /** Applies one read result, keeping the previous snapshot on failure. */
  const applyReadResult = useCallback(
    (result: RepositoryReadResult, generation: number): void => {
      applyRepositoryReadResult(result, generation, evidenceRef, setStore);
    },
    [evidenceRef, setStore],
  );

  /** Starts or joins one status read. */
  const statusTask = useRefreshFlagTask({ flag: "statusInFlight", setStore, mountedRef });

  /** Starts or joins one graph-window refresh. */
  const graphTask = useRefreshFlagTask({ flag: "graphInFlight", setStore, mountedRef });

  /** Starts or joins one combined refresh. */
  const combinedTask = useRefreshFlagTask({ flag: "refreshing", setStore, mountedRef });

  /**
   * Reads status, refs, remotes, identity, and upstreams without history.
   *
   * The reserved generation is published before the read and again with the settled result, on
   * failure too. A consumer that starts using the token while the read is in flight therefore
   * already holds the value the read will publish, and every settled read still invalidates data
   * from the read it replaced.
   */
  const runStatusRead = useCallback(
    async (
      controller: AbortController = new AbortController(),
    ): Promise<RepositoryRefreshResult> => {
      readControllerRef.current = controller;
      generationRef.current += 1;

      const generation = generationRef.current;

      storeGeneration(generation, mountedRef, setStore);

      const result = await readRepositorySnapshot(client, {
        cwd,
        signal: controller.signal,
        now,
        evidence: evidenceRef.current,
      });

      if (mountedRef.current) {
        applyReadResult(result, generation);
      }

      if (followUpControllerRef.current === controller) {
        followUpControllerRef.current = null;
      }

      return { ok: result.ok, coalesced: false, error: result.error, generation };
    },
    [
      applyReadResult,
      client,
      cwd,
      evidenceRef,
      followUpControllerRef,
      generationRef,
      mountedRef,
      now,
      readControllerRef,
      setStore,
    ],
  );

  /**
   * Starts one status read behind every read already in flight.
   *
   * The queue slot holds at most one follow-up, so several command refreshes that join the same
   * pre-command read still produce exactly one read that starts after all of them. When the provider
   * unmounted before the follow-up can start, the joined result is returned instead of starting an
   * unobservable read.
   *
   * @param joined - Result the caller received by joining the in-flight read.
   * @returns The follow-up result, or the joined result after unmount.
   */
  const queueStatusFollowUp = useCallback(
    (joined: RepositoryRefreshResult): Promise<RepositoryRefreshResult> => {
      if (!mountedRef.current) {
        return Promise.resolve(joined);
      }

      if (followUpStatusRef.current !== null) {
        return followUpStatusRef.current;
      }

      const controller = new AbortController();

      followUpControllerRef.current = controller;

      return queueFollowUp(followUpStatusRef, () =>
        statusTask.run(() => runStatusRead(controller)),
      );
    },
    [followUpControllerRef, followUpStatusRef, mountedRef, runStatusRead, statusTask],
  );

  /**
   * Reads status, refs, remotes, identity, and upstreams without history.
   *
   * @param options - Optional follow-up rule for a command-triggered refresh.
   * @param controller - Abort controller owned by a queued follow-up, when any.
   * @returns The refresh result.
   */
  const refreshStatus = useCallback(
    async (
      options: RepositoryRefreshOptions = {},
      controller?: AbortController,
    ): Promise<RepositoryRefreshResult> => {
      const result = await statusTask.run(() => runStatusRead(controller));

      if (!result.coalesced || options.followUp !== true) {
        return result;
      }

      return await queueStatusFollowUp(result);
    },
    [queueStatusFollowUp, runStatusRead, statusTask],
  );

  /**
   * Bumps the graph generation and awaits the registered window reloader.
   *
   * The reserved generation is published before the reloader starts, so every consumer stops using
   * data from the previous read while the window is re-read, and again after it settles so a
   * combined refresh ends on the graph generation.
   */
  const refreshGraphWindow = useCallback(async (): Promise<RepositoryRefreshResult> => {
    return await graphTask.run(async () => {
      generationRef.current += 1;

      const generation = generationRef.current;

      storeGeneration(generation, mountedRef, setStore);

      const result = await readGraphWindowResult(graphRefresherRef.current, generation);

      storeGeneration(generation, mountedRef, setStore);

      return result;
    });
  }, [generationRef, graphRefresherRef, graphTask, mountedRef, setStore]);

  /** Registers or clears the graph feature's window reloader. */
  const registerGraphWindowRefresher = useCallback(
    (refresher: GraphWindowRefresher | null): void => {
      graphRefresherRef.current = refresher;
    },
    [graphRefresherRef],
  );

  /** Registers or clears the graph feature's bounded commit navigator. */
  const registerCommitNavigator = useCallback(
    (navigator: CommitNavigator | null): void => {
      commitNavigatorRef.current = navigator;
    },
    [commitNavigatorRef],
  );

  /**
   * Selects a commit after the graph confirms it is loaded.
   *
   * A missing navigator means the graph is not mounted, so the selection is left untouched and the
   * outcome is `cancelled` because no bounded walk ran. The navigator itself owns the bounded page
   * walk and the visible parent-loading state, and its detailed outcome is returned unchanged,
   * including a `cancelled` walk and a page read `error`.
   *
   * @param oid - Commit OID to select.
   * @returns The bounded load outcome; `loaded` when the commit became the selection.
   */
  const selectCommit = useCallback(
    async (oid: string): Promise<EnsureLoadedResult> => {
      const navigator = commitNavigatorRef.current;

      if (navigator === null) {
        return "cancelled";
      }

      const result = await navigator(oid);

      if (result !== "loaded") {
        return result;
      }

      setSelection({ kind: "commit", oid });

      return "loaded";
    },
    [commitNavigatorRef, setSelection],
  );

  /**
   * Runs a status read followed by a graph-window refresh.
   *
   * @param options - Follow-up rule forwarded to the nested status read.
   * @param controller - Abort controller owned by a queued follow-up, when any.
   * @returns The refresh result.
   */
  const runCombinedRefresh = useCallback(
    async (
      options: RepositoryRefreshOptions,
      controller?: AbortController,
    ): Promise<RepositoryRefreshResult> => {
      const status = await refreshStatus(options, controller);
      const graph = await refreshGraphWindow();

      return { ...status, generation: graph.generation };
    },
    [refreshGraphWindow, refreshStatus],
  );

  /**
   * Starts one combined refresh behind every combined refresh already in flight.
   *
   * @param options - Follow-up rule forwarded to the nested status read.
   * @param joined - Result the caller received by joining the in-flight read.
   * @returns The follow-up result, or the joined result after unmount.
   */
  const queueCombinedFollowUp = useCallback(
    (
      options: RepositoryRefreshOptions,
      joined: RepositoryRefreshResult,
    ): Promise<RepositoryRefreshResult> => {
      if (!mountedRef.current) {
        return Promise.resolve(joined);
      }

      if (followUpCombinedRef.current !== null) {
        return followUpCombinedRef.current;
      }

      const controller = new AbortController();

      followUpControllerRef.current = controller;

      return queueFollowUp(followUpCombinedRef, () =>
        combinedTask.run(() => runCombinedRefresh({ ...options, followUp: false }, controller)),
      );
    },
    [combinedTask, followUpCombinedRef, followUpControllerRef, mountedRef, runCombinedRefresh],
  );

  /**
   * Runs a status read followed by a graph-window refresh.
   *
   * @param options - Optional follow-up rule for a command-triggered refresh.
   * @returns The refresh result.
   */
  const refresh = useCallback(
    async (options: RepositoryRefreshOptions = {}): Promise<RepositoryRefreshResult> => {
      const result = await combinedTask.run(() => runCombinedRefresh(options));

      if (!result.coalesced || options.followUp !== true) {
        return result;
      }

      return await queueCombinedFollowUp(options, result);
    },
    [combinedTask, queueCombinedFollowUp, runCombinedRefresh],
  );

  return {
    refresh,
    refreshStatus,
    refreshGraphWindow,
    registerGraphWindowRefresher,
    registerCommitNavigator,
    selectCommit,
  };
}

/**
 * Applies one read result and refreshes the evidence it observed.
 *
 * @param result - Domain read result.
 * @param generation - Generation reserved for this read.
 * @param evidenceRef - Shared upstream evidence.
 * @param setStore - Store writer.
 */
function applyRepositoryReadResult(
  result: RepositoryReadResult,
  generation: number,
  evidenceRef: RepositoryRefreshCycleInput["evidenceRef"],
  setStore: RepositoryRefreshCycleInput["setStore"],
): void {
  if (result.ok && result.snapshot !== null) {
    evidenceRef.current = clearConfirmedPresence(
      evidenceRef.current,
      readObservedUpstreamRefs(result.snapshot),
    );
  }

  setStore((previous) => applyReadToStore(previous, result, isCommandRunning(), generation));
}

/**
 * Publishes a reserved generation while the provider is mounted.
 *
 * @param generation - Generation reserved by the refresh task.
 * @param mountedRef - Mount state owned by the provider.
 * @param setStore - Store writer.
 */
function storeGeneration(
  generation: number,
  mountedRef: RepositoryRefreshCycleInput["mountedRef"],
  setStore: RepositoryRefreshCycleInput["setStore"],
): void {
  if (!mountedRef.current) {
    return;
  }

  setStore((previous) => writeRepositoryGeneration(previous, generation));
}

/**
 * Runs the registered graph-window reloader and classifies its outcome.
 *
 * @param refresher - Registered reloader, or null when the graph feature has none.
 * @param generation - Generation already reserved for this refresh.
 * @returns The refresh result.
 */
async function readGraphWindowResult(
  refresher: GraphWindowRefresher | null,
  generation: number,
): Promise<RepositoryRefreshResult> {
  try {
    // A registered refresher reports a rolled-back page failure as false. The feature has already
    // published its specific page error, so the provider result carries no duplicate message.
    const ok = refresher === null ? true : await refresher();

    return { ok, coalesced: false, error: null, generation };
  } catch (error) {
    return {
      ok: false,
      coalesced: false,
      error: error instanceof Error ? error.message : String(error),
      generation,
    };
  }
}

/**
 * Reads the upstream refs one successful read observed present.
 *
 * Only refs read in this snapshot count: a failed remote-branch read contributes none, so stale
 * absence evidence is never cleared by an unread list.
 *
 * @param snapshot - Snapshot of the successful read.
 * @returns The upstream refs the read observed as remote-tracking refs.
 */
function readObservedUpstreamRefs(snapshot: RepositorySnapshot): readonly string[] {
  return snapshot.remoteBranches.map((remoteBranch) =>
    formatUpstreamRef(remoteBranch.remote, remoteBranch.branch),
  );
}

/**
 * Queues exactly one task behind the currently queued one.
 *
 * The queue slot is released when the task settles, so a later caller can queue its own follow-up
 * instead of joining a read that already started before its mutation.
 *
 * @param queueRef - Slot holding the queued follow-up, when any.
 * @param run - Starts the follow-up task.
 * @returns The queued follow-up.
 */
function queueFollowUp<T>(
  queueRef: MutableRefObject<Promise<T> | null>,
  run: () => Promise<T>,
): Promise<T> {
  const queued = queueRef.current;

  if (queued !== null) {
    return queued;
  }

  const task = run().finally(() => {
    if (queueRef.current === task) {
      queueRef.current = null;
    }
  });

  queueRef.current = task;

  return task;
}
