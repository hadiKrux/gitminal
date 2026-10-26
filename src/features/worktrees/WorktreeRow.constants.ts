/** Characters of a detached HEAD commit id shown as the worktree identity. */
export const WORKTREE_ROW_SHORT_OID_LENGTH = 7;

/** Widest content area one sidebar worktree row is laid out in, in cells. */
export const WORKTREE_ROW_CONTENT_MAX_WIDTH = 24;

/** Narrowest content area a worktree row still renders in, in cells. */
export const WORKTREE_ROW_CONTENT_MIN_WIDTH = 12;

/** Cells reserved for the leading selection marker so the path budget matches the row. */
export const WORKTREE_ROW_MARKER_WIDTH = 1;

/** Smallest path budget kept, so a very narrow row still shows the tail of the path. */
export const WORKTREE_ROW_MIN_PATH_BUDGET = 8;
