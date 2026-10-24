import type {
  RepositoryStore,
  RepositoryWatcherInput,
} from "@/app/providers/RepositoryProvider.types";
import type { GitWatcher, GitWatchMode, GitWatchStatus } from "@/domain/git/git.types";
import { createRepositorySignals } from "@/domain/repository/repository.states";
import type {
  RemoteCheckKind,
  RemoteCheckRecord,
  RepositoryReadResult,
  RepositorySelection,
  RepositorySignals,
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
 * read can never become `not-a-repository` or `empty`. A successful read replaces the snapshot
 * exactly, including the null snapshot of a bare or non-repository directory, and merges remote
 * check records by name so their timestamps survive a refresh.
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
    snapshot: result.snapshot,
    signals: { ...result.signals, operationRunning },
    upstreamStatus: result.upstreamStatus,
    remoteChecks: mergeRemoteChecks(previous.remoteChecks, result.signals.remotes),
    lastRefreshError: null,
  };
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
