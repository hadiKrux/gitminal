import type { DiffFileStatus, DiffSection } from "@/domain/diff/diff.types";
import type {
  BranchRecord,
  GitFailureKind,
  GitIdentity,
  RemoteBranchRecord,
  RemoteInfo,
  StashRecord,
  StatusSnapshot,
  TagRecord,
  WorktreeRecord,
} from "@/domain/git/git.types";

/** Remote branch view projected from its ref plus exact local upstream relationships. */
export interface RemoteBranchRow extends RemoteBranchRecord {
  /** True when at least one local branch configures this exact remote and branch as its upstream. */
  readonly hasLocalTracker: boolean;
}

/** Upstream classification after a local or remote check. */
export type UpstreamCheck = "none" | "checked" | "unknown";

/**
 * Every F-16 repository state member.
 *
 * The union is split into exclusive primary states and orthogonal flags. A primary state describes
 * what the whole shell can show; flags describe conditions layered on an otherwise usable
 * repository, so a repository can be `normal` plus `detached` plus `conflicted`.
 */
export type RepositoryState =
  | "loading"
  | "normal"
  | "subdirectory"
  | "not-a-repository"
  | "bare"
  | "empty"
  | "missing-git"
  | "permission-error"
  | "detached"
  | "no-upstream"
  | "upstream-gone"
  | "no-remote"
  | "no-origin"
  | "merge-in-progress"
  | "rebase-in-progress"
  | "cherry-pick-in-progress"
  | "conflicted"
  | "checkout-dirty"
  | "operation-in-progress"
  | "external-changes"
  | "huge-repository"
  | "binary-or-oversized"
  | "missing-identity"
  | "hook-failure"
  | "auth-network-failure"
  | "invalid-config"
  | "invalid-theme";

/** States that describe the whole repository and exclude every other primary state. */
export type RepositoryPrimaryState = Extract<
  RepositoryState,
  | "loading"
  | "normal"
  | "subdirectory"
  | "not-a-repository"
  | "bare"
  | "empty"
  | "missing-git"
  | "permission-error"
>;

/** States layered on top of a usable repository, reported in a stable order. */
export type RepositoryFlag = Exclude<RepositoryState, RepositoryPrimaryState>;

/** Result of state detection: one exclusive primary state plus ordered active flags. */
export interface RepositoryStateSnapshot {
  /** The exclusive state that decides which shell surface renders. */
  readonly primary: RepositoryPrimaryState;
  /** Active orthogonal flags, ordered as documented in ticket 16. */
  readonly flags: readonly RepositoryFlag[];
}

/**
 * Raw inputs to state detection.
 *
 * The provider fills this from the git read modules and from its own refresh state. Detection and
 * gating are pure functions of these values, so repository state is never inferred inside UI code.
 */
export interface RepositorySignals {
  /** Directory the app was launched from. */
  readonly cwd: string;
  /** True while the first signal set has not arrived yet. */
  readonly loaded: boolean;
  /** True when the configured git executable could be started. */
  readonly gitAvailable: boolean;
  /** True when the working directory is inside a work tree. */
  readonly insideWorkTree: boolean;
  /** True when the repository is bare. */
  readonly bare: boolean;
  /** Absolute work-tree root, or null when unavailable. */
  readonly repositoryRoot: string | null;
  /** Absolute git directory, or null when unavailable. */
  readonly gitDir: string | null;
  /** True when HEAD resolves to a commit. */
  readonly headExists: boolean;
  /** Short branch name, or null when detached or unavailable. */
  readonly branch: string | null;
  /** True when HEAD is detached. */
  readonly detached: boolean;
  /** Abbreviated HEAD commit id shown for a detached HEAD. */
  readonly shortHash: string | null;
  /** Configured remote names. */
  readonly remotes: readonly string[];
  /** Configured upstream ref, or null when the branch has none. */
  readonly upstream: string | null;
  /** True when the configured upstream ref exists locally. */
  readonly upstreamExists: boolean;
  /** Whether the upstream was actually checked. */
  readonly upstreamCheck: UpstreamCheck;
  /**
   * True when at least one local branch has a configured upstream.
   *
   * Resolved during the repository read from `for-each-ref refs/heads`. It gates the scoped Fetch
   * command, whose scope is exactly the upstream refs of local branches. A failed read leaves it
   * true so an incomplete read never disables Fetch; the executor still refuses an empty scope.
   */
  readonly hasUpstreamBranches: boolean;
  /** True while a merge is in progress. */
  readonly mergeInProgress: boolean;
  /** True while a rebase is in progress. */
  readonly rebaseInProgress: boolean;
  /** True while a cherry-pick is in progress. */
  readonly cherryPickInProgress: boolean;
  /** Paths with unmerged entries. */
  readonly conflictedPaths: readonly string[];
  /** Number of index-side changes. */
  readonly stagedCount: number;
  /** Number of tracked working-tree changes. */
  readonly unstagedCount: number;
  /** Number of untracked entries. */
  readonly untrackedCount: number;
  /** Configured commit identity. */
  readonly identity: GitIdentity;
  /** True when a permission or filesystem error is the dominant failure. */
  readonly permissionError: boolean;
  /** True when git reported that the directory is not a repository. */
  readonly notARepository: boolean;
  /** True while a mutation is running. */
  readonly operationRunning: boolean;
  /** True when the working tree changed outside the app and is not being watched. */
  readonly externalChanges: boolean;
  /** True when the repository exceeds the configured size thresholds. */
  readonly hugeRepository: boolean;
  /** True when the selected diff is binary or over the size limit. */
  readonly binaryOrOversized: boolean;
  /** True when a checkout was rejected because the working tree is dirty. */
  readonly checkoutDirty: boolean;
  /** True when the last commit or push failed in a hook. */
  readonly hookFailure: boolean;
  /** True when the last remote operation failed authentication or networking. */
  readonly authNetworkFailure: boolean;
  /** True when the configuration could not be read or was partially invalid. */
  readonly invalidConfig: boolean;
  /** True when the theme file could not be read or was partially invalid. */
  readonly invalidTheme: boolean;
}

/**
 * A normal snapshot of everything the shell reads from the repository.
 *
 * The snapshot is data only. State detection and gating consume `RepositorySignals`, and the
 * provider owns both values, so a feature never derives repository state itself.
 */
export interface RepositorySnapshot {
  /** Directory the app was launched from. */
  readonly cwd: string;
  /** Absolute work-tree root, or null when unavailable. */
  readonly root: string | null;
  /** Absolute git directory, or null when unavailable. */
  readonly gitDir: string | null;
  /** Short branch name, or null when detached. */
  readonly branch: string | null;
  /** HEAD commit id, or null in an unborn branch. */
  readonly headOid: string | null;
  /** HEAD commit subject, or null in an unborn branch or when the bounded read failed. */
  readonly headSubject: string | null;
  /** Abbreviated HEAD commit id for a detached HEAD. */
  readonly shortHash: string | null;
  /** True when HEAD is detached. */
  readonly detached: boolean;
  /** True when the repository is bare. */
  readonly bare: boolean;
  /** Configured remotes. */
  readonly remotes: readonly RemoteInfo[];
  /** Configured upstream ref, or null when the branch has none. */
  readonly upstream: string | null;
  /** Commits ahead of the upstream. */
  readonly ahead: number;
  /** Commits behind the upstream. */
  readonly behind: number;
  /** Canonical status snapshot, or null before the first read. */
  readonly status: StatusSnapshot | null;
  /** Every local branch, with its worktree attribution and upstream classification. */
  readonly branches: readonly BranchRecord[];
  /** Every remote-tracking branch, attributed to its configured remote. */
  readonly remoteBranches: readonly RemoteBranchRecord[];
  /** Every local tag. Remote tag knowledge lives in the provider, not the snapshot. */
  readonly tags: readonly TagRecord[];
  /** The stash list in git order, newest selector first. */
  readonly stashes: readonly StashRecord[];
  /** Every worktree known to the repository, with the current one marked. */
  readonly worktrees: readonly WorktreeRecord[];
  /** Absolute path of the worktree that contains the repository root, or null when unknown. */
  readonly currentWorktreePath: string | null;
  /** Configured commit identity. */
  readonly identity: GitIdentity;
  /** Clock value of the successful read, in milliseconds. */
  readonly readAt: number;
}

/**
 * Machine-readable reason a repository-wide gate blocks an action.
 *
 * These codes are stable and shared by the footer, palette, help, buttons, and confirmations. The
 * UI maps each code to its display text in one place.
 */
export type RepositoryGateReason =
  | "loading"
  | "not-a-repository"
  | "bare-repository"
  | "git-missing"
  | "permission-error"
  | "no-commits-yet"
  | "detached-head"
  | "no-remote"
  | "no-upstream"
  | "no-local-upstreams"
  | "upstream-gone"
  | "operation-in-progress"
  | "merge-in-progress"
  | "rebase-in-progress"
  | "cherry-pick-in-progress"
  | "missing-git-identity";

/** Result of a repository-wide availability gate. */
export interface RepositoryGateResult {
  /** True when the action may run. */
  readonly available: boolean;
  /** Stable blocked reason, present only when `available` is false. */
  readonly reason?: RepositoryGateReason;
}

/**
 * One repository-wide gate rule.
 *
 * A rule names the actions it applies to and the state condition that activates it. The rule table
 * is evaluated in order, so the first matching reason explains the block.
 */
export interface RepositoryGateRule {
  /** Machine-readable reason returned when the rule matches. */
  readonly reason: RepositoryGateReason;
  /** Actions the rule applies to. */
  readonly actions: ReadonlySet<string>;
  /** Reports whether the state activates the rule. */
  readonly applies: (state: RepositoryStateSnapshot, signals: RepositorySignals) => boolean;
}

/** Result of confirming a remote branch with `git ls-remote`. */
export type RemoteBranchCheck = "present" | "absent" | "unknown";

/**
 * Last known state of one remote's tag knowledge.
 *
 * `neverChecked` is the state of a configured remote whose tags were never read, `known` carries the
 * names a successful `git ls-remote --tags` advertised, and `failed` keeps the previous names while
 * stating that the latest attempt did not complete. Only `known` may prove that a tag is absent.
 */
export type RemoteTagCheckStatus = "known" | "neverChecked" | "failed";

/** One remote's last known tag set plus the time of the successful read that produced it. */
export interface RemoteTagCheck {
  /** Tag names the last successful read advertised, empty when never read. */
  readonly names: readonly string[];
  /** Clock value of the last successful read, or null when no read succeeded yet. */
  readonly checkedAt: number | null;
  /** Whether the names are current, unknown, or stale after a failed attempt. */
  readonly status: RemoteTagCheckStatus;
}

/** Last known tag knowledge per configured remote, keyed by remote name. */
export type RemoteTagChecks = Readonly<Record<string, RemoteTagCheck>>;

/**
 * Classification of the configured upstream branch.
 *
 * `gone` means the upstream ref is configured but absent locally, which is enough to gate `pull`
 * but not enough to claim the remote branch was deleted. Only `deleted-after-prune` and
 * `deleted-after-app-deletion` carry that claim, and `unknown` covers a failed or timed-out remote
 * check.
 */
export type UpstreamStatus =
  | "none"
  | "healthy"
  | "gone"
  | "deleted-after-prune"
  | "deleted-after-app-deletion"
  | "unknown";

/** Parsed upstream ref, split into the remote and branch it tracks. */
export interface UpstreamDescriptor {
  /** Full upstream ref such as `origin/main`. */
  readonly ref: string;
  /** Remote half of the ref. */
  readonly remote: string;
  /** Branch half of the ref. */
  readonly branch: string;
}

/** Evidence that decides how an absent upstream is classified. */
export interface UpstreamEvidence {
  /** Upstream refs a successful Fetch --prune confirmed absent. */
  readonly prunedRefs: readonly string[];
  /** Upstream refs a successful app-initiated remote branch deletion removed. */
  readonly appDeletedRefs: readonly string[];
  /** Upstream refs whose most recent remote check failed or timed out. */
  readonly unknownRefs: readonly string[];
}

/** Inputs to the pure upstream classification. */
export interface UpstreamClassificationInput {
  /** Configured upstream ref, or null when the branch has none. */
  readonly configuredRef: string | null;
  /** True when the configured ref exists as a local remote-tracking ref. */
  readonly refExists: boolean;
  /** Deletion and failure evidence from the current session. */
  readonly evidence: UpstreamEvidence;
}

/** Result of reading and classifying the upstream. */
export interface UpstreamReadResult {
  /** Classification used by the state machine, selectors, and gates. */
  readonly status: UpstreamStatus;
  /** Configured upstream ref, or null when none is configured. */
  readonly upstream: string | null;
  /** Parsed ref, or null when none is configured or it cannot be parsed. */
  readonly descriptor: UpstreamDescriptor | null;
}

/** Kind of remote interaction that proves a remote was reachable. */
export type RemoteCheckKind = "check" | "fetch";

/** Last successful remote interaction, per remote. */
export interface RemoteCheckRecord {
  /** Clock value of the last successful check, or null when never checked. */
  readonly lastSuccessfulCheckAt: number | null;
  /** Clock value of the last successful fetch, or null when never fetched. */
  readonly lastSuccessfulFetchAt: number | null;
}

/** Freshness of a remote derived from its last successful check or fetch. */
export type RemoteFreshness = "fresh" | "stale" | "unknown";

/**
 * Right-pane selection union.
 *
 * Selection is provider state keyed by stable identity, never by row index, so a refresh can keep
 * it. A diff-file selection is a highlight only and does not change the right-pane mode.
 */
export type RepositorySelection =
  | { readonly kind: "pending" }
  | { readonly kind: "commit"; readonly oid: string }
  | { readonly kind: "stash"; readonly objectName: string }
  | { readonly kind: "worktree"; readonly path: string }
  | {
      readonly kind: "diffFile";
      readonly section: string;
      readonly path: string;
      readonly oldPath?: string;
    };

/**
 * Status letter rendered on one diff file row.
 *
 * The letters follow the F-11 priority order `U`, `R`, `C`, `A`, `D`, `M`, then the untracked `?`
 * marker, so one row always shows the strongest applicable status when both sides changed.
 */
export type DiffStatusLetter = "M" | "A" | "D" | "R" | "C" | "U" | "?";

/**
 * One logical changed file in the diff panel.
 *
 * The row identity is the section plus the current path. A rename carries its pre-change path in
 * `oldPath` and remains one row, never one row per path.
 */
export interface DiffFileView {
  /** Stable row identity within the panel, `section::path`. */
  readonly id: string;
  /** Section that owns the row. */
  readonly section: DiffSection;
  /** Strongest status letter for the change. */
  readonly statusLetter: DiffStatusLetter;
  /** Status category used by the renderer. */
  readonly status: DiffFileStatus;
  /** Current path, root-relative. */
  readonly path: string;
  /** Pre-rename or pre-copy path, or null when the file is not a rename or copy. */
  readonly oldPath: string | null;
  /** True when the file is unmerged. */
  readonly conflicted: boolean;
}

/**
 * One section of the diff panel derived from the status snapshot.
 *
 * `paths` is exactly the section's own path set: each row's current path plus its pre-rename path,
 * with duplicates removed. It is never a whole-tree set, so a bulk action built from it can only
 * touch that section.
 */
export interface DiffSectionView {
  /** Section identity. */
  readonly section: DiffSection;
  /** Section title shown in the header. */
  readonly title: string;
  /** Logical changed files in status order. */
  readonly files: readonly DiffFileView[];
  /** Literal section path set, including both paths of a rename. */
  readonly paths: readonly string[];
}

/**
 * Refs that point at one commit, grouped for the details badge row.
 *
 * Groups keep the documented render order: tags first, then local branches, then remote-tracking
 * branches. Each label is unique inside its group.
 */
export interface CommitRefGroups {
  /** Tag names without the `refs/tags/` prefix. */
  readonly tags: readonly string[];
  /** Local branch names without the `refs/heads/` prefix. */
  readonly local: readonly string[];
  /** Remote-tracking branch labels as `<remote>/<branch>`. */
  readonly remote: readonly string[];
}

/** Pending change counts derived from the canonical status snapshot. */
export interface PendingCounts {
  /** Entries with an index-side change. */
  readonly staged: number;
  /** Tracked entries with a working-tree change. */
  readonly unstaged: number;
  /** Untracked entries. */
  readonly untracked: number;
  /** Staged plus unstaged, the count shown on the Pending Changes row. */
  readonly total: number;
}

/** Branch label shown in the top bar and branch rows. */
export interface BranchDisplay {
  /** Branch name, or the abbreviated hash for a detached HEAD, or a loading placeholder. */
  readonly label: string;
  /** True when HEAD is detached. */
  readonly detached: boolean;
  /** Abbreviated hash shown for a detached HEAD. */
  readonly shortHash: string | null;
}

/** Upstream label and status shown next to the branch. */
export interface UpstreamDisplay {
  /** Upstream classification. */
  readonly status: UpstreamStatus;
  /** Text shown next to the branch; never only a marker. */
  readonly label: string;
  /** True when the label describes a missing or unconfirmed upstream. */
  readonly indicatesMissing: boolean;
}

/** Sync relationship between the current branch and its upstream. */
export type SyncState =
  | "up-to-date"
  | "ahead"
  | "behind"
  | "diverged"
  | "no-upstream"
  | "upstream-gone";

/** Repository state text for the top bar and the M5 banner. */
export interface RepositoryStateDisplay {
  /** Exclusive primary state. */
  readonly primary: RepositoryPrimaryState;
  /** Active flags, in detection order. */
  readonly flags: readonly RepositoryFlag[];
  /** Human-readable state text such as `not a git repository` or `merge in progress`. */
  readonly label: string;
}

/** Everything the placeholder top bar needs, derived in one place. */
export interface RepositoryView {
  /** True until the first read settles. */
  readonly loading: boolean;
  /** Branch label. */
  readonly branch: BranchDisplay;
  /** Upstream label. */
  readonly upstream: UpstreamDisplay;
  /** Commits ahead of the upstream. */
  readonly ahead: number;
  /** Commits behind the upstream. */
  readonly behind: number;
  /** Sync relationship derived from the upstream status and the ahead/behind counts. */
  readonly sync: SyncState;
  /** Pending change counts. */
  readonly pending: PendingCounts;
  /** Repository state text. */
  readonly state: RepositoryStateDisplay;
}

/** Options for `readRepositorySnapshot`. */
export interface RepositoryReadOptions {
  /** Directory the app was launched from. */
  readonly cwd: string;
  /** Cancellation signal. */
  readonly signal: AbortSignal;
  /** Clock used for the read timestamp. */
  readonly now: () => number;
  /** Upstream deletion and failure evidence collected this session. */
  readonly evidence: UpstreamEvidence;
}

/**
 * Name of one optional snapshot ref list.
 *
 * These lists are read in the same snapshot as the required status and remote list, but a failure in
 * one of them never fails the whole read, so a corrupt stash reflog cannot freeze the branch and
 * working-tree facts.
 */
export type RepositoryListName = "branches" | "remoteBranches" | "tags" | "stashes" | "worktrees";

/**
 * Classified failure message per optional ref list.
 *
 * A list absent from the record was read successfully. A present entry describes only that list: the
 * provider keeps its previous snapshot value for the failed field and every panel can name its own
 * failing list instead of reporting a global refresh error.
 */
export type RepositoryListFailures = Readonly<Partial<Record<RepositoryListName, string>>>;

/** One commit that exists on a branch but not on the base the deletion compares against. */
export interface BranchRiskCommit {
  /** Full commit id. */
  readonly oid: string;
  /** Commit subject. */
  readonly subject: string;
}

/**
 * Result of the capped at-risk commit read used by the unmerged-branch acknowledgement.
 *
 * `commits` lists only the commits the base does not contain, newest first. An empty successful
 * read means the base already contains the branch, so `merged` is true. A failed read returns an
 * empty list, `merged: null`, and an `error`, so a caller can explain that the merge state is
 * unknown and still offer the force acknowledgement instead of silently dropping it.
 */
export interface BranchRiskRead {
  /** Up to the capped number of commits the base does not contain, empty on success with none. */
  readonly commits: readonly BranchRiskCommit[];
  /** True when the base contains the branch, false when it does not, null when unreadable. */
  readonly merged: boolean | null;
  /** True when the read hit its cap and older commits at risk are not listed. */
  readonly hasMore: boolean;
  /** Classified error message, or null when the read succeeded. */
  readonly error: string | null;
}

/** Result of one repository snapshot read. */
export interface RepositoryReadResult {
  /** True when every required read succeeded. */
  readonly ok: boolean;
  /** Snapshot on success, or null when the read failed or no repository exists. */
  readonly snapshot: RepositorySnapshot | null;
  /** Signals built from the read, always complete. */
  readonly signals: RepositorySignals;
  /** Classified failure per optional ref list, empty when every list was read successfully. */
  readonly listFailures: RepositoryListFailures;
  /** Upstream classification read with the snapshot. */
  readonly upstreamStatus: UpstreamStatus;
  /** True when the configured git executable could be started. */
  readonly gitAvailable: boolean;
  /** Classified error message, or null on success. */
  readonly error: string | null;
  /** Classified failure kind that produced the failed result, or null on success. */
  readonly failureKind: GitFailureKind | null;
}
