import type { RegionId } from "@/features/shell/focus.types";

/**
 * Options accepted by `useListCursor`.
 *
 * The hook owns custom-row navigation for one region. It persists the active row by item id
 * through `FocusProvider`, so a refresh that keeps the item keeps the cursor.
 */
export interface UseListCursorOptions {
  /** Region whose cursor map entry and action scope the hook owns. */
  readonly regionId: RegionId;
  /** Visible rows in render order; each row needs a stable id. */
  readonly items: readonly { readonly id: string }[];
  /** Runs the primary action for the active row; never called for an empty list. */
  readonly onActivate: () => void;
  /** Runs when two clicks land on the same row inside the double-click threshold, with the clicked index. */
  readonly onDoubleClick?: (index: number) => void;
  /** Registers `nav.first` and `nav.last` only when the region binds them. Defaults to true. */
  readonly enableFirstLast?: boolean;
  /**
   * Resolves the requested next row index for one up or down move.
   *
   * The default moves one row from the current index. A caller that owns a free-scrolling viewport
   * supplies this so a cursor a native scroll left outside the visible rows re-anchors to what the
   * user can see instead of pulling the viewport back to the stale row. The hook clamps the returned
   * index to the list bounds.
   *
   * @param direction - Direction of the move.
   * @param currentIndex - Active row index before the move.
   * @returns The requested next index.
   */
  readonly resolveMoveIndex?: (direction: "up" | "down", currentIndex: number) => number;
  /**
   * Intercepts one navigation action before the list cursor handles it.
   *
   * This is how a search overlay keeps its own result cursor while the shared list hook remains the
   * single registration owner. Returning `true` means the delegate handled the action and the list
   * cursor must not move.
   *
   * @param action - Navigation action the delegate may handle.
   * @returns True when the delegate handled the action.
   */
  readonly delegateAction?: (action: "up" | "down" | "first" | "last" | "activate") => boolean;
}

/** Navigation handle returned by `useListCursor`. */
export interface ListCursorHandle {
  /** Clamped active row index; `0` for an empty list. */
  readonly index: number;
  /** Stable id of the active row, or `null` when the list is empty. */
  readonly activeId: string | null;
  /** Selects one row, clamping the index to the current list bounds. */
  readonly select: (index: number) => void;
  /**
   * Selects the row with one stable item id and writes it to the region cursor.
   *
   * An id absent from the current rows is ignored, so a caller may request a selection before a
   * refresh that will add the row.
   *
   * @param id - Stable item id of the row to select.
   */
  readonly selectId: (id: string) => void;
  /** Moves the cursor up one row, stopping at the first row. */
  readonly moveUp: () => void;
  /** Moves the cursor down one row, stopping at the last row. */
  readonly moveDown: () => void;
  /** Moves the cursor to the first row. */
  readonly moveFirst: () => void;
  /** Moves the cursor to the last row. */
  readonly moveLast: () => void;
  /** Selects a clicked row and dispatches the double click when the timing matches. */
  readonly handleRowClick: (index: number) => void;
}
