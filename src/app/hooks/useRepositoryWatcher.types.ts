import type { GitWatcherFactory, GitWatchStatus } from "@/domain/git/git.types";

/** Inputs accepted by `useRepositoryWatcher`. */
export interface RepositoryWatcherHookInput {
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
  /** Called when the watch state changes. */
  readonly onStatus: (status: GitWatchStatus) => void;
}
