import { useCallback, useEffect, useRef } from "react";
import { useInFlightTask } from "@/app/hooks/useInFlightTask";
import type { InFlightTask } from "@/app/hooks/useInFlightTask.types";
import type {
  RefreshFlagTaskInput,
  RepositoryRefreshFlag,
  RepositoryRefreshRefs,
} from "@/app/hooks/useRepositoryRefresh.types";
import type {
  CommitNavigator,
  GraphWindowRefresher,
  RepositoryRefreshResult,
  RepositoryStore,
} from "@/app/providers/RepositoryProvider.types";

/**
 * Owns the refs and abort cleanup shared by the refresh tasks and operations.
 *
 * Keeping the refs in one place gives the public cycle hook a single composition point instead of
 * five independent ref hooks and an unmount effect in its body.
 *
 * @returns The shared refs.
 */
export function useRepositoryRefreshRefs(): RepositoryRefreshRefs {
  const generationRef = useRef(0);
  const graphRefresherRef = useRef<GraphWindowRefresher | null>(null);
  const commitNavigatorRef = useRef<CommitNavigator | null>(null);
  const readControllerRef = useRef<AbortController | null>(null);
  const followUpControllerRef = useRef<AbortController | null>(null);
  const followUpStatusRef = useRef<Promise<RepositoryRefreshResult> | null>(null);
  const followUpCombinedRef = useRef<Promise<RepositoryRefreshResult> | null>(null);

  useEffect(
    () => () => {
      readControllerRef.current?.abort();
      followUpControllerRef.current?.abort();
    },
    [],
  );

  return {
    generationRef,
    graphRefresherRef,
    commitNavigatorRef,
    readControllerRef,
    followUpControllerRef,
    followUpStatusRef,
    followUpCombinedRef,
  };
}

/**
 * Owns one coalescing refresh task and its in-flight store flag.
 *
 * The status, graph-window, and combined tasks differ only in which flag they raise, so this hook
 * supplies the shared start, settle, and join behaviour instead of three copies inside the refresh
 * cycle.
 *
 * @param input - Store flag, writer, and mount state.
 * @returns The task slot.
 */
export function useRefreshFlagTask(
  input: RefreshFlagTaskInput,
): InFlightTask<RepositoryRefreshResult> {
  const { flag, mountedRef, setStore } = input;
  const join = useCallback(
    (result: RepositoryRefreshResult): RepositoryRefreshResult => ({ ...result, coalesced: true }),
    [],
  );

  return useInFlightTask<RepositoryRefreshResult>({
    onStart: () => {
      if (mountedRef.current) {
        setStore((previous) => writeRefreshFlag(previous, flag, true));
      }
    },
    onSettled: () => {
      if (mountedRef.current) {
        setStore((previous) => writeRefreshFlag(previous, flag, false));
      }
    },
    join,
  });
}

/**
 * Writes one refresh flag, keeping the store identity when the value is unchanged.
 *
 * @param store - Previous store.
 * @param flag - Flag to write.
 * @param value - New value.
 * @returns The same store, or a copy with the flag changed.
 */
function writeRefreshFlag(
  store: RepositoryStore,
  flag: RepositoryRefreshFlag,
  value: boolean,
): RepositoryStore {
  if (store[flag] === value) {
    return store;
  }

  return { ...store, [flag]: value };
}
