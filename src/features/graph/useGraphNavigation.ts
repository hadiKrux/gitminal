import type { ScrollBoxRenderable } from "@opentui/core";
import { type RefObject, useCallback, useEffect } from "react";
import { useActions } from "@/app/hooks/useAction";
import { publishActionAvailability } from "@/app/hooks/useActionAvailability";
import type { ListCursorHandle } from "@/app/hooks/useListCursor.types";
import { GRAPH_REGION_ID } from "@/features/graph/graph.constants";
import type { CommitSearchHandle } from "@/features/graph/graph.types";
import {
  readGraphMoveAnchor,
  readGraphRowOriginLines,
  readGraphVisibleRows,
  readTerminalRowCapacity,
  readViewportRowCapacity,
} from "@/features/graph/graph.window";
import { useTerminalDimensions } from "@/ui/useTerminalDimensions";

/** Registration options shared by every graph-scoped action. */
const GRAPH_ACTION_OPTIONS = { scope: GRAPH_REGION_ID } as const;

/**
 * Owns the graph's page and search action registrations.
 *
 * `nav.pageUp` and `nav.pageDown` move by one measured scrollbox viewport while the normal graph body
 * owns the cursor, and forward to the search result pager while search is open. The step is read from
 * the scrollbox at action time so it matches the viewport the rows are rendered in, including the
 * space the footer and the console drawer take; the terminal height is only the fallback before
 * layout publishes the viewport. When a native scroll left the cursor outside the viewport, a page
 * move starts from the nearest visible edge instead of the stale cursor, so it
 * never pulls the viewport back. `graph.search` opens the input. `graph.loadOlder` asks the
 * paginator for the next older page; its handler, footer availability, and the end-of-list button
 * share the same `canLoadOlder` predicate, so an exhausted, loading, failed, or search-owned graph
 * never offers the action twice. The shared list cursor remains the only owner of `nav.up`,
 * `nav.down`, and `nav.activate`.
 *
 * @param input - Graph cursor, search handle, the scrollbox that owns the viewport, the first row id
 * used to find the visible range, and the explicit older-page control state.
 */
export function useGraphNavigation(input: {
  readonly cursor: ListCursorHandle;
  readonly search: CommitSearchHandle;
  readonly scrollRef: RefObject<ScrollBoxRenderable | null>;
  readonly canLoadOlder: boolean;
  readonly loadOlder: () => void;
  readonly firstRowId: string | null;
}): void {
  const { canLoadOlder, cursor, firstRowId, loadOlder, search, scrollRef } = input;
  const dimensions = useTerminalDimensions();

  /** Moves by one viewport, or by one search page while search owns the cursor. */
  const movePage = useCallback(
    (direction: "up" | "down"): void => {
      if (search.isOpen) {
        search.pageBy(direction);

        return;
      }

      const box = scrollRef.current;
      const viewportHeight = box?.viewport.height;
      const step =
        typeof viewportHeight === "number" && viewportHeight > 0
          ? readViewportRowCapacity(viewportHeight)
          : readTerminalRowCapacity(dimensions.height);
      const anchor =
        box !== null && typeof viewportHeight === "number" && viewportHeight > 0
          ? readGraphMoveAnchor(
              cursor.index,
              readGraphVisibleRows(
                box.scrollTop,
                viewportHeight,
                readGraphRowOriginLines(box, firstRowId),
              ),
            )
          : cursor.index;
      const delta = direction === "up" ? -step : step;

      cursor.select(anchor + delta);
    },
    [cursor, dimensions.height, firstRowId, scrollRef, search],
  );

  useActions([
    {
      actionId: "nav.pageUp",
      options: GRAPH_ACTION_OPTIONS,
      handler: () => movePage("up"),
    },
    {
      actionId: "nav.pageDown",
      options: GRAPH_ACTION_OPTIONS,
      handler: () => movePage("down"),
    },
    {
      actionId: "graph.search",
      options: GRAPH_ACTION_OPTIONS,
      handler: search.open,
    },
    {
      actionId: "graph.loadOlder",
      options: GRAPH_ACTION_OPTIONS,
      handler: () => {
        if (!canLoadOlder) {
          return;
        }

        loadOlder();
      },
    },
  ]);

  useEffect(
    () => publishActionAvailability(GRAPH_REGION_ID, "graph.loadOlder", canLoadOlder),
    [canLoadOlder],
  );
}
