import type { StatusEntry } from "../git.types";

/** Mutable accumulator used while parsing one status stream. */
export interface MutableStatus {
  /** HEAD commit id, or null in an unborn branch. */
  headOid: string | null;
  /** Short branch name, or null when detached. */
  branch: string | null;
  /** True when HEAD is detached. */
  detached: boolean;
  /** Upstream ref, or null. */
  upstream: string | null;
  /** Commits ahead of the upstream. */
  ahead: number;
  /** Commits behind the upstream. */
  behind: number;
  /** Parsed entries. */
  entries: StatusEntry[];
  /** Conflicted paths. */
  conflictedPaths: string[];
  /** Count of index-side changes. */
  stagedCount: number;
  /** Count of tracked working-tree changes. */
  unstagedCount: number;
  /** Count of untracked entries. */
  untrackedCount: number;
}
