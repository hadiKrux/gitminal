import { useCallback, useEffect, useRef, useState } from "react";
import type {
  RepositoryStoreHandle,
  RepositoryStoreInput,
} from "@/app/hooks/useRepositoryStore.types";
import { createInitialStore, selectionsEqual } from "@/app/providers/RepositoryProvider.store";
import type { RepositoryStore } from "@/app/providers/RepositoryProvider.types";
import type { RepositorySelection } from "@/domain/repository/repository.types";
import { EMPTY_UPSTREAM_EVIDENCE } from "@/domain/repository/repository.upstream";

/** The default selection is the Pending Changes row. */
const DEFAULT_SELECTION: RepositorySelection = Object.freeze({ kind: "pending" });

/**
 * Owns the repository store, its refs, and the right-pane selection.
 *
 * The store is one object so a read applies atomically. Callbacks read `storeRef` instead of the
 * render value, and `mountedRef` stops a settled read from writing after unmount.
 *
 * @param input - Launch directory, initial selection, and watch mode.
 * @returns The store handle.
 */
export function useRepositoryStore(input: RepositoryStoreInput): RepositoryStoreHandle {
  const [store, setStore] = useState<RepositoryStore>(() =>
    createInitialStore(input.cwd, input.initialSelection ?? DEFAULT_SELECTION, input.worktreeWatch),
  );
  const storeRef = useRef(store);
  const mountedRef = useRef(true);
  const evidenceRef = useRef(EMPTY_UPSTREAM_EVIDENCE);

  storeRef.current = store;

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
    };
  }, []);

  /** Replaces the right-pane selection. */
  const setSelection = useCallback((selection: RepositorySelection): void => {
    setStore((previous) =>
      selectionsEqual(previous.selection, selection) ? previous : { ...previous, selection },
    );
  }, []);

  return { store, setStore, storeRef, mountedRef, evidenceRef, setSelection };
}
