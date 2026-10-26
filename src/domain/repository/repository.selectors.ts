import { groupByRemote } from "@/domain/git/git.remote-branches";
import { sortStashesNewestFirst } from "@/domain/git/git.stashes";
import { mergeTagScopes, sortTagsVersionDesc } from "@/domain/git/git.tags";
import type {
  BranchRecord,
  RemoteBranchRecord,
  StashRecord,
  TagRowRecord,
  WorktreeRecord,
} from "@/domain/git/git.types";
import { buildWorktreeBranchMap } from "@/domain/git/git.worktrees";
import type {
  BranchDisplay,
  PendingCounts,
  RemoteCheckRecord,
  RemoteFreshness,
  RemoteTagChecks,
  RepositoryFlag,
  RepositoryPrimaryState,
  RepositorySignals,
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
 * Reads the repository path shown as the top-bar title.
 *
 * A readable work tree shows its root even when the app was launched from a subdirectory, so the
 * title names the repository rather than the launch folder. A bare repository has no work-tree root,
 * so its git directory is shown. A plain directory falls back to the launch directory, so the title
 * always names the location the app is reading.
 *
 * @param snapshot - Current snapshot, or null before the first read or outside a work tree.
 * @param signals - Signals from the same read, carrying the launch and git directories.
 * @returns The absolute path to show.
 */
export function selectRepositoryPath(
  snapshot: RepositorySnapshot | null,
  signals: RepositorySignals,
): string {
  return snapshot?.root ?? signals.repositoryRoot ?? signals.gitDir ?? signals.cwd;
}

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

/**
 * Orders local branches for the branches panel.
 *
 * The current branch is always first so the checked-out branch stays visible while the list is
 * scrolled. The rest follow by committer date descending, then by name, so two branches that share a
 * timestamp still have one stable order across refreshes. Branches without a committer date sort
 * last, because git reports none only for an unusable or still-unborn ref.
 *
 * @param snapshot - Current snapshot, or null before the first read.
 * @returns A new array in panel order.
 */
export function selectBranchRows(snapshot: RepositorySnapshot | null): readonly BranchRecord[] {
  const branches = snapshot?.branches ?? [];

  return [...branches].sort((left, right) => {
    if (left.head !== right.head) {
      return left.head ? -1 : 1;
    }

    const dateOrder = compareCommitterDatesDesc(left.committerDate, right.committerDate);

    return dateOrder !== 0 ? dateOrder : compareText(left.name, right.name);
  });
}

/**
 * Compares two committer dates newest first.
 *
 * @param left - First ISO date, or null.
 * @param right - Second ISO date, or null.
 * @returns Negative when the left row sorts first, positive when the right does, zero on a tie.
 */
function compareCommitterDatesDesc(left: string | null, right: string | null): number {
  if (left === right) {
    return 0;
  }

  if (left === null) {
    return 1;
  }

  if (right === null) {
    return -1;
  }

  return left < right ? 1 : -1;
}

/**
 * Groups remote-tracking branches by remote and sorts both levels.
 *
 * @param snapshot - Current snapshot, or null before the first read.
 * @returns Groups ordered by remote name, each with branches ordered by branch name.
 */
export function selectRemoteBranchGroups(snapshot: RepositorySnapshot | null): readonly {
  readonly remote: string;
  readonly branches: readonly RemoteBranchRecord[];
}[] {
  return groupByRemote(snapshot?.remoteBranches ?? []);
}

/**
 * Merges local tags with remote tag knowledge and orders the rows newest version first.
 *
 * A remote whose last check failed keeps its previous names and reports `unknown` for a local tag
 * that is not confirmed elsewhere, so missing knowledge never reads as `unpushed`.
 *
 * @param snapshot - Current snapshot, or null before the first read.
 * @param remoteTagChecks - Last known tag set per configured remote.
 * @returns One logical row per tag name in version-aware descending order.
 */
export function selectTagRows(
  snapshot: RepositorySnapshot | null,
  remoteTagChecks: RemoteTagChecks,
): readonly TagRowRecord[] {
  return sortTagsVersionDesc(mergeTagScopes(snapshot?.tags ?? [], remoteTagChecks));
}

/**
 * Orders the stash list newest first.
 *
 * @param snapshot - Current snapshot, or null before the first read.
 * @returns A new array with the newest stash first and the object name preserved.
 */
export function selectStashRows(snapshot: RepositorySnapshot | null): readonly StashRecord[] {
  return sortStashesNewestFirst(snapshot?.stashes ?? []);
}

/**
 * Orders worktrees for the worktrees panel.
 *
 * The current worktree is first so its row is never scrolled away, then the rest follow by path, so
 * the list is stable across refreshes without depending on git's internal ordering.
 *
 * @param snapshot - Current snapshot, or null before the first read.
 * @returns A new array in panel order.
 */
export function selectWorktreeRows(snapshot: RepositorySnapshot | null): readonly WorktreeRecord[] {
  const worktrees = snapshot?.worktrees ?? [];

  return [...worktrees].sort((left, right) => {
    if (left.current !== right.current) {
      return left.current ? -1 : 1;
    }

    return compareText(left.path, right.path);
  });
}

/**
 * Maps each branch checked out in a worktree to that worktree.
 *
 * @param snapshot - Current snapshot, or null before the first read.
 * @returns A map from branch name to the worktree that has it checked out.
 */
export function selectWorktreeBranchMap(
  snapshot: RepositorySnapshot | null,
): ReadonlyMap<string, WorktreeRecord> {
  return buildWorktreeBranchMap(snapshot?.worktrees ?? []);
}

/**
 * Compares two strings by UTF-16 code unit.
 *
 * @param left - First value.
 * @param right - Second value.
 * @returns Negative when the left value sorts first, positive when the right does, zero on a tie.
 */
function compareText(left: string, right: string): number {
  if (left < right) {
    return -1;
  }

  return left > right ? 1 : 0;
}
