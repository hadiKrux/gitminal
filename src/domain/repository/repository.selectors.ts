import type { GraphScope } from "@/domain/config/config.types";
import type { DiffFileStatus, DiffSection } from "@/domain/diff/diff.types";
import { groupByRemote } from "@/domain/git/git.remote-branches";
import { sortStashesNewestFirst } from "@/domain/git/git.stashes";
import { mergeTagScopes, sortTagsVersionDesc } from "@/domain/git/git.tags";
import type {
  BranchRecord,
  FileChangeKind,
  StashRecord,
  StatusEntry,
  TagRowRecord,
  WorktreeRecord,
} from "@/domain/git/git.types";
import { buildWorktreeBranchMap } from "@/domain/git/git.worktrees";
import type {
  BranchDisplay,
  CommitRefGroups,
  DiffFileView,
  DiffSectionView,
  DiffStatusLetter,
  PendingCounts,
  RemoteBranchRow,
  RemoteCheckRecord,
  RemoteFreshness,
  RemoteTagChecks,
  RepositoryFlag,
  RepositoryPrimaryState,
  RepositorySelection,
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

/** Prefix of a fully decorated tag ref. */
const TAG_REF_PREFIX = "refs/tags/";

/** Prefix of a fully decorated local branch ref. */
const LOCAL_BRANCH_PREFIX = "refs/heads/";

/** Prefix of a fully decorated remote-tracking branch ref. */
const REMOTE_BRANCH_PREFIX = "refs/remotes/";

/** Prefix git adds to an annotated tag decoration. */
const TAG_DECORATION_PREFIX = "tag: ";

/** A detached HEAD decoration names no branch, so it produces no badge. */
const HEAD_DECORATION = "HEAD";

/** Separator git uses between a symbolic ref and its target in a decoration. */
const SYMBOLIC_REF_SEPARATOR = " -> ";

/**
 * Collects the refs that point at one commit.
 *
 * The commit's own `--decorate=full` entries are combined with the repository snapshot, so a badge
 * row is complete even when a snapshot ref list was retained after a failed refresh and a ref is
 * still visible in the decoration output. Snapshot order comes first because it is stable across
 * refreshes; decoration-only entries follow in git order. A label is unique inside its group.
 *
 * @param snapshot - Current snapshot, or null before the first read.
 * @param oid - Commit the refs must point at.
 * @param decorations - Raw `%D` entries from the commit details read.
 * @returns Tags, local branches, and remote-tracking branches in render order.
 */
export function selectCommitRefs(
  snapshot: RepositorySnapshot | null,
  oid: string,
  decorations: readonly string[],
): CommitRefGroups {
  const tags = new Set<string>();
  const local = new Set<string>();
  const remote = new Set<string>();
  const remoteNames = (snapshot?.remotes ?? []).map((entry) => entry.name);

  for (const tag of snapshot?.tags ?? []) {
    if (tag.targetOid === oid) {
      tags.add(tag.name);
    }
  }

  for (const branch of snapshot?.branches ?? []) {
    if (branch.tipOid === oid) {
      local.add(branch.name);
    }
  }

  for (const branch of snapshot?.remoteBranches ?? []) {
    if (branch.tipOid === oid) {
      remote.add(`${branch.remote}/${branch.branch}`);
    }
  }

  for (const decoration of decorations) {
    classifyCommitDecoration(decoration, remoteNames, tags, local, remote);
  }

  return { tags: [...tags], local: [...local], remote: [...remote] };
}

/**
 * Classifies one fully qualified decoration entry into its badge group.
 *
 * A symbolic entry such as `HEAD -> refs/heads/main` is classified by its target. A plain `HEAD`
 * entry is skipped because a detached HEAD is not a branch badge. The `tag: ` prefix git adds to
 * annotated tag entries is removed before classification.
 *
 * @param decoration - Raw decoration entry.
 * @param remoteNames - Configured remote names, used to split a remote ref unambiguously.
 * @param tags - Tag label set to add to.
 * @param local - Local branch label set to add to.
 * @param remote - Remote branch label set to add to.
 */
function classifyCommitDecoration(
  decoration: string,
  remoteNames: readonly string[],
  tags: Set<string>,
  local: Set<string>,
  remote: Set<string>,
): void {
  const ref = readDecorationRef(decoration);

  if (ref === null) {
    return;
  }

  if (ref.startsWith(TAG_REF_PREFIX)) {
    tags.add(ref.slice(TAG_REF_PREFIX.length));
    return;
  }

  if (ref.startsWith(LOCAL_BRANCH_PREFIX)) {
    local.add(ref.slice(LOCAL_BRANCH_PREFIX.length));
    return;
  }

  if (ref.startsWith(REMOTE_BRANCH_PREFIX)) {
    const label = readRemoteBadge(ref.slice(REMOTE_BRANCH_PREFIX.length), remoteNames);

    if (label !== null) {
      remote.add(label);
    }
  }
}

/**
 * Reads the ref one decoration entry points at.
 *
 * @param decoration - Raw decoration entry.
 * @returns The fully qualified ref, or null for an entry with no classifiable ref.
 */
function readDecorationRef(decoration: string): string | null {
  const value = decoration.trim();

  if (value.length === 0 || value === HEAD_DECORATION) {
    return null;
  }

  const arrowIndex = value.indexOf(SYMBOLIC_REF_SEPARATOR);
  const target = arrowIndex >= 0 ? value.slice(arrowIndex + SYMBOLIC_REF_SEPARATOR.length) : value;
  const trimmed = target.trim();

  return trimmed.startsWith(TAG_DECORATION_PREFIX)
    ? trimmed.slice(TAG_DECORATION_PREFIX.length).trim()
    : trimmed;
}

/**
 * Builds the badge label of one remote-tracking ref.
 *
 * A remote name may contain a slash, so the configured names are matched longest first instead of
 * splitting at the first slash. An unknown remote keeps its full `remote/branch` path.
 *
 * @param path - Ref path after `refs/remotes/`.
 * @param remoteNames - Configured remote names.
 * @returns The `<remote>/<branch>` label, or null when the path has no branch.
 */
function readRemoteBadge(path: string, remoteNames: readonly string[]): string | null {
  if (path.length === 0) {
    return null;
  }

  const longestFirst = [...remoteNames].sort((left, right) => right.length - left.length);

  for (const name of longestFirst) {
    if (path.startsWith(`${name}/`) && path.length > name.length + 1) {
      return `${name}/${path.slice(name.length + 1)}`;
    }
  }

  return path.includes("/") ? path : null;
}

/**
 * Reports whether the right-pane selection makes the diff surface read-only.
 *
 * A commit or stash selection shows a historical diff, so every mutation over it must be refused by
 * the domain availability check rather than by a caller-supplied form flag. This is the single
 * predicate used by availability, the command runner, and the diff feature, so a future read-only
 * selection kind is classified in one place.
 *
 * @param selection - Current right-pane selection.
 * @returns True for a commit or stash selection.
 */
export function isReadOnlySelection(selection: RepositorySelection): boolean {
  return selection.kind === "commit" || selection.kind === "stash";
}

/**
 * Reports whether the right pane currently renders the commit composer.
 *
 * The pending changes row and the diff-file fallback both keep the composer mounted, while commit,
 * stash, and worktree details replace it. `commit.focus` and its availability check read this one
 * predicate, so the action is never advertised or dispatched at a textarea that is not on screen.
 *
 * @param selection - Current right-pane selection.
 * @returns True when the composer is the mounted right-pane surface.
 */
export function selectComposerVisible(selection: RepositorySelection): boolean {
  return selection.kind === "pending" || selection.kind === "diffFile";
}

/**
 * Reads the commit tips that start a graph scope.
 *
 * The graph cursor seeds its frontier with these OIDs so a tip that is not among the first page is
 * still walked. `all` covers local and remote-tracking branch tips plus HEAD, `local` covers local
 * branch tips plus HEAD, and `current` covers HEAD. An empty OID is skipped, and a commit named by
 * more than one ref appears once. The list is plain data, so the domain paginator never reads
 * repository state itself.
 *
 * @param snapshot - Current snapshot, or null before the first read.
 * @param scope - Configured graph scope.
 * @returns Deduplicated tip OIDs in snapshot order.
 */
export function selectGraphScopeTips(
  snapshot: RepositorySnapshot | null,
  scope: GraphScope,
): readonly string[] {
  if (snapshot === null) {
    return [];
  }

  const tips: string[] = [];

  const addTip = (oid: string | null): void => {
    if (oid !== null && oid.length > 0 && !tips.includes(oid)) {
      tips.push(oid);
    }
  };

  if (scope === "all" || scope === "local") {
    for (const branch of snapshot.branches) {
      addTip(branch.tipOid);
    }
  }

  if (scope === "all") {
    for (const branch of snapshot.remoteBranches) {
      addTip(branch.tipOid);
    }
  }

  addTip(snapshot.headOid);

  return tips;
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

/** Section titles in panel order. */
const DIFF_SECTION_TITLES: Readonly<Record<DiffSection, string>> = Object.freeze({
  working: "Working Directory",
  staged: "Staged Files",
  untracked: "Untracked Files",
});

/** Section render order enforced by F-11. */
const DIFF_SECTION_ORDER: readonly DiffSection[] = Object.freeze([
  "working",
  "staged",
  "untracked",
]);

/** Status letter for every change kind, with null for a side that changed nothing. */
const CHANGE_KIND_LETTERS: Readonly<Record<FileChangeKind, DiffStatusLetter | null>> =
  Object.freeze({
    unmodified: null,
    modified: "M",
    added: "A",
    deleted: "D",
    renamed: "R",
    copied: "C",
    "type-changed": "M",
    untracked: "?",
    ignored: null,
    conflicted: "U",
  });

/** Letters in strongest-first order. */
const STATUS_LETTER_PRIORITY: readonly DiffStatusLetter[] = Object.freeze([
  "U",
  "R",
  "C",
  "A",
  "D",
  "M",
  "?",
]);

/**
 * Derives the three diff sections from the canonical status snapshot.
 *
 * Working Directory holds tracked entries with a working-tree change, including unmerged entries;
 * Staged Files holds entries with an index-side change; Untracked Files holds untracked entries.
 * Sections always appear in F-11 order. A rename is one row carrying both paths, and its old path is
 * removed from the section so a status form that lists the rename pair twice never renders two rows.
 * The returned path sets are scoped to the section and include both rename paths; no whole-tree set
 * is ever produced.
 *
 * @param snapshot - Current snapshot, or null before the first read.
 * @returns The three sections in order, each with its files and literal path set.
 */
export function selectDiffSections(
  snapshot: RepositorySnapshot | null,
): readonly DiffSectionView[] {
  const entries = (snapshot?.status?.entries ?? []).filter((entry) => !isIgnoredEntry(entry));

  return DIFF_SECTION_ORDER.map((section) =>
    buildDiffSectionView(
      section,
      entries.filter((entry) => belongsToSection(entry, section)),
    ),
  );
}

/**
 * Builds one section view from the entries that belong to it.
 *
 * @param section - Section identity.
 * @param entries - Entries classified into the section, in status order.
 * @returns The section with deduplicated rows and its scoped path set.
 */
function buildDiffSectionView(
  section: DiffSection,
  entries: readonly StatusEntry[],
): DiffSectionView {
  const renamedAway = collectRenamedAwayPaths(entries);
  const seenPaths = new Set<string>();
  const files: DiffFileView[] = [];

  for (const entry of entries) {
    if (renamedAway.has(entry.path) || seenPaths.has(entry.path)) {
      continue;
    }

    seenPaths.add(entry.path);
    files.push(toDiffFileView(section, entry));
  }

  return {
    section,
    title: DIFF_SECTION_TITLES[section],
    files,
    paths: collectSectionPaths(files),
  };
}

/**
 * Converts one status entry into a diff row.
 *
 * @param section - Section that owns the row.
 * @param entry - Status entry.
 * @returns The row view.
 */
function toDiffFileView(section: DiffSection, entry: StatusEntry): DiffFileView {
  const statusLetter = readStatusLetter(entry);

  return {
    id: `${section}::${entry.path}`,
    section,
    statusLetter,
    status: readStatusCategory(statusLetter),
    path: entry.path,
    oldPath: entry.originalPath,
    conflicted: isConflictEntry(entry),
  };
}

/**
 * Collects pre-rename paths that no longer exist as rows.
 *
 * Only a rename removes its source; a copy keeps both files, so its source stays a row.
 *
 * @param entries - Entries of one section.
 * @returns The paths replaced by a rename.
 */
function collectRenamedAwayPaths(entries: readonly StatusEntry[]): ReadonlySet<string> {
  const paths = new Set<string>();

  for (const entry of entries) {
    if (entry.kind === "renamed" && entry.originalPath !== null) {
      paths.add(entry.originalPath);
    }
  }

  return paths;
}

/**
 * Builds the section's own literal path set.
 *
 * @param files - Rows of the section.
 * @returns Each current path plus its pre-rename path, deduplicated in row order.
 */
function collectSectionPaths(files: readonly DiffFileView[]): readonly string[] {
  const paths: string[] = [];

  for (const file of files) {
    if (file.oldPath !== null && !paths.includes(file.oldPath)) {
      paths.push(file.oldPath);
    }

    if (!paths.includes(file.path)) {
      paths.push(file.path);
    }
  }

  return paths;
}

/**
 * Reports whether one entry belongs to a section.
 *
 * An unmerged entry belongs to Working Directory only, because it has no stage-0 index state to
 * unstage. An untracked entry belongs to Untracked Files only. Every other entry can appear in both
 * Working Directory and Staged Files when both sides changed, because each section compares a
 * different side.
 *
 * @param entry - Status entry.
 * @param section - Candidate section.
 * @returns True when the entry belongs to that section.
 */
function belongsToSection(entry: StatusEntry, section: DiffSection): boolean {
  if (isIgnoredEntry(entry)) {
    return false;
  }

  if (isUntrackedEntry(entry)) {
    return section === "untracked";
  }

  if (isConflictEntry(entry)) {
    return section === "working";
  }

  if (section === "working") {
    return entry.worktree !== "unmodified";
  }

  return section === "staged" ? entry.index !== "unmodified" : false;
}

/**
 * Reports whether one entry is an untracked record.
 *
 * @param entry - Status entry.
 * @returns True for an untracked file.
 */
function isUntrackedEntry(entry: StatusEntry): boolean {
  return entry.kind === "untracked" || entry.worktree === "untracked";
}

/**
 * Reports whether one entry is unmerged.
 *
 * @param entry - Status entry.
 * @returns True for a conflicted file.
 */
function isConflictEntry(entry: StatusEntry): boolean {
  return (
    entry.kind === "unmerged" || entry.index === "conflicted" || entry.worktree === "conflicted"
  );
}

/**
 * Reports whether one entry is an ignored record that the panel never renders.
 *
 * @param entry - Status entry.
 * @returns True for an ignored file.
 */
function isIgnoredEntry(entry: StatusEntry): boolean {
  return entry.kind === "ignored" || entry.worktree === "ignored";
}

/**
 * Reads the strongest status letter for an entry.
 *
 * @param entry - Status entry.
 * @returns The highest-priority letter across the record kind and both sides.
 */
function readStatusLetter(entry: StatusEntry): DiffStatusLetter {
  if (isUntrackedEntry(entry)) {
    return "?";
  }

  const candidates = [
    changeKindToLetter(entry.index),
    changeKindToLetter(entry.worktree),
    entry.kind === "renamed" ? "R" : null,
    entry.kind === "copied" ? "C" : null,
    isConflictEntry(entry) ? "U" : null,
  ].filter((letter): letter is DiffStatusLetter => letter !== null);

  return STATUS_LETTER_PRIORITY.find((letter) => candidates.includes(letter)) ?? "M";
}

/**
 * Maps one change kind to its status letter.
 *
 * The lookup is exhaustive over `FileChangeKind`, so a new kind fails to compile until it has a
 * letter.
 *
 * @param kind - Index or working-tree change kind.
 * @returns The matching letter, or null when the side is unmodified.
 */
function changeKindToLetter(kind: FileChangeKind): DiffStatusLetter | null {
  return CHANGE_KIND_LETTERS[kind];
}

/**
 * Maps a status letter to the renderer's status category.
 *
 * @param letter - Strongest status letter.
 * @returns The matching `DiffFileStatus`.
 */
function readStatusCategory(letter: DiffStatusLetter): DiffFileStatus {
  switch (letter) {
    case "U":
      return "conflicted";
    case "R":
      return "renamed";
    case "C":
      return "copied";
    case "A":
    case "?":
      return "added";
    case "D":
      return "deleted";
    case "M":
      return "modified";
  }
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
 * Projects remote groups using the single domain ordering shared by the sidebar and feature search.
 * Tip commit committer dates sort newest first within each remote; names break ties, with unknown dates last.
 * Local tracking is derived only from exact upstream remote/branch pairs, independent of checkout or local name.
 * @param snapshot - Current snapshot, or null before the first read.
 * @returns Groups ordered by remote name, each with branches ordered by commit date descending then name.
 */
export function selectRemoteBranchGroups(snapshot: RepositorySnapshot | null): readonly {
  readonly remote: string;
  readonly branches: readonly RemoteBranchRow[];
}[] {
  const trackedBranches = new Map<string, Set<string>>();

  for (const branch of snapshot?.branches ?? []) {
    if (branch.upstreamRemote === null || branch.upstreamBranch === null) {
      continue;
    }

    const names = trackedBranches.get(branch.upstreamRemote) ?? new Set<string>();
    names.add(branch.upstreamBranch);
    trackedBranches.set(branch.upstreamRemote, names);
  }

  return groupByRemote(snapshot?.remoteBranches ?? []).map((group) => ({
    remote: group.remote,
    branches: group.branches.map((branch) => ({
      ...branch,
      hasLocalTracker: trackedBranches.get(group.remote)?.has(branch.branch) ?? false,
    })),
  }));
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
