import type { CommandStatusWriters } from "@/app/hooks/useCommandRunner.types";
import type { RepositoryContextValue } from "@/app/providers/RepositoryProvider.types";
import { describeCommandReason } from "@/domain/commands/commands.reasons";
import type {
  CommandAvailabilityReason,
  CommandRegion,
  CommandRequest,
  CommandResult,
} from "@/domain/commands/commands.types";

/**
 * Reads availability before a command starts.
 *
 * A blocked request never starts an operation, refreshes the repository, appends a console entry, or
 * opens an error surface. The reason is surfaced as a transient warning instead.
 *
 * @param input - Request, region, repository state, label, and status writer.
 * @returns A blocked result, or null when the command may run.
 */
export function readBlockedResult(input: {
  readonly request: CommandRequest;
  readonly region: CommandRegion;
  readonly repository: RepositoryContextValue;
  readonly operationLabel: string;
  readonly setStatus: CommandStatusWriters["setStatus"];
}): CommandResult | null {
  const availability = input.repository.getAvailability(
    input.request.commandId,
    input.request.target,
    input.region,
  );

  if (availability.available) {
    return null;
  }

  return surfaceBlocked({
    request: input.request,
    operationLabel: input.operationLabel,
    cwd: input.repository.signals.cwd,
    reason: availability.reason ?? "command-not-implemented",
    setStatus: input.setStatus,
  });
}

/**
 * Surfaces a blocked result that the runner itself rejected.
 *
 * @param result - Blocked result.
 * @param input - Request, label, working directory, and status writer.
 * @returns The blocked result.
 */
export function surfaceRunnerBlocked(
  result: CommandResult,
  input: {
    readonly request: CommandRequest;
    readonly operationLabel: string;
    readonly cwd: string;
    readonly setStatus: CommandStatusWriters["setStatus"];
  },
): CommandResult {
  return surfaceBlocked({
    request: input.request,
    operationLabel: input.operationLabel,
    cwd: input.cwd,
    reason: result.blockedReason ?? "command-not-implemented",
    setStatus: input.setStatus,
  });
}

/**
 * Surfaces a blocked request as a transient status without starting an operation.
 *
 * @param input - Request, label, working directory, reason, and status writer.
 * @returns The blocked result.
 */
export function surfaceBlocked(input: {
  readonly request: CommandRequest;
  readonly operationLabel: string;
  readonly cwd: string;
  readonly reason: CommandAvailabilityReason;
  readonly setStatus: CommandStatusWriters["setStatus"];
}): CommandResult {
  input.setStatus({ kind: "warning", message: describeCommandReason(input.reason) });

  return createBlockedResult(
    input.request.commandId,
    input.operationLabel,
    input.cwd,
    input.reason,
  );
}

/**
 * Builds a blocked result without invoking the runner.
 *
 * @param commandId - Requested command id.
 * @param operationLabel - Human-readable label.
 * @param cwd - Working directory the command would have used.
 * @param reason - Machine-readable blocked reason.
 * @returns A blocked result with no steps.
 */
function createBlockedResult(
  commandId: string,
  operationLabel: string,
  cwd: string,
  reason: CommandAvailabilityReason,
): CommandResult {
  return {
    commandId,
    status: "blocked",
    operationLabel,
    steps: [],
    cwd,
    progress: [],
    blockedReason: reason,
  };
}
