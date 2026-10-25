import type { ScrollBoxRenderable } from "@opentui/core";
import type { RefObject } from "react";
import type { ConsoleEntry } from "@/domain/console/console.types";

/** Console view state owned by the console cursor hook. */
export interface ConsoleViewState {
  /** Entry under the console cursor, or null when the history is empty. */
  readonly selectedEntryId: string | null;
  /** Entry under the console cursor, or null when the history is empty. */
  readonly selectedEntry: ConsoleEntry | null;
}

/** Input for the console follow-mode and viewport synchronization hook. */
export interface ConsoleFollowSyncInput {
  /** Current bounded history. */
  readonly entries: readonly ConsoleEntry[];
  /** Current cursor entry id, or null. */
  readonly selectedEntryId: string | null;
  /** Writes the cursor entry id. */
  readonly setSelectedEntryId: (entryId: string | null) => void;
}

/** Handlers registered for the console region. */
export interface ConsoleActionHandlers {
  /** Moves the cursor up one entry. */
  readonly moveUp: () => void;
  /** Moves the cursor down one entry. */
  readonly moveDown: () => void;
  /** Moves the cursor up by the entries that fill one viewport. */
  readonly pageUp: () => void;
  /** Moves the cursor down by the entries that fill one viewport. */
  readonly pageDown: () => void;
  /** Moves the cursor to the oldest entry. */
  readonly selectFirst: () => void;
  /** Moves the cursor to the newest entry. */
  readonly selectLast: () => void;
  /** Toggles the selected entry's output. */
  readonly toggleSelected: () => void;
  /** Requests the clear-history confirmation. */
  readonly requestClear: () => void;
}

/** Cursor, scroll, and selection operations shared by the console actions and drawer. */
export interface ConsoleCursorHandle extends ConsoleViewState {
  /** Ref for the log viewport, so navigation can reveal the selected entry. */
  readonly scrollRef: RefObject<ScrollBoxRenderable | null>;
  /** Moves the cursor one entry up. */
  moveUp(): void;
  /** Moves the cursor one entry down. */
  moveDown(): void;
  /** Moves the cursor up by the entries that fill one viewport. */
  pageUp(): void;
  /** Moves the cursor down by the entries that fill one viewport. */
  pageDown(): void;
  /** Moves the cursor to the oldest entry and pauses follow mode. */
  selectFirst(): void;
  /** Moves the cursor to the newest entry and resumes follow mode. */
  selectLast(): void;
  /** Toggles the selected entry's output. */
  toggleSelected(): void;
  /** Forgets the current cursor without touching the history. */
  resetSelection(): void;
}

/** Value returned by `useConsole`. */
export interface ConsoleHandle extends ConsoleCursorHandle {
  /**
   * Reports whether an entry's output is expanded.
   *
   * @param entryId - Entry id.
   * @returns True when the entry is expanded.
   */
  isExpanded(entryId: string): boolean;
  /** Requests the clear-history confirmation, or does nothing when the history is empty. */
  requestClear(): void;
}
