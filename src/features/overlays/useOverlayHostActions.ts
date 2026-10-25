import { useCallback, useEffect, useState } from "react";
import { useConsoleLog } from "@/app/hooks/useConsoleLog";
import { useFocusState } from "@/app/hooks/useFocusState";
import { useOverlay } from "@/app/hooks/useOverlay";
import type { OverlayHostActions } from "@/features/overlays/useOverlayHostActions.types";

/** Maximum next-tick attempts to focus the console region after its gated drawer mounts. */
const CONSOLE_FOCUS_MAX_ATTEMPTS = 5;

/**
 * Owns the error-overlay actions that need the console and focus providers.
 *
 * Opening the linked console entry dismisses the error, writes the pending selection request, and
 * starts a bounded retry that focuses the console region only after the gated drawer mounts. The
 * retry stops when `focusRegion` reports that the frame exists, and its timer is cleared if the host
 * unmounts first, so no fire-and-forget callback outlives the surface.
 *
 * @returns The console-entry and retry actions.
 */
export function useOverlayHostActions(): OverlayHostActions {
  const overlay = useOverlay();
  const consoleLog = useConsoleLog();
  const { focusRegion } = useFocusState();
  const [focusAttempt, setFocusAttempt] = useState<number | null>(null);

  useEffect(() => {
    if (focusAttempt === null || !consoleLog.isOpen) {
      return;
    }

    const timer = setTimeout(() => {
      if (focusRegion("console")) {
        setFocusAttempt(null);
        return;
      }

      if (focusAttempt >= CONSOLE_FOCUS_MAX_ATTEMPTS) {
        setFocusAttempt(null);
        return;
      }

      setFocusAttempt((attempt) => (attempt === null ? null : attempt + 1));
    }, 0);

    return () => {
      clearTimeout(timer);
    };
  }, [consoleLog.isOpen, focusAttempt, focusRegion]);

  /** Dismisses the error, opens the console at its linked entry, and focuses the console region. */
  const openConsoleEntry = useCallback(
    (consoleEntryId: string | null): void => {
      if (consoleEntryId !== null) {
        consoleLog.requestEntrySelection(consoleEntryId);
        setFocusAttempt(0);
      }

      overlay.dismissError();
    },
    [consoleLog, overlay],
  );

  /** Dismisses the error and re-runs the failed command with its captured request. */
  const retryError = useCallback(
    (retry: (() => void) | undefined): void => {
      overlay.dismissError();
      retry?.();
    },
    [overlay],
  );

  return { openConsoleEntry, retryError };
}
