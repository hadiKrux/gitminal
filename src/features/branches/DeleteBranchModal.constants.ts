/** Requested modal width in cells, before terminal clamping. */
export const DELETE_BRANCH_MODAL_WIDTH = 64;

/** Base requested modal height in rows, before the at-risk commit list is added. */
export const DELETE_BRANCH_MODAL_HEIGHT = 20;

/** Upper bound of the modal height when the at-risk commit list is long. */
export const DELETE_BRANCH_MODAL_MAX_HEIGHT = 40;

/**
 * Rows reserved inside the modal for everything except the at-risk scrollbox.
 *
 * The value covers the borders and padding, the branch line, the four-row scope select, the resolved-remote
 * line, the optional behind warning, the evidence heading, the overflow hint, the hidden-count
 * notice, the force checkbox, the acknowledgement line, the disabled reason, and the footer. Every
 * one of those lines renders on a single row and is truncated to the modal content width, so a long
 * branch name or a long notice can never wrap into an extra row and push a control out. Reserving
 * them keeps the acknowledgement and the footer on screen on a short terminal.
 */
export const DELETE_BRANCH_RESERVED_ROWS = 19;

/** Rows the hidden-count notice adds to the requested modal height. */
export const DELETE_BRANCH_NOTICE_ROWS = 1;

/** Cells the footer's two-button padding and gap take from the modal content width. */
export const DELETE_BRANCH_FOOTER_CHROME_WIDTH = 5;

/** Smallest subject budget kept inside one at-risk row. */
export const DELETE_BRANCH_MIN_SUBJECT_WIDTH = 8;

/** Cells one commit id and its separator take in an at-risk row. */
export const DELETE_BRANCH_COMMIT_PREFIX_WIDTH = 8;

/** Cells a vertical scrollbar may take from the at-risk scrollbox. */
export const DELETE_BRANCH_SCROLLBAR_WIDTH = 1;

/** Cells the modal border takes from the requested width. */
export const DELETE_BRANCH_BORDER_WIDTH = 2;

/** Number of commit id characters shown beside an at-risk subject. */
export const DELETE_BRANCH_SHORT_OID_LENGTH = 7;

/** Notice shown when the capped read may hide older commits at risk. */
export const DELETE_BRANCH_HAS_MORE_NOTICE = "Only the newest 20 at-risk commits are listed.";

/** Hint shown when the at-risk list is taller than its viewport. */
export const DELETE_BRANCH_SCROLL_HINT = "PageUp/PageDown scrolls the commit list.";

/** Stable renderable id of the delete scope select. */
export const DELETE_BRANCH_SCOPE_ID = "branches-delete-scope";

/** Stable id of the confirm action. */
export const DELETE_BRANCH_CONFIRM_ID = "branches-delete-confirm";

/** Stable id of the Cancel action. */
export const DELETE_BRANCH_CANCEL_ID = "branches-delete-cancel";

/** Stable id of the force acknowledgement checkbox. */
export const DELETE_BRANCH_FORCE_ID = "branches-delete-force";

/** Stable id of the bounded at-risk commit scrollbox. */
export const DELETE_BRANCH_RISK_LIST_ID = "branches-delete-risk-list";

/** Delete scope that only removes the local branch. */
export const DELETE_BRANCH_SCOPE_LOCAL = "local";

/** Delete scope that also removes the resolved remote branch. */
export const DELETE_BRANCH_SCOPE_LOCAL_REMOTE = "local-remote";

/** Every focusable control of the modal, in navigation order. */
export const DELETE_BRANCH_CONTROL_ORDER = Object.freeze([
  "scope",
  "force",
  "cancel",
  "confirm",
] as const);

/** Controls without the force acknowledgement, used when no force path is offered. */
export const DELETE_BRANCH_MERGED_CONTROL_ORDER = Object.freeze([
  "scope",
  "cancel",
  "confirm",
] as const);
