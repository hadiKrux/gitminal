import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { RepositoryStore } from "@/app/providers/RepositoryProvider.types";
import type { GitWatcherFactory } from "@/domain/git/git.types";

/** Inputs accepted by `useRepositoryStoreWatcher`. */
export interface RepositoryStoreWatcherInput {
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
  /** Status-only refresh entry point. */
  readonly refreshStatus: () => Promise<unknown>;
  /** Store writer. */
  readonly setStore: Dispatch<SetStateAction<RepositoryStore>>;
  /** False after unmount. */
  readonly mountedRef: MutableRefObject<boolean>;
}
