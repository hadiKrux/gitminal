import type { ActionScope } from "@/app/hooks/useAction.types";
import type { ActionId } from "@/domain/keymap/keymap.defaults";

/**
 * Actions the footer advertises while a modal owns the keyboard.
 *
 * Labels come from the action catalogue so help, the palette, and the footer stay aligned. The
 * list only chooses which actions and scopes are modal-relevant. `focus.next` is deliberately absent:
 * overlay precedence blocks it while a modal is open, so advertising it would be false.
 */
export const MODAL_HINT_ACTIONS: readonly {
  readonly actionId: ActionId;
  readonly scope: ActionScope;
}[] = Object.freeze([
  { actionId: "nav.activate", scope: "overlay" },
  { actionId: "nav.up", scope: "overlay" },
  { actionId: "nav.down", scope: "overlay" },
  { actionId: "nav.left", scope: "overlay" },
  { actionId: "nav.right", scope: "overlay" },
  { actionId: "overlay.close", scope: "global" },
]);
