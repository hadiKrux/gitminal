import type { CommitDetailsRecord, CommitStatsRecord } from "@/domain/git/git.types";

/** Status of the details read for the current selection. */
export type CommitReadStatus = "idle" | "loading" | "loaded" | "error";

/** Details and stats that belong to the same commit. */
export interface LoadedCommit {
  /** Parsed detail record. */
  readonly details: CommitDetailsRecord;
  /** Summed stats for the same commit. */
  readonly stats: CommitStatsRecord;
}

/** Result of one details-and-stats read. */
export interface CommitBundleResult {
  /** The loaded pair, or null on failure. */
  readonly loaded: LoadedCommit | null;
  /** Failure message, or null on success. */
  readonly error: string | null;
}

/** View state of the details read. */
export interface CommitReadState {
  /** Current read status. */
  readonly status: CommitReadStatus;
  /** Last successfully loaded commit, kept only while a newer read is in flight. */
  readonly loaded: LoadedCommit | null;
  /** Failure message of the newest attempt, or null. */
  readonly error: string | null;
}

/** One ref badge prepared for rendering. */
export interface RefBadgeView {
  /** Stable key inside the badge row. */
  readonly key: string;
  /** Visible badge label without brackets. */
  readonly label: string;
  /** Group that selects the badge color. */
  readonly kind: "tag" | "local" | "remote";
}
