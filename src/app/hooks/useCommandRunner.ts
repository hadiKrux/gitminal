import { useCallback, useMemo } from "react";
import {
  abortActiveCommand,
  clearCommandExecution,
  isCommandOrchestrationActive,
  recordCommandExecution,
} from "@/app/hooks/commandRunner.state";
import type {
  CommandFailureReport,
  CommandRunnerHook,
  CommandStatusWriters,
  UseCommandRunnerOptions,
} from "@/app/hooks/useCommandRunner.types";
import { useConsoleLog } from "@/app/hooks/useConsoleLog";
import { useFocusState } from "@/app/hooks/useFocusState";
import { useRepository } from "@/app/hooks/useRepository";
import { useStatus } from "@/app/hooks/useStatus";
import type { RepositoryContextValue } from "@/app/providers/RepositoryProvider.types";
import { describeCommandReason } from "@/domain/commands/commands.reasons";
import { getCommandDescriptor } from "@/domain/commands/commands.registry";
import { runCommand as runDomainCommand } from "@/domain/commands/commands.runner";
import type {
  CommandAvailabilityReason,
  CommandRegion,
  CommandRequest,
  CommandResult,
} from "@/domain/commands/commands.types";
import { createConsoleEntryId, formatCommandResult } from "@/domain/console/console.format";
import { redactCommandResult } from "@/domain/git/git.redact";

/**
 * Runs commands through the single domain executor and applies every result effect.
 *
 * This hook is the only application caller of `commands.runner.ts`. It follows the fixed effect
 * order: availability pre-check, `beginOperation`, the runner, progress updates, redaction, exactly
 * one console append, a repository refresh on every non-blocked outcome, then `endOperation` plus a
 * success, warning, or error result. A blocked command performs none of those effects beyond the
 * transient reason. A cancelled or timed-out command is a warning, never success, and never opens
 * the error surface. Drafts and selection are never touched, so they survive every failure.
 *
 * Only one orchestration exists at a time. A second request while the first command still applies
 * its post-result effects returns a blocked result before `beginOperation`, so the active operation
 * progress is never replaced and the abort slot always points at the child that is actually running.
 *
 * @param options - Optional error surface; defaults to an error status.
 * @returns The command entry point and abort handle.
 */
export function useCommandRunner(options: UseCommandRunnerOptions = {}): CommandRunnerHook {
  const repository = useRepository();
  const { setStatus, beginOperation, updateOperation, endOperation } = useStatus();
  const { append } = useConsoleLog();
  const { state: focusState } = useFocusState();

  /** Routes a failure through the injected sink or the default error status. */
  const defaultErrorSink = useCallback(
    (report: CommandFailureReport): void => {
      setStatus({ kind: "error", message: report.message });
    },
    [setStatus],
  );

  const errorSink = options.onError ?? defaultErrorSink;

  /** Resolves the command region from the current focus projection. */
  const readRegion = useCallback((): CommandRegion => {
    const activeRegion = focusState.activeRegion;

    return activeRegion ?? "top-bar";
  }, [focusState.activeRegion]);

  const runCommand = useCallback(
    (request: CommandRequest): Promise<CommandResult> => {
      const operationLabel = readOperationLabel(request.commandId);

      if (isCommandOrchestrationActive()) {
        return Promise.resolve(
          surfaceBlocked({
            request,
            operationLabel,
            cwd: repository.signals.cwd,
            reason: "operation-in-progress",
            setStatus,
          }),
        );
      }

      const controller = new AbortController();
      const execution = executeRequest({
        request,
        region: readRegion(),
        repository,
        operationLabel,
        controller,
        append,
        beginOperation,
        updateOperation,
        endOperation,
        errorSink,
        setStatus,
      });

      recordCommandExecution(controller, execution);

      return execution.finally(() => {
        clearCommandExecution(execution);
      });
    },
    [
      append,
      beginOperation,
      endOperation,
      errorSink,
      readRegion,
      repository,
      setStatus,
      updateOperation,
    ],
  );

  /**
   * Aborts the current invocation and waits for every post-result effect to settle.
   *
   * Quit calls this before destroying the renderer so the client's `SIGTERM`-then-`SIGKILL` sequence
   * completes and the child has stopped writing to the terminal. The active invocation is shared
   * across hook instances, so any surface's quit waits for the command it started.
   */
  const abort = useCallback((): Promise<void> => abortActiveCommand(), []);

  return useMemo(() => ({ runCommand, abort }), [runCommand, abort]);
}

/**
 * Executes one command and applies every effect in the documented order.
 *
 * @param input - Request, captured context, collaborators, and the owned abort controller.
 * @returns The redacted result.
 */
async function executeRequest(input: {
  readonly request: CommandRequest;
  readonly region: CommandRegion;
  readonly repository: RepositoryContextValue;
  readonly operationLabel: string;
  readonly controller: AbortController;
  readonly append: (entry: ReturnType<typeof formatCommandResult>) => void;
  readonly beginOperation: (label: string) => void;
  readonly updateOperation: (progress: { phase?: string; percent?: number | null }) => void;
  readonly endOperation: () => void;
  readonly errorSink: CommandStatusWriters["errorSink"];
  readonly setStatus: CommandStatusWriters["setStatus"];
}): Promise<CommandResult> {
  const { request, region, repository, operationLabel, controller, setStatus } = input;
  const blocked = readBlockedResult({
    request,
    region,
    repository,
    operationLabel,
    setStatus,
  });

  if (blocked !== null) {
    return blocked;
  }

  input.beginOperation(operationLabel);

  try {
    const result = await runDomainCommand(request, {
      state: repository.state,
      signals: repository.signals,
      target: request.target,
      region,
      signal: controller.signal,
      onProgress: (progress) => input.updateOperation(progress),
      client: repository.gitClient,
    });

    if (result.status === "blocked") {
      input.endOperation();

      return surfaceRunnerBlocked(result, {
        request,
        operationLabel,
        cwd: repository.signals.cwd,
        setStatus,
      });
    }

    return await applyResult(result, {
      append: input.append,
      endOperation: input.endOperation,
      errorSink: input.errorSink,
      operationLabel,
      refresh: repository.refresh,
      repositoryRoot: repository.snapshot?.root ?? null,
      setStatus,
    });
  } catch (error) {
    input.endOperation();

    const message = error instanceof Error ? error.message : String(error);

    setStatus({ kind: "error", message });

    throw error;
  }
}

/**
 * Reads a command's display label.
 *
 * @param commandId - Command id.
 * @returns The catalogue label, or the id when the command is unknown.
 */
function readOperationLabel(commandId: string): string {
  const descriptor = getCommandDescriptor(commandId);

  return descriptor === undefined ? commandId : descriptor.label;
}

/**
 * Surfaces a blocked result that the runner itself rejected.
 *
 * @param result - Blocked result.
 * @param input - Request, label, working directory, and status writer.
 * @returns The blocked result.
 */
function surfaceRunnerBlocked(
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
 * Reads availability before a command starts.
 *
 * @param input - Request, region, repository state, label, and status writer.
 * @returns A blocked result, or null when the command may run.
 */
function readBlockedResult(input: {
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
 * Surfaces a blocked request as a transient status without starting an operation.
 *
 * @param input - Request, label, working directory, reason, and status writer.
 * @returns The blocked result.
 */
function surfaceBlocked(input: {
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
 * Redacts, logs, refreshes, and reports one executed result.
 *
 * @param result - Raw result returned by the runner.
 * @param context - Console, status, refresh, and error collaborators.
 * @returns The redacted result.
 */
async function applyResult(
  result: CommandResult,
  context: {
    readonly append: (entry: ReturnType<typeof formatCommandResult>) => void;
    readonly endOperation: () => void;
    readonly errorSink: CommandStatusWriters["errorSink"];
    readonly operationLabel: string;
    readonly refresh: () => Promise<unknown>;
    readonly repositoryRoot: string | null;
    readonly setStatus: CommandStatusWriters["setStatus"];
  },
): Promise<CommandResult> {
  const redacted = redactCommandResult(result);
  const entry = formatCommandResult(redacted, {
    id: createConsoleEntryId(),
    at: Date.now(),
    repositoryRoot: context.repositoryRoot,
  });

  context.append(entry);
  await context.refresh();
  context.endOperation();
  applyOutcome(redacted, context.operationLabel, entry.decisiveError ?? entry.summary, {
    errorSink: context.errorSink,
    setStatus: context.setStatus,
  });

  return redacted;
}

/**
 * Applies the status or error effect for a settled result.
 *
 * Cancellation and timeout are warnings. A successful result with warnings, such as a missing
 * upstream ref in a scoped Fetch, becomes a warning that names the affected branch instead of a
 * success message; it never reaches the error sink.
 *
 * @param result - Redacted result.
 * @param operationLabel - Human-readable label.
 * @param message - Decisive message for the error sink.
 * @param status - Status writers for the warning, success, and error outcomes.
 */
function applyOutcome(
  result: CommandResult,
  operationLabel: string,
  message: string,
  status: CommandStatusWriters,
): void {
  if (result.cancelled === true) {
    status.setStatus({ kind: "warning", message: "cancelled" });

    return;
  }

  if (result.timedOut === true) {
    status.setStatus({ kind: "warning", message: readTimeoutMessage(result.timedOutAfterMs) });

    return;
  }

  if (result.status === "success") {
    const warning = result.warnings?.join("; ");

    if (warning !== undefined && warning.length > 0) {
      status.setStatus({ kind: "warning", message: warning });

      return;
    }

    status.setStatus({ kind: "success", message: `${operationLabel} completed` });

    return;
  }

  status.errorSink({
    commandId: result.commandId,
    operationLabel,
    message,
    result,
  });
}

/**
 * Builds the warning text for a timed-out command.
 *
 * The timeout duration is part of the execution contract, so it is rendered when the client reported
 * one and falls back to the short form only when the duration is unknown.
 *
 * @param timedOutAfterMs - Timeout that expired, or null when unknown.
 * @returns The warning message.
 */
function readTimeoutMessage(timedOutAfterMs: number | null | undefined): string {
  if (timedOutAfterMs === null || timedOutAfterMs === undefined) {
    return "timed out";
  }

  return `timed out after ${Math.round(timedOutAfterMs / 1000)} seconds`;
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
