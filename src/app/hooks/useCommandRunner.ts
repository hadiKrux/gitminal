import { useCallback, useMemo, useRef } from "react";
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
import { getCommandDescriptor } from "@/domain/commands/commands.availability";
import { runCommand as runDomainCommand } from "@/domain/commands/commands.runner";
import type {
  CommandAvailabilityReason,
  CommandRegion,
  CommandRequest,
  CommandResult,
} from "@/domain/commands/commands.types";
import { createConsoleEntryId, formatCommandResult } from "@/domain/console/console.format";
import { redactCommandResult } from "@/domain/git/git.redact";

/** Readable text for a blocked availability reason. */
const REASON_TEXT: Readonly<Partial<Record<CommandAvailabilityReason, string>>> = Object.freeze({
  "missing-target": "Select an item first",
  "invalid-target": "The selected target is no longer valid",
  "unknown-remote": "The selected remote is not configured",
  "cannot-delete-current-branch": "Cannot delete the current branch",
  "resolve-conflicts-first": "Resolve conflicts first",
  "merge-state": "Another operation is in progress",
  "command-not-found": "Command not found",
  "not-a-mutation": "This command does not change the repository",
  "operation-in-progress": "Another operation is running",
  "command-not-implemented": "This command is not implemented yet",
  "not-a-repository": "Not a git repository",
  "bare-repository": "Bare repositories are not supported",
  "git-missing": "Git not found",
  "permission-error": "Permission denied",
  "no-commits-yet": "No commits yet",
  "detached-head": "Detached HEAD",
  "no-remote": "No remote configured",
  "no-upstream": "The branch has no upstream",
  "no-local-upstreams": "No local branches with upstreams",
  "upstream-gone": "The upstream is gone",
  "merge-in-progress": "Merge in progress",
  "rebase-in-progress": "Rebase in progress",
  "cherry-pick-in-progress": "Cherry-pick in progress",
  "missing-git-identity": "Set user.name and user.email first",
  loading: "The repository is still loading",
});

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
 * The hook owns one abort controller for the current invocation and exposes `abort()` so quit can
 * cancel the child before the renderer is destroyed.
 *
 * @param options - Optional error surface; defaults to an error status.
 * @returns The command entry point and abort handle.
 */
export function useCommandRunner(options: UseCommandRunnerOptions = {}): CommandRunnerHook {
  const repository = useRepository();
  const { setStatus, beginOperation, updateOperation, endOperation } = useStatus();
  const { append } = useConsoleLog();
  const { state: focusState } = useFocusState();
  const controllerRef = useRef<AbortController | null>(null);
  const inFlightRef = useRef<Promise<CommandResult> | null>(null);

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

  /**
   * Runs one command and applies its effects.
   *
   * @param request - Command id, explicit target, and optional form values.
   * @returns The redacted result.
   */
  const runCommand = useCallback(
    (request: CommandRequest): Promise<CommandResult> => {
      const execute = async (): Promise<CommandResult> => {
        const region = readRegion();
        const operationLabel = readOperationLabel(request.commandId);
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

        beginOperation(operationLabel);

        const controller = new AbortController();
        controllerRef.current = controller;

        try {
          const result = await runDomainCommand(request, {
            state: repository.state,
            signals: repository.signals,
            target: request.target,
            region,
            signal: controller.signal,
            onProgress: (progress) => updateOperation(progress),
            client: repository.gitClient,
          });

          if (result.status === "blocked") {
            endOperation();

            return surfaceRunnerBlocked(result, {
              request,
              operationLabel,
              cwd: repository.signals.cwd,
              setStatus,
            });
          }

          return await applyResult(result, {
            append,
            endOperation,
            errorSink,
            operationLabel,
            refresh: repository.refresh,
            repositoryRoot: repository.snapshot?.root ?? null,
            setStatus,
          });
        } catch (error) {
          endOperation();

          const message = error instanceof Error ? error.message : String(error);

          setStatus({ kind: "error", message });

          throw error;
        } finally {
          if (controllerRef.current === controller) {
            controllerRef.current = null;
          }
        }
      };

      const execution = execute();

      inFlightRef.current = execution;

      return execution.finally(() => {
        if (inFlightRef.current === execution) {
          inFlightRef.current = null;
        }
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
   * Aborts the current invocation and waits for it to settle.
   *
   * Quit calls this before destroying the renderer so the client's `SIGTERM`-then-`SIGKILL` sequence
   * completes and the child has stopped writing to the terminal.
   */
  const abort = useCallback(async (): Promise<void> => {
    controllerRef.current?.abort();

    const inFlight = inFlightRef.current;

    if (inFlight === null) {
      return;
    }

    try {
      await inFlight;
    } catch {
      // The command already reported its own failure; quit only needs the settlement.
    }
  }, []);

  return useMemo(() => ({ runCommand, abort }), [runCommand, abort]);
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
  input.setStatus({ kind: "warning", message: describeReason(input.reason) });

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
    status.setStatus({ kind: "warning", message: "timed out" });

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

/**
 * Reads readable text for an availability reason.
 *
 * @param reason - Machine-readable reason.
 * @returns Display text.
 */
function describeReason(reason: CommandAvailabilityReason): string {
  return REASON_TEXT[reason] ?? reason.replace(/-/g, " ");
}
