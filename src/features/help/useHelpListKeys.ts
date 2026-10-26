import { useCallback } from "react";
import { useAction } from "@/app/hooks/useAction";
import { readSelectedSection } from "@/features/help/help.sections";
import { HELP_PAGE_ROWS } from "@/features/help/useHelp.constants";
import type { HelpSectionId, HelpSectionView, HelpSelection } from "@/features/help/useHelp.types";

/** Inputs accepted by `useHelpListKeys`. */
interface UseHelpListKeysInput {
  /** Row cursor and its movements. */
  readonly selection: HelpSelection;
  /** Sections the row cursor can collapse, in render order. */
  readonly sections: readonly HelpSectionView[];
  /** Collapses or expands one section. */
  readonly setSectionCollapsed: (sectionId: HelpSectionId, collapsed: boolean) => void;
}

/**
 * Registers the help modal's list keys.
 *
 * Up, Down, Page Up, Page Down, Home, and End move the row cursor; Left and Right collapse and
 * expand the section that owns the cursor. With every section collapsed there is no selected row, so
 * Right expands the first collapsed section instead. That keeps the keyboard path usable after
 * collapsing everything, matching the requirement that help is fully operable without a mouse.
 *
 * @param input - Row cursor, sections, and the collapse writer.
 */
export function useHelpListKeys(input: UseHelpListKeysInput): void {
  const { selection, sections, setSectionCollapsed } = input;
  const { moveCursor, moveCursorToFirst, moveCursorToLast, selectedActionId } = selection;

  /** Collapses the section that owns the row cursor. */
  const collapseSelectedSection = useCallback((): void => {
    const sectionId = readSelectedSection(sections, selectedActionId);

    if (sectionId !== null) {
      setSectionCollapsed(sectionId, true);
    }
  }, [sections, selectedActionId, setSectionCollapsed]);

  /** Expands the section that owns the row cursor, or the first collapsed section. */
  const expandSelectedSection = useCallback((): void => {
    const sectionId =
      readSelectedSection(sections, selectedActionId) ??
      sections.find((section) => section.collapsed)?.id ??
      null;

    if (sectionId !== null) {
      setSectionCollapsed(sectionId, false);
    }
  }, [sections, selectedActionId, setSectionCollapsed]);

  useAction("nav.up", { scope: "overlay" }, () => {
    moveCursor(-1);
  });
  useAction("nav.down", { scope: "overlay" }, () => {
    moveCursor(1);
  });
  useAction("nav.pageUp", { scope: "overlay" }, () => {
    moveCursor(-HELP_PAGE_ROWS);
  });
  useAction("nav.pageDown", { scope: "overlay" }, () => {
    moveCursor(HELP_PAGE_ROWS);
  });
  useAction("nav.first", { scope: "overlay" }, moveCursorToFirst);
  useAction("nav.last", { scope: "overlay" }, moveCursorToLast);
  useAction("nav.left", { scope: "overlay" }, collapseSelectedSection);
  useAction("nav.right", { scope: "overlay" }, expandSelectedSection);
}
