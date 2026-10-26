import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  readBlockedResult,
  surfaceBlocked,
  surfaceRunnerBlocked,
} from "@/app/hooks/commandRunner.blocked";
import {
  applyCommandOutcome,
  buildErrorDetails,
  createRetryHandler,
  reportUnexpectedFailure,
} from "@/app/hooks/commandRunner.report";
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
import { useConfig } from "@/app/hooks/useConfig";
import { useConsoleLog } from "@/app/hooks/useConsoleLog";
import { useFocusState } from "@/app/hooks/useFocusState";
import { useOverlay } from "@/app/hooks/useOverlay";
import { useRepository } from "@/app/hooks/useRepository";
import { useStatus } from "@/app/hooks/useStatus";
import type {
  RepositoryContextValue,
  RepositoryRefreshOptions,
} from "@/app/providers/RepositoryProvider.types";
import { getCommandDescriptor } from "@/domain/commands/commands.registry";
import { runCommand as runDomainCommand } from "@/domain/commands/commands.runner";
import type {
  CommandRegion,
  CommandRequest,
  CommandResult,
} from "@/domain/commands/commands.types";
import type { RemoteFetchScope } from "@/domain/config/config.types";
import { createConsoleEntryId, formatCommandResult } from "@/domain/console/console.format";
import { sanitizeCommandResult } from "@/domain/console/console.sanitize";
import type { ConsoleEntry } from "@/domain/console/console.types";
import { redactCommandResult } from "@/domain/git/git.redact";
import { isReadOnlySelection } from "@/domain/repository/repository.selectors";

/**
 * Runs commands through the single domain executor and applies every result effect.
 *
 * This hook is the only application caller of `commands.runner.ts`. It follows the fixed effect
 * order: availability pre-check, `beginOperation`, the runner, progress updates, redaction and
 * control-character sanitization, exactly one console append, a repository refresh on every
 * non-blocked outcome, then `endOperation` plus a success, warning, or error result. A blocked
 * command performs none of those effects beyond the transient reason. A cancelled or timed-out
 * command is a warning, never success, and never opens the error surface. A settled result closes
 * only the overlay entry that was open when the command started, so an unrelated confirmation or a
 * visible error detail stays untouched. A failure stores a redacted error detail in
 * `OverlayProvider`, which renders the persistent error overlay. Drafts and selection are never
 * touched, so they survive every failure, and a retryable remote failure carries a retry closure
 * over the original request.
 *
 * Only one orchestration exists at a time. A second request while the first command still applies
 * its post-result effects returns a blocked result before `beginOperation`, so the active operation
 * progress is never replaced and the abort slot always points at the child that is actually running.
 *
 * @param options - Optional error surface; defaults to the persistent error overlay.
 * @returns The command entry point and abort handle.
 */
export function useCommandRunner(options: UseCommandRunnerOptions = {}): CommandRunnerHook {
  const repository = useRepository();
  const { config } = useConfig();
  const { setStatus, beginOperation, updateOperation, endOperation } = useStatus();
  const { append, replaceEntry } = useConsoleLog();
  const { state: focusState } = useFocusState();
  const overlay = useOverlay();
  const runCommandRef = useRef<CommandRunnerHook["runCommand"] | null>(null);

  /** Routes a failure to the persistent error overlay. */
  const defaultErrorSink = useCallback(
    (report: CommandFailureReport): void => {
      overlay.showError({
        commandId: report.commandId,
        operationLabel: report.operationLabel,
        message: report.message,
        details: report.details,
        consoleEntryId: report.consoleEntryId,
        retry: report.retry,
      });
    },
    [overlay],
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
      const originatingEntryId = overlay.entry?.id ?? null;
      const execution = executeRequest({
        request,
        region: readRegion(),
        repository,
        fetchScope: config.remote.fetchScope,
        operationLabel,
        controller,
        append,
        replaceEntry,
        beginOperation,
        updateOperation,
        endOperation,
        errorSink,
        setStatus,
        closeOriginatingOverlay: () => {
          if (originatingEntryId !== null) {
            overlay.closeEntry(originatingEntryId);
          }
        },
        retry: createRetryHandler(request, runCommandRef),
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
      overlay.closeEntry,
      overlay.entry?.id,
      config.remote.fetchScope,
      readRegion,
      replaceEntry,
      repository,
      setStatus,
      updateOperation,
    ],
  );

  useEffect(() => {
    runCommandRef.current = runCommand;
  }, [runCommand]);

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
  readonly fetchScope: RemoteFetchScope;
  readonly operationLabel: string;
  readonly controller: AbortController;
  readonly append: (entry: ConsoleEntry) => void;
  readonly replaceEntry: (entry: ConsoleEntry) => void;
  readonly beginOperation: (label: string) => void;
  readonly updateOperation: (progress: { phase?: string; percent?: number | null }) => void;
  readonly endOperation: () => void;
  readonly errorSink: CommandStatusWriters["errorSink"];
  readonly setStatus: CommandStatusWriters["setStatus"];
  readonly closeOriginatingOverlay: () => void;
  readonly retry?: () => void;
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

  let appendedEntry: ConsoleEntry | null = null;

  try {
    const result = await runDomainCommand(request, {
      state: repository.state,
      signals: repository.signals,
      target: request.target,
      region,
      readOnly: isReadOnlySelection(repository.selection),
      fetchScope: input.fetchScope,
      currentBranchHasUpstream: repository.signals.upstream !== null,
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
      closeOriginatingOverlay: input.closeOriginatingOverlay,
      endOperation: input.endOperation,
      errorSink: input.errorSink,
      operationLabel,
      refresh: repository.refresh,
      repositoryRoot: repository.snapshot?.root ?? null,
      setStatus,
      retry: input.retry,
      onEntryAppended: (entry) => {
        appendedEntry = entry;
      },
    });
  } catch (error) {
    reportUnexpectedFailure(
      {
        request,
        operationLabel,
        cwd: repository.signals.cwd,
        repositoryRoot: repository.snapshot?.root ?? null,
        append: input.append,
        replaceEntry: input.replaceEntry,
        closeOriginatingOverlay: input.closeOriginatingOverlay,
        endOperation: input.endOperation,
        errorSink: input.errorSink,
        retry: input.retry,
        appendedEntry,
      },
      error,
    );

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
 * Redacts, sanitizes, logs, refreshes, and reports one executed result.
 *
 * @param result - Raw result returned by the runner.
 * @param context - Console, status, refresh, and error collaborators.
 * @returns The redacted result.
 */
async function applyResult(
  result: CommandResult,
  context: {
    readonly append: (entry: ConsoleEntry) => void;
    readonly closeOriginatingOverlay: () => void;
    readonly endOperation: () => void;
    readonly errorSink: CommandStatusWriters["errorSink"];
    readonly operationLabel: string;
    readonly onEntryAppended: (entry: ConsoleEntry) => void;
    readonly refresh: (options?: RepositoryRefreshOptions) => Promise<unknown>;
    readonly repositoryRoot: string | null;
    readonly setStatus: CommandStatusWriters["setStatus"];
    readonly retry?: () => void;
  },
): Promise<CommandResult> {
  const redacted = sanitizeCommandResult(redactCommandResult(result));
  const entry = formatCommandResult(redacted, {
    id: createConsoleEntryId(),
    at: Date.now(),
    repositoryRoot: context.repositoryRoot,
  });

  context.append(entry);
  context.onEntryAppended(entry);
  await context.refresh({ followUp: true });
  context.endOperation();
  context.closeOriginatingOverlay();
  applyCommandOutcome(redacted, context.operationLabel, entry.decisiveError ?? entry.summary, {
    errorSink: context.errorSink,
    setStatus: context.setStatus,
    consoleEntryId: entry.id,
    details: buildErrorDetails(redacted),
    retry: context.retry,
  });

  return redacted;
}
