import { useCallback } from "react";
import type { useCommandRunner } from "@/app/hooks/useCommandRunner";
import type { useRepository } from "@/app/hooks/useRepository";
import type { useStatus } from "@/app/hooks/useStatus";
import { describeCommandReason } from "@/domain/commands/commands.reasons";

/**
 * Builds the object-name-keyed stash mutation runner.
 *
 * The executor resolves the object name against a fresh stash list at action time. A blocked
 * `stash-changed-externally` result means the snapshot is stale, so the list is refreshed before the
 * next action and the documented reason stays visible. A failed apply or pop keeps the stash, and
 * the orchestrator's refresh is what re-renders the surviving row.
 *
 * @param input - Command runner, status refresh, and status writer.
 * @returns The mutation runner.
 */
export function useStashMutations(input: {
  readonly runCommand: ReturnType<typeof useCommandRunner>["runCommand"];
  readonly refreshStatus: ReturnType<typeof useRepository>["refreshStatus"];
  readonly setStatus: ReturnType<typeof useStatus>["setStatus"];
}): (commandId: "stash.apply" | "stash.pop" | "stash.delete", objectName: string) => Promise<void> {
  const { refreshStatus, runCommand, setStatus } = input;

  return useCallback(
    async (
      commandId: "stash.apply" | "stash.pop" | "stash.delete",
      objectName: string,
    ): Promise<void> => {
      const result = await runCommand({
        commandId,
        target: { kind: "stash", objectName },
      }).catch(() => null);

      if (result?.status !== "blocked" || result.blockedReason !== "stash-changed-externally") {
        return;
      }

      setStatus({ kind: "warning", message: describeCommandReason("stash-changed-externally") });
      await refreshStatus();
    },
    [refreshStatus, runCommand, setStatus],
  );
}
