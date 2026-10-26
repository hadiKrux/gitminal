import { useCallback, useEffect, useRef } from "react";
import { useListCursor } from "@/app/hooks/useListCursor";
import type { StashRecord } from "@/domain/git/git.types";
import type { RepositorySelection } from "@/domain/repository/repository.types";
import { STASHES_REGION_ID } from "@/features/stashes/useStashes.constants";

/**
 * Owns the stash cursor and the right-pane selection it drives.
 *
 * `nav.activate` and a double click both select the immutable object name in the right pane. The
 * cursor owns navigation with `nav.first`/`nav.last` disabled, because the Stashes context does not
 * claim `g` and `G`.
 *
 * @param items - Visible rows in display order.
 * @param setSelection - Provider selection writer.
 * @returns The cursor, active row, active index, and activation helpers.
 */
export function useStashSelection(
  items: readonly { readonly id: string; readonly stash: StashRecord }[],
  setSelection: (selection: RepositorySelection) => void,
) {
  const itemsRef = useRef(items);
  const indexRef = useRef(0);

  itemsRef.current = items;

  /** Selects one stash in the right pane without running a git command. */
  const selectStash = useCallback(
    (stash: StashRecord | null): void => {
      if (stash === null) {
        return;
      }

      setSelection({ kind: "stash", objectName: stash.objectName });
    },
    [setSelection],
  );

  /** Runs the primary action for the active row. */
  const activateActive = useCallback((): void => {
    selectStash(itemsRef.current[indexRef.current]?.stash ?? null);
  }, [selectStash]);

  /**
   * Runs the primary action for one clicked row.
   *
   * @param index - Row index reported by the click that completed the double click.
   */
  const activateAtIndex = useCallback(
    (index: number): void => {
      selectStash(itemsRef.current[index]?.stash ?? null);
    },
    [selectStash],
  );

  const cursor = useListCursor({
    regionId: STASHES_REGION_ID,
    items,
    enableFirstLast: false,
    onActivate: activateActive,
    onDoubleClick: activateAtIndex,
  });

  indexRef.current = cursor.index;

  return {
    cursor,
    selected: items[cursor.index]?.stash ?? null,
    selectedIndex: cursor.index,
    selectStash,
  };
}

/**
 * Repairs the right-pane selection when the selected stash leaves the snapshot.
 *
 * The cursor already falls back to the same position, but the provider selection is written only on
 * activation. When the selected object name disappears, this effect moves the selection to the
 * nearest surviving row at the last known position, or back to the Pending Changes row when no row
 * survives. The last known position is recorded while the selection still exists, so an external
 * drop cannot make the pane point at a vanished identity.
 *
 * @param input - Refreshed rows, snapshot readiness, current selection, position memory, and setter.
 */
export function useStashSelectionRepair(input: {
  readonly rows: readonly StashRecord[];
  readonly snapshotReady: boolean;
  readonly selection: RepositorySelection;
  readonly lastSelectionIndexRef: { current: number };
  readonly setSelection: (selection: RepositorySelection) => void;
}): void {
  const { lastSelectionIndexRef, rows, selection, setSelection, snapshotReady } = input;
  const selectedIndex =
    selection.kind === "stash"
      ? rows.findIndex((row) => row.objectName === selection.objectName)
      : -1;

  if (selectedIndex >= 0) {
    lastSelectionIndexRef.current = selectedIndex;
  }

  useEffect(() => {
    if (!snapshotReady || selection.kind !== "stash") {
      return;
    }

    if (rows.some((row) => row.objectName === selection.objectName)) {
      return;
    }

    const nearestIndex = Math.min(Math.max(0, lastSelectionIndexRef.current), rows.length - 1);
    const nearest = rows[nearestIndex];

    setSelection(
      nearest === undefined
        ? { kind: "pending" }
        : { kind: "stash", objectName: nearest.objectName },
    );
  }, [lastSelectionIndexRef, rows, selection, setSelection, snapshotReady]);
}
