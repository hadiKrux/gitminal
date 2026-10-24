/**
 * Operation class of one git invocation.
 *
 * The class selects the default timeout: local reads are short, local writes are medium, and
 * network operations are long. It also tells the client which serialization lane the invocation
 * belongs to.
 */
export type GitOperationClass = "read" | "write" | "network";

/** Default timeout in milliseconds for every operation class. */
export interface GitOperationTimeouts {
  /** Local read timeout. */
  readonly read: number;
  /** Local write timeout. */
  readonly write: number;
  /** Network timeout. */
  readonly network: number;
}

/** Options passed to the injectable spawn seam. */
export interface GitSpawnOptions {
  /** Working directory of the child, normally the repository root. */
  readonly cwd: string;
  /** Fully merged child environment. */
  readonly env: Record<string, string>;
  /** The child is always executed without a shell. */
  readonly shell: false;
  /** Stdin is ignored; stdout and stderr are captured. */
  readonly stdio: readonly ["ignore", "pipe", "pipe"];
}

/** Minimal readable stream contract used for child stdout and stderr. */
export interface GitReadableStream {
  /**
   * Subscribes to one stream event.
   *
   * @param event - Only `data` is observed by the client.
   * @param listener - Receives each raw chunk.
   */
  on(event: "data", listener: (chunk: Uint8Array | string) => void): void;
}

/** Minimal child process contract the client needs, so tests can substitute a fake process. */
export interface GitSpawnedProcess {
  /** Captured standard output stream, or null when the spawn failed. */
  readonly stdout: GitReadableStream | null;
  /** Captured standard error stream, or null when the spawn failed. */
  readonly stderr: GitReadableStream | null;
  /**
   * Subscribes to a process lifecycle event.
   *
   * @param event - `error` or `close`.
   * @param listener - Error or termination listener.
   */
  on(event: "error", listener: (error: NodeJS.ErrnoException) => void): void;
  /**
   * Subscribes to the close event.
   *
   * @param event - `close` or `exit`.
   * @param listener - Receives the exit code and the terminating signal.
   */
  on(
    event: "close" | "exit",
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): void;
  /**
   * Sends a signal to the child.
   *
   * @param signal - Signal to deliver.
   * @returns True when the signal was delivered.
   */
  kill(signal: NodeJS.Signals): boolean;
}

/**
 * Injectable process spawner.
 *
 * Production uses `node:child_process`; tests pass a fake so the unit suite never spawns. The
 * signature is intentionally narrow: argument arrays and an environment, never a shell string.
 */
export type GitSpawn = (
  command: string,
  args: readonly string[],
  options: GitSpawnOptions,
) => GitSpawnedProcess;

/** Inputs for one git invocation. */
export interface GitInvokeOptions {
  /** Git subcommand and arguments, without the executable. */
  readonly args: readonly string[];
  /** Working directory, normally the repository root. */
  readonly cwd: string;
  /** Cancellation signal. Every invocation has one. */
  readonly signal: AbortSignal;
  /** Operation class that selects the default timeout and serialization lane. */
  readonly operationClass: GitOperationClass;
  /** Explicit timeout override in milliseconds. */
  readonly timeoutMs?: number;
  /** Called with each decoded stdout chunk as it arrives. */
  readonly onStdout?: (chunk: string) => void;
  /** Called with each decoded stderr chunk as it arrives. */
  readonly onStderr?: (chunk: string) => void;
  /** Overrides index serialization inference; reads infer it from the argv. */
  readonly touchesIndex?: boolean;
  /**
   * Reports whether the user configured `GIT_SSH_COMMAND` or `core.sshCommand`.
   *
   * When omitted the client reads `GIT_SSH_COMMAND` from the base environment and asks git for
   * `core.sshCommand` once per working directory.
   */
  readonly sshCommandConfigured?: boolean;
}

/** Failure reported by the process boundary itself, before git produced an exit status. */
export interface GitSpawnFailure {
  /** Platform error code such as `ENOENT`, or null when none was reported. */
  readonly code: string | null;
  /** Human-readable spawn error. */
  readonly message: string;
}

/** Result of one git invocation. A cancelled or timed-out invocation is never successful. */
export interface GitInvocationResult {
  /** Executable followed by the argument array, exactly as spawned. */
  readonly argv: readonly string[];
  /** Working directory of the child. */
  readonly cwd: string;
  /** Exit code, or null when the child failed to start or was killed by a signal. */
  readonly exitCode: number | null;
  /** Signal that terminated the child, when any. */
  readonly terminationSignal: NodeJS.Signals | null;
  /** Captured standard output, bounded by the client output limit. */
  readonly stdout: string;
  /** Captured standard error, bounded by the client output limit. */
  readonly stderr: string;
  /**
   * True when stdout exceeded the client output limit and lost its middle.
   *
   * A truncated parse is incomplete evidence, so callers that infer absence from output must
   * treat it as unknown instead of a confirmed result.
   */
  readonly stdoutTruncated?: boolean;
  /** True when stderr exceeded the client output limit and lost its middle. */
  readonly stderrTruncated?: boolean;
  /** Wall-clock duration in milliseconds. */
  readonly durationMs: number;
  /** True when the invocation was cancelled through its `AbortSignal`. */
  readonly cancelled: boolean;
  /** True when the invocation exceeded its timeout and was killed. */
  readonly timedOut: boolean;
  /** Timeout that expired, in milliseconds, or null when the invocation did not time out. */
  readonly timedOutAfterMs: number | null;
  /** Spawn failure, or null when the child started. */
  readonly spawnError: GitSpawnFailure | null;
  /** True only for a clean exit without cancellation, timeout, or spawn failure. */
  readonly ok: boolean;
}

/** Serialization lane used by the client's index lock. */
export type GitInvocationLane = "plain" | "index-read" | "write";

/** Git client contract consumed by read modules and the command runner. */
export interface GitClient {
  /** Executable configured for this client. */
  readonly gitPath: string;
  /**
   * Runs one git invocation.
   *
   * @param options - Arguments, working directory, operation class, and signal.
   * @returns The settled invocation result. Never rejects for a git failure.
   */
  invoke(options: GitInvokeOptions): Promise<GitInvocationResult>;
}

/** Options accepted by `createGitClient`. */
export interface GitClientOptions {
  /** Git executable. Defaults to `git`. */
  readonly gitPath?: string;
  /** Base environment. Defaults to `process.env`. */
  readonly baseEnv?: Readonly<Record<string, string | undefined>>;
  /** Per-class timeout overrides in milliseconds. */
  readonly timeouts?: Partial<GitOperationTimeouts>;
  /** Injectable spawner. Defaults to `node:child_process`. */
  readonly spawn?: GitSpawn;
  /** Grace between `SIGTERM` and `SIGKILL`. Defaults to two seconds. */
  readonly killGraceMs?: number;
  /** Maximum captured characters per stream before head and tail truncation. */
  readonly outputLimitCharacters?: number;
  /** Injectable clock for duration measurement. */
  readonly now?: () => number;
  /** Injectable resolver for the user's SSH command configuration. */
  readonly resolveSshCommandConfigured?: (cwd: string, signal: AbortSignal) => Promise<boolean>;
}

/** Classification of a git failure. */
export type GitFailureKind =
  | "missing-git"
  | "permission"
  | "auth-network"
  | "hook-failure"
  | "non-fast-forward"
  | "not-a-repository"
  | "cancelled"
  | "timed-out"
  | "unknown";

/** Classified failure derived from an invocation result. */
export interface GitFailure {
  /** Failure category used by the UI and the repository state machine. */
  readonly kind: GitFailureKind;
  /** Exit code, or null when the child did not exit normally. */
  readonly exitCode: number | null;
  /** Decisive error line, falling back to the captured stderr. */
  readonly message: string;
  /** Full captured stderr. */
  readonly stderr: string;
  /** True when the invocation was cancelled. */
  readonly cancelled: boolean;
  /** True when the invocation timed out. */
  readonly timedOut: boolean;
}

/** Change kind of one index or working-tree side of a status entry. */
export type FileChangeKind =
  | "unmodified"
  | "modified"
  | "added"
  | "deleted"
  | "renamed"
  | "copied"
  | "type-changed"
  | "untracked"
  | "ignored"
  | "conflicted";

/** Record kind of one parsed status entry. */
export type StatusEntryKind =
  | "ordinary"
  | "renamed"
  | "copied"
  | "unmerged"
  | "untracked"
  | "ignored";

/** One changed path from `git status --porcelain=v2 --branch -z --untracked-files=all`. */
export interface StatusEntry {
  /** Current path, root-relative. */
  readonly path: string;
  /** Pre-rename path for a rename or copy, otherwise null. */
  readonly originalPath: string | null;
  /** Record kind. */
  readonly kind: StatusEntryKind;
  /** Index-side change kind. */
  readonly index: FileChangeKind;
  /** Working-tree-side change kind. */
  readonly worktree: FileChangeKind;
}

/** Parsed canonical status output. */
export interface StatusSnapshot {
  /** HEAD commit id, or null in an unborn branch. */
  readonly headOid: string | null;
  /** Short branch name, or null when detached. */
  readonly branch: string | null;
  /** True when HEAD is detached. */
  readonly detached: boolean;
  /** Upstream ref such as `origin/main`, or null when none is configured. */
  readonly upstream: string | null;
  /** Commits ahead of the upstream. */
  readonly ahead: number;
  /** Commits behind the upstream. */
  readonly behind: number;
  /** Every changed path in status order. */
  readonly entries: readonly StatusEntry[];
  /** Paths with unmerged entries. */
  readonly conflictedPaths: readonly string[];
  /** Number of entries with an index-side change. */
  readonly stagedCount: number;
  /** Number of tracked entries with a working-tree change. */
  readonly unstagedCount: number;
  /** Number of untracked entries. */
  readonly untrackedCount: number;
}

/** One configured remote. */
export interface RemoteInfo {
  /** Remote name. */
  readonly name: string;
  /** Fetch URL, or null when the remote has no fetch URL. */
  readonly fetchUrl: string | null;
  /** Push URL, or null when it matches the fetch URL or is unset. */
  readonly pushUrl: string | null;
}

/** Result of one canonical status read. */
export interface StatusReadResult {
  /** True when git exited cleanly and the output parsed. */
  readonly ok: boolean;
  /** Parsed snapshot, or null when the read failed. */
  readonly snapshot: StatusSnapshot | null;
  /** Classified failure, or null on success. */
  readonly failure: GitFailure | null;
}

/** Result of one remote read. */
export interface RemoteReadResult {
  /** True when git exited cleanly. */
  readonly ok: boolean;
  /** Configured remotes in git order, empty when none exist. */
  readonly remotes: readonly RemoteInfo[];
  /** Classified failure, or null on success. */
  readonly failure: GitFailure | null;
}

/** Local identity used for commits. */
export interface GitIdentity {
  /** Configured `user.name`, or null when unset. */
  readonly name: string | null;
  /** Configured `user.email`, or null when unset. */
  readonly email: string | null;
}

/** Discovery signals from `git rev-parse`. */
export interface RepositoryProbe {
  /** True when the working directory is inside a work tree. */
  readonly insideWorkTree: boolean;
  /** True when the repository is bare. */
  readonly bare: boolean;
  /** Absolute work-tree root, or null when unavailable. */
  readonly root: string | null;
  /** Absolute git directory, or null when unavailable. */
  readonly gitDir: string | null;
}

/** Discovery signals with the failures that produced them. */
export interface RepositoryProbeDetail {
  /** The discovery signals. */
  readonly probe: RepositoryProbe;
  /** Classified failure of the inside-work-tree probe, or null on success. */
  readonly insideFailure: GitFailure | null;
  /** Classified failure of the bare and git-directory probe, or null on success. */
  readonly metaFailure: GitFailure | null;
}

/** HEAD signals from `git rev-parse` and `git symbolic-ref`. */
export interface HeadProbe {
  /** True when HEAD resolves to a commit. */
  readonly exists: boolean;
  /** Short branch name, or null when detached or unavailable. */
  readonly branch: string | null;
  /** True when HEAD is detached. */
  readonly detached: boolean;
  /** Abbreviated commit id shown for a detached HEAD. */
  readonly shortHash: string | null;
}

/** In-progress operation markers. */
export interface OperationProbe {
  /** True while a merge is in progress. */
  readonly mergeInProgress: boolean;
  /** True while a rebase is in progress. */
  readonly rebaseInProgress: boolean;
  /** True while a cherry-pick is in progress. */
  readonly cherryPickInProgress: boolean;
}

/** Common options for git read modules. */
export interface GitReadOptions {
  /** Working directory of the invocation. */
  readonly cwd: string;
  /** Cancellation signal. */
  readonly signal: AbortSignal;
}

/** One progress event parsed from git's `--progress` stderr stream. */
export interface GitProgressEvent {
  /** Phase label such as `Receiving objects`. */
  readonly phase: string;
  /** Completion percentage from 0 to 100 when git reports one. */
  readonly percent?: number;
}

/**
 * Incremental parser for git progress output.
 *
 * Chunks are consumed as they arrive. Only an incomplete trailing line is retained, so a long
 * stream never accumulates in memory and a phase is published before the stream ends.
 */
export interface GitProgressParser {
  /**
   * Consumes one stderr chunk.
   *
   * @param chunk - Decoded stderr text, which may split a line or contain several lines.
   * @returns Every event completed by this chunk.
   */
  push(chunk: string): readonly GitProgressEvent[];
  /**
   * Completes a trailing line that was never terminated by a newline.
   *
   * @returns The events completed by the flush.
   */
  flush(): readonly GitProgressEvent[];
  /** Number of characters retained for the incomplete trailing line. */
  readonly bufferedCharacters: number;
  /** Drops the incomplete line and the duplicate-detection memory. */
  reset(): void;
}

/** Directory a git watcher observes. */
export type GitWatchMode = "git-dir" | "worktree";

/** Current state of one git watcher. */
export interface GitWatchStatus {
  /** True while the underlying filesystem watch is active. */
  readonly watching: boolean;
  /** Directory mode the watcher was created with. */
  readonly mode: GitWatchMode;
  /** Absolute directory being watched, or null when no path is available. */
  readonly path: string | null;
  /** True when the active watch is recursive. */
  readonly recursive: boolean;
  /** Human-readable limitation of the active or configured watch, or null when none applies. */
  readonly limitation: string | null;
}

/** Closable handle returned by the injectable filesystem watch seam. */
export interface GitWatchHandle {
  /** Stops the filesystem watch. Safe to call more than once. */
  close(): void;
}

/** One directory the watcher asks the seam to observe. */
export interface GitWatchTarget {
  /** Absolute directory to observe. */
  readonly path: string;
  /** True when the seam should watch nested paths. */
  readonly recursive: boolean;
}

/**
 * Injectable filesystem watch seam.
 *
 * Production uses `node:fs.watch`; tests pass a fake so the unit suite never touches the disk. The
 * watcher reports the platform's inability to watch recursively by letting the seam throw.
 */
export type GitWatchSeam = (
  target: GitWatchTarget,
  onChange: (filename: string | null) => void,
  onError: (error: unknown) => void,
) => GitWatchHandle;

/** Options accepted by `createGitWatcher`. */
export interface GitWatcherOptions {
  /** Absolute git directory, always watched in `git-dir` mode. */
  readonly gitDir: string;
  /** Watch mode. Defaults to `git-dir`; worktree watching is opt-in. */
  readonly mode?: GitWatchMode;
  /** Absolute work-tree root, required for `worktree` mode. */
  readonly worktreePath?: string | null;
  /** Coalescing window in milliseconds. Defaults to 250. */
  readonly debounceMs?: number;
  /** Called once per coalesced burst of filesystem events. */
  readonly onRefresh: () => void;
  /** Called whenever the watch state changes, including a mid-life failure. */
  readonly onStatus?: (status: GitWatchStatus) => void;
  /** Injectable filesystem watch seam. Defaults to `node:fs.watch`. */
  readonly watch?: GitWatchSeam;
}

/** Watcher contract consumed by `RepositoryProvider`. */
export interface GitWatcher {
  /** Starts watching. Calling it twice keeps one underlying watch. */
  start(): void;
  /** Stops watching and cancels a pending debounced refresh. */
  stop(): void;
  /** Current watch state. */
  readonly status: GitWatchStatus;
}

/** Factory used to create a watcher, injectable for tests and future watch settings. */
export type GitWatcherFactory = (options: GitWatcherOptions) => GitWatcher;
