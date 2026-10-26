import type { ReactNode } from "react";
import type {
  CommandAvailability,
  CommandFormValues,
  CommandRegion,
  CommandTarget,
} from "@/domain/commands/commands.types";
import type { GitClient, GitWatcherFactory, GitWatchStatus } from "@/domain/git/git.types";
import type { EnsureLoadedResult } from "@/domain/graph/graph.types";
import type {
  BranchRiskRead,
  RemoteCheckKind,
  RemoteCheckRecord,
  RemoteTagChecks,
  RepositoryListFailures,
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

/**
 * Loads a commit OID into the graph's loaded window before it is selected.
 *
 * The graph registers this seam on mount, so a parent or search-result selection can ask the
 * paginator for a bounded `ensureLoaded` walk without any feature importing another feature.
 */
export type CommitNavigator = (oid: string) => Promise<EnsureLoadedResult>;

/**
 * Reloads the graph feature's loaded window and reports whether the reload succeeded.
 *
 * A false result means the feature rolled back to its captured checkpoint after a page read
 * failure, so the provider can report `ok: false` for the request and the page Retry can re-run the
 * window reload instead of treating the failed tip as handled.
 */
export type GraphWindowRefresher = () => Promise<boolean>;

/** Options accepted by the repository refresh entry points. */
export interface RepositoryRefreshOptions {
  /**
   * Queues exactly one follow-up read when this request joins an in-flight read.
   *
   * A command-triggered refresh sets this so its result can never describe the repository state
   * from before the command. Focus, watcher, and manual refreshes leave it unset and keep joining
   * the in-flight read without an extra read.
   */
  readonly followUp?: boolean;
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
  /** Last known tag names per configured remote, with the status of the latest read. */
  readonly remoteTagChecks: RemoteTagChecks;
  /** Classified failure per optional ref list, empty when the last read succeeded for every list. */
  readonly listFailures: RepositoryListFailures;
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
   * @param options - Optional follow-up rule for a command-triggered refresh.
   * @returns The refresh result.
   */
  refresh(options?: RepositoryRefreshOptions): Promise<RepositoryRefreshResult>;
  /**
   * Reads status, refs, remotes, identity, and upstreams without reading history.
   *
   * @param options - Optional follow-up rule for a command-triggered refresh.
   * @returns The refresh result.
   */
  refreshStatus(options?: RepositoryRefreshOptions): Promise<RepositoryRefreshResult>;
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
   * @param refresher - Reloader that reports success, or null to clear it.
   */
  registerGraphWindowRefresher(refresher: GraphWindowRefresher | null): void;
  /**
   * Registers the graph feature's bounded commit loader.
   *
   * `useCommitGraph` registers on mount and clears on unmount. The provider never reads history
   * itself; it only asks the graph whether an OID is loaded before it changes the selection.
   *
   * @param navigator - Loader, or null to clear it.
   */
  registerCommitNavigator(navigator: CommitNavigator | null): void;
  /**
   * Selects a commit after the graph has loaded it.
   *
   * The selection changes only when the registered navigator reports `loaded`. The detailed
   * `notFound`, `exceeded`, `cancelled`, and `error` outcomes keep the current selection and let a
   * caller distinguish a genuine bounded miss from a walk cancelled by a refresh or a page read
   * failure.
   *
   * @param oid - Commit OID to select.
   * @returns The bounded load outcome; `loaded` when the commit became the selection.
   */
  selectCommit(oid: string): Promise<EnsureLoadedResult>;
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
   * Re-reads every configured remote's advertised tags with `git ls-remote --tags`.
   *
   * A successful read replaces that remote's names and records the check time; a failed read keeps
   * the previous names and marks the attempt failed. The snapshot is never refreshed, so a tags panel
   * can call this on region focus without re-reading the repository. Calls are coalesced while one
   * refresh is in flight.
   *
   * @returns A promise that settles after every configured remote has been attempted.
   */
  refreshRemoteTags(): Promise<void>;
  /**
   * Reads the capped commits a branch holds that its deletion base does not.
   *
   * The base is the branch's configured upstream, or HEAD when it has none, so the list matches what
   * `git branch -d` would refuse. The read is bounded and never throws: a failure returns an empty
   * list plus a message the panel can show beside the acknowledgement.
   *
   * @param name - Branch whose at-risk commits are read.
   * @returns The capped commit list plus any classified error.
   */
  readBranchRisk(name: string): Promise<BranchRiskRead>;
  /**
   * Records a confirmed absent upstream and re-reads the repository once.
   *
   * Reserved for the future F-04 remote-branch-deletion entry point. It must not be reintroduced
   * into the prune path, which uses `recordUpstreamEvidence` so a multi-ref prune performs one write
   * and one refresh instead of one per ref.
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
   * Records a failed or timed-out upstream check and re-reads the repository once.
   *
   * Reserved for the future F-04 remote-branch-deletion entry point. It must not be reintroduced
   * into the prune path, which uses `recordUpstreamEvidence` for its batched write and refresh.
   *
   * @param ref - Upstream ref whose check failed.
   * @returns The refresh result.
   */
  markUpstreamUnknown(ref: string): Promise<RepositoryRefreshResult>;
  /**
   * Records confirmed absent refs and failed checks in one batch and re-reads the repository once.
   *
   * @param prunedRefs - Upstream refs a successful prune confirmed absent.
   * @param unknownRefs - Upstream refs whose remote check failed.
   * @returns The single refresh result, or null when both lists are empty.
   */
  recordUpstreamEvidence(
    prunedRefs: readonly string[],
    unknownRefs: readonly string[],
  ): Promise<RepositoryRefreshResult | null>;
  /**
   * Reads target-aware availability from the current provider state.
   *
   * @param commandId - Command id.
   * @param target - Explicit target captured at dispatch time.
   * @param region - Focus context that dispatched the command.
   * @param formValues - Values collected by the owning form, when the check depends on them.
   * @returns Availability with a machine-readable reason when unavailable.
   */
  getAvailability(
    commandId: string,
    target: CommandTarget,
    region: CommandRegion,
    formValues?: CommandFormValues,
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
  /** Last known tag names per configured remote, with the status of the latest read. */
  readonly remoteTagChecks: RemoteTagChecks;
  /** Classified failure per optional ref list from the last applied read. */
  readonly listFailures: RepositoryListFailures;
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
