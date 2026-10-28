import type { ScrollBoxRenderable } from "@opentui/core";
import { type MutableRefObject, type RefObject, useCallback, useEffect, useRef } from "react";
import { useListCursor } from "@/app/hooks/useListCursor";
import type { GraphWindowState } from "@/domain/graph/graph.types";
import type { RepositorySelection } from "@/domain/repository/repository.types";
import { GRAPH_PENDING_ROW_ID, GRAPH_REGION_ID } from "@/features/graph/graph.constants";
import { readSelectedRowId } from "@/features/graph/graph.rows";
import type { GraphDisplayRow, GraphSelectionTarget } from "@/features/graph/graph.types";
import {
  readGraphRowOriginLines,
  readGraphVisibleRows,
  resolveMoveIndex,
  stepIndex,
} from "@/features/graph/graph.window";

/**
 * Owns graph selection and cursor navigation.
 *
 * The cursor is the shared `graph` region cursor, so it survives a refresh that keeps the same row
 * id. A provider selection change moves the cursor once; a row-list change also re-syncs the cursor
 * to the retained provider selection, so a reload that inserted rows cannot leave the cursor on the
 * row that clamped into the old index. Cursor movement dispatches the internal selection command
 * once, so the graph never writes provider selection directly. Mouse wheel scrolling never reaches
 * this hook: it scrolls the native viewport in `CommitGraph` and leaves the selection untouched.
 * Because that free scroll can leave the cursor outside the viewport, the cursor resolver re-anchors
 * an up or down move to the nearest visible edge instead of revealing the stale row and pulling the
 * viewport back. Older pages are loaded only by the explicit graph action or the
 * Load older commits button.
 *
 * @param input - Rows, provider selection, the internal selection dispatcher, the scrollbox, and the
 * selection memory needed by the paging layer.
 * @returns The cursor, the selected row id, and the row click handler.
 */
export function useGraphSelection(input: {
  readonly rows: readonly GraphDisplayRow[];
  readonly selection: RepositorySelection;
  readonly selectTarget: (target: GraphSelectionTarget) => void;
  readonly lastSelectionIndexRef: MutableRefObject<number>;
  readonly windowState: GraphWindowState;
  readonly scrollRef: RefObject<ScrollBoxRenderable | null>;
  readonly searchDelegateActionRef: MutableRefObject<
    (action: "up" | "down" | "first" | "last" | "activate") => boolean
  >;
}) {
  const {
    lastSelectionIndexRef,
    rows,
    scrollRef,
    searchDelegateActionRef,
    selectTarget,
    selection,
    windowState,
  } = input;
  const cursorIndexRef = useRef(0);

  /** Re-anchors an up or down move to the visible rows after a free scroll. */
  const resolveRowMoveIndex = useCallback(
    (direction: "up" | "down", currentIndex: number): number => {
      const box = scrollRef.current;

      if (box === null || box.viewport.height <= 0) {
        return stepIndex(currentIndex, direction);
      }

      const origin = readGraphRowOriginLines(box, rows[0]?.id ?? null);
      const visible = readGraphVisibleRows(box.scrollTop, box.viewport.height, origin);

      return resolveMoveIndex(currentIndex, direction, visible);
    },
    [rows, scrollRef],
  );

  /** Selects one graph row by index through the internal selection command. */
  const activateAt = useCallback(
    (index: number): void => {
      const row = rows[index];

      if (row === undefined) {
        return;
      }

      selectTarget(row.kind === "pending" ? { kind: "pending" } : { kind: "commit", oid: row.id });
    },
    [rows, selectTarget],
  );

  const cursor = useListCursor({
    regionId: GRAPH_REGION_ID,
    items: rows.map((row) => ({ id: row.id })),
    onActivate: () => {
      activateAt(cursorIndexRef.current);
    },
    onDoubleClick: activateAt,
    delegateAction: (action) => searchDelegateActionRef.current(action),
    resolveMoveIndex: resolveRowMoveIndex,
  });

  cursorIndexRef.current = cursor.index;

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
  }, [cursor.activeId, cursor.selectId, rows, selectedRowId]);

  useSelectionFromCursor({
    activeId: cursor.activeId,
    rows,
    selection,
    selectTarget,
  });

  useEffect(() => {
    if (selection.kind !== "commit") {
      return;
    }

    const index = windowState.rows.findIndex((row) => row.oid === selection.oid);

    if (index >= 0) {
      lastSelectionIndexRef.current = index;
    }
  }, [lastSelectionIndexRef, selection, windowState.rows]);

  return {
    cursor,
    selectedRowId,
    handleRowClick: cursor.handleRowClick,
  };
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
 * @param input - Active cursor id, current rows, current selection, and the selection dispatcher.
 */
function useSelectionFromCursor(input: {
  readonly activeId: string | null;
  readonly rows: readonly GraphDisplayRow[];
  readonly selection: RepositorySelection;
  readonly selectTarget: (target: GraphSelectionTarget) => void;
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

    const target = readCursorTarget(activeId, input.selection);

    if (target !== null) {
      input.selectTarget(target);
    }
  }, [input.activeId, input.rows, input.selection, input.selectTarget]);
}

/**
 * Maps a cursor row and the current selection to the selection it should dispatch.
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
