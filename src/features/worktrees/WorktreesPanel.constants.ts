/** Overlay entry id of the New Worktree modal. */
export const CREATE_WORKTREE_OVERLAY_ID = "worktree.create";

/** Prefix of the Delete Worktree overlay entry id, suffixed with the worktree path. */
export const DELETE_WORKTREE_OVERLAY_ID_PREFIX = "worktree.delete:";

/** Error message shown above the previous rows. */
export const WORKTREES_ERROR_MESSAGE = "Could not read worktrees";

/** Text shown while another mutation owns the write slot. */
export const WORKTREES_BUSY_MESSAGE = "operation in progress - read only";

/** Loading row label while the first read is in flight. */
export const WORKTREES_LOADING_LABEL = "loading worktrees";

/** Empty state message when the repository has no worktrees. */
export const WORKTREES_EMPTY_MESSAGE = "No worktrees";

/** Prefix of the row-cap notice, followed by the visible and filtered counts. */
export const WORKTREES_TRUNCATION_LABEL = "showing first";
