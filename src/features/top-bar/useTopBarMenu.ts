import type { ReactNode } from "react";
import { useCallback, useRef } from "react";
import { useOverlay } from "@/app/hooks/useOverlay";
import { MORE_MENU_SELECT_ID } from "@/features/top-bar/MoreMenu.constants";
import {
  MORE_MENU_OVERLAY_ID,
  MORE_MENU_TOGGLE_ACTION_ID,
} from "@/features/top-bar/TopBar.constants";
import type { TopBarMoreMenuRenderInput } from "@/features/top-bar/useTopBar.types";

/**
 * Owns the More menu overlay entry for the top bar.
 *
 * The menu is overlay state, not a local flag: opening it stores one modal entry whose renderer is
 * supplied by the `.tsx` component, and pressing the toggle action again closes the same entry. The
 * renderer subscribes to the repository itself, so a refresh while the menu is open updates the
 * visible availability reasons without closing it. The activation callback is read through a ref so
 * the entry always routes to fresh command state.
 *
 * @param input - The JSX renderer and the confirmed-command router.
 * @returns The open-and-toggle entry point.
 */
export function useTopBarMenu(input: {
  readonly renderMoreMenu: (context: TopBarMoreMenuRenderInput) => ReactNode;
  readonly activateCommand: (commandId: string) => void;
}): { readonly openMoreMenu: () => void } {
  const overlay = useOverlay();
  const { renderMoreMenu } = input;
  const activateRef = useRef(input.activateCommand);

  activateRef.current = input.activateCommand;

  /** Opens the More menu, or closes it when it is already the open entry. */
  const openMoreMenu = useCallback((): void => {
    const current = overlay.entry;

    if (current !== null && current.kind === "modal" && current.id === MORE_MENU_OVERLAY_ID) {
      overlay.close();
      return;
    }

    overlay.open({
      kind: "modal",
      id: MORE_MENU_OVERLAY_ID,
      toggleActionId: MORE_MENU_TOGGLE_ACTION_ID,
      initialFocusId: MORE_MENU_SELECT_ID,
      render: ({ close }) =>
        renderMoreMenu({
          close,
          activate: activateRef.current,
        }),
    });
  }, [overlay, renderMoreMenu]);

  return { openMoreMenu };
}
