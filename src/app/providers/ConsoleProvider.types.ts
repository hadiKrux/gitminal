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
}

/** Value exposed by `ConsoleProvider` and read through `useConsoleLog`. */
export interface ConsoleContextValue extends ConsoleState {
  /**
   * Appends one entry and updates the new-entry counter.
   *
   * @param entry - Formatted console entry.
   */
  append(entry: ConsoleEntry): void;
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
