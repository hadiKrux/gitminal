import type { ReactNode } from "react";
import type { ConsoleEntry } from "@/domain/console/console.types";

/** Console provider state. */
export interface ConsoleState {
  /** Bounded session history, newest last. */
  readonly entries: readonly ConsoleEntry[];
  /** True while the drawer is open. */
  readonly isOpen: boolean;
  /** True when the viewport follows new entries. */
  readonly followMode: boolean;
  /** Entries appended while follow mode was off. */
  readonly newEntryCount: number;
  /** Ids whose output is expanded. */
  readonly expandedEntryIds: ReadonlySet<string>;
  /** Entry that a cross-surface action asked the drawer to reveal, or null. */
  readonly pendingSelectionEntryId: string | null;
}

/** Value exposed by `ConsoleProvider` and read through `useConsoleLog`. */
export interface ConsoleContextValue extends ConsoleState {
  /**
   * Appends one entry and updates the new-entry counter.
   *
   * The entry is stored exactly as supplied. The app-layer orchestrator is the only writer and
   * applies redaction and sanitization before calling, so the provider does not sanitize again.
   *
   * @param entry - Formatted console entry.
   */
  append(entry: ConsoleEntry): void;
  /**
   * Replaces one existing entry in place.
   *
   * A post-result failure, such as a rejected refresh, updates the entry that was already appended
   * instead of adding a second one. Replacing a failure entry also expands it, matching append.
   *
   * @param entry - Replacement entry with the same id as the stored entry.
   */
  replaceEntry(entry: ConsoleEntry): void;
  /** Clears the session history and its expansion state. */
  clear(): void;
  /** Opens the drawer. */
  open(): void;
  /** Closes the drawer. */
  close(): void;
  /** Toggles the drawer. */
  toggle(): void;
  /**
   * Pauses or resumes follow mode.
   *
   * @param following - False when the user scrolls away from the bottom.
   */
  setFollowing(following: boolean): void;
  /**
   * Toggles one entry's expanded output.
   *
   * @param entryId - Entry id.
   */
  toggleExpanded(entryId: string): void;
  /**
   * Opens the drawer and requests that it reveals one entry.
   *
   * This is a navigation request, not the selection itself: `useConsoleFollowSync` consumes it and
   * `useConsoleCursor` owns the selected entry id, so the drawer never keeps two copies of that view
   * state.
   *
   * @param entryId - Entry that the calling surface wants selected.
   */
  requestEntrySelection(entryId: string): void;
  /**
   * Clears a pending selection request after the drawer consumed it.
   *
   * @param entryId - Entry id that was consumed.
   */
  consumePendingSelection(entryId: string): void;
}

/** Props accepted by `ConsoleProvider`. */
export interface ConsoleProviderProps {
  /** Provider content. */
  readonly children?: ReactNode;
  /** Entry bound. Defaults to the domain buffer bound. */
  readonly limit?: number;
  /** Initial follow mode. Defaults to true. */
  readonly initialFollowMode?: boolean;
}
