/** Characters of a commit id shown in the summary. */
export const WORKTREE_DETAILS_SHORT_OID_LENGTH = 7;

/** Width subtracted from the terminal when sizing the shortened path. */
export const WORKTREE_DETAILS_CHROME_WIDTH = 40;

/** Smallest shortened-path budget kept for a narrow right pane. */
export const WORKTREE_DETAILS_MIN_PATH_BUDGET = 20;

/** Largest shortened-path budget, so a wide terminal keeps the summary readable. */
export const WORKTREE_DETAILS_MAX_PATH_BUDGET = 80;

/** Exact read-only notice required by F-07. */
export const WORKTREE_DETAILS_READ_ONLY_TEXT =
  "Read-only. This panel never switches the active repository.";

/** Text shown when the selected worktree disappeared from the snapshot. */
export const WORKTREE_DETAILS_MISSING_TEXT = "Worktree no longer exists";
