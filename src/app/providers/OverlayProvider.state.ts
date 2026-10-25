import type {
  ErrorDetail,
  OverlayEntry,
  OverlaySurfaceAction,
  OverlaySurfaceState,
} from "@/app/providers/OverlayProvider.types";

/** State before any overlay surface opens. */
export const INITIAL_OVERLAY_SURFACE_STATE: OverlaySurfaceState = Object.freeze({
  entry: null,
  errorDetail: null,
  capturedFocusId: null,
  releasedFocusId: null,
});

/**
 * Reduces one overlay surface transition.
 *
 * A new entry replaces the open entry, and a new error replaces the visible error. The captured
 * background focus belongs to the first surface in a run, so replacing a surface keeps it. A surface
 * that closes while another is still visible keeps the capture; the last visible surface releases it
 * once through `releasedFocusId`, which the provider's focus effect consumes.
 *
 * @param state - Current surface state.
 * @param action - Transition to apply.
 * @returns The next surface state.
 */
export function reduceOverlaySurface(
  state: OverlaySurfaceState,
  action: OverlaySurfaceAction,
): OverlaySurfaceState {
  switch (action.type) {
    case "open":
      return {
        entry: action.entry,
        errorDetail: state.errorDetail,
        capturedFocusId: readFocusCapture(state, action.focusedId),
        releasedFocusId: null,
      };
    case "close":
      return closeSurface(state, true);
    case "closeEntry":
      return state.entry?.id === action.entryId ? closeSurface(state, false) : state;
    case "showError":
      return {
        entry: state.entry,
        errorDetail: action.detail,
        capturedFocusId: readFocusCapture(state, action.focusedId),
        releasedFocusId: null,
      };
    case "dismissError":
      return state.errorDetail === null ? state : releaseError(state);
    case "acknowledgeRestore":
      return state.releasedFocusId === null ? state : { ...state, releasedFocusId: null };
  }
}

/**
 * Reports whether any overlay surface currently owns the keyboard.
 *
 * @param state - Current surface state.
 * @returns True when an entry or an error is visible.
 */
export function readOverlayIsOpen(state: OverlaySurfaceState): boolean {
  return state.entry !== null || state.errorDetail !== null;
}

/**
 * Reads the toggle action id of a modal entry.
 *
 * Confirmations, the error overlay, and an empty overlay declare no toggle, so only `overlay.close`
 * and `app.quit` can resolve while they are open.
 *
 * @param entry - Open entry, or null.
 * @returns The toggle action id, or null.
 */
export function readToggleActionId(entry: OverlayEntry | null): string | null {
  if (entry === null || entry.kind !== "modal") {
    return null;
  }

  return entry.toggleActionId ?? null;
}

/**
 * Reads the background focus to keep when a surface opens.
 *
 * A close followed by an open in the same tick, such as a menu that closes before it opens its
 * confirmation, leaves the restore pending in `releasedFocusId` while the renderer focus is already
 * blurred. That pending id is the user's real background context, so it wins over the newly observed
 * focus, which is null at that point.
 *
 * @param state - Current surface state.
 * @param focusedId - Renderable id captured from the renderer for this open.
 * @returns The id to restore when the last surface closes.
 */
function readFocusCapture(state: OverlaySurfaceState, focusedId: string | null): string | null {
  return state.capturedFocusId ?? state.releasedFocusId ?? focusedId;
}

/**
 * Closes the entry or the error that `close` targets.
 *
 * @param state - Current surface state.
 * @param closeErrorWhenNoEntry - True for the Esc path, which dismisses the error when no entry is open.
 * @returns The next state with a released focus id when the last surface closed.
 */
function closeSurface(
  state: OverlaySurfaceState,
  closeErrorWhenNoEntry: boolean,
): OverlaySurfaceState {
  if (state.entry === null && (!closeErrorWhenNoEntry || state.errorDetail === null)) {
    return state;
  }

  return storeSurfaces(state, null, state.entry === null ? null : state.errorDetail);
}

/**
 * Dismisses the error while an entry may still be open.
 *
 * @param state - Current surface state with an error.
 * @returns The next state.
 */
function releaseError(state: OverlaySurfaceState): OverlaySurfaceState {
  return storeSurfaces(state, state.entry, null);
}

/**
 * Stores the visible surfaces and releases the captured focus when both are gone.
 *
 * @param state - Current surface state.
 * @param entry - Entry that remains visible, or null.
 * @param errorDetail - Error that remains visible, or null.
 * @returns The next state.
 */
function storeSurfaces(
  state: OverlaySurfaceState,
  entry: OverlayEntry | null,
  errorDetail: ErrorDetail | null,
): OverlaySurfaceState {
  const releases = entry === null && errorDetail === null;

  return {
    entry,
    errorDetail,
    capturedFocusId: releases ? null : state.capturedFocusId,
    releasedFocusId: releases ? state.capturedFocusId : state.releasedFocusId,
  };
}
