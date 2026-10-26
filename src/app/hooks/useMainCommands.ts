import { useEffect } from "react";
import type { MainCommandDefinition } from "@/app/hooks/useMainCommands.types";
import {
  executeCommitAmend,
  executeCommitAmendNoVerify,
  executeCommitSubmit,
  executeCommitSubmitNoVerify,
} from "@/domain/commands/commands.commit";
import {
  executeDiffDeleteAllUntracked,
  executeDiffDeleteUntracked,
  executeDiffDiscard,
  executeDiffDiscardAll,
  executeDiffStage,
  executeDiffStageAll,
  executeDiffUnstage,
  executeDiffUnstageAll,
} from "@/domain/commands/commands.diff";
import { getCommandDescriptor } from "@/domain/commands/commands.registry";
import { registerCommandHandler } from "@/domain/commands/commands.runner";

/**
 * Commands owned by the main-area surfaces, in registration order.
 *
 * The diff panel and the commit composer both register here, so a new main-area feature adds rows
 * instead of creating a second registration hook. Nothing in this table reads a cursor: each
 * executor resolves its target from the request or its form values.
 */
const MAIN_COMMANDS: readonly MainCommandDefinition[] = Object.freeze([
  { commandId: "diff.stage", execute: executeDiffStage },
  { commandId: "diff.unstage", execute: executeDiffUnstage },
  { commandId: "diff.discard", execute: executeDiffDiscard },
  { commandId: "diff.deleteUntracked", execute: executeDiffDeleteUntracked },
  { commandId: "diff.stageAll", execute: executeDiffStageAll },
  { commandId: "diff.unstageAll", execute: executeDiffUnstageAll },
  { commandId: "diff.discardAll", execute: executeDiffDiscardAll },
  { commandId: "diff.deleteAllUntracked", execute: executeDiffDeleteAllUntracked },
  { commandId: "commit.submit", execute: executeCommitSubmit },
  { commandId: "commit.submitNoVerify", execute: executeCommitSubmitNoVerify },
  { commandId: "commit.amend", execute: executeCommitAmend },
  { commandId: "commit.amendNoVerify", execute: executeCommitAmendNoVerify },
]);

/**
 * Registers every main-area command executor once for the mounted composition root.
 *
 * The runner rejects a duplicate registration, so a remount receives no-op cleanups and never
 * competes with the first mount. Registration is keyed by command id only; the availability and
 * serialization rules stay in the runner.
 */
export function useMainCommands(): void {
  useEffect(() => {
    const cleanups = MAIN_COMMANDS.map((definition) =>
      registerCommandHandler({
        commandId: definition.commandId,
        operationLabel: readOperationLabel(definition.commandId),
        handler: definition.execute,
      }),
    );

    return () => {
      for (const cleanup of cleanups) {
        cleanup();
      }
    };
  }, []);
}

/**
 * Reads a command's operation label from the catalogue.
 *
 * @param commandId - Stable command id.
 * @returns The catalogue label, or the id when the command is unknown.
 */
function readOperationLabel(commandId: string): string {
  const descriptor = getCommandDescriptor(commandId);

  return descriptor === undefined ? commandId : descriptor.label;
}
