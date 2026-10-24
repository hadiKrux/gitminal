import type { ActionScope } from "@/app/hooks/useAction.types";
import type { ActionId } from "@/domain/keymap/keymap.defaults";

/**
 * Actions the footer advertises while a modal owns the keyboard.
 *
 * Labels come from the action catalogue so help, the palette, and the footer stay aligned. The
 * list only chooses which actions and scopes are modal-relevant.
 */
export const MODAL_HINT_ACTIONS: readonly {
  readonly actionId: ActionId;
  readonly scope: ActionScope;
}[] = Object.freeze([
  { actionId: "nav.activate", scope: "overlay" },
  { actionId: "overlay.close", scope: "global" },
  { actionId: "focus.next", scope: "global" },
]);
