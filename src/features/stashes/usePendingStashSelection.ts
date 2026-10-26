import { useCallback, useEffect, useState } from "react";
import type { StashRecord } from "@/domain/git/git.types";
import type { RepositorySnapshot } from "@/domain/repository/repository.types";
import { resolveCreatedStash } from "@/features/stashes/stash.resolve";
import type { PendingStashCreation } from "@/features/stashes/useStashes.types";

/**
 * Selects and reveals the stash created by the last successful command.
 *
 * The effect waits for the repository snapshot identity to change from the one captured before the
 * command, so it never resolves the old list. The target comes from the refreshed snapshot through
 * `resolveCreatedStash`, which needs the list to prove growth before falling back to the newest row:
 * a pre-command read that settles after the command leaves the pending target in place until the
 * follow-up read observes the created stash. The cursor then moves to that row. No second list is
 * kept.
 *
 * @param input - Snapshot, refreshed rows, and the selection writers.
 * @returns The request a successful create makes.
 */
export function usePendingStashSelection(input: {
  readonly snapshot: RepositorySnapshot | null;
  readonly orderedRows: readonly StashRecord[];
  readonly visibleRows: readonly StashRecord[];
  readonly selectStash: (stash: StashRecord) => void;
  readonly selectIndex: (index: number) => void;
}) {
  const [pending, setPending] = useState<PendingStashCreation | null>(null);
  const { orderedRows, selectIndex, selectStash, snapshot, visibleRows } = input;

  useEffect(() => {
    if (pending === null || snapshot === pending.snapshot) {
      return;
    }

    const target = resolveCreatedStash(orderedRows, pending.message, pending.previousCount);

    if (target === null) {
      return;
    }

    setPending(null);
    selectStash(target);

    const index = visibleRows.findIndex((row) => row.objectName === target.objectName);

    if (index >= 0) {
      selectIndex(index);
    }
  }, [orderedRows, pending, selectIndex, selectStash, snapshot, visibleRows]);

  /** Records a successful create so the next snapshot can select the new stash. */
  const requestCreatedStash = useCallback((next: PendingStashCreation): void => {
    setPending(next);
  }, []);

  return { requestCreatedStash };
}
