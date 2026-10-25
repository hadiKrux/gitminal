import type { ActionScope } from "@/app/hooks/useAction.types";
import type { ActionId } from "@/domain/keymap/keymap.defaults";

/**
 * Contextual actions the footer never advertises because their keys are self-evident.
 *
 * Tab traversal, arrow movement between controls, quit, the console toggle, the More menu trigger,
 * and Esc cancel are learned once and documented in Help and the command palette. Hiding them
 * leaves the single footer line for the focused region's actions and the globals that change with
 * repository state, such as pull and fetch, as the mockup shows. This filter applies to context
 * hints only; the modal list below is a separate allowlist, where Esc and Left/Right are deliberate
 * choices inside a modal rather than generic navigation.
 */
export const HIDDEN_CONTEXT_HINT_ACTIONS: ReadonlySet<string> = Object.freeze(
  new Set([
    "app.quit",
    "app.console",
    "focus.next",
    "focus.previous",
    "nav.left",
    "nav.right",
    "overlay.close",
    "remote.more",
  ]),
);

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
