import { useEffect, useRef } from "react";
import type { RepositoryWatcherHookInput } from "@/app/hooks/useRepositoryWatcher.types";
import {
  createInactiveWatch,
  createRepositoryWatcher,
} from "@/app/providers/RepositoryProvider.store";

/**
 * Starts the git-directory watcher after the first successful read and stops it on unmount.
 *
 * The watcher is created only when a git directory is available and watching is enabled. Callbacks
 * are read through refs so a re-render does not restart the filesystem watch. Cleanup closes the
 * watch, cancels a pending debounce, and publishes the inactive status so no refresh can arrive
 * after unmount.
 *
 * @param input - Directories, watch mode, factory, and callbacks.
 */
export function useRepositoryWatcher(input: RepositoryWatcherHookInput): void {
  const onRefreshRef = useRef(input.onRefresh);
  const onStatusRef = useRef(input.onStatus);

  onRefreshRef.current = input.onRefresh;
  onStatusRef.current = input.onStatus;

  const { cwd, debounceMs, enableWatcher, factory, gitDir, root, worktreeWatch } = input;

  useEffect(() => {
    const watcher = createRepositoryWatcher({
      gitDir,
      root,
      cwd,
      enableWatcher,
      worktreeWatch,
      debounceMs,
      factory,
      onRefresh: () => onRefreshRef.current(),
      onStatus: (status) => onStatusRef.current(status),
    });

    if (watcher === null) {
      return;
    }

    watcher.start();
    onStatusRef.current(watcher.status);

    return () => {
      watcher.stop();
      onStatusRef.current(createInactiveWatch(worktreeWatch));
    };
  }, [cwd, debounceMs, enableWatcher, factory, gitDir, root, worktreeWatch]);
}
