import { useRenderer } from "@opentui/react";
import { useCallback, useEffect, useRef } from "react";
import { useFocusState } from "@/app/hooks/useFocusState";
import { readOverlayIsOpen } from "@/app/providers/OverlayProvider.state";
import type {
  OverlaySurfaceAction,
  OverlaySurfaceState,
} from "@/app/providers/OverlayProvider.types";

/** Focus handoff operations the overlay surface owns. */
export interface OverlayFocusHandoff {
  /** Captures and blurs the background renderable when no surface owns focus yet. */
  readonly captureFocus: () => string | null;
  /** Records or clears the completion that runs once the next close restores focus. */
  readonly recordCloseCompletion: (completion: (() => void) | null) => void;
}

/**
 * Owns the captured background focus, its restore, and the close completion.
 *
 * The reducer owns every transition, so this hook only captures the background focus, dispatches the
 * matching action, and restores focus once when the last surface closes. Opening a surface blurs the
 * previously focused renderable before native focus moves into the modal, so a background input can
 * never keep receiving typing even when the entry supplies no focus target. Capturing happens only
 * while no surface is open, so replacing one modal with another keeps the user's original background
 * context. A caller that needs work to happen after the restore records it here through
 * `recordCloseCompletion`, so the work is caused by the restore instead of racing it on a timer.
 *
 * @param state - Current overlay surface state.
 * @param dispatch - Overlay surface dispatcher.
 * @returns The focus handoff operations.
 */
export function useOverlayFocusHandoff(
  state: OverlaySurfaceState,
  dispatch: (action: OverlaySurfaceAction) => void,
): OverlayFocusHandoff {
  const renderer = useRenderer();
  const { restoreFocus } = useFocusState();
  const stateRef = useRef(state);
  const postRestoreRef = useRef<(() => void) | null>(null);

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

  /** Records the completion of one close session, or clears it when nothing was open. */
  const recordCloseCompletion = useCallback((completion: (() => void) | null): void => {
    postRestoreRef.current = readOverlayIsOpen(stateRef.current) ? completion : null;
  }, []);

  useEffect(() => {
    if (state.releasedFocusId === null) {
      return;
    }

    restoreFocus(state.releasedFocusId);
    dispatch({ type: "acknowledgeRestore" });
  }, [dispatch, restoreFocus, state.releasedFocusId]);

  // Declared after the restore effect, so the completion defined here runs only once the restore,
  // including its `acknowledgeRestore` dispatch, has finished. A close completion that opens a new
  // entry therefore replaces a fully restored background instead of being undone by it. The
  // completion is taken and cleared before the open check, so it belongs to one close session: a
  // surface that opened before the restore was acknowledged discards it instead of running it when
  // that unrelated surface later closes.
  useEffect(() => {
    if (state.releasedFocusId !== null) {
      return;
    }

    const completion = postRestoreRef.current;

    postRestoreRef.current = null;

    if (readOverlayIsOpen(state)) {
      return;
    }

    completion?.();
  }, [state]);

  return { captureFocus, recordCloseCompletion };
}
