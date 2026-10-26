import type { ScrollBoxRenderable } from "@opentui/core";
import { useTerminalDimensions } from "@opentui/react";
import { type RefObject, useCallback } from "react";
import { useActions } from "@/app/hooks/useAction";
import type { ListCursorHandle } from "@/app/hooks/useListCursor.types";
import { GRAPH_REGION_ID } from "@/features/graph/graph.constants";
import type { CommitSearchHandle } from "@/features/graph/graph.types";
import { readTerminalRowCapacity, readViewportRowCapacity } from "@/features/graph/graph.window";

/** Registration options shared by every graph-scoped action. */
const GRAPH_ACTION_OPTIONS = { scope: GRAPH_REGION_ID } as const;

/**
 * Owns the graph's page and search action registrations.
 *
 * `nav.pageUp` and `nav.pageDown` move by one measured scrollbox viewport while the normal graph body
 * owns the cursor, and forward to the search result pager while search is open. The step is read from
 * the scrollbox at action time so it matches the viewport the rows are rendered in, including the
 * space the footer and the console drawer take; the terminal height is only the fallback before
 * layout publishes the viewport. `graph.search` opens the input. The shared list cursor remains the
 * only owner of `nav.up`, `nav.down`, and `nav.activate`.
 *
 * @param input - Graph cursor, search handle, and the scrollbox that owns the viewport.
 */
export function useGraphNavigation(input: {
  readonly cursor: ListCursorHandle;
  readonly search: CommitSearchHandle;
  readonly scrollRef: RefObject<ScrollBoxRenderable | null>;
}): void {
  const { cursor, search, scrollRef } = input;
  const dimensions = useTerminalDimensions();

  /** Moves by one viewport, or by one search page while search owns the cursor. */
  const movePage = useCallback(
    (direction: "up" | "down"): void => {
      if (search.isOpen) {
        search.pageBy(direction);

        return;
      }

      const viewportHeight = scrollRef.current?.viewport.height;
      const step =
        typeof viewportHeight === "number" && viewportHeight > 0
          ? readViewportRowCapacity(viewportHeight)
          : readTerminalRowCapacity(dimensions.height);
      const delta = direction === "up" ? -step : step;

      cursor.select(cursor.index + delta);
    },
    [cursor, dimensions.height, scrollRef, search],
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
  ]);
}
