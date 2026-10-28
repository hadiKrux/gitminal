import { useCallback, useEffect, useRef } from "react";
import { registerInputMode } from "@/app/hooks/inputMode.registry";
import { useFocusState } from "@/app/hooks/useFocusState";
import { registerInputEscapeClear } from "@/app/hooks/useInputEscapeClear";
import { useOverlay } from "@/app/hooks/useOverlay";
import { useStatus } from "@/app/hooks/useStatus";
import type { RepositorySelection } from "@/domain/repository/repository.types";
import {
  GRAPH_SEARCH_INPUT_ID,
  GRAPH_SEARCH_UNAVAILABLE_MESSAGE,
} from "@/features/graph/graph.constants";
import type { SearchSnapshot } from "@/features/graph/graph.types";

/**
 * Owns the search surface lifetime: opening, closing, snapshot restore, and auto-cancel.
 *
 * The snapshot captures the provider selection, graph cursor, and generation on open. The viewport
 * offset is deliberately not part of the snapshot: mouse wheel scrolling is a free viewport action,
 * so a saved offset can point at rows where the restored cursor is not visible. One Esc restores the
 * selection and cursor, and the graph's reveal brings that row into view. Confirming a result writes
 * the chosen cursor instead. Losing graph focus, changing the scope, a generation move, or another
 * overlay opening cancels the search and restores the snapshot. Opening is refused in an empty
 * repository with the "No commits to search" status, and an open search closes itself if the
 * repository becomes empty.
 *
 * @param input - Surface flags, graph focus access, snapshot sources, and the two reset callbacks.
 * @returns The open state plus the open, close, and cancel entry points.
 */
export function useSearchSession(input: {
  readonly isOpen: boolean;
  readonly setIsOpen: (open: boolean) => void;
  readonly enabled: boolean;
  readonly focusGraph: () => void;
  readonly generation: number;
  readonly graphFocused: boolean;
  readonly scopeKey: string;
  readonly selection: RepositorySelection;
  readonly readCursor: () => string | null;
  readonly writeCursor: (id: string | null) => void;
  readonly setBoundedMiss: (visible: boolean) => void;
  readonly setSelection: (selection: RepositorySelection) => void;
  readonly resetResults: () => void;
  readonly resetSelection: () => void;
}) {
  const {
    enabled,
    focusGraph,
    generation,
    graphFocused,
    isOpen,
    readCursor,
    resetResults,
    resetSelection,
    selection,
    setBoundedMiss,
    setIsOpen,
    setSelection,
    writeCursor,
  } = input;
  const { focusRenderable } = useFocusState();
  const overlay = useOverlay();
  const { setStatus } = useStatus();
  const snapshotRef = useRef<SearchSnapshot | null>(null);
  const previousGraphFocusedRef = useRef(graphFocused);
  const previousScopeRef = useRef(input.scopeKey);

  /** Closes the surface and restores the snapshot unless a result was confirmed. */
  const closeSearch = useCallback(
    (mode: "cancel" | "confirm-success" | "confirm-failure", cursorId?: string): void => {
      setIsOpen(false);
      resetResults();
      resetSelection();

      const snapshot = snapshotRef.current;

      snapshotRef.current = null;

      if (mode === "confirm-success") {
        if (cursorId !== undefined) {
          writeCursor(cursorId);
        }

        setBoundedMiss(false);
      } else if (snapshot !== null) {
        // Snapshot restore writes the provider directly because it must restore every selection
        // kind (including stash, worktree, and diffFile), while the internal selection commands
        // only address commit and pending targets.
        setSelection(snapshot.selection);
        writeCursor(snapshot.cursorId);

        if (mode === "cancel") {
          setBoundedMiss(false);
        }
      }

      focusGraph();
    },
    [
      focusGraph,
      resetResults,
      resetSelection,
      setBoundedMiss,
      setIsOpen,
      setSelection,
      writeCursor,
    ],
  );

  /** Cancels and restores the pre-search graph state. */
  const cancelAndRestore = useCallback((): void => {
    closeSearch("cancel");
  }, [closeSearch]);

  /** Opens the input, snapshots the graph state, and focuses the field. */
  const open = useCallback((): void => {
    if (isOpen) {
      focusRenderable(GRAPH_SEARCH_INPUT_ID);

      return;
    }

    if (!enabled) {
      setStatus({ kind: "warning", message: GRAPH_SEARCH_UNAVAILABLE_MESSAGE });

      return;
    }

    snapshotRef.current = {
      selection,
      cursorId: readCursor(),
      generation,
    };
    resetResults();
    resetSelection();
    setBoundedMiss(false);
    setIsOpen(true);
  }, [
    enabled,
    focusRenderable,
    generation,
    isOpen,
    readCursor,
    resetResults,
    resetSelection,
    selection,
    setBoundedMiss,
    setIsOpen,
    setStatus,
  ]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const cleanupMode = registerInputMode(GRAPH_SEARCH_INPUT_ID, "search");
    const cleanupEscape = registerInputEscapeClear(GRAPH_SEARCH_INPUT_ID, cancelAndRestore);

    return () => {
      cleanupMode();
      cleanupEscape();
    };
  }, [cancelAndRestore, isOpen]);

  useEffect(() => {
    if (!isOpen || enabled) {
      return;
    }

    setStatus({ kind: "warning", message: GRAPH_SEARCH_UNAVAILABLE_MESSAGE });
    cancelAndRestore();
  }, [cancelAndRestore, enabled, isOpen, setStatus]);

  useEffect(() => {
    if (!isOpen || !enabled) {
      return;
    }

    focusRenderable(GRAPH_SEARCH_INPUT_ID);
  }, [enabled, focusRenderable, isOpen]);

  useEffect(() => {
    const wasFocused = previousGraphFocusedRef.current;
    const previousScope = previousScopeRef.current;

    previousGraphFocusedRef.current = graphFocused;
    previousScopeRef.current = input.scopeKey;

    if (!isOpen) {
      return;
    }

    const snapshot = snapshotRef.current;
    const lostFocus = wasFocused && !graphFocused;
    const scopeChanged = previousScope !== input.scopeKey;
    const generationChanged = snapshot !== null && generation !== snapshot.generation;

    if (lostFocus || scopeChanged || generationChanged || overlay.isOpen) {
      cancelAndRestore();
    }
  }, [cancelAndRestore, generation, graphFocused, input.scopeKey, isOpen, overlay.isOpen]);

  return { isOpen, open, closeSearch, cancelAndRestore };
}
