import type {
  CommandAvailability,
  CommandRegion,
  CommandTarget,
} from "@/domain/commands/commands.types";
import type { ResolvedKeymap } from "@/domain/keymap/keymap.types";
import type { HelpViewState } from "@/features/help/help.view";

/** Stable identifiers of the documented help sections, in default order. */
export type HelpSectionId =
  | "focus"
  | "global"
  | "topBar"
  | "sidebar"
  | "graph"
  | "composer"
  | "details"
  | "diff"
  | "console"
  | "modals"
  | "configuration";

/** One ordered help section definition. */
export interface HelpSectionDefinition {
  /** Stable section id. */
  readonly id: HelpSectionId;
  /** Section title rendered by `SectionHeader`. */
  readonly title: string;
}

/**
 * One help row for an implemented action.
 *
 * The row keeps the action visible whether or not it can run now. `keys` is empty when the action is
 * unbound, and `unavailableReason` carries the exact shared availability wording when the action
 * cannot run.
 */
export interface HelpRowView {
  /** Stable action id from the catalogue. */
  readonly actionId: string;
  /** Human-readable action name. */
  readonly label: string;
  /** One-line explanation of what the action does. */
  readonly description: string;
  /** Effective bindings formatted for display; empty when the action is unbound. */
  readonly keys: readonly string[];
  /** Section the action belongs to. */
  readonly sectionId: HelpSectionId;
  /** Exact availability reason, or null when the action can run now. */
  readonly unavailableReason: string | null;
}

/** One rendered help section with its filtered rows. */
export interface HelpSectionView {
  /** Stable section id. */
  readonly id: HelpSectionId;
  /** Section title. */
  readonly title: string;
  /** True when the section body is collapsed. */
  readonly collapsed: boolean;
  /** Rows visible in this section. */
  readonly rows: readonly HelpRowView[];
}

/** Options accepted by `useHelp`. */
export interface UseHelpOptions {
  /** Closes the overlay entry that renders help. */
  readonly onClose: () => void;
}

/**
 * The repository surface help consumes: target-aware availability read from current state.
 *
 * Help never copies repository data, so the provider contract it depends on is exactly this one
 * call. That keeps the hook testable with a stub and stops it from growing a second repository
 * projection.
 */
export interface HelpAvailabilitySource {
  /**
   * Reads availability for one command and its explicit target.
   *
   * @param commandId - Command id.
   * @param target - Explicit target derived from the shared target derivation.
   * @param region - Context that asked for the availability.
   * @returns Availability with a machine-readable reason when unavailable.
   */
  getAvailability(
    commandId: string,
    target: CommandTarget,
    region: CommandRegion,
  ): CommandAvailability;
}

/** Effective keys the help footer advertises. */
export interface HelpHintKeys {
  /** Key that focuses the search field. */
  readonly search: string;
  /** Key that clears the search, then closes help. */
  readonly close: string;
  /** Key that moves the row cursor. */
  readonly navigate: string;
}

/** Search text, the settled query, and the writers the help modal uses. */
export interface HelpViewControl extends HelpViewState {
  /** Settled query the rows were filtered by. */
  readonly activeQuery: string;
  /** True when the settled query is non-empty. */
  readonly hasQuery: boolean;
  /** Replaces the search text and resets the row cursor. */
  readonly setQuery: (value: string) => void;
  /** Clears the search and resets the row cursor. */
  readonly clearSearch: () => void;
  /** Moves the row cursor to one index inside the visible rows. */
  readonly setSelectedIndex: (index: number) => void;
}

/** Catalogue the help modal renders for one query and collapse state. */
export interface HelpCatalogue {
  /** Keymap the footer hints and row bindings are read from. */
  readonly keymap: ResolvedKeymap;
  /** Ordered sections with the current focus section first. */
  readonly sections: readonly HelpSectionView[];
  /** Number of rows that survived filtering. */
  readonly matchCount: number;
  /** Visible rows in render order, flattened across sections. */
  readonly visibleRows: readonly HelpRowView[];
}

/** Row cursor over the visible help rows. */
export interface HelpSelection {
  /** Index of the highlighted row inside the visible rows. */
  readonly activeIndex: number;
  /** Action id under the row cursor, or null when no row is visible. */
  readonly selectedActionId: string | null;
  /**
   * Moves the row cursor by a number of rows and clamps it to the visible rows.
   *
   * @param delta - Rows to move; negative moves up.
   */
  readonly moveCursor: (delta: number) => void;
  /** Puts the row cursor on the first visible row. */
  readonly moveCursorToFirst: () => void;
  /** Puts the row cursor on the last visible row. */
  readonly moveCursorToLast: () => void;
  /**
   * Puts the row cursor on one action.
   *
   * @param actionId - Action to select; an action that is not visible is ignored.
   */
  readonly selectRow: (actionId: string) => void;
}

/** State, rows, and callbacks the help modal renders. */
export interface HelpHandle {
  /** Current search text. */
  readonly query: string;
  /** True when the query the rows were filtered by is non-empty. */
  readonly hasQuery: boolean;
  /** Replaces the search text and resets the row cursor. */
  readonly setQuery: (value: string) => void;
  /** Ordered sections with the current focus section first. */
  readonly sections: readonly HelpSectionView[];
  /** Action id under the row cursor, or null when no row is visible. */
  readonly selectedActionId: string | null;
  /** Number of rows that survived filtering. */
  readonly matchCount: number;
  /** Effective keys for the modal footer. */
  readonly hints: HelpHintKeys;
  /** Focuses the help search field. */
  readonly focusSearch: () => void;
  /**
   * Toggles one section between expanded and collapsed.
   *
   * @param sectionId - Section to toggle.
   */
  readonly toggleSection: (sectionId: HelpSectionId) => void;
  /**
   * Puts the row cursor on one action.
   *
   * @param actionId - Action to select; an action that is not visible is ignored.
   */
  readonly selectRow: (actionId: string) => void;
}
