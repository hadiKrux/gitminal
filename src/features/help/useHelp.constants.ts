import type { KeymapContext } from "@/domain/keymap/keymap.types";
import type { HelpSectionDefinition } from "@/features/help/useHelp.types";

/**
 * Help sections in their default order.
 *
 * The current focus section is moved to the front at render time, so this list is the stable
 * documentation order the rest of the app refers to.
 */
export const HELP_SECTIONS: readonly HelpSectionDefinition[] = Object.freeze([
  { id: "focus", title: "Focus" },
  { id: "global", title: "Global" },
  { id: "topBar", title: "Top bar" },
  { id: "sidebar", title: "Sidebar panels" },
  { id: "graph", title: "Commit graph" },
  { id: "composer", title: "Commit composer" },
  { id: "details", title: "Commit details" },
  { id: "diff", title: "Diffs" },
  { id: "console", title: "Console" },
  { id: "modals", title: "Modals" },
  { id: "configuration", title: "Configuration" },
]);

/** Quiet interval before the help search filters, in milliseconds. */
export const HELP_SEARCH_DEBOUNCE_MS = 120;

/** Rows the paging keys move by one step. */
export const HELP_PAGE_ROWS = 8;

/** Prefix of the renderable id of one help row. */
export const HELP_ROW_ID_PREFIX = "help-row-";

/** Prefix of the renderable id of one help section header. */
export const HELP_SECTION_ID_PREFIX = "help-section-";

/** Action id that moves the row cursor down; its binding advertises the navigation keys. */
export const HELP_NAVIGATE_ACTION_ID = "nav.down";

/** Fallback context help attributes a row's binding to when the focused context does not bind it. */
export const HELP_FALLBACK_CONTEXT: KeymapContext = "overlay";
