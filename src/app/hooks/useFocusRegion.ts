import type { BoxRenderable } from "@opentui/core";
import { useCallback, useRef } from "react";
import { useFocusState } from "@/app/hooks/useFocusState";
import type { FocusRegionHandle, RegionCursor, RegionId } from "@/features/shell/focus.types";
import { regionFrameId } from "@/features/shell/regions";
import { useTokens } from "@/theme/useTokens";

/**
 * Binds one component subtree to a shell region.
 *
 * The returned `regionProps` make the frame focusable with the stable `region-<id>` identity so
 * `FocusProvider` can derive the active region from native focus. `focused` stays true while a
 * descendant such as a text input owns focus, and false while focus is outside every region.
 *
 * @param regionId - Region this frame represents.
 * @returns The focus state, focus action, frame props, and cursor helpers.
 */
export function useFocusRegion(regionId: RegionId): FocusRegionHandle {
  const { state, focusRegion, getCursor, setCursor } = useFocusState();
  const tokens = useTokens();
  const frameRef = useRef<BoxRenderable | null>(null);

  /** Focuses this region's frame. */
  const focus = useCallback(() => {
    focusRegion(regionId);
  }, [focusRegion, regionId]);

  /** Reads this region's stored cursor. */
  const readCursor = useCallback(() => getCursor(regionId), [getCursor, regionId]);
  /** Writes or clears this region's stored cursor. */
  const writeCursor = useCallback(
    (cursor: RegionCursor | null) => setCursor(regionId, cursor),
    [regionId, setCursor],
  );

  return {
    focused: state.focusInsideRegion && state.activeRegion === regionId,
    focus,
    regionProps: {
      id: regionFrameId(regionId),
      ref: frameRef,
      focusable: true,
      borderColor: tokens.border,
      focusedBorderColor: tokens.focus,
    },
    getCursor: readCursor,
    setCursor: writeCursor,
  };
}
