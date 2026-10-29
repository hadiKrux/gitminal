import { useCallback } from "react";
import { useAction } from "@/app/hooks/useAction";
import { useRepository } from "@/app/hooks/useRepository";
import type { useStatus } from "@/app/hooks/useStatus";
import { describeCommandReason } from "@/domain/commands/commands.reasons";
import type { CommandAvailability } from "@/domain/commands/commands.types";
import type { WorktreeRecord } from "@/domain/git/git.types";

/**
 * Owns the Worktrees region actions and their availability pre-checks.
 *
 * Create reports every unavailable state except the empty repository as a transient status; the
 * empty repository still opens the modal so its documented "no commits yet" reason stays visible
 * next to the disabled Create action. Delete validates availability first, so the current worktree
 * and a target that disappeared from the last read never open a modal.
 *
 * @param input - Active-row reader, modal openers, owning region, and status writer.
 * @returns The registered action callbacks.
 */
export function useWorktreeActions(input: {
  readonly readActiveRow: () => WorktreeRecord | null;
  readonly openCreateWorktree: () => void;
  readonly openDeleteWorktree: (worktree: WorktreeRecord) => void;
  readonly regionId: "worktrees";
  readonly setStatus: ReturnType<typeof useStatus>["setStatus"];
}) {
  const repository = useRepository();
  const { openCreateWorktree, openDeleteWorktree, readActiveRow } = input;
  const { regionId, setStatus } = input;

  /** Shows an unavailable reason as a transient warning status. */
  const reportUnavailable = useCallback(
    (availability: CommandAvailability): void => {
      setStatus({
        kind: "warning",
        message: describeCommandReason(availability.reason ?? "command-not-implemented"),
      });
    },
    [setStatus],
  );

  /** Opens the New Worktree modal when only the empty-repository reason would block it. */
  const createWorktree = useCallback((): void => {
    const availability = repository.getAvailability("worktree.create", { kind: "none" }, regionId);

    if (!availability.available && availability.reason !== "no-commits-yet") {
      reportUnavailable(availability);
      return;
    }

    openCreateWorktree();
  }, [openCreateWorktree, regionId, reportUnavailable, repository]);

  /** Opens the Delete Worktree modal for the active row after a fresh availability check. */
  const deleteWorktree = useCallback((): void => {
    const row = readActiveRow();

    if (row === null) {
      reportUnavailable({ available: false, reason: "missing-target" });
      return;
    }

    const availability = repository.getAvailability(
      "worktree.delete",
      { kind: "worktree", path: row.path },
      regionId,
    );

    if (!availability.available) {
      reportUnavailable(availability);
      return;
    }

    openDeleteWorktree(row);
  }, [openDeleteWorktree, readActiveRow, regionId, reportUnavailable, repository]);

  useAction("worktree.create", { scope: regionId, targetKind: "none" }, createWorktree);
  useAction("worktree.delete", { scope: regionId, targetKind: "worktree" }, deleteWorktree);
}
