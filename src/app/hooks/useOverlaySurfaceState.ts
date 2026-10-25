import { useRenderer } from "@opentui/react";
import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { useFocusState } from "@/app/hooks/useFocusState";
import {
  INITIAL_OVERLAY_SURFACE_STATE,
  readOverlayIsOpen,
  readToggleActionId,
  reduceOverlaySurface,
} from "@/app/providers/OverlayProvider.state";
import type {
  ErrorDetail,
  OverlayConfirmEntry,
  OverlayConfirmInput,
  OverlayContextValue,
  OverlayEntry,
} from "@/app/providers/OverlayProvider.types";
import { readConfirmLabelWarning } from "@/domain/commands/confirm.labels";

/** Prefix of the provider-generated confirmation entry id. */
const CONFIRM_ENTRY_ID_PREFIX = "overlay-confirm";

/**
 * Owns the single overlay surface, its captured focus, and the provider operations.
 *
 * The reducer owns every transition, so this hook only captures the background focus, dispatches the
 * matching action, and restores focus once when the last surface closes. Opening a surface blurs the
 * previously focused renderable before native focus moves into the modal, so a background input can
 * never keep receiving typing even when the entry supplies no focus target. Capturing happens only
 * while no surface is open, so replacing one modal with another keeps the user's original background
 * context.
 *
 * @returns The overlay context value.
 */
export function useOverlaySurfaceState(): OverlayContextValue {
  const renderer = useRenderer();
  const { restoreFocus } = useFocusState();
  const [state, dispatch] = useReducer(reduceOverlaySurface, INITIAL_OVERLAY_SURFACE_STATE);
  const stateRef = useRef(state);
  const confirmCounterRef = useRef(0);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  /**
   * Captures and blurs the background renderable when no surface owns focus yet.
   *
   * The callback reads the live reducer state through `stateRef`, not the state captured by the
   * render that created it. A command that started before a modal opened holds the older
   * `showError` closure; without the live read, its late failure would blur the modal's focused
   * control based on the pre-modal state.
   */
  const captureFocus = useCallback((): string | null => {
    if (readOverlayIsOpen(stateRef.current)) {
      return null;
    }

    const focused = renderer.currentFocusedRenderable;

    focused?.blur();

    return focused?.id ?? null;
  }, [renderer]);

  /** Opens or replaces the single modal entry. */
  const open = useCallback(
    (entry: OverlayEntry): void => {
      dispatch({ type: "open", entry, focusedId: captureFocus() });
    },
    [captureFocus],
  );

  /** Closes the open entry, or dismisses the error when no entry is open. */
  const close = useCallback((): void => {
    dispatch({ type: "close" });
  }, []);

  /** Closes one entry only when it is still the open entry. */
  const closeEntry = useCallback((entryId: string): void => {
    dispatch({ type: "closeEntry", entryId });
  }, []);

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
    [captureFocus],
  );

  /** Dismisses the visible error. */
  const dismissError = useCallback((): void => {
    dispatch({ type: "dismissError" });
  }, []);

  useEffect(() => {
    if (state.releasedFocusId === null) {
      return;
    }

    restoreFocus(state.releasedFocusId);
    dispatch({ type: "acknowledgeRestore" });
  }, [restoreFocus, state.releasedFocusId]);

  return useMemo<OverlayContextValue>(
    () => ({
      entry: state.entry,
      errorDetail: state.errorDetail,
      isOpen: readOverlayIsOpen(state),
      toggleActionId: readToggleActionId(state.entry),
      open,
      close,
      closeEntry,
      confirm,
      showError,
      dismissError,
    }),
    [close, closeEntry, confirm, dismissError, open, showError, state],
  );
}
