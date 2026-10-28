import { useEffect, useRef } from "react";
import type {
  RemoteCommandDefinition,
  RemoteEvidenceWriters,
} from "@/app/hooks/useRemoteCommands.types";
import { useRepository } from "@/app/hooks/useRepository";
import { executeRemoteFetch } from "@/domain/commands/commands.fetch";
import { executeRemoteFetchPrune } from "@/domain/commands/commands.prune";
import { executeRemotePull, executeRemotePush } from "@/domain/commands/commands.remote";
import { registerCommandHandler } from "@/domain/commands/commands.runner";
import type {
  CommandExecutionOutcome,
  CommandHandlerContext,
} from "@/domain/commands/commands.types";
import type { RemoteCheckKind } from "@/domain/repository/repository.types";

/** Evidence kind recorded for a successful fetch or prune. */
const REMOTE_FETCH_EVIDENCE_KIND: RemoteCheckKind = "fetch";

/** Every remote command the top bar dispatches, with its user-facing operation label. */
const REMOTE_COMMANDS: readonly RemoteCommandDefinition[] = Object.freeze([
  { commandId: "remote.fetch", operationLabel: "Fetch", kind: "fetch" },
  { commandId: "remote.fetchPrune", operationLabel: "Fetch --prune", kind: "fetchPrune" },
  { commandId: "remote.pull", operationLabel: "Pull", kind: "pull" },
  { commandId: "remote.push", operationLabel: "Push", kind: "push" },
  { commandId: "remote.pushForceSafe", operationLabel: "Force push safely", kind: "push" },
  { commandId: "remote.pushForceOverwrite", operationLabel: "Overwrite remote", kind: "push" },
  { commandId: "remote.pushNoVerify", operationLabel: "Push without hooks", kind: "push" },
]);

/**
 * Registers every remote command executor once for the mounted composition root.
 *
 * The hook owns the evidence step that the domain executors deliberately leave out. Fetch and
 * Fetch --prune record each per-remote result, and Fetch --prune awaits the provider evidence
 * writers in order after the executor settles. Those writers re-read the repository on purpose, so
 * the orchestrator's own refresh sees the new upstream classification instead of a stale snapshot.
 * Pull and push write no evidence.
 *
 * The runner rejects a duplicate registration, so a remount of the composition root receives no-op
 * cleanups and never competes with the first mount.
 */
export function useRemoteCommands(): void {
  const { recordRemoteCheck, confirmUpstreamAbsent, markUpstreamUnknown, recordUpstreamEvidence } =
    useRepository();
  const writersRef = useRef<RemoteEvidenceWriters>({
    recordRemoteCheck,
    confirmUpstreamAbsent,
    markUpstreamUnknown,
    recordUpstreamEvidence,
  });

  writersRef.current = {
    recordRemoteCheck,
    confirmUpstreamAbsent,
    markUpstreamUnknown,
    recordUpstreamEvidence,
  };

  useEffect(() => {
    const cleanups = REMOTE_COMMANDS.map((definition) =>
      registerCommandHandler({
        commandId: definition.commandId,
        operationLabel: definition.operationLabel,
        handler: (context) => executeRemoteCommand(definition, context, writersRef.current),
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
 * Executes one remote command and records its evidence.
 *
 * @param definition - Command registration being executed.
 * @param context - Handler context passed through to the executor.
 * @param writers - Evidence writers owned by the repository provider.
 * @returns The executor outcome, unchanged after evidence is written.
 */
async function executeRemoteCommand(
  definition: RemoteCommandDefinition,
  context: CommandHandlerContext,
  writers: RemoteEvidenceWriters,
): Promise<CommandExecutionOutcome> {
  switch (definition.kind) {
    case "fetch":
      return executeFetchWithEvidence(executeRemoteFetch(context), writers);
    case "fetchPrune":
      return executeFetchPruneWithEvidence(executeRemoteFetchPrune(context), writers);
    case "pull":
      return executeRemotePull(context);
    case "push":
      return executeRemotePush(context);
  }
}

/**
 * Records per-remote fetch evidence after a scoped fetch settles.
 *
 * A remote the executor reports as failed is recorded as an unsuccessful attempt, so a failed
 * fetch never advances its freshness timestamp.
 *
 * @param execution - In-flight scoped fetch.
 * @param writers - Evidence writers owned by the repository provider.
 * @returns The executor outcome unchanged.
 */
async function executeFetchWithEvidence(
  execution: Promise<CommandExecutionOutcome>,
  writers: RemoteEvidenceWriters,
): Promise<CommandExecutionOutcome> {
  const outcome = await execution;

  recordRemoteResults(outcome, writers);

  return outcome;
}

/**
 * Records fetch, prune, and unknown-check evidence after Fetch --prune settles.
 *
 * Both lists are folded into evidence before a single repository read, so a prune of many refs does
 * not perform one full refresh per ref while the operation is still running. The combined writer
 * handles both lists in one pass, so a run with pruned and unknown refs still refreshes once. The
 * write is awaited, so the orchestrator's refresh that follows cannot race the classification update.
 *
 * @param execution - In-flight Fetch --prune.
 * @param writers - Evidence writers owned by the repository provider.
 * @returns The executor outcome unchanged.
 */
async function executeFetchPruneWithEvidence(
  execution: Promise<CommandExecutionOutcome>,
  writers: RemoteEvidenceWriters,
): Promise<CommandExecutionOutcome> {
  const outcome = await execution;

  recordRemoteResults(outcome, writers);

  await writers.recordUpstreamEvidence(
    outcome.prunedUpstreamRefs ?? [],
    outcome.unknownUpstreamRefs ?? [],
  );

  return outcome;
}

/**
 * Records every per-remote result reported by an executor.
 *
 * @param outcome - Settled executor outcome.
 * @param writers - Evidence writers owned by the repository provider.
 */
function recordRemoteResults(
  outcome: CommandExecutionOutcome,
  writers: RemoteEvidenceWriters,
): void {
  for (const remoteResult of outcome.remoteResults ?? []) {
    writers.recordRemoteCheck(
      remoteResult.remote,
      REMOTE_FETCH_EVIDENCE_KIND,
      remoteResult.succeeded,
    );
  }
}
