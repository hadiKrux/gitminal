import { useCallback, useContext } from "react";
import { useAction } from "@/app/hooks/useAction";
import { useConsoleLog } from "@/app/hooks/useConsoleLog";
import { useStatus } from "@/app/hooks/useStatus";
import { RepositoryContext } from "@/app/providers/RepositoryProvider";
import type { RepositoryContextValue } from "@/app/providers/RepositoryProvider.types";
import { createConsoleEntryId, formatRefreshEntry } from "@/domain/console/console.format";

/**
 * Reads the repository snapshot, derived state, selection, and refresh cycle.
 *
 * @returns The repository context value.
 * @throws When called outside a `RepositoryProvider`.
 */
export function useRepository(): RepositoryContextValue {
  const value = useContext(RepositoryContext);

  if (!value) {
    throw new Error("useRepository must be used within a RepositoryProvider.");
  }

  return value;
}

/**
 * Registers the single global `app.refresh` handler.
 *
 * This is the read path: it calls `RepositoryProvider.refresh()` directly and never enters
 * `commands.runner.ts`, because a refresh is not a mutation. A user-initiated refresh is observable:
 * it writes one transient status and appends exactly one console entry. Watcher and terminal-focus
 * refreshes call the provider directly instead, so they stay silent. A request that joins an
 * in-flight refresh reports "refresh in progress" and does not append a second entry.
 *
 * The handler is registered once by the composition root. Features never register `app.refresh`.
 */
export function useRepositoryRefreshAction(): void {
  const repository = useRepository();
  const { setStatus } = useStatus();
  const { append } = useConsoleLog();

  const runManualRefresh = useCallback(async (): Promise<void> => {
    if (repository.isRefreshing) {
      setStatus({ kind: "info", message: "Refresh in progress" });

      return;
    }

    const startedAt = Date.now();
    const result = await repository.refresh();

    if (result.coalesced) {
      setStatus({ kind: "info", message: "Refresh in progress" });

      return;
    }

    append(
      formatRefreshEntry({
        id: createConsoleEntryId(),
        at: startedAt,
        ok: result.ok,
        message: result.ok ? "Repository refreshed" : (result.error ?? "Refresh failed"),
        durationMs: Date.now() - startedAt,
        repositoryRoot: repository.snapshot?.root ?? null,
        cwd: repository.signals.cwd,
      }),
    );

    setStatus(
      result.ok
        ? { kind: "success", message: "Repository refreshed" }
        : { kind: "warning", message: result.error ?? "Refresh failed" },
    );
  }, [append, repository, setStatus]);

  useAction("app.refresh", { scope: "global", owner: "app" }, () => {
    void runManualRefresh();
  });
}
