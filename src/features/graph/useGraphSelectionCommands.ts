import { useCallback } from "react";
import { useInternalCommands } from "@/app/hooks/useInternalCommands";
import type { EnsureLoadedResult } from "@/domain/graph/graph.types";
import type { GraphSelectionTarget } from "@/features/graph/graph.types";

/**
 * Binds the graph's explicit selection targets to the internal selection commands.
 *
 * The graph never writes `RepositoryProvider.selection` itself: a row target is dispatched through
 * `graph.selectPending` or `graph.selectCommit`, and commit targets keep the provider's bounded
 * `ensureLoaded` walk. Keeping the two wrappers here leaves `useCommitGraph` a flat composition.
 *
 * @returns The pending-or-commit dispatcher and the bounded commit selector.
 */
export function useGraphSelectionCommands(): {
  readonly selectTarget: (target: GraphSelectionTarget) => void;
  readonly selectCommit: (oid: string) => Promise<EnsureLoadedResult>;
} {
  const { run, selectCommit } = useInternalCommands();

  /** Dispatches one explicit graph selection through the internal command seam. */
  const selectTarget = useCallback(
    (target: GraphSelectionTarget): void => {
      void run(target.kind === "pending" ? "graph.selectPending" : "graph.selectCommit", target);
    },
    [run],
  );

  return { selectTarget, selectCommit };
}
