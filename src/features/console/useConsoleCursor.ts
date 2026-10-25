import type { ScrollBoxRenderable } from "@opentui/core";
import { type RefObject, useCallback, useState } from "react";
import { useConsoleLog } from "@/app/hooks/useConsoleLog";
import { useStatus } from "@/app/hooks/useStatus";
import { readConsolePageStep } from "@/domain/console/console.rows";
import type { ConsoleEntry } from "@/domain/console/console.types";
import type { ConsoleCursorHandle } from "@/features/console/useConsole.types";
import { useConsoleFollowSync } from "@/features/console/useConsoleFollowSync";

/**
 * Owns the console cursor and the movement operations the drawer and actions share.
 *
 * Selection is local view state; follow-mode synchronization and the viewport reveal live in
 * `useConsoleFollowSync`, and follow mode, the buffer, the new-entry count, and expanded ids stay in
 * `ConsoleProvider`. Moving to the newest entry resumes follow mode, and moving anywhere else pauses
 * it, so the header indicator and the viewport cannot disagree. PageUp and PageDown move by the
 * entries whose rendered heights fill the current viewport, not by a fixed row count and not by
 * treating viewport rows as entries.
 *
 * @returns The console cursor and scroll helpers.
 */
export function useConsoleCursor(): ConsoleCursorHandle {
  const log = useConsoleLog();
  const { operation } = useStatus();
  const entries = log.entries;
  const { expandedEntryIds, setFollowing, toggleExpanded } = log;
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const scrollRef = useConsoleFollowSync({ entries, selectedEntryId, setSelectedEntryId });
  const reservedRows = operation === null ? 0 : 1;

  const selectedEntry = readEntry(entries, selectedEntryId);

  /** Clamps an index and writes the selection plus the matching follow state. */
  const applySelection = useCallback(
    (index: number): void => {
      if (entries.length === 0) {
        setSelectedEntryId(null);
        setFollowing(true);
        return;
      }

      const bounded = Math.min(entries.length - 1, Math.max(0, index));
      setSelectedEntryId(entries[bounded]?.id ?? null);
      setFollowing(bounded === entries.length - 1);
    },
    [entries, setFollowing],
  );

  /** Moves the cursor by a signed number of entries. */
  const moveBy = useCallback(
    (delta: number): void => {
      const currentIndex = readSelectedIndex(entries, selectedEntryId);

      applySelection((currentIndex < 0 ? entries.length - 1 : currentIndex) + delta);
    },
    [applySelection, entries, selectedEntryId],
  );

  /** Moves the cursor up one entry. */
  const moveUp = useCallback((): void => {
    moveBy(-1);
  }, [moveBy]);

  /** Moves the cursor down one entry. */
  const moveDown = useCallback((): void => {
    moveBy(1);
  }, [moveBy]);

  /** Moves the cursor up by the entries that fill one viewport. */
  const pageUp = useCallback((): void => {
    moveBy(-readPageStep(entries, selectedEntryId, -1, scrollRef, expandedEntryIds, reservedRows));
  }, [entries, expandedEntryIds, moveBy, reservedRows, scrollRef, selectedEntryId]);

  /** Moves the cursor down by the entries that fill one viewport. */
  const pageDown = useCallback((): void => {
    moveBy(readPageStep(entries, selectedEntryId, 1, scrollRef, expandedEntryIds, reservedRows));
  }, [entries, expandedEntryIds, moveBy, reservedRows, scrollRef, selectedEntryId]);

  /** Moves the cursor to the oldest entry. */
  const selectFirst = useCallback((): void => {
    applySelection(0);
  }, [applySelection]);

  /** Moves the cursor to the newest entry and resumes follow mode. */
  const selectLast = useCallback((): void => {
    applySelection(entries.length - 1);
  }, [applySelection, entries.length]);

  /** Toggles the selected entry's output through the provider. */
  const toggleSelected = useCallback((): void => {
    if (selectedEntryId !== null) {
      toggleExpanded(selectedEntryId);
    }
  }, [selectedEntryId, toggleExpanded]);

  /** Forgets the current cursor without touching the history. */
  const resetSelection = useCallback((): void => {
    setSelectedEntryId(null);
  }, []);

  return {
    selectedEntryId,
    selectedEntry,
    scrollRef,
    moveUp,
    moveDown,
    pageUp,
    pageDown,
    selectFirst,
    selectLast,
    toggleSelected,
    resetSelection,
  };
}

/**
 * Reads the page step in entries from the current viewport height and entry heights.
 *
 * Before the viewport mounts there is no visible row count, so the step falls back to one entry. A
 * mounted scrollbox contributes its visible height in rows, and the domain helper converts it to the
 * number of entries whose rendered heights fill that height.
 *
 * @param entries - Current bounded history.
 * @param selectedEntryId - Selected entry id, or null.
 * @param direction - `1` for PageDown, `-1` for PageUp.
 * @param scrollRef - Log viewport ref.
 * @param expandedEntryIds - Ids whose output panes are visible.
 * @param reservedRows - Rows the running spinner occupies inside the viewport.
 * @returns The number of entries one page press moves.
 */
function readPageStep(
  entries: readonly ConsoleEntry[],
  selectedEntryId: string | null,
  direction: 1 | -1,
  scrollRef: RefObject<ScrollBoxRenderable | null>,
  expandedEntryIds: ReadonlySet<string>,
  reservedRows: number,
): number {
  return readConsolePageStep({
    entries,
    currentIndex: readSelectedIndex(entries, selectedEntryId),
    direction,
    viewportHeight: scrollRef.current?.viewport.height ?? 1,
    reservedRows,
    isExpanded: (entryId) => expandedEntryIds.has(entryId),
  });
}

/**
 * Reads the index of the selected entry.
 *
 * @param entries - Current bounded history.
 * @param selectedEntryId - Selected entry id, or null.
 * @returns The zero-based index, or `-1` when nothing is selected.
 */
function readSelectedIndex(
  entries: readonly ConsoleEntry[],
  selectedEntryId: string | null,
): number {
  if (selectedEntryId === null) {
    return -1;
  }

  return entries.findIndex((entry) => entry.id === selectedEntryId);
}

/**
 * Reads the selected entry from the history.
 *
 * @param entries - Current bounded history.
 * @param selectedEntryId - Selected entry id, or null.
 * @returns The selected entry, or null when it no longer exists.
 */
function readEntry(
  entries: readonly ConsoleEntry[],
  selectedEntryId: string | null,
): ConsoleEntry | null {
  const index = readSelectedIndex(entries, selectedEntryId);

  return index < 0 ? null : (entries[index] ?? null);
}
