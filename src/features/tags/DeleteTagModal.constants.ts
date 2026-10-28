import type { DeleteControl } from "@/features/tags/DeleteTagModal.types";

/** Stable renderable id of the delete scope field. */
export const DELETE_TAG_SCOPE_SELECT_ID = "delete-tag-scope";

/** Stable renderable id of the remote picker, rendered when several remotes contain the tag. */
export const DELETE_TAG_REMOTE_SELECT_ID = "delete-tag-remote";

/** Renderable id of the primary delete action. */
export const DELETE_TAG_DELETE_BUTTON_ID = "delete-tag-delete";

/** Renderable id of the cancel action. */
export const DELETE_TAG_CANCEL_BUTTON_ID = "delete-tag-cancel";

/** Requested modal width, in cells, before terminal clamping. */
export const DELETE_TAG_WIDTH = 66;

/** Maximum remote picker height before native scrolling, in rows. */
export const DELETE_TAG_REMOTE_MAX_ROWS = 6;

/** Modal title. */
export const DELETE_TAG_TITLE = "Delete tag";

/** Reason shown when a remote scope cannot run. */
export const DELETE_TAG_NOT_ON_REMOTE = "not on any remote";

/** Focusable controls when the remote picker is shown. */
export const DELETE_TAG_FULL_CONTROL_ORDER: readonly DeleteControl[] = Object.freeze([
  "scope",
  "remote",
  "cancel",
  "confirm",
]);

/** Focusable controls when a single remote is named as text instead of a picker. */
export const DELETE_TAG_COMPACT_CONTROL_ORDER: readonly DeleteControl[] = Object.freeze([
  "scope",
  "cancel",
  "confirm",
]);
