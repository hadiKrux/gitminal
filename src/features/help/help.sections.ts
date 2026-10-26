import type { KeymapContext, KeymapHelpRow } from "@/domain/keymap/keymap.types";
import { HELP_SECTIONS } from "@/features/help/useHelp.constants";
import type { HelpRowView, HelpSectionId, HelpSectionView } from "@/features/help/useHelp.types";

/**
 * Section that owns each keymap context.
 *
 * The right-pane context splits by the current selection, so this table holds its default and
 * `readContextSection` overrides it while the Pending Changes row is selected.
 */
const CONTEXT_SECTIONS: Readonly<Record<KeymapContext, HelpSectionId>> = Object.freeze({
  global: "global",
  "top-bar": "topBar",
  branches: "sidebar",
  remotes: "sidebar",
  tags: "sidebar",
  stashes: "sidebar",
  worktrees: "sidebar",
  graph: "graph",
  "right-pane": "details",
  diff: "diff",
  console: "console",
  overlay: "modals",
});

/**
 * Builds the ordered, filtered, and grouped help sections.
 *
 * While a query is active every matching section is shown expanded and empty sections, including
 * the Configuration block, are hidden, so a search never hides a match behind a collapsed section.
 * Without a query every section is present and the caller's collapsed set decides its body, so a
 * collapsed section still renders its header.
 *
 * @param input - Rows, query, collapsed sections, and the focus section.
 * @returns The sections in render order.
 */
export function buildHelpSections(input: {
  readonly rows: readonly HelpRowView[];
  readonly query: string;
  readonly collapsedSections: readonly HelpSectionId[];
  readonly focusSection: HelpSectionId | null;
}): readonly HelpSectionView[] {
  const needle = input.query.trim().toLowerCase();
  const searching = needle.length > 0;
  const sections = readOrderedSections(input.focusSection)
    .map((definition) => ({
      definition,
      rows: input.rows.filter(
        (row) => row.sectionId === definition.id && matchesHelpQuery(row, needle),
      ),
    }))
    .filter((section) => !searching || section.rows.length > 0);

  return sections.map((section) => ({
    id: section.definition.id,
    title: section.definition.title,
    collapsed: !searching && input.collapsedSections.includes(section.definition.id),
    rows: section.rows,
  }));
}

/**
 * Counts the rows that survived filtering, regardless of collapse state.
 *
 * The count drives the help empty state, so collapsing every section must not look like an empty
 * search. Only a query that matches nothing produces zero.
 *
 * @param sections - Sections in render order.
 * @returns The number of matching rows across every rendered section.
 */
export function countFilteredRows(sections: readonly HelpSectionView[]): number {
  return sections.reduce((total, section) => total + section.rows.length, 0);
}

/**
 * Flattens the visible rows in render order.
 *
 * @param sections - Sections in render order.
 * @returns Every row that is currently visible, skipping collapsed sections.
 */
export function flattenSections(sections: readonly HelpSectionView[]): readonly HelpRowView[] {
  return sections.flatMap((section) => (section.collapsed ? [] : section.rows));
}

/**
 * Reads the section that owns the selected row.
 *
 * @param sections - Sections in render order.
 * @param actionId - Selected action id, or null.
 * @returns The owning section id, or null when no row is selected.
 */
export function readSelectedSection(
  sections: readonly HelpSectionView[],
  actionId: string | null,
): HelpSectionId | null {
  if (actionId === null) {
    return null;
  }

  const section = sections.find((candidate) =>
    candidate.rows.some((row) => row.actionId === actionId),
  );

  return section?.id ?? null;
}

/**
 * Adds or removes one section from the collapsed set.
 *
 * @param current - Collapsed sections before the change.
 * @param sectionId - Section being changed.
 * @param collapsed - True to collapse, false to expand.
 * @returns The collapsed sections after the change.
 */
export function toggleCollapsed(
  current: readonly HelpSectionId[],
  sectionId: HelpSectionId,
  collapsed: boolean,
): readonly HelpSectionId[] {
  if (collapsed === current.includes(sectionId)) {
    return current;
  }

  return collapsed
    ? [...current, sectionId]
    : current.filter((candidate) => candidate !== sectionId);
}

/**
 * Maps one action to its help section.
 *
 * Catalogue categories decide the section directly. Navigation actions are shared across contexts,
 * so they follow the context their effective binding is attributed to.
 *
 * @param row - Described action row.
 * @param isPendingSelection - True while the right-pane selection is the Pending Changes row.
 * @returns The section the action belongs to.
 */
export function readHelpSectionId(row: KeymapHelpRow, isPendingSelection: boolean): HelpSectionId {
  switch (row.category) {
    case "focus":
      return "focus";
    case "app":
    case "help":
      return "global";
    case "remote":
      return "topBar";
    case "branch":
    case "tag":
    case "stash":
    case "worktree":
    case "list":
      return "sidebar";
    case "graph":
      return "graph";
    case "commit":
      return "composer";
    case "diff":
      return "diff";
    case "console":
      return "console";
    case "overlay":
    case "form":
      return "modals";
    case "navigation":
      return readContextSection(row.bindingContext, isPendingSelection);
  }
}

/**
 * Reads the section that must be shown first for the current focus.
 *
 * @param focusContext - Focused keymap context, or null when no region owns focus.
 * @param isPendingSelection - True while the right-pane selection is the Pending Changes row.
 * @returns The focus section, or null when the default order applies.
 */
export function readFocusSection(
  focusContext: KeymapContext | null,
  isPendingSelection: boolean,
): HelpSectionId | null {
  return focusContext === null ? null : readContextSection(focusContext, isPendingSelection);
}

/**
 * Reads the section definitions with the current focus section moved to the front.
 *
 * @param focusSection - Section to show first, or null for the default order.
 * @returns The section definitions in render order.
 */
function readOrderedSections(focusSection: HelpSectionId | null) {
  const first = HELP_SECTIONS.find((section) => section.id === focusSection);

  if (first === undefined) {
    return HELP_SECTIONS;
  }

  return [first, ...HELP_SECTIONS.filter((section) => section.id !== focusSection)];
}

/**
 * Maps a keymap context to its help section.
 *
 * @param context - Context the action runs in.
 * @param isPendingSelection - True while the right-pane selection is the Pending Changes row.
 * @returns The section that owns the context.
 */
function readContextSection(context: KeymapContext, isPendingSelection: boolean): HelpSectionId {
  if (context === "right-pane" && isPendingSelection) {
    return "composer";
  }

  return CONTEXT_SECTIONS[context];
}

/**
 * Reports whether one row matches the search text.
 *
 * @param row - Row to test.
 * @param needle - Lower-cased query; an empty query matches every row.
 * @returns True when the row matches.
 */
function matchesHelpQuery(row: HelpRowView, needle: string): boolean {
  return needle.length === 0 || readSearchText(row).includes(needle);
}

/**
 * Builds the lower-cased search text of one row.
 *
 * The name, effective keys, description, action id, and availability reason are all searchable, so a
 * user can find an action by any of them.
 *
 * @param row - Row to describe.
 * @returns The searchable text.
 */
function readSearchText(row: HelpRowView): string {
  return [row.label, row.keys.join(" "), row.description, row.actionId, row.unavailableReason ?? ""]
    .join(" ")
    .toLowerCase();
}
