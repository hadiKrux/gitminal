import {
  GRAPH_CHROME_ROWS,
  GRAPH_ROW_HEIGHT,
  GRAPH_SCROLL_MAX_STEPS,
  GRAPH_SCROLL_STEP_ROWS,
} from "@/features/graph/graph.constants";
import type { VisibleWindow } from "@/features/graph/graph.types";

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
 * Panel borders, the header line, the optional search field, and the bounded status footer are
 * reserved from the terminal height. The measured viewport supersedes this estimate as soon as the
 * layout settles, so it is deliberately an over-estimate rather than a second source of truth.
 *
 * @param terminalHeight - Terminal height in cells.
 * @param reservedLines - Bounded status footer lines, or zero when no footer renders.
 * @returns The estimated number of fully visible rows.
 */
export function readTerminalRowCapacity(terminalHeight: number, reservedLines: number = 0): number {
  return readViewportRowCapacity(terminalHeight - GRAPH_CHROME_ROWS - reservedLines);
}

/**
 * Computes the contiguous row range mounted for one render.
 *
 * The visible window is centered on the selected row and clamped to the list. The selected row is
 * always kept inside the first `capacity` rows of the returned slice, including at the end of the
 * loaded list, because the scrollbox is anchored at the top and is never scrolled programmatically.
 * Overscan is then added above and below, but the upper overscan is trimmed when it would push the
 * selection past the visible rows and the lower overscan is capped by the list end.
 *
 * @param total - Number of rows in the list.
 * @param selectedIndex - Selected row index.
 * @param capacity - Fully visible rows.
 * @param overscan - Extra rows mounted beyond each edge.
 * @returns The half-open mounted range.
 */
export function computeVisibleWindow(
  total: number,
  selectedIndex: number,
  capacity: number,
  overscan: number,
): VisibleWindow {
  if (total <= 0) {
    return { start: 0, end: 0 };
  }

  const rows = Math.max(1, Math.floor(capacity));
  const extra = Math.max(0, Math.floor(overscan));
  const selected = clampIndex(selectedIndex, total);
  const centeredStart = selected - Math.floor(rows / 2);
  const baseStart = Math.min(Math.max(0, centeredStart), Math.max(0, total - rows));
  const start = Math.max(0, baseStart - extra, selected - rows + 1);
  const end = Math.min(total, baseStart + rows + extra);

  return { start, end };
}

/**
 * Counts the bounded lines the fixed graph status footer occupies for the current state.
 *
 * Every footer row is single-line or capped, so this is a true maximum instead of a wide-panel guess:
 * the loading and walk rows take one line, a compact page error takes its message, an optional
 * details line, and the Retry row, and the end marker wraps to at most two lines. The footer sits
 * outside the scrollbox, so its real height is already excluded from the measured viewport; this
 * count is only used to reserve space in the first-frame terminal estimate.
 *
 * @param input - Footer row presence flags.
 * @returns The bounded footer line count.
 */
export function readStatusFooterLines(input: {
  readonly isLoadingOlder: boolean;
  readonly hasWalkError: boolean;
  readonly hasPageError: boolean;
  readonly hasPageErrorDetails: boolean;
  readonly isDone: boolean;
}): number {
  const loadingLines = input.isLoadingOlder ? 1 : 0;
  const walkLines = input.hasWalkError ? 1 : 0;
  const pageErrorLines = input.hasPageError ? (input.hasPageErrorDetails ? 3 : 2) : 0;
  const endLines = input.isDone ? 2 : 0;

  return loadingLines + walkLines + pageErrorLines + endLines;
}

/**
 * Reads the bounded row delta for one wheel event.
 *
 * The visible window mounts only the visible slice, so native scrolling has no unmounted rows to
 * travel through. The wheel moves the cursor by a small fixed step instead. The direction decides
 * the sign, the delta magnitude is capped, and a horizontal wheel has no row delta. Callers pass
 * the result to `moveIndexByRows`.
 *
 * @param direction - Wheel direction from the OpenTUI scroll payload.
 * @param delta - Wheel delta magnitude from the same payload.
 * @returns Signed rows to move, or zero for a horizontal wheel.
 */
export function readScrollRowDelta(
  direction: "up" | "down" | "left" | "right",
  delta: number,
): number {
  if (direction !== "up" && direction !== "down") {
    return 0;
  }

  const steps = Math.min(Math.max(1, Math.trunc(Math.abs(delta)) || 1), GRAPH_SCROLL_MAX_STEPS);

  return (direction === "down" ? 1 : -1) * steps * GRAPH_SCROLL_STEP_ROWS;
}

/**
 * Moves one cursor index by a bounded row delta and clamps it into the list.
 *
 * @param index - Current cursor index.
 * @param total - Number of rows in the list.
 * @param delta - Signed rows to move.
 * @returns The clamped cursor index, or zero for an empty list.
 */
export function moveIndexByRows(index: number, total: number, delta: number): number {
  if (total <= 0) {
    return 0;
  }

  return clampIndex(index + delta, total);
}

/**
 * Clamps one row index into a non-empty list.
 *
 * @param index - Requested index.
 * @param total - Number of rows.
 * @returns A whole index between zero and `total - 1`.
 */
function clampIndex(index: number, total: number): number {
  if (!Number.isFinite(index)) {
    return 0;
  }

  return Math.min(Math.max(0, Math.trunc(index)), total - 1);
}
