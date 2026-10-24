import { createContext, type ReactNode, useMemo } from "react";
import { useRepositoryAvailability } from "@/app/hooks/useRepositoryAvailability";
import { useRepositoryEvidence } from "@/app/hooks/useRepositoryEvidence";
import { useRepositoryInitialRead } from "@/app/hooks/useRepositoryInitialRead";
import { useRepositoryRefreshCycle } from "@/app/hooks/useRepositoryRefresh";
import { useRepositoryRuntime } from "@/app/hooks/useRepositoryRuntime";
import { useRepositoryStore } from "@/app/hooks/useRepositoryStore";
import { useRepositoryStoreWatcher } from "@/app/hooks/useRepositoryStoreWatcher";
import type {
  RepositoryContextValue,
  RepositoryProviderProps,
} from "@/app/providers/RepositoryProvider.types";
import { detectRepositoryState } from "@/domain/repository/repository.states";

/** Context carrying the repository snapshot and refresh cycle. */
export const RepositoryContext = createContext<RepositoryContextValue | null>(null);

/**
 * Owns the repository snapshot, derived state, selection, and refresh cycle.
 *
 * The provider body only composes collaborators. Runtime construction, the store, the refresh cycle,
 * evidence, the initial and focus reads, availability projection, and watcher wiring each live in a
 * focused hook. Reads never pass through the command runner: the refresh cycle calls the domain read
 * modules directly. Concurrent requests join the in-flight read rather than stacking, a failed read
 * keeps the previous snapshot and records a redacted non-blocking message, and the right-pane
 * selection is never rewritten by a read.
 *
 * @param props - Content plus cwd, client, watcher, and selection seams.
 * @returns The repository context provider.
 */
export function RepositoryProvider(props: RepositoryProviderProps): ReactNode {
  const runtime = useRepositoryRuntime(props);
  const repositoryStore = useRepositoryStore({
    cwd: runtime.cwd,
    initialSelection: props.initialSelection,
    worktreeWatch: runtime.worktreeWatch,
  });
  const { store, setStore, storeRef, mountedRef, evidenceRef, setSelection } = repositoryStore;
  const refreshCycle = useRepositoryRefreshCycle({
    cwd: runtime.cwd,
    client: runtime.gitClient,
    now: runtime.now,
    setStore,
    mountedRef,
    evidenceRef,
  });
  const evidence = useRepositoryEvidence({
    refresh: refreshCycle.refresh,
    setStore,
    now: runtime.now,
    evidenceRef,
  });
  const getAvailabilityFor = useRepositoryAvailability({ storeRef });

  useRepositoryInitialRead({
    refresh: refreshCycle.refresh,
    mountedRef,
    storeRef,
  });
  useRepositoryStoreWatcher({
    gitDir: store.snapshot?.gitDir ?? null,
    root: store.snapshot?.root ?? null,
    cwd: runtime.cwd,
    enableWatcher: runtime.enableWatcher,
    worktreeWatch: runtime.worktreeWatch,
    debounceMs: runtime.watchDebounceMs,
    factory: runtime.watcherFactory,
    refreshStatus: refreshCycle.refreshStatus,
    setStore,
    mountedRef,
  });

  const state = useMemo(() => detectRepositoryState(store.signals), [store.signals]);
  const value = useMemo<RepositoryContextValue>(
    () => ({
      snapshot: store.snapshot,
      signals: store.signals,
      state,
      selection: store.selection,
      generation: store.generation,
      watch: store.watch,
      upstreamStatus: store.upstreamStatus,
      remoteChecks: store.remoteChecks,
      lastRefreshError: store.lastRefreshError,
      isRefreshing: store.refreshing,
      isStatusInFlight: store.statusInFlight,
      isGraphInFlight: store.graphInFlight,
      gitClient: runtime.gitClient,
      refresh: refreshCycle.refresh,
      refreshStatus: refreshCycle.refreshStatus,
      refreshGraphWindow: refreshCycle.refreshGraphWindow,
      registerGraphWindowRefresher: refreshCycle.registerGraphWindowRefresher,
      setSelection,
      recordRemoteCheck: evidence.recordRemoteCheck,
      confirmUpstreamAbsent: evidence.confirmUpstreamAbsent,
      markUpstreamUnknown: evidence.markUpstreamUnknown,
      recordUpstreamEvidence: evidence.recordUpstreamEvidence,
      getAvailability: getAvailabilityFor,
    }),
    [state, store, runtime.gitClient, refreshCycle, setSelection, evidence, getAvailabilityFor],
  );

  return <RepositoryContext.Provider value={value}>{props.children}</RepositoryContext.Provider>;
}
