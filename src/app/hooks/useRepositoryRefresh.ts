import { useCallback, useEffect, useRef } from "react";
import { useInFlightTask } from "@/app/hooks/useInFlightTask";
import type {
  RepositoryRefreshCycle,
  RepositoryRefreshCycleInput,
} from "@/app/hooks/useRepositoryRefresh.types";
import { applyReadToStore } from "@/app/providers/RepositoryProvider.store";
import type { RepositoryRefreshResult } from "@/app/providers/RepositoryProvider.types";
import { isCommandRunning } from "@/domain/commands/commands.runner";
import { readRepositorySnapshot } from "@/domain/repository/repository.read";
import type { RepositoryReadResult } from "@/domain/repository/repository.types";

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
  const generationRef = useRef(0);
  const graphRefresherRef = useRef<(() => Promise<void>) | null>(null);
  const readControllerRef = useRef<AbortController | null>(null);

  const { client, cwd, evidenceRef, mountedRef, now, setStore } = input;

  useEffect(
    () => () => {
      readControllerRef.current?.abort();
    },
    [],
  );

  /** Applies one read result, keeping the previous snapshot on failure. */
  const applyReadResult = useCallback(
    (result: RepositoryReadResult): void => {
      setStore((previous) => applyReadToStore(previous, result, isCommandRunning()));
    },
    [setStore],
  );

  /** Starts or joins one status read. */
  const statusTask = useInFlightTask<RepositoryRefreshResult>({
    onStart: () => {
      if (mountedRef.current) {
        setStore((previous) => ({ ...previous, statusInFlight: true }));
      }
    },
    onSettled: () => {
      if (mountedRef.current) {
        setStore((previous) =>
          previous.statusInFlight ? { ...previous, statusInFlight: false } : previous,
        );
      }
    },
    join: (result) => ({ ...result, coalesced: true }),
  });

  /** Starts or joins one graph-window refresh. */
  const graphTask = useInFlightTask<RepositoryRefreshResult>({
    onStart: () => {
      if (mountedRef.current) {
        setStore((previous) => ({ ...previous, graphInFlight: true }));
      }
    },
    onSettled: () => {
      if (mountedRef.current) {
        setStore((previous) =>
          previous.graphInFlight ? { ...previous, graphInFlight: false } : previous,
        );
      }
    },
    join: (result) => ({ ...result, coalesced: true }),
  });

  /** Starts or joins one combined refresh. */
  const combinedTask = useInFlightTask<RepositoryRefreshResult>({
    onStart: () => {
      if (mountedRef.current) {
        setStore((previous) => ({ ...previous, refreshing: true }));
      }
    },
    onSettled: () => {
      if (mountedRef.current) {
        setStore((previous) =>
          previous.refreshing ? { ...previous, refreshing: false } : previous,
        );
      }
    },
    join: (result) => ({ ...result, coalesced: true }),
  });

  /** Reads status, refs, remotes, identity, and upstreams without history. */
  const refreshStatus = useCallback(async (): Promise<RepositoryRefreshResult> => {
    return await statusTask.run(async () => {
      const controller = new AbortController();
      readControllerRef.current = controller;
      generationRef.current += 1;
      const generation = generationRef.current;
      const result = await readRepositorySnapshot(client, {
        cwd,
        signal: controller.signal,
        now,
        evidence: evidenceRef.current,
      });

      if (mountedRef.current) {
        applyReadResult(result);
      }

      return { ok: result.ok, coalesced: false, error: result.error, generation };
    });
  }, [applyReadResult, client, cwd, evidenceRef, mountedRef, now, statusTask]);

  /** Bumps the graph generation and awaits the registered window reloader. */
  const refreshGraphWindow = useCallback(async (): Promise<RepositoryRefreshResult> => {
    return await graphTask.run(async () => {
      generationRef.current += 1;
      const generation = generationRef.current;
      const refresher = graphRefresherRef.current;

      try {
        await refresher?.();

        return { ok: true, coalesced: false, error: null, generation };
      } catch (error) {
        return {
          ok: false,
          coalesced: false,
          error: error instanceof Error ? error.message : String(error),
          generation,
        };
      }
    });
  }, [graphTask]);

  /** Registers or clears the graph feature's window reloader. */
  const registerGraphWindowRefresher = useCallback(
    (refresher: (() => Promise<void>) | null): void => {
      graphRefresherRef.current = refresher;
    },
    [],
  );

  /** Runs a status read followed by a graph-window refresh. */
  const refresh = useCallback(async (): Promise<RepositoryRefreshResult> => {
    return await combinedTask.run(async () => {
      const status = await refreshStatus();
      const graph = await refreshGraphWindow();

      return { ...status, generation: graph.generation };
    });
  }, [combinedTask, refreshGraphWindow, refreshStatus]);

  return {
    refresh,
    refreshStatus,
    refreshGraphWindow,
    registerGraphWindowRefresher,
  };
}
