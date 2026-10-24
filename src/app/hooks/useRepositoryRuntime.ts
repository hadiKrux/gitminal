import { useMemo } from "react";
import { useConfig } from "@/app/hooks/useConfig";
import type {
  RepositoryRuntime,
  RepositoryRuntimeInput,
} from "@/app/hooks/useRepositoryRuntime.types";
import { createGitClient } from "@/domain/git/git.client";
import type { GitClient } from "@/domain/git/git.types";
import { createGitWatcher } from "@/domain/git/git.watcher";

/**
 * Builds the repository runtime collaborators from configuration and provider props.
 *
 * One git client is created from `config.git.path` unless the provider injected one, so reads and
 * the command runner share the same index latch and SSH detection cache. The watcher factory and
 * clock are also resolved here so the provider body only composes values.
 *
 * @param input - Provider seams and launch directory.
 * @returns The resolved runtime.
 */
export function useRepositoryRuntime(input: RepositoryRuntimeInput): RepositoryRuntime {
  const { config } = useConfig();
  const cwd = useMemo(() => input.cwd ?? process.cwd(), [input.cwd]);
  const now = useMemo(() => input.now ?? (() => Date.now()), [input.now]);
  const gitClient = useMemo<GitClient>(
    () => input.gitClient ?? createGitClient({ gitPath: config.git.path }),
    [input.gitClient, config.git.path],
  );
  const watcherFactory = useMemo(
    () => input.createWatcher ?? createGitWatcher,
    [input.createWatcher],
  );

  return {
    cwd,
    now,
    gitClient,
    watcherFactory,
    enableWatcher: input.enableWatcher ?? true,
    worktreeWatch: input.worktreeWatch ?? false,
    watchDebounceMs: input.watchDebounceMs,
  };
}
