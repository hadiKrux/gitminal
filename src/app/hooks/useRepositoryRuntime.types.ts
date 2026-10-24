import type { GitClient, GitWatcherFactory } from "@/domain/git/git.types";

/** Inputs accepted by `useRepositoryRuntime`. */
export interface RepositoryRuntimeInput {
  /** Directory the app was launched from. */
  readonly cwd?: string;
  /** Injected git client. */
  readonly gitClient?: GitClient;
  /** Injected watcher factory. */
  readonly createWatcher?: GitWatcherFactory;
  /** Whether the git-directory watcher starts after the first successful read. */
  readonly enableWatcher?: boolean;
  /** Opt-in worktree watching. */
  readonly worktreeWatch?: boolean;
  /** Coalescing window for watcher events, in milliseconds. */
  readonly watchDebounceMs?: number;
  /** Clock used for read timestamps and remote freshness. */
  readonly now?: () => number;
}

/** Stable runtime collaborators derived from configuration and provider props. */
export interface RepositoryRuntime {
  /** Launch directory. */
  readonly cwd: string;
  /** Clock used for read timestamps. */
  readonly now: () => number;
  /** Git client shared by reads and commands. */
  readonly gitClient: GitClient;
  /** Watcher factory. */
  readonly watcherFactory: GitWatcherFactory;
  /** Whether watching is enabled. */
  readonly enableWatcher: boolean;
  /** Whether worktree watching is enabled. */
  readonly worktreeWatch: boolean;
  /** Coalescing window for watcher events. */
  readonly watchDebounceMs: number | undefined;
}
