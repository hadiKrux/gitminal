import type { ActionScope } from "@/app/hooks/useAction.types";
import type { ActionId } from "@/domain/keymap/keymap.defaults";
import type { KeymapContext } from "@/domain/keymap/keymap.types";

/**
 * Contextual actions the footer never advertises because their keys are self-evident.
 *
 * Tab traversal, arrow movement between controls, quit, the console toggle, and Esc cancel are
 * learned once and documented in Help and the command palette. Hiding them leaves the single footer
 * line for the focused region's actions and the globals that change with repository state, such as
 * pull and fetch, as the mockup shows. The More menu trigger stays visible because `.` is not
 * guessable and it is the discovery path for the force and prune variants. This filter applies to
 * context hints only; the modal list below is a separate allowlist, where Esc and Left/Right are
 * deliberate choices inside a modal rather than generic navigation.
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
  ]),
);

/**
 * Context hints the footer suppresses only inside one focus context.
 *
 * `nav.activate` stays visible in the panels, where Enter runs the selected row's action, and in
 * overlays, where it commits the focused control. On the top bar the focused control already shows
 * its own focus state and its label names the outcome, so an Enter hint only spends footer width.
 * The theme picker and refresh globals are also dropped there: the top bar is a short navigation
 * strip, and Help remains as the discovery surface for every global chord. The `branches` context
 * hides its own activation hint, and every content region hides all global hints through
 * `CONTEXTS_WITHOUT_GLOBAL_HINTS`, so a focused block lists only its own verbs. The `graph` context
 * also hides PageUp and PageDown, which most laptop keyboards do not have; the bindings still work
 * where the keys exist, but the commits footer does not spend width on them.
 */
export const HIDDEN_HINTS_BY_CONTEXT: Readonly<
  Partial<Record<KeymapContext, ReadonlySet<string>>>
> = Object.freeze({
  "top-bar": Object.freeze(new Set(["nav.activate", "app.refresh", "app.themePicker"])),
  branches: Object.freeze(new Set(["nav.activate"])),
  graph: Object.freeze(new Set(["nav.pageUp", "nav.pageDown"])),
});

/**
 * Content-region contexts whose footer shows only that region's own hints.
 *
 * Each block advertises the verbs that act on its selection, and the shared global chords would
 * crowd those out on one line. Help and the palette remain the discovery surfaces for the global
 * actions while focus stays in a block. The top bar is excluded because its footer is the only
 * place the palette, Help, and the More menu trigger are advertised, and the no-focus fallback
 * still lists the globals because there is no block context to speak for.
 */
export const CONTEXTS_WITHOUT_GLOBAL_HINTS: ReadonlySet<KeymapContext> = Object.freeze(
  new Set<KeymapContext>([
    "branches",
    "remotes",
    "tags",
    "stashes",
    "worktrees",
    "graph",
    "right-pane",
    "diff",
    "console",
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
