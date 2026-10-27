import { type MutableRefObject, useCallback, useEffect, useRef } from "react";
import { useListCursor } from "@/app/hooks/useListCursor";
import type { GraphWindowState } from "@/domain/graph/graph.types";
import type { RepositorySelection } from "@/domain/repository/repository.types";
import {
  GRAPH_NEAR_BOTTOM_ROWS,
  GRAPH_PENDING_ROW_ID,
  GRAPH_REGION_ID,
  GRAPH_SELECTION_DEBOUNCE_MS,
} from "@/features/graph/graph.constants";
import { readSelectedRowId } from "@/features/graph/graph.rows";
import type { GraphDisplayRow, GraphSelectionTarget } from "@/features/graph/graph.types";
import { moveIndexByRows } from "@/features/graph/graph.window";

/**
 * Owns graph selection, cursor navigation, and the near-bottom page trigger.
 *
 * The cursor is the shared `graph` region cursor, so it survives a refresh that keeps the same row
 * id. A provider selection change moves the cursor once; a row-list change also re-syncs the cursor
 * to the retained provider selection, so a reload that inserted rows cannot leave the cursor on the
 * row that clamped into the old index. Cursor movement dispatches the internal selection command
 * once, so the graph never writes provider selection directly. Wheel movement uses the same cursor
 * path, but its selection dispatch waits for `GRAPH_SELECTION_DEBOUNCE_MS` of quiet, so a scroll
 * gesture moves the cursor without selecting every row it passes; Enter, a click, or a keyboard
 * move settles the pending wheel row immediately and owns the dispatch. The near-bottom effect asks
 * for an older page only when the search overlay is closed and no other read owns the surface.
 *
 * @param input - Rows, provider selection, the internal selection dispatcher, paging state, and the
 * older-page callback.
 * @returns The cursor, the selected row id, the row click handler, and the wheel movement.
 */
export function useGraphSelection(input: {
  readonly rows: readonly GraphDisplayRow[];
  readonly selection: RepositorySelection;
  readonly selectTarget: (target: GraphSelectionTarget) => void;
  readonly lastSelectionIndexRef: MutableRefObject<number>;
  readonly requestOlderPage: () => Promise<void>;
  readonly searchOpen: boolean;
  readonly windowState: GraphWindowState;
  readonly isLoadingInitial: boolean;
  readonly isLoadingOlder: boolean;
  readonly pageError: string | null;
  readonly searchDelegateActionRef: MutableRefObject<
    (action: "up" | "down" | "first" | "last" | "activate") => boolean
  >;
}) {
  const {
    isLoadingInitial,
    isLoadingOlder,
    lastSelectionIndexRef,
    pageError,
    requestOlderPage,
    rows,
    searchDelegateActionRef,
    searchOpen,
    selectTarget,
    selection,
    windowState,
  } = input;
  const cursorIndexRef = useRef(0);
  const {
    cancel: cancelDeferred,
    schedule: scheduleDeferred,
    deferredIdRef,
  } = useDeferredRowSelection({ selectTarget, selection });

  /** Selects one graph row by index through the internal selection command. */
  const activateAt = useCallback(
    (index: number): void => {
      const row = rows[index];

      if (row === undefined) {
        return;
      }

      cancelDeferred();
      selectTarget(row.kind === "pending" ? { kind: "pending" } : { kind: "commit", oid: row.id });
    },
    [cancelDeferred, rows, selectTarget],
  );

  const cursor = useListCursor({
    regionId: GRAPH_REGION_ID,
    items: rows.map((row) => ({ id: row.id })),
    onActivate: () => {
      activateAt(cursorIndexRef.current);
    },
    onDoubleClick: activateAt,
    delegateAction: (action) => searchDelegateActionRef.current(action),
  });

  cursorIndexRef.current = cursor.index;

  /** Moves the cursor by a bounded wheel delta and defers the row selection until it settles. */
  const scrollBy = useCallback(
    (delta: number): void => {
      if (rows.length === 0) {
        return;
      }

      const nextIndex = moveIndexByRows(cursor.index, rows.length, delta);
      const row = rows[nextIndex];

      if (row === undefined) {
        return;
      }

      cursor.select(nextIndex);
      scheduleDeferred(row.id);
    },
    [cursor, rows, scheduleDeferred],
  );

  const selectedRowId = readSelectedRowId(selection);
  const previousSelectedIdRef = useRef(selectedRowId);
  const previousRowsRef = useRef(rows);
  const pendingExternalIdRef = useRef<string | null>(selectedRowId);

  useEffect(() => {
    const previous = previousSelectedIdRef.current;
    const rowsChanged = previousRowsRef.current !== rows;

    previousSelectedIdRef.current = selectedRowId;
    previousRowsRef.current = rows;

    if (selectedRowId !== previous) {
      pendingExternalIdRef.current = selectedRowId;
      cancelDeferred();
    }

    // A row-list change is authoritative for the selection: the provider selection survives a
    // reload that inserted or appended pages, so the cursor must follow it instead of staying on the
    // row that clamped into the old index. Cursor movement without a row change still dispatches
    // through `useSelectionFromCursor`.
    const pending = pendingExternalIdRef.current ?? (rowsChanged ? selectedRowId : null);

    if (pending === null) {
      return;
    }

    if (cursor.activeId === pending) {
      pendingExternalIdRef.current = null;

      return;
    }

    if (!rows.some((row) => row.id === pending)) {
      return;
    }

    cursor.selectId(pending);
    pendingExternalIdRef.current = null;
  }, [cancelDeferred, cursor.activeId, cursor.selectId, rows, selectedRowId]);

  useSelectionFromCursor({
    activeId: cursor.activeId,
    rows,
    selection,
    selectTarget,
    deferredIdRef,
    cancelDeferred,
  });

  useEffect(() => {
    if (searchOpen) {
      cancelDeferred();
    }
  }, [cancelDeferred, searchOpen]);

  useEffect(() => {
    if (selection.kind !== "commit") {
      return;
    }

    const index = windowState.rows.findIndex((row) => row.oid === selection.oid);

    if (index >= 0) {
      lastSelectionIndexRef.current = index;
    }
  }, [lastSelectionIndexRef, selection, windowState.rows]);

  useEffect(() => {
    if (searchOpen) {
      return;
    }

    if (
      isLoadingInitial ||
      isLoadingOlder ||
      pageError !== null ||
      windowState.done ||
      windowState.pagesLoaded === 0 ||
      cursor.index < rows.length - GRAPH_NEAR_BOTTOM_ROWS
    ) {
      return;
    }

    void requestOlderPage();
  }, [
    cursor.index,
    isLoadingInitial,
    isLoadingOlder,
    pageError,
    requestOlderPage,
    rows.length,
    searchOpen,
    windowState.done,
    windowState.pagesLoaded,
  ]);

  return {
    cursor,
    selectedRowId,
    handleRowClick: cursor.handleRowClick,
    scrollBy,
  };
}

/**
 * Owns the debounced wheel selection timer.
 *
 * `schedule` replaces any pending row with the newest wheel row and dispatches it through the
 * selection command only after `GRAPH_SELECTION_DEBOUNCE_MS` of quiet. `cancel` drops the pending
 * row when a deliberate cursor move, another surface selection, search, or unmount takes over. The
 * timer callback reads the latest selection from a ref, so it can skip a row that is already
 * selected without restarting the timer on every provider update.
 *
 * @param input - Current provider selection and the internal selection dispatcher.
 * @returns The cancel and schedule callbacks plus the pending row id ref the sync skips.
 */
function useDeferredRowSelection(input: {
  readonly selection: RepositorySelection;
  readonly selectTarget: (target: GraphSelectionTarget) => void;
}): {
  readonly cancel: () => void;
  readonly schedule: (rowId: string) => void;
  readonly deferredIdRef: MutableRefObject<string | null>;
} {
  const { selectTarget, selection } = input;
  const selectionRef = useRef(selection);
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deferredIdRef = useRef<string | null>(null);

  selectionRef.current = selection;

  /** Cancels a pending wheel selection so a deliberate move owns the next dispatch. */
  const cancel = useCallback((): void => {
    if (scrollTimerRef.current !== null) {
      clearTimeout(scrollTimerRef.current);
      scrollTimerRef.current = null;
    }

    deferredIdRef.current = null;
  }, []);

  useEffect(() => cancel, [cancel]);

  /** Schedules one wheel row for dispatch after the wheel has been quiet for the debounce interval. */
  const schedule = useCallback(
    (rowId: string): void => {
      cancel();
      deferredIdRef.current = rowId;
      scrollTimerRef.current = setTimeout(() => {
        scrollTimerRef.current = null;
        deferredIdRef.current = null;

        const target = readCursorTarget(rowId, selectionRef.current);

        if (target !== null) {
          selectTarget(target);
        }
      }, GRAPH_SELECTION_DEBOUNCE_MS);
    },
    [cancel, selectTarget],
  );

  return { cancel, schedule, deferredIdRef };
}

/**
 * Synchronizes the provider selection with cursor movement.
 *
 * The effect dispatches the internal selection command only when the active cursor id changes, so an
 * external stash or worktree selection is never pulled back to a graph row just because the
 * selection object changed. A render that changes the row list is skipped: `useListCursor` reconciles
 * its index by item identity in its own effect, and dispatching before that settles would select the
 * row that moved into the old index when a reload inserts commits above the selection.
 *
 * @param input - Active cursor id, current rows, current selection, selection dispatcher, the
 * pending wheel row id, and the wheel cancellation callback.
 */
function useSelectionFromCursor(input: {
  readonly activeId: string | null;
  readonly rows: readonly GraphDisplayRow[];
  readonly selection: RepositorySelection;
  readonly selectTarget: (target: GraphSelectionTarget) => void;
  readonly deferredIdRef: MutableRefObject<string | null>;
  readonly cancelDeferred: () => void;
}): void {
  const previousIdRef = useRef<string | null>(null);
  const previousRowsRef = useRef(input.rows);

  useEffect(() => {
    const activeId = input.activeId;
    const rowsChanged = previousRowsRef.current !== input.rows;

    previousRowsRef.current = input.rows;

    if (rowsChanged || activeId === null || previousIdRef.current === activeId) {
      return;
    }

    previousIdRef.current = activeId;

    // A wheel row owns its dispatch through the debounce timer, so the cursor movement it caused is
    // not selected immediately. Any other cursor move cancels that pending row first.
    if (input.deferredIdRef.current === activeId) {
      return;
    }

    input.cancelDeferred();

    const target = readCursorTarget(activeId, input.selection);

    if (target !== null) {
      input.selectTarget(target);
    }
  }, [
    input.activeId,
    input.cancelDeferred,
    input.deferredIdRef,
    input.rows,
    input.selection,
    input.selectTarget,
  ]);
}

/**
 * Maps a settled cursor row and the current selection to the selection it should dispatch.
 *
 * Returns null when the selection already matches the cursor or when the selected surface is not
 * owned by the graph, so the caller never writes a duplicate or unrelated selection.
 *
 * @param activeId - Active cursor row id.
 * @param selection - Current right-pane selection.
 * @returns The target to dispatch, or null when nothing changes.
 */
function readCursorTarget(
  activeId: string,
  selection: RepositorySelection,
): GraphSelectionTarget | null {
  if (selection.kind !== "pending" && selection.kind !== "commit") {
    return null;
  }

  if (activeId === GRAPH_PENDING_ROW_ID) {
    return selection.kind === "pending" ? null : { kind: "pending" };
  }

  if (selection.kind === "commit" && selection.oid === activeId) {
    return null;
  }

  return { kind: "commit", oid: activeId };
}
