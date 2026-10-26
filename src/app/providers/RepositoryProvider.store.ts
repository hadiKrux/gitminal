import type {
  RepositoryStore,
  RepositoryWatcherInput,
} from "@/app/providers/RepositoryProvider.types";
import type {
  BranchRecord,
  GitWatcher,
  GitWatchMode,
  GitWatchStatus,
  WorktreeRecord,
} from "@/domain/git/git.types";
import { applyWorktreePaths } from "@/domain/repository/repository.refs";
import { createRepositorySignals } from "@/domain/repository/repository.states";
import type {
  RemoteCheckKind,
  RemoteCheckRecord,
  RemoteTagCheck,
  RemoteTagChecks,
  RepositoryListFailures,
  RepositoryReadResult,
  RepositorySelection,
  RepositorySignals,
  RepositorySnapshot,
} from "@/domain/repository/repository.types";

/**
 * Builds the initial store before the first read.
 *
 * @param cwd - Launch directory.
 * @param selection - Initial selection.
 * @param worktreeWatch - Whether worktree watching is enabled.
 * @returns The initial store.
 */
export function createInitialStore(
  cwd: string,
  selection: RepositorySelection,
  worktreeWatch: boolean,
): RepositoryStore {
  return {
    snapshot: null,
    signals: createRepositorySignals({ cwd }),
    selection,
    generation: 0,
    watch: createInactiveWatch(worktreeWatch),
    remoteChecks: {},
    remoteTagChecks: {},
    listFailures: {},
    lastRefreshError: null,
    upstreamStatus: "none",
    statusInFlight: false,
    graphInFlight: false,
    refreshing: false,
  };
}

/**
 * Builds an inactive watch status for the configured mode.
 *
 * @param worktreeWatch - Whether worktree watching is enabled.
 * @returns The inactive status.
 */
export function createInactiveWatch(worktreeWatch: boolean): GitWatchStatus {
  return {
    watching: false,
    mode: worktreeWatch ? "worktree" : "git-dir",
    path: null,
    recursive: false,
    limitation: worktreeWatch ? "worktree watch off; press r after external edits" : null,
  };
}

/**
 * Applies one read result to the store.
 *
 * A failed read keeps the previous snapshot and records the message. A genuine environment failure
 * (`missing-git`, `permission`) updates the signals that decide the whole-shell state; a transient or
 * unresolved failure keeps the previous signals so a cancelled, timed-out, auth-network, or unknown
 * read can never become `not-a-repository` or `empty`.
 *
 * A successful read replaces the snapshot, including the null snapshot of a bare or non-repository
 * directory, and merges remote check records by name so their timestamps survive a refresh. Optional
 * ref lists are applied one by one: every successfully read list is replaced, a list named in
 * `listFailures` keeps the previous snapshot's value, and the failure map itself is stored so a panel
 * can name only its own failing list. A retained worktree list re-derives the branch worktree paths
 * on the newly read branch rows. A fully successful read therefore clears the map.
 *
 * @param previous - Current store.
 * @param result - Read result.
 * @param operationRunning - True while a mutation holds the runner latch.
 * @returns The next store.
 */
export function applyReadToStore(
  previous: RepositoryStore,
  result: RepositoryReadResult,
  operationRunning: boolean,
): RepositoryStore {
  if (!result.ok) {
    const environmentFailure =
      result.failureKind === "missing-git" ||
      result.failureKind === "permission" ||
      result.failureKind === "not-a-repository";
    const signals: RepositorySignals =
      environmentFailure || previous.snapshot === null
        ? { ...result.signals, operationRunning }
        : { ...previous.signals, operationRunning };

    return {
      ...previous,
      signals,
      lastRefreshError: result.error ?? "repository read failed",
    };
  }

  return {
    ...previous,
    snapshot: keepFailedLists(previous.snapshot, result.snapshot, result.listFailures),
    signals: { ...result.signals, operationRunning },
    upstreamStatus: result.upstreamStatus,
    remoteChecks: mergeRemoteChecks(previous.remoteChecks, result.signals.remotes),
    remoteTagChecks: mergeRemoteTagChecks(previous.remoteTagChecks, result.signals.remotes),
    listFailures: result.listFailures,
    lastRefreshError: null,
  };
}

/**
 * Keeps the previous snapshot's value for every optional list that failed to read.
 *
 * A first successful read has no previous snapshot, so the empty values of the failed lists stand.
 * When the worktree list is kept, its current-worktree path is kept with it, because the two describe
 * the same read. Branch worktree attribution is derived from the worktree list, so whenever either
 * list fails the branch rows are re-derived from the worktrees this snapshot stores. A failed
 * worktree read therefore keeps the marker and guard aligned with the retained worktrees, and a
 * failed branch read keeps them aligned with the newly read worktrees instead of the stale paths on
 * the retained branch rows.
 *
 * @param previous - Snapshot before this read, or null before the first successful read.
 * @param next - Snapshot produced by this read, or null outside a work tree.
 * @param failures - Optional lists that failed in this read.
 * @returns The snapshot to store.
 */
function keepFailedLists(
  previous: RepositorySnapshot | null,
  next: RepositorySnapshot | null,
  failures: RepositoryListFailures,
): RepositorySnapshot | null {
  if (previous === null || next === null) {
    return next;
  }

  const worktreesFailed = failures.worktrees !== undefined;
  const branchesFailed = failures.branches !== undefined;
  const branches = keepListedValue(failures.branches, next.branches, previous.branches);
  const worktrees = keepListedValue(failures.worktrees, next.worktrees, previous.worktrees);

  return {
    ...next,
    branches:
      worktreesFailed || branchesFailed ? rederiveWorktreePaths(branches, worktrees) : branches,
    remoteBranches: keepListedValue(
      failures.remoteBranches,
      next.remoteBranches,
      previous.remoteBranches,
    ),
    tags: keepListedValue(failures.tags, next.tags, previous.tags),
    stashes: keepListedValue(failures.stashes, next.stashes, previous.stashes),
    worktrees,
    currentWorktreePath: worktreesFailed ? previous.currentWorktreePath : next.currentWorktreePath,
  };
}

/**
 * Re-derives branch worktree paths from the worktrees this snapshot stores.
 *
 * Every existing path is cleared first, so a branch that no longer appears in the worktree list
 * loses a path retained by an earlier read instead of keeping stale attribution.
 *
 * @param branches - Branch rows this snapshot keeps.
 * @param worktrees - Worktrees this snapshot stores.
 * @returns New branch rows with `worktreePath` resolved only from the supplied worktrees.
 */
function rederiveWorktreePaths(
  branches: readonly BranchRecord[],
  worktrees: readonly WorktreeRecord[],
): readonly BranchRecord[] {
  const cleared = branches.map((branch) =>
    branch.worktreePath === null ? branch : { ...branch, worktreePath: null },
  );

  return applyWorktreePaths(cleared, worktrees);
}

/**
 * Chooses the value a list keeps after one read.
 *
 * A list absent from the failure map read successfully and contributes this read's value; a list
 * named there failed and keeps the previous snapshot's value.
 *
 * @param failure - Failure message for this list, or undefined when it read successfully.
 * @param next - Value produced by this read.
 * @param previous - Value from the previous snapshot.
 * @returns The value to store for this list.
 */
function keepListedValue<T>(
  failure: string | undefined,
  next: readonly T[],
  previous: readonly T[],
): readonly T[] {
  return failure === undefined ? next : previous;
}

/**
 * Creates the provider watcher, or null when watching cannot start.
 *
 * The watcher starts only after a successful read reported a git directory, so a missing or
 * non-repository directory never leaves a watcher behind.
 *
 * @param input - Snapshot, paths, mode, factory, and refresh callback.
 * @returns The unstarted watcher, or null.
 */
export function createRepositoryWatcher(input: RepositoryWatcherInput): GitWatcher | null {
  const gitDir = input.gitDir;

  if (!input.enableWatcher || gitDir === null) {
    return null;
  }

  const mode: GitWatchMode = input.worktreeWatch ? "worktree" : "git-dir";

  return input.factory({
    gitDir,
    mode,
    worktreePath: mode === "worktree" ? (input.root ?? input.cwd) : null,
    debounceMs: input.debounceMs,
    onRefresh: input.onRefresh,
    onStatus: input.onStatus,
  });
}

/**
 * Keeps timestamps for remotes that still exist and adds new remotes.
 *
 * @param previous - Existing records.
 * @param remotes - Configured remote names.
 * @returns The merged records.
 */
function mergeRemoteChecks(
  previous: Readonly<Record<string, RemoteCheckRecord>>,
  remotes: readonly string[],
): Readonly<Record<string, RemoteCheckRecord>> {
  const next: Record<string, RemoteCheckRecord> = {};

  for (const remote of remotes) {
    next[remote] = previous[remote] ?? { lastSuccessfulCheckAt: null, lastSuccessfulFetchAt: null };
  }

  return next;
}

/**
 * Updates one remote record with a successful interaction.
 *
 * @param record - Existing record, when any.
 * @param kind - Check or fetch.
 * @param at - Success timestamp.
 * @returns The updated record.
 */
export function updateRemoteCheck(
  record: RemoteCheckRecord | undefined,
  kind: RemoteCheckKind,
  at: number,
): RemoteCheckRecord {
  const current = record ?? { lastSuccessfulCheckAt: null, lastSuccessfulFetchAt: null };

  return kind === "fetch"
    ? { ...current, lastSuccessfulFetchAt: at }
    : { ...current, lastSuccessfulCheckAt: at };
}

/**
 * Keeps tag knowledge for remotes that still exist and seeds new remotes as never checked.
 *
 * A read must never turn a failed or never-run check into an empty known set, so a record that
 * already exists keeps its names, timestamp, and status. Only a remote the store has never seen
 * starts at `neverChecked`, which is the state the tags panel renders while it waits for its first
 * `ls-remote` read.
 *
 * @param previous - Existing tag knowledge.
 * @param remotes - Configured remote names.
 * @returns The merged tag knowledge for the configured remotes only.
 */
function mergeRemoteTagChecks(
  previous: RemoteTagChecks,
  remotes: readonly string[],
): RemoteTagChecks {
  const next: Record<string, RemoteTagCheck> = {};

  for (const remote of remotes) {
    next[remote] = previous[remote] ?? createNeverCheckedTags();
  }

  return next;
}

/**
 * Builds the tag knowledge of a remote that has never been read.
 *
 * @returns A frozen never-checked record.
 */
function createNeverCheckedTags(): RemoteTagCheck {
  return Object.freeze({ names: Object.freeze([]), checkedAt: null, status: "neverChecked" });
}

/**
 * Compares two selections by their stable identity.
 *
 * @param left - First selection.
 * @param right - Second selection.
 * @returns True when they select the same item.
 */
export function selectionsEqual(left: RepositorySelection, right: RepositorySelection): boolean {
  return selectionKey(left) === selectionKey(right);
}

/**
 * Builds a stable identity key for one selection.
 *
 * @param selection - Selection value.
 * @returns A key that changes only when the selected item changes.
 */
function selectionKey(selection: RepositorySelection): string {
  switch (selection.kind) {
    case "pending":
      return "pending";
    case "commit":
      return `commit:${selection.oid}`;
    case "stash":
      return `stash:${selection.objectName}`;
    case "worktree":
      return `worktree:${selection.path}`;
    case "diffFile":
      return `diff:${selection.section}:${selection.path}:${selection.oldPath ?? ""}`;
  }
}
