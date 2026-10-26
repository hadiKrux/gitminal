/** Worktree record while its porcelain block is still being read. */
export interface MutableWorktree {
  /** Absolute worktree path. */
  path: string;
  /** Resolved HEAD id, or null before the block reports one. */
  headOid: string | null;
  /** Checked-out branch name, or null for a detached entry. */
  branch: string | null;
  /** True when the block reports a detached HEAD. */
  detached: boolean;
  /** True when the block reports a bare worktree. */
  bare: boolean;
  /** True when the block reports a lock. */
  locked: boolean;
  /** Reported lock reason, or null. */
  lockReason: string | null;
  /** True when the block reports prunability. */
  prunable: boolean;
  /** Reported prune reason, or null. */
  pruneReason: string | null;
}
