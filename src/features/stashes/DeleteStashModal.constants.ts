/** Renderable id of the primary drop action. */
export const DELETE_STASH_DROP_BUTTON_ID = "delete-stash-drop";

/** Renderable id of the cancel action. */
export const DELETE_STASH_CANCEL_BUTTON_ID = "delete-stash-cancel";

/** Requested modal width, in cells, before terminal clamping. */
export const DELETE_STASH_WIDTH = 66;

/** Requested modal height, in rows, holding the identity, consequence, and footer. */
export const DELETE_STASH_HEIGHT = 17;

/** Modal title. */
export const DELETE_STASH_TITLE = "Drop stash";

/** Consequence text for the destructive action. */
export const DELETE_STASH_CONSEQUENCE =
  "This drops the stash and keeps no copy. It cannot be undone.";

/** Footer index of the primary drop action. */
export const DELETE_STASH_DROP_ACTION_INDEX = 0;

/** Footer index of the cancel action; it is focused when the modal opens. */
export const DELETE_STASH_CANCEL_ACTION_INDEX = 1;
