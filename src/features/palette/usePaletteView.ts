import { useCallback, useMemo, useState } from "react";
import { useTerminalSize } from "@/app/hooks/useTerminalSize";
import {
  PALETTE_MAX_OPTION_ROWS,
  PALETTE_MIN_OPTION_ROWS,
  PALETTE_RESERVED_COLUMNS,
  PALETTE_RESERVED_ROWS,
} from "@/features/palette/CommandPalette.constants";
import type {
  PaletteCommandEntry,
  PaletteRow,
  PaletteSelectOption,
} from "@/features/palette/CommandRow.types";
import {
  buildPaletteRows,
  moveSelectableIndex,
  resolveSelectableIndex,
} from "@/features/palette/palette.search";

/** Rows, query, and highlight the palette view renders. */
export interface PaletteView {
  /** Current search text. */
  readonly query: string;
  /** Replaces the search text and resets the highlight to the first match. */
  readonly setQuery: (value: string) => void;
  /** Rendered rows, including group headers. */
  readonly rows: readonly PaletteRow[];
  /** Options handed to the native select, including group headers. */
  readonly options: readonly PaletteSelectOption[];
  /** Number of commands that survived filtering. */
  readonly matchCount: number;
  /** Option window height for the native select. */
  readonly optionRows: number;
  /** Highlighted row index, always a selectable command row. */
  readonly highlightedIndex: number;
  /**
   * Moves the highlight by a number of command rows.
   *
   * @param delta - Command rows to move; negative moves up.
   */
  readonly move: (delta: number) => void;
  /** Puts the highlight on the first selectable command row. */
  readonly moveToFirst: () => void;
  /** Puts the highlight on the last selectable command row. */
  readonly moveToLast: () => void;
  /**
   * Records the option the native select reports.
   *
   * @param value - Encoded option value.
   */
  readonly highlightOption: (value: string) => void;
}

/**
 * Owns the palette query, its rendered rows, and the highlight over them.
 *
 * The rows are rebuilt only when the query, the captured entries, the recents, or the measured text
 * budget change, so typing never re-derives a command target. The highlight is resolved through
 * `resolveSelectableIndex`, so it always names a command row even while the rows carry group
 * headers.
 *
 * @param entries - Captured palette entries.
 * @param recentCommandIds - Session recents captured at open time.
 * @returns The query, rows, and highlight operations.
 */
export function usePaletteView(
  entries: readonly PaletteCommandEntry[],
  recentCommandIds: readonly string[],
): PaletteView {
  const size = useTerminalSize({
    reservedRows: PALETTE_RESERVED_ROWS,
    reservedColumns: PALETTE_RESERVED_COLUMNS,
  });
  const [query, setQueryState] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const rows = useMemo(
    () =>
      buildPaletteRows({
        entries,
        query,
        recentCommandIds,
        textBudget: size.textBudget,
      }),
    [entries, query, recentCommandIds, size.textBudget],
  );
  const selectableIndex = resolveSelectableIndex(rows.rows, highlightedIndex);
  const optionRows = clampOptionRows(size.visibleRows);
  const options = useMemo(() => rows.rows.map((row) => row.option), [rows.rows]);

  /** Replaces the query and resets the highlight to the first match. */
  const setQuery = useCallback((value: string): void => {
    setQueryState(value);
    setHighlightedIndex(0);
  }, []);

  /** Moves the highlight by a number of command rows. */
  const move = useCallback(
    (delta: number): void => {
      setHighlightedIndex(moveSelectableIndex(rows.rows, selectableIndex, delta));
    },
    [rows.rows, selectableIndex],
  );

  /** Puts the highlight on the first selectable command row. */
  const moveToFirst = useCallback((): void => {
    setHighlightedIndex(resolveSelectableIndex(rows.rows, 0));
  }, [rows.rows]);

  /** Puts the highlight on the last selectable command row. */
  const moveToLast = useCallback((): void => {
    setHighlightedIndex(resolveSelectableIndex(rows.rows, rows.rows.length - 1));
  }, [rows.rows]);

  /** Records the option the native select reports. */
  const highlightOption = useCallback(
    (value: string): void => {
      const index = rows.rows.findIndex((row) => row.option.value === value);

      if (index !== -1) {
        setHighlightedIndex(index);
      }
    },
    [rows.rows],
  );

  return {
    query,
    setQuery,
    rows: rows.rows,
    options,
    matchCount: rows.matchCount,
    optionRows,
    highlightedIndex: selectableIndex,
    move,
    moveToFirst,
    moveToLast,
    highlightOption,
  };
}

/**
 * Clamps the option window to the measured rows and the documented bounds.
 *
 * @param visibleRows - Rows the terminal leaves for content.
 * @returns The select height.
 */
function clampOptionRows(visibleRows: number): number {
  return Math.max(PALETTE_MIN_OPTION_ROWS, Math.min(visibleRows, PALETTE_MAX_OPTION_ROWS));
}
