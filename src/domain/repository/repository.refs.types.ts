import type {
  BranchRecord,
  RemoteBranchRecord,
  StashRecord,
  TagRecord,
  WorktreeRecord,
} from "@/domain/git/git.types";
import type { RepositoryListFailures, UpstreamEvidence } from "./repository.types";

/** Ref lists read in the same snapshot as the status and the upstream classification. */
export interface SnapshotRefsRead {
  /** Local branches. */
  readonly branches: readonly BranchRecord[];
  /** Remote-tracking branches. */
  readonly remoteBranches: readonly RemoteBranchRecord[];
  /** Local tags. */
  readonly tags: readonly TagRecord[];
  /** Stashes. */
  readonly stashes: readonly StashRecord[];
  /** Worktrees, with the current one marked. */
  readonly worktrees: readonly WorktreeRecord[];
  /** Classified failure per optional list that did not read. */
  readonly listFailures: RepositoryListFailures;
}

/** Options the optional ref-list read needs from the repository read. */
export interface SnapshotRefsReadOptions {
  /** Working directory of every invocation. */
  readonly cwd: string;
  /** Cancellation signal. */
  readonly signal: AbortSignal;
  /** Upstream deletion and failure evidence from this session. */
  readonly evidence: UpstreamEvidence;
}
