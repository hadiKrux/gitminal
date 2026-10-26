import type { RemoteBranchRecord } from "./git.types";

/** One remote's remote-tracking branches, ordered by branch name. */
export interface RemoteBranchGroup {
  /** Configured remote name, exactly as configured. */
  readonly remote: string;
  /** Remote-tracking branches of that remote, sorted by branch name. */
  readonly branches: readonly RemoteBranchRecord[];
}

/** Validated atoms of one non-symbolic remote-tracking ref line. */
export interface RemoteBranchFields {
  /** Full ref name, already confirmed to start with `refs/remotes/`. */
  readonly ref: string;
  /** Tip object name. */
  readonly tipOid: string;
  /** Committer date, or null when git reported none. */
  readonly committerDate: string | null;
  /** Commit subject, empty when git reported none. */
  readonly subject: string;
}
