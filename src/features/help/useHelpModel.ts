import { useCallback, useMemo } from "react";
import { useCommandTargets } from "@/app/hooks/useCommandTargets";
import { useFocusState } from "@/app/hooks/useFocusState";
import { useKeymap } from "@/app/hooks/useKeymap";
import { useRepository } from "@/app/hooks/useRepository";
import { buildHelpRows } from "@/features/help/help.availability";
import {
  buildHelpSections,
  countFilteredRows,
  flattenSections,
  readFocusSection,
} from "@/features/help/help.sections";
import type { HelpCatalogue, HelpSectionId, HelpSelection } from "@/features/help/useHelp.types";
import { clampIndex } from "@/lib/list";

/**
 * Builds the help catalogue for one query and collapse state, and the row cursor over it.
 *
 * Every implemented action is listed, in the documented section order, with the effective bindings
 * from the resolved keymap and the current availability from `commands.availability.ts`. Unavailable
 * actions stay visible with their exact reason and unbound actions stay visible as "Unbound", so
 * help is complete discovery rather than a filtered hint strip. Availability is recomputed from the
 * provider state on every render that can change it, so a reason is never a snapshot taken at mount.
 *
 * The cursor is stored as an index so a section collapse keeps the user's position in the surviving
 * rows, and every movement clamps through `clampIndex`, so a query that shortens the list can never
 * leave the cursor outside it.
 *
 * @param input - Settled query, collapse state, and the cursor index with its writer.
 * @returns The catalogue and the cursor over its visible rows.
 */
export function useHelpModel(input: {
  readonly activeQuery: string;
  readonly collapsedSections: readonly HelpSectionId[];
  readonly selectedIndex: number;
  readonly setSelectedIndex: (index: number) => void;
}): HelpCatalogue & HelpSelection {
  const keymap = useKeymap();
  const repository = useRepository();
  const focus = useFocusState();
  const targets = useCommandTargets();
  const { activeQuery, collapsedSections, selectedIndex, setSelectedIndex } = input;
  const isPendingSelection = repository.selection.kind === "pending";
  const rows = useMemo(
    () =>
      buildHelpRows({
        keymap,
        repository,
        deriveTarget: targets.deriveTarget,
        focusContext: focus.state.activeRegion,
        isPendingSelection,
      }),
    [focus.state.activeRegion, isPendingSelection, keymap, repository, targets],
  );
  const sections = useMemo(
    () =>
      buildHelpSections({
        rows,
        query: activeQuery,
        collapsedSections,
        focusSection: readFocusSection(focus.state.activeRegion, isPendingSelection),
      }),
    [activeQuery, collapsedSections, focus.state.activeRegion, isPendingSelection, rows],
  );
  const visibleRows = useMemo(() => flattenSections(sections), [sections]);
  const activeIndex = clampIndex(selectedIndex, visibleRows.length);

  /** Moves the row cursor by a number of rows and clamps it to the visible rows. */
  const moveCursor = useCallback(
    (delta: number): void => {
      setSelectedIndex(clampIndex(activeIndex + delta, visibleRows.length));
    },
    [activeIndex, setSelectedIndex, visibleRows.length],
  );

  /** Puts the row cursor on the first visible row. */
  const moveCursorToFirst = useCallback((): void => {
    setSelectedIndex(0);
  }, [setSelectedIndex]);

  /** Puts the row cursor on the last visible row. */
  const moveCursorToLast = useCallback((): void => {
    setSelectedIndex(Math.max(0, visibleRows.length - 1));
  }, [setSelectedIndex, visibleRows.length]);

  /** Puts the row cursor on one action. */
  const selectRow = useCallback(
    (actionId: string): void => {
      const index = visibleRows.findIndex((row) => row.actionId === actionId);

      if (index !== -1) {
        setSelectedIndex(index);
      }
    },
    [setSelectedIndex, visibleRows],
  );

  return {
    keymap,
    sections,
    matchCount: countFilteredRows(sections),
    visibleRows,
    activeIndex,
    selectedActionId: visibleRows[activeIndex]?.actionId ?? null,
    moveCursor,
    moveCursorToFirst,
    moveCursorToLast,
    selectRow,
  };
}
