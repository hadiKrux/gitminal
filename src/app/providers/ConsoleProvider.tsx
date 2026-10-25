import { createContext, type ReactNode, useCallback, useMemo, useState } from "react";
import type {
  ConsoleContextValue,
  ConsoleProviderProps,
  ConsoleState,
} from "@/app/providers/ConsoleProvider.types";
import {
  appendConsoleEntry,
  CONSOLE_ENTRY_LIMIT,
  retainExpandedEntryIds,
} from "@/domain/console/console.buffer";
import type { ConsoleEntry } from "@/domain/console/console.types";

/** Context carrying the console history and drawer state. */
export const ConsoleContext = createContext<ConsoleContextValue | null>(null);

/** State before any entry, visibility change, or selection request. */
function createInitialState(followMode: boolean): ConsoleState {
  return {
    entries: [],
    isOpen: false,
    followMode,
    newEntryCount: 0,
    expandedEntryIds: new Set<string>(),
    pendingSelectionEntryId: null,
  };
}

/**
 * Owns the bounded command log, follow mode, new-entry count, and expanded entry ids.
 *
 * Appending while follow mode is on leaves the new-entry count at zero, and appending while follow
 * mode is off increments it. Appending is the only writer of both values, so the viewport position
 * and the counter cannot disagree. Trimming an entry also forgets that it was expanded and drops a
 * pending selection that no longer exists, so view state stays bounded by the history bound. A
 * failure entry starts expanded because its stderr carries the decisive line.
 *
 * @param props - Content, entry bound, and initial follow mode.
 * @returns The console context provider.
 */
export function ConsoleProvider(props: ConsoleProviderProps): ReactNode {
  const limit = Math.max(1, props.limit ?? CONSOLE_ENTRY_LIMIT);
  const [state, setState] = useState<ConsoleState>(() =>
    createInitialState(props.initialFollowMode ?? true),
  );

  /** Appends one entry and updates the new-entry counter. */
  const append = useCallback(
    (entry: ConsoleEntry): void => {
      setState((previous) => {
        const entries = appendConsoleEntry(previous.entries, entry, limit);
        const retainedIds = retainExpandedEntryIds(previous.expandedEntryIds, entries);
        const expandedEntryIds =
          entry.status === "failure" ? new Set([...retainedIds, entry.id]) : retainedIds;

        return {
          ...previous,
          entries,
          newEntryCount: previous.followMode ? 0 : previous.newEntryCount + 1,
          expandedEntryIds,
          pendingSelectionEntryId: retainsEntry(previous.pendingSelectionEntryId, entries)
            ? previous.pendingSelectionEntryId
            : null,
        };
      });
    },
    [limit],
  );

  /** Replaces one stored entry in place and expands it when it became a failure. */
  const replaceEntry = useCallback((entry: ConsoleEntry): void => {
    setState((previous) => {
      const index = previous.entries.findIndex((candidate) => candidate.id === entry.id);

      if (index < 0) {
        return previous;
      }

      const entries = [...previous.entries];
      entries[index] = entry;
      const expandedEntryIds =
        entry.status === "failure"
          ? new Set([...previous.expandedEntryIds, entry.id])
          : previous.expandedEntryIds;

      return { ...previous, entries, expandedEntryIds };
    });
  }, []);

  /** Clears the session history and its expansion state. */
  const clear = useCallback((): void => {
    setState((previous) => ({
      ...previous,
      entries: [],
      newEntryCount: 0,
      expandedEntryIds: new Set<string>(),
      pendingSelectionEntryId: null,
    }));
  }, []);

  /** Opens the drawer. */
  const open = useCallback((): void => {
    setState((previous) => (previous.isOpen ? previous : { ...previous, isOpen: true }));
  }, []);

  /** Closes the drawer. */
  const close = useCallback((): void => {
    setState((previous) => (previous.isOpen ? { ...previous, isOpen: false } : previous));
  }, []);

  /** Toggles the drawer. */
  const toggle = useCallback((): void => {
    setState((previous) => ({ ...previous, isOpen: !previous.isOpen }));
  }, []);

  /** Pauses or resumes follow mode. */
  const setFollowing = useCallback((following: boolean): void => {
    setState((previous) => {
      if (previous.followMode === following) {
        return previous;
      }

      return {
        ...previous,
        followMode: following,
        newEntryCount: following ? 0 : previous.newEntryCount,
      };
    });
  }, []);

  /** Toggles one entry's expanded output. */
  const toggleExpanded = useCallback((entryId: string): void => {
    setState((previous) => {
      if (!previous.entries.some((entry) => entry.id === entryId)) {
        return previous;
      }

      const expandedEntryIds = new Set(previous.expandedEntryIds);

      if (expandedEntryIds.has(entryId)) {
        expandedEntryIds.delete(entryId);
      } else {
        expandedEntryIds.add(entryId);
      }

      return { ...previous, expandedEntryIds };
    });
  }, []);

  /** Opens the drawer and requests that it reveals one entry. */
  const requestEntrySelection = useCallback((entryId: string): void => {
    setState((previous) => ({
      ...previous,
      isOpen: true,
      pendingSelectionEntryId: entryId,
    }));
  }, []);

  /** Clears a consumed selection request. */
  const consumePendingSelection = useCallback((entryId: string): void => {
    setState((previous) =>
      previous.pendingSelectionEntryId === entryId
        ? { ...previous, pendingSelectionEntryId: null }
        : previous,
    );
  }, []);

  const value = useMemo<ConsoleContextValue>(
    () => ({
      ...state,
      append,
      replaceEntry,
      clear,
      open,
      close,
      toggle,
      setFollowing,
      toggleExpanded,
      requestEntrySelection,
      consumePendingSelection,
    }),
    [
      state,
      append,
      replaceEntry,
      clear,
      open,
      close,
      toggle,
      setFollowing,
      toggleExpanded,
      requestEntrySelection,
      consumePendingSelection,
    ],
  );

  return <ConsoleContext.Provider value={value}>{props.children}</ConsoleContext.Provider>;
}

/**
 * Reports whether a pending entry id still has a live entry.
 *
 * @param entryId - Pending entry id, or null.
 * @param entries - Current bounded history.
 * @returns True when the id is null or still present.
 */
function retainsEntry(entryId: string | null, entries: readonly ConsoleEntry[]): boolean {
  return entryId === null || entries.some((entry) => entry.id === entryId);
}
