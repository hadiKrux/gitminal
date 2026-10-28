import type { ScrollBoxRenderable } from "@opentui/core";
import type { RefObject } from "react";
import { searchResultRowId } from "@/features/graph/graph.rows";
import type { GraphVisibleRows, SearchResultView } from "@/features/graph/graph.types";
import { readGraphMoveAnchor, resolveMoveIndex, stepIndex } from "@/features/graph/graph.window";

/**
 * Reads the search result indexes currently visible in the graph scrollbox.
 *
 * Search rows have variable heights, so their visible range cannot be derived from the scroll offset
 * and a fixed row height. The body may also mount non-result rows around the results, such as the
 * search error block or the trailing loading row, so mounted children are matched by renderable id
 * instead of by position. A row counts as visible when any of its lines overlaps the viewport.
 *
 * @param box - Graph scrollbox whose content holds the mounted result rows.
 * @param results - Search results in display order.
 * @returns The visible index range, or null before layout.
 */
function readVisibleResultRange(
  box: ScrollBoxRenderable,
  results: readonly SearchResultView[],
): GraphVisibleRows | null {
  const wrapper = box.content.getChildren()[0];
  const mounted = new Map<string, { readonly y: number; readonly height: number }>();

  for (const child of wrapper?.getChildren() ?? []) {
    mounted.set(child.id, { y: child.y, height: child.height });
  }

  const viewportTop = box.viewport.y;
  const viewportBottom = viewportTop + box.viewport.height;
  let first: number | null = null;
  let last = 0;

  for (let index = 0; index < results.length; index += 1) {
    const result = results[index];
    const row = result === undefined ? undefined : mounted.get(searchResultRowId(result.id));

    if (row === undefined || !isRowVisible(row, viewportTop, viewportBottom)) {
      continue;
    }

    if (first === null) {
      first = index;
    }

    last = index;
  }

  return first === null ? null : { first, last };
}

/**
 * Reports whether one mounted result row overlaps the viewport.
 *
 * @param row - Mounted row geometry.
 * @param viewportTop - Viewport top edge.
 * @param viewportBottom - Viewport bottom edge.
 * @returns True when any row line is inside the viewport.
 */
function isRowVisible(
  row: { readonly y: number; readonly height: number },
  viewportTop: number,
  viewportBottom: number,
): boolean {
  return row.height > 0 && row.y + row.height > viewportTop && row.y < viewportBottom;
}

/**
 * Anchors one search result move to the results the user can see.
 *
 * A result cursor inside the visible range stays where it is. A cursor outside it, which happens
 * when the wheel scrolled the result list without moving the cursor, anchors to the nearest visible
 * edge. The anchor follows the cursor position, not the move direction, so an up key never moves the
 * cursor down. The fallback before layout is the current index, which leaves the move unchanged.
 *
 * @param input - Scrollbox, results, and cursor position.
 * @returns The result index the move should start from.
 */
export function readSearchMoveAnchor(input: {
  readonly scrollRef: RefObject<ScrollBoxRenderable | null>;
  readonly results: readonly SearchResultView[];
  readonly currentIndex: number;
}): number {
  const box = input.scrollRef.current;

  if (box === null || box.viewport.height <= 0 || input.results.length === 0) {
    return input.currentIndex;
  }

  const visible = readVisibleResultRange(box, input.results);

  return visible === null ? input.currentIndex : readGraphMoveAnchor(input.currentIndex, visible);
}

/**
 * Resolves the next search result index for one keyboard move.
 *
 * When the cursor is inside the visible result range the move advances one row. When a native scroll
 * left it outside, the move re-anchors to the nearest visible edge instead, so the reveal does not
 * pull the viewport back to the stale result.
 *
 * @param input - Scrollbox, results, cursor position, and move direction.
 * @returns The requested next result index.
 */
export function readSearchMoveIndex(input: {
  readonly scrollRef: RefObject<ScrollBoxRenderable | null>;
  readonly results: readonly SearchResultView[];
  readonly currentIndex: number;
  readonly direction: "up" | "down";
}): number {
  const box = input.scrollRef.current;

  if (box === null || box.viewport.height <= 0 || input.results.length === 0) {
    return stepIndex(input.currentIndex, input.direction);
  }

  const visible = readVisibleResultRange(box, input.results);

  return visible === null
    ? stepIndex(input.currentIndex, input.direction)
    : resolveMoveIndex(input.currentIndex, input.direction, visible);
}
