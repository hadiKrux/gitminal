import type { ReactNode } from "react";
import { useTokens } from "@/theme/useTokens";
import { OVERLAY_FOOTER_RESERVED_ROWS } from "@/ui/Overlay.constants";
import { useTerminalDimensions } from "@/ui/useTerminalDimensions";

/**
 * Renders the surface that deactivates everything behind a modal.
 *
 * The layer paints the app background and consumes mouse events with `stopPropagation`, so a click
 * outside the modal cannot reach a background region or button. It covers the whole shell except
 * the footer row, because the footer hint bar stays visible with the modal keys while an overlay is
 * open. It is not focusable: native focus belongs to the modal frame, and the overlay host owns
 * focus restoration on close.
 *
 * @returns The blocking overlay layer.
 */
export function Overlay(): ReactNode {
  const tokens = useTokens();
  const dimensions = useTerminalDimensions();
  const height = Math.max(1, dimensions.height - OVERLAY_FOOTER_RESERVED_ROWS);

  return (
    <box
      position="absolute"
      top={0}
      left={0}
      width="100%"
      height={height}
      zIndex={10}
      backgroundColor={tokens.background}
      opacity={0.8}
      onMouseDown={(event) => {
        event.stopPropagation();
      }}
    />
  );
}
