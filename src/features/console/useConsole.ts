import { useCallback } from "react";
import { useConsoleLog } from "@/app/hooks/useConsoleLog";
import { useOverlay } from "@/app/hooks/useOverlay";
import {
  CONSOLE_CLEAR_CONFIRM_DESCRIPTION,
  CONSOLE_CLEAR_CONFIRM_LABEL,
  CONSOLE_CLEAR_CONFIRM_TITLE,
} from "@/features/console/useConsole.constants";
import type { ConsoleHandle } from "@/features/console/useConsole.types";
import { useConsoleActions } from "@/features/console/useConsoleActions";
import { useConsoleCursor } from "@/features/console/useConsoleCursor";

/**
 * Owns the console cursor, scroll helper, and every console-scoped action handler.
 *
 * The cursor and follow-mode synchronization live in `useConsoleCursor`, and the action registration
 * lives in `useConsoleActions`; this hook composes them and owns the clear confirmation, which needs
 * both the overlay and the history. Follow mode, the buffer, the new-entry count, and expanded ids
 * stay in `ConsoleProvider`; nothing here keeps a second copy. A failure entry is expanded by the
 * provider on append, so its decisive stderr line is visible immediately.
 *
 * @returns The console cursor, scroll ref, and action handlers.
 */
export function useConsole(): ConsoleHandle {
  const log = useConsoleLog();
  const overlay = useOverlay();
  const cursor = useConsoleCursor();

  /** Asks for the clear-history confirmation when there is history to clear. */
  const requestClear = useCallback((): void => {
    if (log.entries.length === 0) {
      return;
    }

    overlay.confirm({
      title: CONSOLE_CLEAR_CONFIRM_TITLE,
      description: CONSOLE_CLEAR_CONFIRM_DESCRIPTION,
      confirmLabel: CONSOLE_CLEAR_CONFIRM_LABEL,
      destructive: false,
      onConfirm: () => {
        overlay.close();
        log.clear();
        cursor.resetSelection();
      },
    });
  }, [cursor, log, overlay]);

  /** Reports whether an entry's output is expanded. */
  const isExpanded = useCallback(
    (entryId: string): boolean => log.expandedEntryIds.has(entryId),
    [log.expandedEntryIds],
  );

  useConsoleActions({
    moveUp: cursor.moveUp,
    moveDown: cursor.moveDown,
    pageUp: cursor.pageUp,
    pageDown: cursor.pageDown,
    selectFirst: cursor.selectFirst,
    selectLast: cursor.selectLast,
    toggleSelected: cursor.toggleSelected,
    requestClear,
  });

  return {
    ...cursor,
    isExpanded,
    requestClear,
  };
}
