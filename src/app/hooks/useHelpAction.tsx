import { type ReactNode, useCallback } from "react";
import { useAction } from "@/app/hooks/useAction";
import { useOverlay } from "@/app/hooks/useOverlay";
import { HelpModal } from "@/features/help/HelpModal";
import {
  HELP_MODAL_ID,
  HELP_OVERLAY_ID,
  HELP_TOGGLE_ACTION_ID,
} from "@/features/help/HelpModal.constants";

/**
 * Registers `app.help` once as a global action in the app layer.
 *
 * The action opens help as an `OverlayModalEntry`, so `OverlayHost` renders it inside `ModalFrame`
 * and the overlay provider owns the keyboard and the focus restore. Re-running the action while help
 * is the open entry closes it through the entry's `toggleActionId`, so both default bindings (`?`
 * and `F1`) resolve to the same toggle. This hook is the single owner of the global action: the help
 * feature registers only overlay-scoped handlers, and every other global action stays unreachable
 * while help is open.
 */
export function useHelpAction(): void {
  const overlay = useOverlay();

  /** Opens help, or closes it when it is already the open entry. */
  const toggleHelp = useCallback((): void => {
    if (overlay.entry?.id === HELP_OVERLAY_ID) {
      overlay.close();

      return;
    }

    overlay.open({
      kind: "modal",
      id: HELP_OVERLAY_ID,
      toggleActionId: HELP_TOGGLE_ACTION_ID,
      initialFocusId: HELP_MODAL_ID,
      render: ({ close }): ReactNode => <HelpModal onClose={close} />,
    });
  }, [overlay]);

  useAction(HELP_TOGGLE_ACTION_ID, { scope: "global", owner: "app" }, toggleHelp);
}
