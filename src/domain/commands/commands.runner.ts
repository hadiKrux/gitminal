import { createGitClient } from "@/domain/git/git.client";
import type { GitClient } from "@/domain/git/git.types";
import { getAvailability } from "./commands.availability";
import { getCommandDescriptor } from "./commands.registry";
import type {
  CommandExecutionOutcome,
  CommandHandlerRegistration,
  CommandProgress,
  CommandRequest,
  CommandResult,
  CommandRunOptions,
  CommandStatus,
  CommandStepResult,
} from "./commands.types";

/** Module-level write latch. The runner is the single authority for one mutation at a time. */
let writeLatchHeld = false;

/** Registered mutation executors, keyed by command id. */
const handlers = new Map<string, CommandHandlerRegistration>();

/** Default client created on first use when the caller supplies none. */
let defaultClient: GitClient | null = null;

/**
 * Registers the executor for one mutation command.
 *
 * Exactly one handler may exist per command. A duplicate is rejected and returns a no-op cleanup,
 * so two modules cannot silently compete for the same mutation. The full `commands.registry.ts`
 * will own registration once it lands; this function is the seam the runner exposes until then.
 *
 * @param registration - Command id, operation label, and executor.
 * @returns A cleanup function that removes this exact registration.
 */
export function registerCommandHandler(registration: CommandHandlerRegistration): () => void {
  if (handlers.has(registration.commandId)) {
    console.error(
      `Duplicate command handler for "${registration.commandId}"; the later registration was rejected.`,
    );

    return () => {};
  }

  handlers.set(registration.commandId, registration);

  return () => {
    if (handlers.get(registration.commandId) === registration) {
      handlers.delete(registration.commandId);
    }
  };
}

/**
 * Reports whether a mutation is currently running.
 *
 * The app layer reads this only as a projection; the runner remains the authority. Tests use it to
 * assert latch release after success, failure, cancellation, and timeout.
 *
 * @returns True while the write latch is held.
 */
export function isCommandRunning(): boolean {
  return writeLatchHeld;
}

/**
 * Clears registered handlers and the write latch.
 *
 * Test isolation only. Production modules never call it.
 */
export function resetCommandRunner(): void {
  handlers.clear();
  writeLatchHeld = false;
}

/**
 * Executes one mutation command.
 *
 * This is a pure executor. It re-checks availability and serialization as the authority, runs the
 * registered handler, forwards progress events, and returns a `CommandResult` for every outcome. It
 * never throws for a git failure, never refreshes the repository, never appends a console entry,
 * never sets a status, and never opens an overlay. A second mutation while one is running returns a
 * blocked result with `operation-in-progress` in constant time. The runner latch is the single
 * serialization authority; the app projection reads the same latch through `isCommandRunning()`
 * rather than keeping a second gate.
 *
 * The repository root comes from `signals.repositoryRoot` so every invocation runs from the root;
 * the target and region cross the boundary as plain values, never as a hook or context.
 *
 * @param request - Command id, explicit target, and optional form values.
 * @param options - Repository values, cancellation signal, progress callback, and client override.
 * @returns The settled command result.
 */
export async function runCommand(
  request: CommandRequest,
  options: CommandRunOptions,
): Promise<CommandResult> {
  const descriptor = getCommandDescriptor(request.commandId);
  const cwd = options.signals.repositoryRoot ?? options.signals.cwd;
  const operationLabel =
    handlers.get(request.commandId)?.operationLabel ?? descriptor?.label ?? request.commandId;

  if (descriptor === undefined) {
    return createBlockedResult(request.commandId, operationLabel, cwd, "command-not-found");
  }

  if (descriptor.kind !== "mutation") {
    return createBlockedResult(request.commandId, operationLabel, cwd, "not-a-mutation");
  }

  const availability = getAvailability(request.commandId, {
    state: options.state,
    signals: options.signals,
    target: options.target,
    region: options.region,
    operation: "idle",
    readOnly: options.readOnly,
    formValues: request.formValues,
  });

  if (!availability.available) {
    return createBlockedResult(
      request.commandId,
      operationLabel,
      cwd,
      availability.reason ?? "command-not-implemented",
    );
  }

  const registration = handlers.get(request.commandId);

  if (registration === undefined) {
    return createBlockedResult(request.commandId, operationLabel, cwd, "command-not-implemented");
  }

  if (writeLatchHeld) {
    return createBlockedResult(request.commandId, operationLabel, cwd, "operation-in-progress");
  }

  writeLatchHeld = true;

  const progress: CommandProgress[] = [];
  const client = resolveClient(options.client);
  const controller = createLinkedController(options.signal);
  const notifyProgress = (event: CommandProgress): void => {
    progress.push(event);
    options.onProgress?.(event);
  };

  try {
    const outcome = await registration.handler({
      request,
      target: options.target,
      cwd,
      client,
      signal: controller.signal,
      readOnly: options.readOnly === true,
      notifyProgress,
    });

    return createExecutedResult(request.commandId, operationLabel, cwd, outcome, progress);
  } catch (error) {
    return createThrownResult(request.commandId, operationLabel, cwd, error, progress);
  } finally {
    writeLatchHeld = false;
    controller.release();
  }
}

/**
 * Resolves the client used for the command.
 *
 * The default client uses the `git` executable. The app layer builds a client from `config.git.path`
 * and passes it in, so a configured path and the index serialization stay in one place.
 *
 * @param client - Caller-supplied client.
 * @returns The caller client, or a lazily created default.
 */
function resolveClient(client: GitClient | undefined): GitClient {
  if (client !== undefined) {
    return client;
  }

  defaultClient ??= createGitClient();

  return defaultClient;
}

/**
 * Creates an abort controller linked to the caller signal.
 *
 * The runner owns the signal handed to the handler so it can always detach its listener. Aborting
 * the caller signal aborts the controller once, which the git client turns into the documented
 * `SIGTERM`-then-`SIGKILL` sequence.
 *
 * @param signal - Caller signal, when any.
 * @returns The controller plus a release function for its listener.
 */
function createLinkedController(signal: AbortSignal | undefined): {
  signal: AbortSignal;
  release: () => void;
} {
  const controller = new AbortController();

  if (signal === undefined) {
    return { signal: controller.signal, release: () => {} };
  }

  const abort = (): void => controller.abort();

  if (signal.aborted) {
    controller.abort();
  } else {
    signal.addEventListener("abort", abort, { once: true });
  }

  return {
    signal: controller.signal,
    release: () => signal.removeEventListener("abort", abort),
  };
}

/**
 * Builds the result for a command that started and settled.
 *
 * A handler that refuses its scope before working returns a blocked reason, which becomes a blocked
 * result with no steps. Otherwise the status is a failure only for an unreported non-zero step;
 * steps marked `nonFatal` keep the command successful and contribute warnings instead.
 *
 * @param commandId - Requested command id.
 * @param operationLabel - Human-readable operation label.
 * @param cwd - Working directory the command ran in.
 * @param outcome - Steps, warnings, termination, or blocked flag reported by the handler.
 * @param progress - Every progress event emitted while it ran.
 * @returns The settled result with a status derived from the steps.
 */
function createExecutedResult(
  commandId: string,
  operationLabel: string,
  cwd: string,
  outcome: CommandExecutionOutcome,
  progress: readonly CommandProgress[],
): CommandResult {
  if (outcome.blockedReason !== undefined) {
    return createBlockedResult(commandId, operationLabel, cwd, outcome.blockedReason);
  }

  const cancelled = isOutcomeCancelled(outcome);
  const timedOut = isOutcomeTimedOut(outcome);
  const failed = outcome.failed === true || outcome.steps.some(isFailedStep);
  const warnings = outcome.warnings ?? [];
  const timedOutAfterMs = readTimedOutAfterMs(outcome);

  return {
    commandId,
    status: readCommandStatus(cancelled, timedOut, failed),
    operationLabel,
    steps: outcome.steps,
    cwd,
    progress,
    warnings: warnings.length > 0 ? warnings : undefined,
    cancelled: cancelled || undefined,
    timedOut: timedOut || undefined,
    timedOutAfterMs,
  };
}

/**
 * Reads the timeout duration that expired for an outcome.
 *
 * @param outcome - Handler outcome.
 * @returns The first reported timeout duration, or null when none is known.
 */
function readTimedOutAfterMs(outcome: CommandExecutionOutcome): number | null {
  for (const step of outcome.steps) {
    if (step.timedOutAfterMs !== undefined && step.timedOutAfterMs !== null) {
      return step.timedOutAfterMs;
    }
  }

  return null;
}

/**
 * Reports whether a step is an unreported failure.
 *
 * A step marked `nonFatal` is a supported outcome and never fails the command.
 *
 * @param step - Command step.
 * @returns True when the step's non-zero exit makes the command a failure.
 */
function isFailedStep(step: CommandStepResult): boolean {
  return step.exitCode !== 0 && step.nonFatal !== true;
}

/**
 * Reports whether the outcome is cancelled.
 *
 * @param outcome - Handler outcome.
 * @returns True when the outcome or any step was cancelled.
 */
function isOutcomeCancelled(outcome: CommandExecutionOutcome): boolean {
  return outcome.cancelled === true || outcome.steps.some((step) => step.cancelled === true);
}

/**
 * Reports whether the outcome timed out.
 *
 * @param outcome - Handler outcome.
 * @returns True when the outcome or any step timed out.
 */
function isOutcomeTimedOut(outcome: CommandExecutionOutcome): boolean {
  return outcome.timedOut === true || outcome.steps.some((step) => step.timedOut === true);
}

/**
 * Maps the outcome flags to a command status.
 *
 * @param cancelled - True when the command was cancelled.
 * @param timedOut - True when the command timed out.
 * @param failed - True when an unreported step failed.
 * @returns `failure` for any termination or failure, otherwise `success`.
 */
function readCommandStatus(cancelled: boolean, timedOut: boolean, failed: boolean): CommandStatus {
  return cancelled || timedOut || failed ? "failure" : "success";
}

/**
 * Builds a failure result when a handler throws.
 *
 * A thrown handler is a programming defect, not a git failure, but the runner still returns a
 * result so the orchestrator can route one error without a second error path. The synthetic step
 * carries the message, which the console and error overlay already know how to render.
 *
 * @param commandId - Requested command id.
 * @param operationLabel - Human-readable operation label.
 * @param cwd - Working directory the command ran in.
 * @param error - Thrown value.
 * @param progress - Progress emitted before the throw.
 * @returns A failure result with a synthetic step.
 */
function createThrownResult(
  commandId: string,
  operationLabel: string,
  cwd: string,
  error: unknown,
  progress: readonly CommandProgress[],
): CommandResult {
  const message = error instanceof Error ? error.message : String(error);

  return {
    commandId,
    status: "failure",
    operationLabel,
    steps: [
      {
        argv: [],
        exitCode: null,
        durationMs: 0,
        stdout: "",
        stderr: message,
      },
    ],
    cwd,
    progress,
  };
}

/**
 * Builds a blocked result that never started an operation.
 *
 * @param commandId - Requested command id.
 * @param operationLabel - Human-readable operation label.
 * @param cwd - Working directory the command would have used.
 * @param reason - Machine-readable blocked reason.
 * @returns A blocked result with no steps.
 */
function createBlockedResult(
  commandId: string,
  operationLabel: string,
  cwd: string,
  reason: CommandResult["blockedReason"],
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
