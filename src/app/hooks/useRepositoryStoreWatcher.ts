import type { RepositoryStoreWatcherInput } from "@/app/hooks/useRepositoryStoreWatcher.types";
import { useRepositoryWatcher } from "@/app/hooks/useRepositoryWatcher";

/**
 * Connects the filesystem watcher to the repository store.
 *
 * A watcher event runs a status-only read, which never re-reads history. Every status change,
 * including a mid-life watch failure, is written into the store so the top bar can explain that
 * watching stopped and manual refresh is the fallback.
 *
 * @param input - Paths, watch mode, factory, refresh entry point, and store writer.
 */
export function useRepositoryStoreWatcher(input: RepositoryStoreWatcherInput): void {
  useRepositoryWatcher({
    gitDir: input.gitDir,
    root: input.root,
    cwd: input.cwd,
    enableWatcher: input.enableWatcher,
    worktreeWatch: input.worktreeWatch,
    debounceMs: input.debounceMs,
    factory: input.factory,
    onRefresh: () => {
      void input.refreshStatus();
    },
    onStatus: (status) => {
      if (input.mountedRef.current) {
        input.setStore((previous) => ({ ...previous, watch: status }));
      }
    },
  });
}
