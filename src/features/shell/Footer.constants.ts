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
 * Actions whose hint depends on the right-pane selection rather than a panel publication.
 *
 * `commit.focus` targets the composer textarea, so the footer asks the same availability source the
 * palette and help read instead of falling back to "a handler is registered" and advertising a
 * command whose surface is not mounted.
 */
export const SELECTION_HINT_ACTIONS: ReadonlySet<string> = Object.freeze(new Set(["commit.focus"]));

/**
 * Actions the footer advertises while a modal owns the keyboard.
 *
 * Labels come from the action catalogue so help, the palette, and the footer stay aligned. The
 * list only chooses which actions and scopes are modal-relevant. `focus.next` is deliberately absent:
 * the palette renders its own field-traversal hint inside the modal, and every other modal has no
 * such cycle to advertise.
 */
export const MODAL_HINT_ACTIONS: readonly {
  readonly actionId: ActionId;
  readonly scope: ActionScope;
}[] = Object.freeze([
  { actionId: "nav.activate", scope: "overlay" },
  { actionId: "nav.up", scope: "overlay" },
  { actionId: "nav.down", scope: "overlay" },
  { actionId: "nav.pageUp", scope: "overlay" },
  { actionId: "nav.pageDown", scope: "overlay" },
  { actionId: "nav.left", scope: "overlay" },
  { actionId: "nav.right", scope: "overlay" },
  { actionId: "overlay.close", scope: "global" },
]);
