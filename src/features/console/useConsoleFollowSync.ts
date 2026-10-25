import type { ScrollBoxRenderable } from "@opentui/core";
import { type RefObject, useEffect, useRef } from "react";
import { useConsoleLog } from "@/app/hooks/useConsoleLog";
import type { ConsoleFollowSyncInput } from "@/features/console/useConsole.types";

/**
 * Keeps the console cursor, follow mode, and viewport in agreement.
 *
 * Three effects own the synchronization. The first aligns the cursor with follow mode, including
 * resuming follow when a fresh paused drawer lands on the newest entry; the second consumes a
 * cross-surface selection request once; the third either sticks the viewport to the bottom or
 * reveals the selected entry. Follow mode, the buffer, and the pending request stay in
 * `ConsoleProvider`; this hook never keeps a second copy.
 *
 * @param input - History, cursor, and cursor writer.
 * @returns The log viewport ref.
 */
export function useConsoleFollowSync(
  input: ConsoleFollowSyncInput,
): RefObject<ScrollBoxRenderable | null> {
  const log = useConsoleLog();
  const { consumePendingSelection, setFollowing } = log;
  const scrollRef = useRef<ScrollBoxRenderable | null>(null);
  const { entries, selectedEntryId, setSelectedEntryId } = input;

  useEffect(() => {
    if (entries.length === 0) {
      setSelectedEntryId(null);
      return;
    }

    if (log.followMode) {
      setSelectedEntryId(entries.at(-1)?.id ?? null);
      return;
    }

    if (selectedEntryId === null || !entries.some((entry) => entry.id === selectedEntryId)) {
      setSelectedEntryId(entries.at(-1)?.id ?? null);
      setFollowing(true);
    }
  }, [entries, log.followMode, selectedEntryId, setFollowing, setSelectedEntryId]);

  useEffect(() => {
    const pending = log.pendingSelectionEntryId;

    if (pending === null) {
      return;
    }

    consumePendingSelection(pending);

    if (!entries.some((entry) => entry.id === pending)) {
      return;
    }

    setFollowing(false);
    setSelectedEntryId(pending);
  }, [
    consumePendingSelection,
    entries,
    log.pendingSelectionEntryId,
    setFollowing,
    setSelectedEntryId,
  ]);

  useEffect(() => {
    const viewport = scrollRef.current;

    if (viewport === null) {
      return;
    }

    if (log.followMode) {
      viewport.scrollTop = viewport.scrollHeight;
      return;
    }

    if (selectedEntryId !== null) {
      viewport.scrollChildIntoView(selectedEntryId);
    }
  }, [log.followMode, selectedEntryId]);

  return scrollRef;
}
