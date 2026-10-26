import { useCallback, useState } from "react";
import { toggleCollapsed } from "@/features/help/help.sections";
import type { HelpSectionId } from "@/features/help/useHelp.types";

/** Collapse state of the help sections. */
export interface HelpSectionsState {
  /** Sections whose body the user collapsed. */
  readonly collapsedSections: readonly HelpSectionId[];
  /**
   * Expands or collapses one section.
   *
   * @param sectionId - Section to change.
   * @param collapsed - True to collapse, false to expand.
   */
  readonly setSectionCollapsed: (sectionId: HelpSectionId, collapsed: boolean) => void;
  /**
   * Toggles one section between expanded and collapsed.
   *
   * @param sectionId - Section to toggle.
   */
  readonly toggleSection: (sectionId: HelpSectionId) => void;
}

/**
 * Owns the help section collapse state.
 *
 * Everything starts expanded, so the first render of help is complete discovery. The state lives in
 * this hook rather than in each section, so a collapse survives a query change and the section list
 * stays a pure projection of the catalogue.
 *
 * @returns The collapsed sections and the writers.
 */
export function useHelpSectionsState(): HelpSectionsState {
  const [collapsedSections, setCollapsedSections] = useState<readonly HelpSectionId[]>([]);

  /** Expands or collapses one section. */
  const setSectionCollapsed = useCallback((sectionId: HelpSectionId, collapsed: boolean): void => {
    setCollapsedSections((current) => toggleCollapsed(current, sectionId, collapsed));
  }, []);

  /** Toggles one section between expanded and collapsed. */
  const toggleSection = useCallback((sectionId: HelpSectionId): void => {
    setCollapsedSections((current) =>
      toggleCollapsed(current, sectionId, !current.includes(sectionId)),
    );
  }, []);

  return { collapsedSections, setSectionCollapsed, toggleSection };
}
