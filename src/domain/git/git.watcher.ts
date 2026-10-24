import { watch } from "node:fs";
import path from "node:path";
import type {
  GitWatcher,
  GitWatcherOptions,
  GitWatchHandle,
  GitWatchMode,
  GitWatchStatus,
  GitWatchTarget,
} from "./git.types";

/** Default coalescing window for filesystem events. */
const DEFAULT_WATCH_DEBOUNCE_MS = 250;

/** Worktree path segments that never trigger a refresh in worktree mode. */
const WORKTREE_IGNORED_SEGMENTS: ReadonlySet<string> = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "out",
  "target",
  ".next",
  "coverage",
  ".cache",
]);

/** Git-directory files whose churn never means a repository change. */
const GIT_DIR_IGNORED_FILENAMES: ReadonlySet<string> = new Set(["index.lock"]);

/** Ref directories that must be watched when recursive watching is unavailable. */
const GIT_DIR_REF_DIRECTORIES: readonly string[] = Object.freeze([
  "refs/heads",
  "refs/tags",
  "refs/remotes",
]);

/**
 * Creates a debounced watcher for one repository directory.
 *
 * Git writes several files for a single operation, so events are coalesced into one refresh per
 * quiet window. The watcher never mutates anything: it only reports that a refresh should run, and
 * the caller decides which read path to use. Git-directory watching is the default; worktree
 * watching is an explicit opt-in mode that needs a work-tree path.
 *
 * Recursive watching is requested first. When the platform refuses it, the git directory, its ref
 * directories, and its top level are watched non-recursively so nested ref changes are still
 * observed, and the limitation is published through the status. Worktree mode filters its
 * documented ignore set, and a mid-life watch error closes the watch and publishes an inactive
 * status instead of throwing out of the render loop.
 *
 * @param options - Directory, mode, debounce window, refresh callback, status callback, and seam.
 * @returns The watcher with its current status.
 */
export function createGitWatcher(options: GitWatcherOptions): GitWatcher {
  const mode: GitWatchMode = options.mode ?? "git-dir";
  const debounceMs = Math.max(1, options.debounceMs ?? DEFAULT_WATCH_DEBOUNCE_MS);
  const watchPath = mode === "worktree" ? (options.worktreePath ?? null) : options.gitDir;
  const beginWatch = options.watch ?? defaultWatch;
  let handles: GitWatchHandle[] = [];
  let recursive = true;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  /** Reports the current watch state. */
  const readStatus = (): GitWatchStatus => ({
    watching: handles.length > 0,
    mode,
    path: watchPath,
    recursive,
    limitation: readLimitation(mode, handles.length > 0, recursive),
  });

  /** Publishes the current status without ever throwing. */
  const publishStatus = (): void => {
    try {
      options.onStatus?.(readStatus());
    } catch {
      // A status consumer must never break the watcher.
    }
  };

  /** Schedules one refresh unless a burst is already pending. */
  const scheduleRefresh = (filename: string | null): void => {
    if (shouldIgnoreWatchEvent(mode, filename)) {
      return;
    }

    if (debounceTimer !== null) {
      return;
    }

    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      options.onRefresh();
    }, debounceMs);
  };

  /** Closes every active handle and stops the debounce timer. */
  const closeAll = (): void => {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }

    const closing = handles;
    handles = [];

    for (const handle of closing) {
      try {
        handle.close();
      } catch {
        // A handle that is already closed needs no further cleanup.
      }
    }
  };

  /** Handles one platform watch failure without escaping the render loop. */
  const handleWatchError = (): void => {
    closeAll();
    publishStatus();
  };

  /** Starts one target, returning null when the platform refuses it. */
  const tryWatch = (target: GitWatchTarget): GitWatchHandle | null => {
    try {
      return beginWatch(target, scheduleRefresh, handleWatchError);
    } catch {
      return null;
    }
  };

  return {
    start(): void {
      if (handles.length > 0 || watchPath === null) {
        return;
      }

      const recursiveHandle = tryWatch({ path: watchPath, recursive: true });

      if (recursiveHandle !== null) {
        handles = [recursiveHandle];
        recursive = true;
        publishStatus();

        return;
      }

      recursive = false;
      handles = startFallbackWatches(watchPath, mode, tryWatch);
      publishStatus();
    },

    stop(): void {
      closeAll();
      publishStatus();
    },

    get status(): GitWatchStatus {
      return readStatus();
    },
  };
}

/**
 * Starts the non-recursive fallback watches for one mode.
 *
 * The git-directory fallback watches the git directory and each ref directory so an external commit
 * or branch switch still produces an event on platforms without recursive watching. A missing ref
 * directory is skipped; a missing root leaves the watcher inactive.
 *
 * @param watchPath - Root path for the configured mode.
 * @param mode - Git-directory or worktree mode.
 * @param tryWatch - Seam wrapper that returns null when a path cannot be watched.
 * @returns The started handles.
 */
function startFallbackWatches(
  watchPath: string,
  mode: GitWatchMode,
  tryWatch: (target: GitWatchTarget) => GitWatchHandle | null,
): GitWatchHandle[] {
  if (mode === "worktree") {
    const handle = tryWatch({ path: watchPath, recursive: false });

    return handle === null ? [] : [handle];
  }

  const rootHandle = tryWatch({ path: watchPath, recursive: false });

  if (rootHandle === null) {
    return [];
  }

  const handles = [rootHandle];

  for (const directory of GIT_DIR_REF_DIRECTORIES) {
    const handle = tryWatch({ path: path.join(watchPath, directory), recursive: false });

    if (handle !== null) {
      handles.push(handle);
    }
  }

  return handles;
}

/**
 * Reads the human-readable limitation for one watch state.
 *
 * @param mode - Git-directory or worktree mode.
 * @param watching - True while a filesystem watch is active.
 * @param recursive - True when the active watch is recursive.
 * @returns The limitation text, or null when the watch is at full capability.
 */
function readLimitation(mode: GitWatchMode, watching: boolean, recursive: boolean): string | null {
  if (!watching) {
    return mode === "worktree"
      ? "worktree watch off; press r after external edits"
      : "git-dir watch unavailable; press r to refresh";
  }

  if (recursive) {
    return null;
  }

  return mode === "worktree"
    ? "worktree watch is top-level only; nested edits may need r"
    : "non-recursive watch: git-dir and refs directories only";
}

/**
 * Reports whether one filesystem event is known to be irrelevant.
 *
 * @param mode - Git-directory or worktree mode.
 * @param filename - Event path reported by the platform, or null when unknown.
 * @returns True when the event must not trigger a refresh.
 */
function shouldIgnoreWatchEvent(mode: GitWatchMode, filename: string | null): boolean {
  if (filename === null || filename.length === 0) {
    return false;
  }

  const segments = filename.replaceAll("\\", "/").split("/");

  if (mode === "worktree") {
    return segments.some((segment) => WORKTREE_IGNORED_SEGMENTS.has(segment));
  }

  return segments.some((segment) => GIT_DIR_IGNORED_FILENAMES.has(segment));
}

/**
 * Watches one target with `node:fs.watch`.
 *
 * @param target - Directory and recursion flag.
 * @param onChange - Called for every filesystem event with its relative filename.
 * @param onError - Called when the platform reports a watch error.
 * @returns A closable watch handle.
 */
function defaultWatch(
  target: GitWatchTarget,
  onChange: (filename: string | null) => void,
  onError: (error: unknown) => void,
): GitWatchHandle {
  const watcher = watch(target.path, { recursive: target.recursive }, (_event, filename) => {
    onChange(filename === null ? null : String(filename));
  });

  watcher.on("error", (error) => onError(error));

  return { close: () => watcher.close() };
}
