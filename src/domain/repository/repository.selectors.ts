import type {
  BranchDisplay,
  PendingCounts,
  RemoteCheckRecord,
  RemoteFreshness,
  RepositoryFlag,
  RepositoryPrimaryState,
  RepositorySnapshot,
  RepositoryStateDisplay,
  RepositoryStateSnapshot,
  RepositoryView,
  SyncState,
  UpstreamDisplay,
  UpstreamStatus,
} from "./repository.types";

/** Default age after which a remote interaction is considered stale. */
export const REMOTE_STALE_AFTER_MS = 5 * 60 * 1000;

/** Text for each exclusive primary state. */
const PRIMARY_STATE_LABELS: Readonly<Record<RepositoryPrimaryState, string>> = Object.freeze({
  loading: "loading",
  normal: "normal",
  subdirectory: "subdirectory launch",
  "not-a-repository": "not a git repository",
  bare: "bare repository not supported",
  empty: "empty repository",
  "missing-git": "git not found",
  "permission-error": "permission error",
});

/** Text for each orthogonal flag, in the order the state detector reports them. */
const FLAG_LABELS: Readonly<Record<RepositoryFlag, string>> = Object.freeze({
  detached: "detached",
  "no-upstream": "no upstream",
  "upstream-gone": "upstream gone",
  "no-remote": "no remote",
  "no-origin": "no origin remote",
  "merge-in-progress": "merge in progress",
  "rebase-in-progress": "rebase in progress",
  "cherry-pick-in-progress": "cherry-pick in progress",
  conflicted: "conflicts",
  "operation-in-progress": "operation in progress",
  "checkout-dirty": "checkout blocked by local changes",
  "external-changes": "external changes",
  "huge-repository": "huge repository",
  "binary-or-oversized": "binary or oversized file",
  "missing-identity": "missing identity",
  "hook-failure": "hook failure",
  "auth-network-failure": "authentication or network failure",
  "invalid-config": "invalid configuration",
  "invalid-theme": "invalid theme",
});

/**
 * Reads the pending change counts.
 *
 * The total counts working-tree modifications plus untracked files, which is the count the Pending
 * Changes row shows. Staged-only changes are reported separately so the composer can show them even
 * when the working tree is otherwise clean.
 *
 * @param snapshot - Current snapshot, or null before the first read.
 * @returns The staged, unstaged, untracked, and total counts.
 */
export function selectPendingCounts(snapshot: RepositorySnapshot | null): PendingCounts {
  const staged = snapshot?.status?.stagedCount ?? 0;
  const unstaged = snapshot?.status?.unstagedCount ?? 0;
  const untracked = snapshot?.status?.untrackedCount ?? 0;

  return { staged, unstaged, untracked, total: unstaged + untracked };
}

/**
 * Reads the ahead and behind counts from the last fetched refs.
 *
 * @param snapshot - Current snapshot, or null before the first read.
 * @returns The ahead and behind counts, never a network result.
 */
export function selectAheadBehind(snapshot: RepositorySnapshot | null): {
  readonly ahead: number;
  readonly behind: number;
} {
  return { ahead: snapshot?.status?.ahead ?? 0, behind: snapshot?.status?.behind ?? 0 };
}

/**
 * Reads the sync relationship between the current branch and its upstream.
 *
 * The upstream classification decides the missing cases first, then the ahead and behind counts
 * read from the last fetched refs decide the rest. Refs are never recomputed here, so a network
 * result can only arrive through a completed fetch or push that refreshed the snapshot.
 *
 * @param snapshot - Current snapshot, or null before the first read.
 * @param upstreamStatus - Upstream classification read with the snapshot.
 * @returns One of the six sync states.
 */
export function selectSyncState(
  snapshot: RepositorySnapshot | null,
  upstreamStatus: UpstreamStatus,
): SyncState {
  if (upstreamStatus === "none") {
    return "no-upstream";
  }

  if (upstreamStatus !== "healthy") {
    return "upstream-gone";
  }

  const { ahead, behind } = selectAheadBehind(snapshot);

  if (ahead > 0 && behind > 0) {
    return "diverged";
  }

  if (ahead > 0) {
    return "ahead";
  }

  if (behind > 0) {
    return "behind";
  }

  return "up-to-date";
}

/**
 * Reads the branch label.
 *
 * @param snapshot - Current snapshot, or null before the first read.
 * @returns The branch name, or the detached short hash plus its identity.
 */
export function selectBranchDisplay(snapshot: RepositorySnapshot | null): BranchDisplay {
  if (snapshot === null) {
    return { label: "loading", detached: false, shortHash: null };
  }

  if (snapshot.detached) {
    return {
      label: snapshot.shortHash ?? "detached",
      detached: true,
      shortHash: snapshot.shortHash,
    };
  }

  return { label: snapshot.branch ?? "no branch", detached: false, shortHash: null };
}

/**
 * Reads the upstream label and status.
 *
 * The label always carries words, because a missing-upstream marker is never the only signal.
 *
 * @param snapshot - Current snapshot, or null before the first read.
 * @param status - Upstream classification read with the snapshot.
 * @returns The upstream display state.
 */
export function selectUpstreamDisplay(
  snapshot: RepositorySnapshot | null,
  status: UpstreamStatus,
): UpstreamDisplay {
  switch (status) {
    case "none":
      return { status, label: "no upstream", indicatesMissing: false };
    case "healthy":
      return { status, label: snapshot?.upstream ?? "upstream", indicatesMissing: false };
    case "gone":
      return { status, label: "upstream not found", indicatesMissing: true };
    case "deleted-after-prune":
    case "deleted-after-app-deletion":
      return { status, label: "remote branch deleted", indicatesMissing: true };
    case "unknown":
      return { status, label: "upstream unknown", indicatesMissing: true };
  }
}

/**
 * Reads the repository state text.
 *
 * A gating primary state names the whole-shell condition. A readable repository names its primary
 * state and then its active flags in detection order, so `conflicted` renders as `conflicts` and a
 * merge renders as `merge in progress`.
 *
 * @param state - Detected state snapshot.
 * @returns The primary state, flags, and display label.
 */
export function selectStateDisplay(state: RepositoryStateSnapshot): RepositoryStateDisplay {
  const primary = PRIMARY_STATE_LABELS[state.primary];
  const flags = state.flags.map((flag) => FLAG_LABELS[flag]);
  const label = flags.length === 0 ? primary : `${primary}: ${flags.join(", ")}`;

  return { primary: state.primary, flags: state.flags, label };
}

/**
 * Reads the freshness of a remote from its last successful check or fetch.
 *
 * A remote that was never checked is `unknown`, not stale, and the age of a ref object is never an
 * input.
 *
 * @param record - Per-remote success timestamps, or undefined when the remote is unknown.
 * @param now - Current clock value in milliseconds.
 * @param staleAfterMs - Age at which a successful interaction stops being fresh.
 * @returns `fresh`, `stale`, or `unknown`.
 */
export function selectRemoteFreshness(
  record: RemoteCheckRecord | undefined,
  now: number,
  staleAfterMs: number = REMOTE_STALE_AFTER_MS,
): RemoteFreshness {
  if (record === undefined) {
    return "unknown";
  }

  const lastSuccess = readLatestSuccess(record);

  if (lastSuccess === null) {
    return "unknown";
  }

  return now - lastSuccess <= staleAfterMs ? "fresh" : "stale";
}

/**
 * Reads the latest successful remote interaction for one record.
 *
 * @param record - Per-remote success timestamps.
 * @returns The newest timestamp, or null when both are unset.
 */
function readLatestSuccess(record: RemoteCheckRecord): number | null {
  const timestamps = [record.lastSuccessfulCheckAt, record.lastSuccessfulFetchAt].filter(
    (value): value is number => value !== null,
  );

  return timestamps.length === 0 ? null : Math.max(...timestamps);
}

/**
 * Builds the complete display view for the top bar and repository banner.
 *
 * @param snapshot - Current snapshot, or null before the first read.
 * @param state - Detected state snapshot.
 * @param upstreamStatus - Upstream classification read with the snapshot.
 * @returns Every value the placeholder top bar shows, derived once.
 */
export function selectRepositoryView(
  snapshot: RepositorySnapshot | null,
  state: RepositoryStateSnapshot,
  upstreamStatus: UpstreamStatus,
): RepositoryView {
  const aheadBehind = selectAheadBehind(snapshot);

  return {
    loading: state.primary === "loading",
    branch: selectBranchDisplay(snapshot),
    upstream: selectUpstreamDisplay(snapshot, upstreamStatus),
    ahead: aheadBehind.ahead,
    behind: aheadBehind.behind,
    sync: selectSyncState(snapshot, upstreamStatus),
    pending: selectPendingCounts(snapshot),
    state: selectStateDisplay(state),
  };
}
