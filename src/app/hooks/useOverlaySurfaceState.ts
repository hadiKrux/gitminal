import { useMemo, useReducer } from "react";
import { useOverlayFocusHandoff } from "@/app/hooks/useOverlayFocusHandoff";
import { useOverlayOperations } from "@/app/hooks/useOverlayOperations";
import {
  INITIAL_OVERLAY_SURFACE_STATE,
  readOverlayIsOpen,
  readToggleActionId,
  reduceOverlaySurface,
} from "@/app/providers/OverlayProvider.state";
import type { OverlayContextValue } from "@/app/providers/OverlayProvider.types";

/**
 * Owns the single overlay surface, its captured focus, and the provider operations.
 *
 * The reducer owns every transition. `useOverlayFocusHandoff` owns the captured background focus and
 * the restore that runs once the last surface closes, and `useOverlayOperations` owns the provider
 * operations, so this hook only joins the reducer state with the operations it exposes.
 *
 * @returns The overlay context value.
 */
export function useOverlaySurfaceState(): OverlayContextValue {
  const [state, dispatch] = useReducer(reduceOverlaySurface, INITIAL_OVERLAY_SURFACE_STATE);
  const handoff = useOverlayFocusHandoff(state, dispatch);
  const operations = useOverlayOperations(dispatch, handoff);

  return useMemo<OverlayContextValue>(
    () => ({
      entry: state.entry,
      errorDetail: state.errorDetail,
      isOpen: readOverlayIsOpen(state),
      toggleActionId: readToggleActionId(state.entry),
      ...operations,
    }),
    [operations, state],
  );
}
