import { useCallback } from "react";
import type {
  InternalCommandResult,
  InternalCommandsHandle,
} from "@/app/hooks/useInternalCommands.types";
import { useRepository } from "@/app/hooks/useRepository";
import type { CommandAvailabilityReason, CommandTarget } from "@/domain/commands/commands.types";
import type { EnsureLoadedResult } from "@/domain/graph/graph.types";
import type { RepositorySelection } from "@/domain/repository/repository.types";

/** Result reported when a command selected the right-pane value successfully. */
const HANDLED: InternalCommandResult = Object.freeze({ status: "handled" });

/**
 * Builds one blocked internal-command result.
 *
 * @param reason - Machine-readable availability reason.
 * @returns The blocked result.
 */
function blocked(reason: CommandAvailabilityReason): InternalCommandResult {
  return { status: "blocked", reason };
}

/**
 * Selects the Pending Changes row, refusing a misrouted target.
 *
 * @param target - Explicit command target.
 * @param setSelection - Provider selection writer.
 * @returns The handled or blocked result.
 */
function selectPendingTarget(
  target: CommandTarget,
  setSelection: (selection: RepositorySelection) => void,
): InternalCommandResult {
  if (target.kind !== "pending") {
    return blocked("missing-target");
  }

  setSelection({ kind: "pending" });

  return HANDLED;
}

/**
 * Maps a bounded commit selection outcome to an internal command result.
 *
 * @param result - Outcome returned by the graph's bounded navigator.
 * @returns Handled when loaded, a neutral blocked reason when cancelled or failed, otherwise
 * invalid-target.
 */
function readCommitSelectionResult(result: EnsureLoadedResult): InternalCommandResult {
  if (result === "loaded") {
    return HANDLED;
  }

  return blocked(
    result === "cancelled" || result === "error" ? "operation-in-progress" : "invalid-target",
  );
}

/**
 * Dispatches `graph.selectCommit` against an explicit commit target.
 *
 * @param target - Explicit command target.
 * @param selectCommit - Bounded provider selector.
 * @returns The handled or blocked result.
 */
async function runCommitSelection(
  target: CommandTarget,
  selectCommit: (oid: string) => Promise<EnsureLoadedResult>,
): Promise<InternalCommandResult> {
  if (target.kind !== "commit") {
    return blocked("missing-target");
  }

  return readCommitSelectionResult(await selectCommit(target.oid));
}

/**
 * Resolves the internal selection commands without the mutation runner.
 *
 * Internal navigation commands have no action id and no git step: they only move
 * `RepositoryProvider.selection`. `graph.selectCommit` keeps the provider's bounded `ensureLoaded`
 * walk, so a target outside the loaded window still loads before it becomes selected. The typed
 * result lets the future palette report a stale, missing, or unreadable target instead of throwing,
 * while a cancellation or a page read failure stays a neutral operation-in-progress block.
 *
 * @returns The dispatcher handle.
 */
export function useInternalCommands(): InternalCommandsHandle {
  const { selectCommit, setSelection } = useRepository();

  /** Dispatches one explicit selection target. */
  const run = useCallback(
    async (commandId: string, target: CommandTarget): Promise<InternalCommandResult> => {
      switch (commandId) {
        case "graph.selectCommit": {
          return await runCommitSelection(target, selectCommit);
        }
        case "graph.selectPending": {
          return selectPendingTarget(target, setSelection);
        }
        case "stash.select": {
          if (target.kind !== "stash") {
            return blocked("missing-target");
          }

          setSelection({ kind: "stash", objectName: target.objectName });

          return HANDLED;
        }
        case "worktree.select": {
          if (target.kind !== "worktree") {
            return blocked("missing-target");
          }

          setSelection({ kind: "worktree", path: target.path });

          return HANDLED;
        }
        default:
          return blocked("command-not-found");
      }
    },
    [selectCommit, setSelection],
  );

  /** Selects one commit through the bounded selector the internal command uses. */
  const selectCommitTarget = useCallback(
    async (oid: string): Promise<EnsureLoadedResult> => await selectCommit(oid),
    [selectCommit],
  );

  return { run, selectCommit: selectCommitTarget };
}
