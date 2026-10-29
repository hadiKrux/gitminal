import type { selectRemoteBranchGroups } from "@/domain/repository/repository.selectors";

/** A remote-tracking ref addressed by its configured remote and branch name. */
export interface RemoteBranchTarget {
  /** Configured remote name. */
  readonly remote: string;
  /** Branch name inside that remote. */
  readonly branch: string;
}

/** One selectable branch row derived from the grouped selector output. */
export interface RemoteBranchItem extends RemoteBranchTarget {
  /** Exact upstream relationship derived by the repository selector, never inferred from local names. */
  readonly hasLocalTracker: boolean;
  /** Stable cursor identity, persisted by the focus provider. */
  readonly id: string;
  /** Stable renderable id used by scrolling and row tests. */
  readonly rowId: string;
}

/** Grouped remote branches as returned by the shared selector. */
export type RemoteBranchGroups = ReturnType<typeof selectRemoteBranchGroups>;

/** One rendered group of remote branches, after filtering and the row cap. */
export interface VisibleRemoteGroup {
  /** Configured remote name. */
  readonly remote: string;
  /** Visible branches inside that remote, in display order. */
  readonly branches: readonly { readonly branch: string; readonly hasLocalTracker: boolean }[];
}

/** One grouped row rendered by the remotes panel. */
export type RemoteBranchGroup = VisibleRemoteGroup;
