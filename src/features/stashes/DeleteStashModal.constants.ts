import type { DeleteStashControl } from "@/features/stashes/DeleteStashModal.types";

/** Renderable id of the primary drop action. */
export const DELETE_STASH_DROP_BUTTON_ID = "delete-stash-drop";

/** Renderable id of the cancel action. */
export const DELETE_STASH_CANCEL_BUTTON_ID = "delete-stash-cancel";

/** Requested modal width, in cells, before terminal clamping. */
export const DELETE_STASH_WIDTH = 66;

/** Modal title. */
export const DELETE_STASH_TITLE = "Drop stash";

/** Consequence text for the destructive action. */
export const DELETE_STASH_CONSEQUENCE =
  "This drops the stash and keeps no copy. It cannot be undone.";

/** Footer controls in display order; the cycle steps Up and Down through this list. */
export const DELETE_STASH_CONTROL_ORDER: readonly DeleteStashControl[] = Object.freeze([
  "drop",
  "cancel",
]);

/** Control focused when the modal opens, so the destructive action is never the default. */
export const DELETE_STASH_INITIAL_CONTROL: DeleteStashControl = "cancel";
