/** Prefix of the overlay entry id for the create-local-branch modal. */
export const CREATE_LOCAL_OVERLAY_ID_PREFIX = "remotes.create-local:";

/** Stable id of the create-local-branch modal frame. */
export const CREATE_LOCAL_MODAL_FRAME_ID = "remotes-create-local-modal";

/** Stable id of the local branch name input. */
export const CREATE_LOCAL_NAME_INPUT_ID = "remotes-create-local-name";

/** Stable id of the checkout checkbox. */
export const CREATE_LOCAL_CHECKOUT_ID = "remotes-create-local-checkout";

/** Stable id of the Create action. */
export const CREATE_LOCAL_SUBMIT_ID = "remotes-create-local-submit";

/** Stable id of the Cancel action. */
export const CREATE_LOCAL_CANCEL_ID = "remotes-create-local-cancel";

/** Requested modal width in cells, clamped by the modal frame. */
export const CREATE_LOCAL_MODAL_WIDTH = 56;

/** Requested modal height in rows, clamped by the modal frame. */
export const CREATE_LOCAL_MODAL_HEIGHT = 13;

/** Title prefix naming the remote branch the local branch is created from. */
export const CREATE_LOCAL_TITLE_PREFIX = "Create local branch from";

/** Label above the local branch name field. */
export const CREATE_LOCAL_NAME_LABEL = "Local branch name";

/** Label of the read-only base ref line. */
export const CREATE_LOCAL_BASE_REF_LABEL = "Base ref:";

/** Label of the checkout checkbox. */
export const CREATE_LOCAL_CHECKOUT_LABEL = "Check out after creating";

/** Create action label. */
export const CREATE_LOCAL_SUBMIT_LABEL = "Create";

/** Cancel action label. */
export const CREATE_LOCAL_CANCEL_LABEL = "Cancel";

/** Inline error shown when the local branch name is empty. */
export const CREATE_LOCAL_NAME_REQUIRED_ERROR = "Enter a local branch name";

/** Inline error shown when the name is not a safe single git ref value. */
export const CREATE_LOCAL_NAME_INVALID_ERROR = "Use a branch name without spaces or ~ ^ : ? * [";

/** Prefix of the inline error shown when the local branch already exists. */
export const CREATE_LOCAL_NAME_DUPLICATE_PREFIX = "Local branch already exists: ";
