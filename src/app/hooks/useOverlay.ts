import { useContext } from "react";
import { OverlayContext } from "@/app/providers/OverlayProvider";
import type { OverlayContextValue } from "@/app/providers/OverlayProvider.types";

/**
 * Reads the single overlay entry, the persistent error detail, and the operations that open, close,
 * confirm, show, and dismiss them.
 *
 * The value also exposes `closeEntry` so a settled command can close only the entry that was open
 * when it started, and `toggleActionId` for the overlay's own toggle. Success and informational
 * messages are not part of this context; they live in `StatusProvider`.
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
