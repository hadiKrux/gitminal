import type { ScrollBoxRenderable } from "@opentui/core";
import { GRAPH_CHROME_ROWS, GRAPH_ROW_HEIGHT } from "@/features/graph/graph.constants";
import { graphRowRenderableId } from "@/features/graph/graph.rows";
import type { GraphVisibleRows } from "@/features/graph/graph.types";

/**
 * Reads how many two-line rows fit in a scrollbox viewport.
 *
 * The measured viewport already excludes the panel borders, the header, the status footer, and any
 * console drawer, so no chrome estimate is subtracted here. The result is always at least one row so
 * a very small viewport still renders the selection instead of an empty panel.
 *
 * @param viewportHeight - Measured scrollbox viewport height in lines.
 * @returns The number of fully visible rows.
 */
export function readViewportRowCapacity(viewportHeight: number): number {
  const bodyHeight = Math.max(GRAPH_ROW_HEIGHT, viewportHeight);

  return Math.max(1, Math.floor(bodyHeight / GRAPH_ROW_HEIGHT));
}

/**
 * Reads the first-frame row estimate before the scrollbox publishes its viewport.
 *
 * Panel borders, the header line, and the optional search field are reserved from the terminal
 * height. The measured viewport supersedes this estimate as soon as the layout settles, so it is
 * deliberately an over-estimate rather than a second source of truth. The only row-count consumer
 * left is the `nav.pageUp`/`nav.pageDown` step, which reads it before the first layout pass.
 *
 * @param terminalHeight - Terminal height in cells.
 * @returns The estimated number of fully visible rows.
 */
export function readTerminalRowCapacity(terminalHeight: number): number {
  return readViewportRowCapacity(terminalHeight - GRAPH_CHROME_ROWS);
}

/**
 * Computes the two-line graph rows visible at one native scroll offset.
 *
 * The graph mounts every loaded row and rows line up on whole lines, so the first visible row starts
 * at or above the viewport top. A partially visible edge row counts as visible, and the last index
 * may exceed the loaded row count; callers clamp it through the cursor. The trailing one-line load
 * control is counted as part of the last row near the very bottom, which can shift the reported range
 * by one index there and is why callers clamp. An odd origin, such as a one-line loading row or a
 * wrapped bounded-miss notice, can also shift the bottom edge by one row; the caller's clamp and the
 * reveal correct it. A zero or non-finite viewport height before layout reports a single row, which
 * keeps a move from anchoring to an empty range.
 *
 * @param scrollTop - Native scroll offset in lines.
 * @param viewportHeight - Measured scrollbox viewport height in lines.
 * @param originLines - Content lines mounted above the first graph row, such as the loading and
 * bounded-miss rows.
 * @returns The first and last visible row indexes.
 */
export function readGraphVisibleRows(
  scrollTop: number,
  viewportHeight: number,
  originLines: number = 0,
): GraphVisibleRows {
  const top = Number.isFinite(scrollTop) ? Math.max(0, Math.floor(scrollTop)) : 0;
  const height = Number.isFinite(viewportHeight) ? Math.max(0, Math.floor(viewportHeight)) : 0;
  const origin = Number.isFinite(originLines) ? Math.max(0, Math.floor(originLines)) : 0;
  const first = Math.max(0, Math.floor((top - origin) / GRAPH_ROW_HEIGHT));
  const count = Math.max(1, Math.floor(height / GRAPH_ROW_HEIGHT));

  return { first, last: first + count - 1 };
}

/**
 * Reads how many content lines are mounted above the first graph row.
 *
 * The body renders an initial-loading row, a parent-loading row, and the bounded-miss notice before
 * the pending and commit rows, so `scrollTop` alone does not identify the first visible graph row.
 * The first row's laid-out position is converted back into content lines; before layout it falls
 * back to zero.
 *
 * @param box - Graph scrollbox that owns the body.
 * @param firstRowId - Stable id of the first graph row, or null before rows load.
 * @returns The number of content lines above the first graph row.
 */
export function readGraphRowOriginLines(
  box: ScrollBoxRenderable,
  firstRowId: string | null,
): number {
  if (firstRowId === null) {
    return 0;
  }

  const row = box.content.findDescendantById(graphRowRenderableId(firstRowId));

  if (row === undefined || row.height <= 0) {
    return 0;
  }

  return Math.max(0, row.y - box.viewport.y + box.scrollTop);
}

/**
 * Anchors one keyboard move to the rows the user can see.
 *
 * A cursor inside the visible range stays where it is. A cursor outside it, which happens when the
 * wheel scrolled the viewport away without moving the selection, anchors to the nearest visible edge
 * instead. The anchor follows the cursor's position, not the move direction: pressing up while the
 * cursor is above the viewport must not move the cursor down to the bottom visible row. Returning the
 * anchor rather than the moved index lets page moves and row moves share the same rule.
 *
 * @param currentIndex - Active cursor index before the move.
 * @param visible - Visible row range of the body.
 * @returns The row index the move should start from.
 */
export function readGraphMoveAnchor(currentIndex: number, visible: GraphVisibleRows): number {
  if (currentIndex < visible.first) {
    return visible.first;
  }

  if (currentIndex > visible.last) {
    return visible.last;
  }

  return currentIndex;
}

/**
 * Resolves one keyboard move from the visible row range.
 *
 * A cursor inside the visible range advances one row. A cursor outside anchors to the nearest visible
 * edge without stepping, so the key that re-enters the viewport selects the edge row and does not
 * jump past it. Row moves and search moves share this rule.
 *
 * @param currentIndex - Active cursor index before the move.
 * @param direction - Direction of the move.
 * @param visible - Visible row range of the body.
 * @returns The requested next index.
 */
export function resolveMoveIndex(
  currentIndex: number,
  direction: "up" | "down",
  visible: GraphVisibleRows,
): number {
  const anchor = readGraphMoveAnchor(currentIndex, visible);

  return anchor === currentIndex ? stepIndex(currentIndex, direction) : anchor;
}

/**
 * Applies one row step in a move direction.
 *
 * Only the cursor clamps the result, so a move past either end stays a plain index the caller can
 * hand to a clamping selector. This keeps every fallback in the graph and search move paths identical.
 *
 * @param index - Index to step from.
 * @param direction - Direction of the move.
 * @returns The index one row up or down.
 */
export function stepIndex(index: number, direction: "up" | "down"): number {
  return index + (direction === "up" ? -1 : 1);
}
