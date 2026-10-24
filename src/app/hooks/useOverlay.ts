import { useContext } from "react";
import { OverlayContext } from "@/app/providers/OverlayProvider";
import type { OverlayContextValue } from "@/app/providers/OverlayProvider.types";

/**
 * Reads the overlay entry and its open, close, and confirm operations.
 *
 * @returns The overlay context value.
 * @throws When called outside an `OverlayProvider`.
 */
export function useOverlay(): OverlayContextValue {
  const value = useContext(OverlayContext);

  if (!value) {
    throw new Error("useOverlay must be used within an OverlayProvider.");
  }

  return value;
}
