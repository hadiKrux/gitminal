import { useCallback, useEffect, useRef, useState } from "react";
import { useActions } from "@/app/hooks/useAction";
import type { ActionBatchRegistration } from "@/app/hooks/useAction.types";
import { useFocusRegion } from "@/app/hooks/useFocusRegion";
import type { ListCursorHandle, UseListCursorOptions } from "@/app/hooks/useListCursor.types";
import type { RegionId } from "@/features/shell/focus.types";
import { clampIndex } from "@/lib/list";

/** Largest gap between two clicks on one row that counts as a double click. */
const DOUBLE_CLICK_THRESHOLD_MS = 400;

/**
 * Owns keyboard navigation, cursor persistence, and double click for a custom-row list.
 *
 * The hook reads and writes the region cursor through `FocusProvider`, so the selection is keyed
 * by item id and survives a refresh that keeps the item. It registers `nav.up`, `nav.down`, and
 * `nav.activate` in the region scope, plus `nav.first` and `nav.last` only when the region binds
 * them. It never registers `focus.*` or `app.refresh`, never calls `focus()`, and never activates
 * an empty list. When the list shrinks, the index clamps; when the active item disappears, the
 * cursor falls back to the same position in the new list. A caller that owns a free-scrolling
 * viewport may supply `resolveMoveIndex` so an up or down move re-anchors a cursor that scrolled out
 * of view instead of revealing the stale row. An empty list leaves the stored cursor in
 * place, so the selection returns when rows arrive after a load; it is never cleared on the caller's
 * behalf. A double click reports the clicked row index to the caller, so activation targets the row
 * the user clicked even when no render separates the two mouse events.
 *
 * @param options - Region identity, visible rows, activation callbacks, and the first/last toggle.
 * @returns The cursor handle the list renders and forwards to `ListRow`.
 */
export function useListCursor(options: UseListCursorOptions): ListCursorHandle {
  const { getCursor, setCursor } = useFocusRegion(options.regionId);
  const [index, setIndex] = useState(() => resolveInitialIndex(options.items, getCursor()));
  const previousItems = useRef<readonly { readonly id: string }[] | null>(null);
  const clampedIndex = clampIndex(index, options.items.length);
  const activeId = options.items[clampedIndex]?.id ?? null;

  useEffect(() => {
    const previous = previousItems.current;
    previousItems.current = options.items;

    if (options.items.length === 0) {
      return;
    }

    const storedId = getCursor();

    setIndex((current) => resolveItemsChange(previous, options.items, current, storedId));
  }, [options.items, getCursor]);

  useEffect(() => {
    if (activeId !== null) {
      setCursor(activeId);
    }
  }, [activeId, setCursor]);

  const select = useCallback(
    (nextIndex: number): void => {
      setIndex(clampIndex(nextIndex, options.items.length));
    },
    [options.items.length],
  );

  const selectId = useCallback(
    (id: string): void => {
      const found = findItemIndex(options.items, id);

      if (found === -1) {
        return;
      }

      setIndex(found);
      setCursor(id);
    },
    [options.items, setCursor],
  );

  const moveUp = useCallback((): void => {
    if (options.delegateAction?.("up") === true) {
      return;
    }

    setIndex((current) =>
      clampIndex(options.resolveMoveIndex?.("up", current) ?? current - 1, options.items.length),
    );
  }, [options.delegateAction, options.items.length, options.resolveMoveIndex]);

  const moveDown = useCallback((): void => {
    if (options.delegateAction?.("down") === true) {
      return;
    }

    setIndex((current) =>
      clampIndex(options.resolveMoveIndex?.("down", current) ?? current + 1, options.items.length),
    );
  }, [options.delegateAction, options.items.length, options.resolveMoveIndex]);

  const moveFirst = useCallback((): void => {
    if (options.delegateAction?.("first") === true) {
      return;
    }

    setIndex(clampIndex(0, options.items.length));
  }, [options.delegateAction, options.items.length]);

  const moveLast = useCallback((): void => {
    if (options.delegateAction?.("last") === true) {
      return;
    }

    setIndex(clampIndex(options.items.length - 1, options.items.length));
  }, [options.delegateAction, options.items.length]);

  const activate = useCallback((): void => {
    if (options.delegateAction?.("activate") === true) {
      return;
    }

    if (options.items.length === 0) {
      return;
    }

    options.onActivate();
  }, [options.delegateAction, options.items.length, options.onActivate]);

  const handleRowClick = useRowClickHandler(select, options.onDoubleClick);

  useActions(
    buildListCursorRegistrations({
      regionId: options.regionId,
      enableFirstLast: options.enableFirstLast !== false,
      moveUp,
      moveDown,
      moveFirst,
      moveLast,
      activate,
    }),
  );

  return {
    index: clampedIndex,
    activeId,
    select,
    selectId,
    moveUp,
    moveDown,
    moveFirst,
    moveLast,
    handleRowClick,
  };
}

/**
 * Builds the row click handler that selects a row and detects a double click.
 *
 * The last click stays in refs so the handler identity changes only with its callbacks. The helper
 * keeps the double-click branch out of the cursor hook body.
 *
 * @param select - Selects one row index.
 * @param onDoubleClick - Caller double-click handler, when the list binds one.
 * @returns The row click handler.
 */
function useRowClickHandler(
  select: (index: number) => void,
  onDoubleClick: ((index: number) => void) | undefined,
): (rowIndex: number) => void {
  const lastClick = useRef<{ readonly index: number; readonly at: number } | null>(null);

  return useCallback(
    (rowIndex: number): void => {
      select(rowIndex);

      const now = Date.now();
      const previousClick = lastClick.current;

      lastClick.current = { index: rowIndex, at: now };

      if (!isDoubleClick(previousClick, rowIndex, now)) {
        return;
      }

      lastClick.current = null;
      onDoubleClick?.(rowIndex);
    },
    [onDoubleClick, select],
  );
}

/**
 * Builds the region-scoped action registrations the cursor owns.
 *
 * @param handlers - Region identity, navigation callbacks, and the first/last toggle.
 * @returns The registrations to install, without `focus.*` or any global action.
 */
function buildListCursorRegistrations(handlers: {
  readonly regionId: RegionId;
  readonly enableFirstLast: boolean;
  readonly moveUp: () => void;
  readonly moveDown: () => void;
  readonly moveFirst: () => void;
  readonly moveLast: () => void;
  readonly activate: () => void;
}): readonly ActionBatchRegistration[] {
  const options = { scope: handlers.regionId } as const;
  const registrations: ActionBatchRegistration[] = [
    { actionId: "nav.up", options, handler: handlers.moveUp },
    { actionId: "nav.down", options, handler: handlers.moveDown },
    { actionId: "nav.activate", options, handler: handlers.activate },
  ];

  if (handlers.enableFirstLast) {
    registrations.push(
      { actionId: "nav.first", options, handler: handlers.moveFirst },
      { actionId: "nav.last", options, handler: handlers.moveLast },
    );
  }

  return registrations;
}

/**
 * Resolves the initial index from the persisted cursor identity.
 *
 * @param items - Visible rows.
 * @param storedId - Persisted item id, or `null`.
 * @returns The index of the stored item, or `0` when it is absent.
 */
function resolveInitialIndex(
  items: readonly { readonly id: string }[],
  storedId: string | null,
): number {
  if (storedId === null) {
    return 0;
  }

  const found = findItemIndex(items, storedId);

  return found === -1 ? 0 : found;
}

/**
 * Resolves the index after the visible rows change.
 *
 * The active item keeps its identity when it survives the change, so a reorder follows the row. A
 * list that was empty restores the persisted cursor, and a shrinking list clamps into range.
 *
 * @param previous - Rows from the previous render, or `null` on mount.
 * @param items - Rows from the current render.
 * @param currentIndex - Index held before the change.
 * @param storedId - Persisted item id, or `null`.
 * @returns The index to select in the current rows.
 */
function resolveItemsChange(
  previous: readonly { readonly id: string }[] | null,
  items: readonly { readonly id: string }[],
  currentIndex: number,
  storedId: string | null,
): number {
  if (previous !== null) {
    const activeId = previous[clampIndex(currentIndex, previous.length)]?.id;
    const carried = activeId === undefined ? -1 : findItemIndex(items, activeId);

    if (carried !== -1) {
      return carried;
    }

    if (previous.length === 0 && storedId !== null) {
      const restored = findItemIndex(items, storedId);

      if (restored !== -1) {
        return restored;
      }
    }
  }

  return clampIndex(currentIndex, items.length);
}

/**
 * Finds the index of one item id.
 *
 * @param items - Rows to search.
 * @param id - Stable item id.
 * @returns The matching index, or `-1` when the id is absent.
 */
function findItemIndex(items: readonly { readonly id: string }[], id: string): number {
  return items.findIndex((item) => item.id === id);
}

/**
 * Reports whether a click completes a double click on the same row.
 *
 * @param previous - Previous click record, or `null`.
 * @param rowIndex - Row of the current click.
 * @param now - Current timestamp in milliseconds.
 * @returns True when both clicks landed on the row inside the threshold.
 */
function isDoubleClick(
  previous: { readonly index: number; readonly at: number } | null,
  rowIndex: number,
  now: number,
): boolean {
  if (previous === null || previous.index !== rowIndex) {
    return false;
  }

  return now - previous.at <= DOUBLE_CLICK_THRESHOLD_MS;
}
