import { useCallback, useRef } from "react";
import { isCommandOrchestrationActive } from "@/app/hooks/commandRunner.state";
import type {
  RepositoryAvailabilityInput,
  TagRowsCache,
} from "@/app/hooks/useRepositoryAvailability.types";
import type {
  RepositoryContextValue,
  RepositoryStore,
} from "@/app/providers/RepositoryProvider.types";
import { getAvailability } from "@/domain/commands/commands.availability";
import { isCommandRunning } from "@/domain/commands/commands.runner";
import type { CommandPanelFacts } from "@/domain/commands/commands.types";
import type { TagRowRecord } from "@/domain/git/git.types";
import { selectTagRows } from "@/domain/repository/repository.selectors";
import { detectRepositoryState } from "@/domain/repository/repository.states";

/**
 * Builds the target-aware availability reader from the latest store.
 *
 * The returned function reads the current signals, panel facts, and command latch at call time, so a
 * handler always validates against fresh state without making the provider value change on every
 * read. Optional form values pass through so a modal check evaluates the live form, such as the
 * create-stash include-untracked checkbox. Panel facts come from the same snapshot the panels
 * render, and merged tag rows are memoized
 * per snapshot plus tag knowledge because a tag list asks for availability once per row and the merge
 * is O(n log n). The orchestration flag keeps mutations blocked through the post-result refresh
 * window, after the domain write latch has already been released.
 *
 * @param input - Store ref.
 * @returns The availability reader exposed by the provider.
 */
export function useRepositoryAvailability(
  input: RepositoryAvailabilityInput,
): RepositoryContextValue["getAvailability"] {
  const tagRowsRef = useRef<TagRowsCache | null>(null);

  const readTagRows = useCallback((store: RepositoryStore): readonly TagRowRecord[] => {
    const cached = tagRowsRef.current;

    if (
      cached !== null &&
      cached.snapshot === store.snapshot &&
      cached.checks === store.remoteTagChecks
    ) {
      return cached.rows;
    }

    const rows = selectTagRows(store.snapshot, store.remoteTagChecks);

    tagRowsRef.current = {
      snapshot: store.snapshot,
      checks: store.remoteTagChecks,
      rows,
    };

    return rows;
  }, []);

  return useCallback<RepositoryContextValue["getAvailability"]>(
    (commandId, target, region, formValues) => {
      const store = input.storeRef.current;

      return getAvailability(commandId, {
        state: detectRepositoryState(store.signals),
        signals: store.signals,
        target,
        region,
        operation: readCommandOperation(),
        panel: buildPanelFacts(store, readTagRows(store)),
        formValues,
      });
    },
    [input.storeRef, readTagRows],
  );
}

/**
 * Builds the panel facts a target-aware check may read.
 *
 * Every field is a reference into the current snapshot, so no list is copied per availability call.
 * A missing snapshot leaves the lists absent, which keeps checks permissive instead of blocking on
 * evidence the provider does not have yet.
 *
 * @param store - Latest provider store.
 * @param tagRows - Merged tag rows derived from the same store.
 * @returns The panel facts.
 */
function buildPanelFacts(
  store: RepositoryStore,
  tagRows: readonly TagRowRecord[],
): CommandPanelFacts {
  const snapshot = store.snapshot;

  return {
    branches: snapshot?.branches,
    remoteBranches: snapshot?.remoteBranches,
    stashes: snapshot?.stashes,
    worktrees: snapshot?.worktrees,
    tagRows,
    status: snapshot?.status ?? null,
  };
}

/**
 * Reads the current command operation state for availability.
 *
 * @returns `running` while the domain latch or the orchestrator owns the single slot.
 */
function readCommandOperation(): "idle" | "running" {
  return isCommandRunning() || isCommandOrchestrationActive() ? "running" : "idle";
}
