import { useEffect, useRef } from "react";
import { useRepository } from "@/app/hooks/useRepository";
import type { RepositoryContextValue } from "@/app/providers/RepositoryProvider.types";
import { executeRemoteFetch } from "@/domain/commands/commands.fetch";
import { registerCommandHandler } from "@/domain/commands/commands.runner";
import type {
  CommandExecutionOutcome,
  CommandHandlerContext,
} from "@/domain/commands/commands.types";
import type { RemoteCheckKind } from "@/domain/repository/repository.types";

/** Command id implemented by the M4 fetch handler. */
const REMOTE_FETCH_COMMAND_ID = "remote.fetch";

/** Operation label shown while fetch runs. */
const REMOTE_FETCH_LABEL = "Fetch";

/** Evidence kind recorded for a successful fetch. */
const REMOTE_FETCH_EVIDENCE_KIND: RemoteCheckKind = "fetch";

/**
 * Registers the real `remote.fetch` executor once for the mounted composition root.
 *
 * The executor returns per-remote results, and this wrapper records success evidence for each remote
 * that was actually reached. A failed remote is recorded as a failed attempt, which leaves its
 * `lastSuccessfulFetchAt` untouched. The runner rejects a duplicate registration, so a remount of
 * the composition root receives a no-op cleanup and never competes with the first handler. The M5
 * top bar replaces the temporary trigger but keeps this registration contract.
 */
export function useRemoteFetchCommand(): void {
  const { recordRemoteCheck } = useRepository();
  const recordRemoteCheckRef = useRef(recordRemoteCheck);

  recordRemoteCheckRef.current = recordRemoteCheck;

  useEffect(
    () =>
      registerCommandHandler({
        commandId: REMOTE_FETCH_COMMAND_ID,
        operationLabel: REMOTE_FETCH_LABEL,
        handler: (context) =>
          executeFetchWithEvidence(context, (remote, kind, succeeded) => {
            recordRemoteCheckRef.current(remote, kind, succeeded);
          }),
      }),
    [],
  );
}

/**
 * Executes the scoped fetch and records per-remote success evidence.
 *
 * A remote the executor reports as failed is recorded as an unsuccessful attempt, so its success
 * timestamp never advances. Remotes absent from the outcome, such as a scope probe that could not
 * run, are not recorded at all.
 *
 * @param context - Handler context passed through to the executor.
 * @param recordRemoteCheck - Evidence writer owned by the repository provider.
 * @returns The executor outcome unchanged.
 */
async function executeFetchWithEvidence(
  context: CommandHandlerContext,
  recordRemoteCheck: RepositoryContextValue["recordRemoteCheck"],
): Promise<CommandExecutionOutcome> {
  const outcome = await executeRemoteFetch(context);

  for (const remoteResult of outcome.remoteResults ?? []) {
    recordRemoteCheck(remoteResult.remote, REMOTE_FETCH_EVIDENCE_KIND, remoteResult.succeeded);
  }

  return outcome;
}
