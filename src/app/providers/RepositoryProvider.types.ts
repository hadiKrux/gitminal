import type { ReactNode } from "react";
import type {
  CommandAvailability,
  CommandRegion,
  CommandTarget,
} from "@/domain/commands/commands.types";
import type { GitClient, GitWatcherFactory, GitWatchStatus } from "@/domain/git/git.types";
import type {
  RemoteCheckKind,
  RemoteCheckRecord,
  RepositorySelection,
  RepositorySignals,
  RepositorySnapshot,
  RepositoryStateSnapshot,
  UpstreamStatus,
} from "@/domain/repository/repository.types";

/** Result of one refresh request. */
export interface RepositoryRefreshResult {
  /** True when the read succeeded. */
  readonly ok: boolean;
  /** True when the caller joined an in-flight read instead of starting another. */
  readonly coalesced: boolean;
  /** Classified error message, or null on success. */
  readonly error: string | null;
  /** Repository generation after the request settled. */
  readonly generation: number;
}

/** Value exposed by `RepositoryProvider` and read through `useRepository`. */
export interface RepositoryContextValue {
  /** Latest snapshot, or null before the first successful read. */
  readonly snapshot: RepositorySnapshot | null;
  /** Signals built from the latest read. */
  readonly signals: RepositorySignals;
  /** Derived repository state. Features never recompute it. */
  readonly state: RepositoryStateSnapshot;
  /** Right-pane selection, keyed by stable identity. */
  readonly selection: RepositorySelection;
  /** Generation token bumped by every read, used to discard stale page results. */
  readonly generation: number;
  /** Current git-directory or worktree watch state. */
  readonly watch: GitWatchStatus;
  /** Upstream classification read with the snapshot. */
  readonly upstreamStatus: UpstreamStatus;
  /** Per-remote last successful check and fetch timestamps. */
  readonly remoteChecks: Readonly<Record<string, RemoteCheckRecord>>;
  /** Non-blocking message from the last failed refresh, or null. */
  readonly lastRefreshError: string | null;
  /** True while a full refresh is in flight. */
  readonly isRefreshing: boolean;
  /** True while a status read is in flight. */
  readonly isStatusInFlight: boolean;
  /** True while a graph-window read is in flight. */
  readonly isGraphInFlight: boolean;
  /** Git client built from `config.git.path`. Read paths and the command runner share it. */
  readonly gitClient: GitClient;
  /**
   * Reads status, then the graph window.
   *
   * @returns The refresh result.
   */
  refresh(): Promise<RepositoryRefreshResult>;
  /**
   * Reads status, refs, remotes, identity, and upstreams without reading history.
   *
   * @returns The refresh result.
   */
  refreshStatus(): Promise<RepositoryRefreshResult>;
  /**
   * Bumps the graph generation and awaits the registered window reloader.
   *
   * @returns The refresh result.
   */
  refreshGraphWindow(): Promise<RepositoryRefreshResult>;
  /**
   * Registers the graph feature's loaded-window reloader.
   *
   * `useCommitGraph` registers on mount and clears on unmount; the provider owns the in-flight flag
   * and the generation token, while the graph owns the page reads.
   *
   * @param refresher - Reloader, or null to clear it.
   */
  registerGraphWindowRefresher(refresher: (() => Promise<void>) | null): void;
  /**
   * Replaces the right-pane selection.
   *
   * @param selection - New selection value.
   */
  setSelection(selection: RepositorySelection): void;
  /**
   * Records a successful or failed remote interaction.
   *
   * @param remote - Remote name.
   * @param kind - Check or fetch.
   * @param succeeded - False records a failed attempt without moving the timestamp.
   */
  recordRemoteCheck(remote: string, kind: RemoteCheckKind, succeeded: boolean): void;
  /**
   * Records a confirmed absent upstream ref and re-reads the repository.
   *
   * @param ref - Upstream ref confirmed absent.
   * @param basis - Successful prune or successful app-initiated remote deletion.
   * @returns The refresh result.
   */
  confirmUpstreamAbsent(
    ref: string,
    basis: "prune" | "app-deletion",
  ): Promise<RepositoryRefreshResult>;
  /**
   * Records a failed or timed-out upstream check and re-reads the repository.
   *
   * @param ref - Upstream ref whose check failed.
   * @returns The refresh result.
   */
  markUpstreamUnknown(ref: string): Promise<RepositoryRefreshResult>;
  /**
   * Reads target-aware availability from the current provider state.
   *
   * @param commandId - Command id.
   * @param target - Explicit target captured at dispatch time.
   * @param region - Focus context that dispatched the command.
   * @returns Availability with a machine-readable reason when unavailable.
   */
  getAvailability(
    commandId: string,
    target: CommandTarget,
    region: CommandRegion,
  ): CommandAvailability;
}

/** Props accepted by `RepositoryProvider`. */
export interface RepositoryProviderProps {
  /** Provider content. */
  readonly children?: ReactNode;
  /** Directory the app was launched from. Defaults to `process.cwd()`. */
  readonly cwd?: string;
  /** Injected git client. Defaults to a client built from `config.git.path`. */
  readonly gitClient?: GitClient;
  /** Injected watcher factory. Defaults to the production `node:fs` watcher. */
  readonly createWatcher?: GitWatcherFactory;
  /** Whether the git-directory watcher starts after the first successful read. */
  readonly enableWatcher?: boolean;
  /** Opt-in worktree watching. Off by default. */
  readonly worktreeWatch?: boolean;
  /** Coalescing window for watcher events, in milliseconds. */
  readonly watchDebounceMs?: number;
  /** Initial right-pane selection. Defaults to the Pending Changes row. */
  readonly initialSelection?: RepositorySelection;
  /** Clock used for read timestamps and remote freshness. */
  readonly now?: () => number;
}

/** Internal provider state, kept in one object so a read applies atomically. */
export interface RepositoryStore {
  /** Latest snapshot, or null before the first successful read. */
  readonly snapshot: RepositorySnapshot | null;
  /** Signals built from the latest read. */
  readonly signals: RepositorySignals;
  /** Right-pane selection. */
  readonly selection: RepositorySelection;
  /** Generation token. */
  readonly generation: number;
  /** Watch state. */
  readonly watch: GitWatchStatus;
  /** Per-remote last successful interactions. */
  readonly remoteChecks: Readonly<Record<string, RemoteCheckRecord>>;
  /** Non-blocking message from the last failed refresh. */
  readonly lastRefreshError: string | null;
  /** Upstream classification read with the snapshot. */
  readonly upstreamStatus: UpstreamStatus;
  /** True while a status read is in flight. */
  readonly statusInFlight: boolean;
  /** True while a graph-window read is in flight. */
  readonly graphInFlight: boolean;
  /** True while a combined refresh is in flight. */
  readonly refreshing: boolean;
}

/** Inputs used to create the provider's watcher. */
export interface RepositoryWatcherInput {
  /** Absolute git directory, or null before the first successful read. */
  readonly gitDir: string | null;
  /** Absolute work-tree root, or null when unavailable. */
  readonly root: string | null;
  /** Launch directory. */
  readonly cwd: string;
  /** Whether watching is enabled. */
  readonly enableWatcher: boolean;
  /** Whether worktree watching is opted in. */
  readonly worktreeWatch: boolean;
  /** Coalescing window. */
  readonly debounceMs: number | undefined;
  /** Watcher factory. */
  readonly factory: GitWatcherFactory;
  /** Called once per coalesced event burst. */
  readonly onRefresh: () => void;
  /** Called whenever the watch state changes, including a mid-life failure. */
  readonly onStatus: (status: GitWatchStatus) => void;
}
