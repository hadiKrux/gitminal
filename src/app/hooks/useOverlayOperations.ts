import { useCallback, useRef } from "react";
import type { OverlayFocusHandoff } from "@/app/hooks/useOverlayFocusHandoff";
import type {
  ErrorDetail,
  OverlayConfirmEntry,
  OverlayConfirmInput,
  OverlayContextValue,
  OverlayEntry,
  OverlaySurfaceAction,
} from "@/app/providers/OverlayProvider.types";
import { readConfirmLabelWarning } from "@/domain/commands/confirm.labels";

/** Prefix of the provider-generated confirmation entry id. */
const CONFIRM_ENTRY_ID_PREFIX = "overlay-confirm";

/** Provider operations the overlay surface exposes to its consumers. */
export type OverlaySurfaceOperations = Pick<
  OverlayContextValue,
  "open" | "close" | "closeEntry" | "confirm" | "showError" | "dismissError"
>;

/**
 * Owns the overlay provider operations.
 *
 * Every operation is one reducer dispatch plus, where a surface is opening, the focus capture the
 * handoff performs. The operations read the live handoff callbacks, so a command that started before
 * a modal opened still closes against the state the reducer holds now.
 *
 * @param dispatch - Overlay surface dispatcher.
 * @param handoff - Focus handoff operations.
 * @returns The provider operations.
 */
export function useOverlayOperations(
  dispatch: (action: OverlaySurfaceAction) => void,
  handoff: OverlayFocusHandoff,
): OverlaySurfaceOperations {
  const { captureFocus, recordCloseCompletion } = handoff;
  const confirmCounterRef = useRef(0);

  /** Opens or replaces the single modal entry. */
  const open = useCallback(
    (entry: OverlayEntry): void => {
      dispatch({ type: "open", entry, focusedId: captureFocus() });
    },
    [captureFocus, dispatch],
  );

  /**
   * Closes the open entry, or dismisses the error when no entry is open.
   *
   * @param afterRestore - Work to run once the closed surface has restored the captured focus. The
   * completion belongs to one close session: it is discarded when another surface is open at that
   * point, and a close without a completion also clears any completion that has not run yet, so an
   * earlier closure can never run after a later one. A non-function argument is
   * ignored as a completion but still clears a pending one and closes, because the close operation
   * is also wired to native mouse handlers that pass their event.
   */
  const close = useCallback(
    (afterRestore?: () => void): void => {
      recordCloseCompletion(typeof afterRestore === "function" ? afterRestore : null);
      dispatch({ type: "close" });
    },
    [dispatch, recordCloseCompletion],
  );

  /** Closes one entry only when it is still the open entry. */
  const closeEntry = useCallback(
    (entryId: string): void => {
      dispatch({ type: "closeEntry", entryId });
    },
    [dispatch],
  );

  /** Opens a confirmation entry with a generated id and its label warning. */
  const confirm = useCallback(
    (input: OverlayConfirmInput): void => {
      confirmCounterRef.current += 1;

      const entry: OverlayConfirmEntry = {
        ...input,
        kind: "confirm",
        id: `${CONFIRM_ENTRY_ID_PREFIX}-${confirmCounterRef.current}`,
        labelWarning: readConfirmLabelWarning(input.destructive, input.confirmLabel) ?? undefined,
      };

      open(entry);
    },
    [open],
  );

  /** Shows a failure, replacing any error that is already visible. */
  const showError = useCallback(
    (detail: ErrorDetail): void => {
      dispatch({ type: "showError", detail, focusedId: captureFocus() });
    },
    [captureFocus, dispatch],
  );

  /** Dismisses the visible error. */
  const dismissError = useCallback((): void => {
    dispatch({ type: "dismissError" });
  }, [dispatch]);

  return { open, close, closeEntry, confirm, showError, dismissError };
}
