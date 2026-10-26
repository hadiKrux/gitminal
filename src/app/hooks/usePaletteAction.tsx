import { type ReactNode, useCallback } from "react";
import { useAction } from "@/app/hooks/useAction";
import { useOverlay } from "@/app/hooks/useOverlay";
import { CommandPalette } from "@/features/palette/CommandPalette";
import {
  PALETTE_OVERLAY_ID,
  PALETTE_SEARCH_INPUT_ID,
  PALETTE_TOGGLE_ACTION_ID,
} from "@/features/palette/CommandPalette.constants";

/**
 * Registers `app.palette` once as a global action in the app layer.
 *
 * The action opens the palette as an `OverlayModalEntry`, so `OverlayHost` renders it inside
 * `ModalFrame` and the overlay provider owns the keyboard and the focus restore. Re-pressing the
 * action while the palette is the open entry closes it through the entry's `toggleActionId`, which
 * is how `app.palette` remains reachable from the focused search field. This hook is the single
 * owner of the global action: the palette feature registers only overlay-scoped handlers.
 */
export function usePaletteAction(): void {
  const overlay = useOverlay();

  /** Opens the palette, or closes it when it is already the open entry. */
  const togglePalette = useCallback((): void => {
    if (overlay.entry?.id === PALETTE_OVERLAY_ID) {
      overlay.close();

      return;
    }

    overlay.open({
      kind: "modal",
      id: PALETTE_OVERLAY_ID,
      toggleActionId: PALETTE_TOGGLE_ACTION_ID,
      initialFocusId: PALETTE_SEARCH_INPUT_ID,
      render: ({ close }): ReactNode => <CommandPalette onClose={close} />,
    });
  }, [overlay]);

  useAction("app.palette", { scope: "global", owner: "app" }, togglePalette);
}
