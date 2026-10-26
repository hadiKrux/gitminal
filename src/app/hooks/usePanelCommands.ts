import { useEffect, useRef } from "react";
import type { PanelCommandDefinition } from "@/app/hooks/usePanelCommands.types";
import { useRepository } from "@/app/hooks/useRepository";
import type { RepositoryContextValue } from "@/app/providers/RepositoryProvider.types";
import {
  executeBranchCheckout,
  executeBranchCreate,
  executeBranchDelete,
  executeRemoteCreateLocal,
} from "@/domain/commands/commands.branches";
import { readFormString } from "@/domain/commands/commands.invoke";
import { getCommandDescriptor } from "@/domain/commands/commands.registry";
import { registerCommandHandler } from "@/domain/commands/commands.runner";
import {
  executeStashApply,
  executeStashCreate,
  executeStashDelete,
  executeStashPop,
} from "@/domain/commands/commands.stashes";
import {
  executeTagCreate,
  executeTagDelete,
  executeTagPush,
} from "@/domain/commands/commands.tags";
import type {
  CommandExecutionOutcome,
  CommandHandlerContext,
} from "@/domain/commands/commands.types";
import { executeWorktreeCreate, executeWorktreeDelete } from "@/domain/commands/commands.worktrees";

/** Every sidebar panel mutation the composition root registers, with its executor and evidence. */
const PANEL_COMMANDS: readonly PanelCommandDefinition[] = Object.freeze([
  { commandId: "branch.create", execute: executeBranchCreate, evidence: "none" },
  { commandId: "branch.checkout", execute: executeBranchCheckout, evidence: "none" },
  { commandId: "branch.delete", execute: executeBranchDelete, evidence: "branchDelete" },
  { commandId: "remote.createLocal", execute: executeRemoteCreateLocal, evidence: "none" },
  { commandId: "tag.create", execute: executeTagCreate, evidence: "remoteTags" },
  { commandId: "tag.push", execute: executeTagPush, evidence: "remoteTags" },
  { commandId: "tag.delete", execute: executeTagDelete, evidence: "remoteTags" },
  { commandId: "stash.create", execute: executeStashCreate, evidence: "none" },
  { commandId: "stash.apply", execute: executeStashApply, evidence: "none" },
  { commandId: "stash.pop", execute: executeStashPop, evidence: "none" },
  { commandId: "stash.delete", execute: executeStashDelete, evidence: "none" },
  { commandId: "worktree.create", execute: executeWorktreeCreate, evidence: "none" },
  { commandId: "worktree.delete", execute: executeWorktreeDelete, evidence: "none" },
]);

/** The delete scope that also removes the remote branch. */
const LOCAL_AND_REMOTE_SCOPE = "local-remote";

/**
 * Registers every sidebar panel command executor once for the mounted composition root.
 *
 * The hook owns the evidence step the domain executors deliberately leave out, mirroring
 * `useRemoteCommands`. A branch delete that succeeded on both halves records a confirmed remote
 * deletion with `confirmUpstreamAbsent`, so local branches that tracked it classify as
 * `deleted-after-app-deletion` after the orchestrator's refresh without another prune. A tag push or
 * delete that reached a remote re-reads that remote's tag knowledge, because only a successful
 * `ls-remote` may prove which tags exist there.
 *
 * The runner rejects a duplicate registration, so a remount of the composition root receives no-op
 * cleanups and never competes with the first mount.
 */
export function usePanelCommands(): void {
  const repository = useRepository();
  const repositoryRef = useRef<RepositoryContextValue>(repository);

  repositoryRef.current = repository;

  useEffect(() => {
    const cleanups = PANEL_COMMANDS.map((definition) =>
      registerCommandHandler({
        commandId: definition.commandId,
        operationLabel: readOperationLabel(definition.commandId),
        handler: (context) => executePanelCommand(definition, context, repositoryRef.current),
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
 * Executes one panel command and records the evidence its definition declares.
 *
 * @param definition - Command registration being executed.
 * @param context - Handler context passed through to the executor.
 * @param repository - Repository operations owned by the provider.
 * @returns The executor outcome, unchanged after evidence is written.
 */
async function executePanelCommand(
  definition: PanelCommandDefinition,
  context: CommandHandlerContext,
  repository: RepositoryContextValue,
): Promise<CommandExecutionOutcome> {
  const outcome = await definition.execute(context);

  if (definition.evidence === "branchDelete") {
    return await recordBranchDeleteEvidence(outcome, context, repository);
  }

  return definition.evidence === "remoteTags"
    ? await recordTagEvidence(outcome, repository)
    : outcome;
}

/**
 * Records a confirmed remote branch deletion after a local-and-remote delete.
 *
 * The remote ref is derived from the form values the executor used, so the confirmed deletion names
 * exactly the branch that was deleted. Only a reported successful remote result writes evidence; a
 * failed or skipped remote half records nothing and therefore never changes a branch classification.
 *
 * @param outcome - Settled branch delete outcome.
 * @param context - Handler context carrying the request form values.
 * @param repository - Repository operations owned by the provider.
 * @returns The executor outcome unchanged.
 */
async function recordBranchDeleteEvidence(
  outcome: CommandExecutionOutcome,
  context: CommandHandlerContext,
  repository: RepositoryContextValue,
): Promise<CommandExecutionOutcome> {
  const values = context.request.formValues;

  if (readFormString(values, "scope") !== LOCAL_AND_REMOTE_SCOPE) {
    return outcome;
  }

  const remote = readFormString(values, "remote");
  const branch = readFormString(values, "remoteBranch") || readTargetBranchName(context);
  const succeeded = outcome.remoteResults?.some(
    (result) => result.remote === remote && result.succeeded,
  );

  if (remote.length === 0 || branch.length === 0 || succeeded !== true) {
    return outcome;
  }

  await repository.confirmUpstreamAbsent(`${remote}/${branch}`, "app-deletion");

  return outcome;
}

/**
 * Reads the branch name a branch delete targeted.
 *
 * @param context - Handler context carrying the explicit target.
 * @returns The target branch name, or an empty string for another target kind.
 */
function readTargetBranchName(context: CommandHandlerContext): string {
  return context.target.kind === "branch" ? context.target.name : "";
}

/**
 * Re-reads remote tag knowledge after a tag command reached a remote.
 *
 * A failed step records nothing as confirmed, and a local-only operation never re-reads a remote it
 * did not contact, so the tags panel keeps its last known scope until a real remote change happens.
 *
 * @param outcome - Settled tag command outcome.
 * @param repository - Repository operations owned by the provider.
 * @returns The executor outcome unchanged.
 */
async function recordTagEvidence(
  outcome: CommandExecutionOutcome,
  repository: RepositoryContextValue,
): Promise<CommandExecutionOutcome> {
  const reachedRemote = outcome.remoteResults?.some((result) => result.succeeded) ?? false;

  if (reachedRemote) {
    await repository.refreshRemoteTags();
  }

  return outcome;
}

/**
 * Reads a command's operation label from the catalogue.
 *
 * The registry is the single source of the label shown by the status strip and the console, so a
 * rename cannot leave the registration and the palette disagreeing.
 *
 * @param commandId - Stable command id.
 * @returns The catalogue label, or the id when the command is unknown.
 */
function readOperationLabel(commandId: string): string {
  const descriptor = getCommandDescriptor(commandId);

  return descriptor === undefined ? commandId : descriptor.label;
}
