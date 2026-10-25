import type { CommandResult, CommandStepResult } from "@/domain/commands/commands.types";
import { isSamePath } from "@/lib/paths";
import { capConsoleOutput } from "./console.buffer";
import { sanitizeConsoleLine } from "./console.sanitize";
import type {
  ConsoleEntry,
  ConsoleEntryStatus,
  ConsoleStepEntry,
  FormatCommandResultOptions,
  RefreshConsoleEntryInput,
} from "./console.types";

/**
 * Creates a stable entry id.
 *
 * @returns A random UUID suitable for expansion state and error links.
 */
export function createConsoleEntryId(): string {
  return crypto.randomUUID();
}

/**
 * Formats one command result into a console entry.
 *
 * The result must already be redacted; the orchestrator redacts before calling this function. Each
 * git step keeps its argv, exit code, duration, and bounded output, so a composite command shows
 * every invocation in one entry. A cancelled or timed-out result is never reported as success, even
 * if the last step happened to exit zero.
 *
 * @param result - Settled command result.
 * @param options - Entry id, timestamp, repository root, and output caps.
 * @returns The console entry.
 */
export function formatCommandResult(
  result: CommandResult,
  options: FormatCommandResultOptions,
): ConsoleEntry {
  const steps = result.steps.map((step) => formatStep(step, options));
  const status = readEntryStatus(result);
  const decisiveError = status === "failure" ? readDecisiveError(result) : null;

  return {
    id: options.id,
    at: options.at,
    commandId: result.commandId,
    operationLabel: result.operationLabel,
    steps,
    cwd: readDisplayCwd(result.cwd, options.repositoryRoot ?? null),
    status,
    exitCode: result.steps.at(-1)?.exitCode ?? null,
    durationMs: result.steps.reduce((total, step) => total + step.durationMs, 0),
    phase: result.progress.at(-1)?.phase ?? null,
    cancelled: result.cancelled === true,
    timedOut: result.timedOut === true,
    summary: readSummary(result, status, decisiveError),
    decisiveError,
  };
}

/**
 * Formats one manual refresh as a console entry.
 *
 * User-initiated refreshes are visible in the console, while watcher and terminal-focus refreshes
 * stay silent. The entry has no git steps because a refresh is a read that never enters the command
 * runner.
 *
 * @param input - Outcome, ids, timing, and paths.
 * @returns The console entry.
 */
export function formatRefreshEntry(input: RefreshConsoleEntryInput): ConsoleEntry {
  const message = sanitizeConsoleLine(input.message);

  return {
    id: input.id,
    at: input.at,
    commandId: "app.refresh",
    operationLabel: "Refresh",
    steps: [],
    cwd: readDisplayCwd(input.cwd ?? null, input.repositoryRoot ?? null),
    status: input.ok ? "success" : "failure",
    exitCode: null,
    durationMs: input.durationMs,
    phase: null,
    cancelled: false,
    timedOut: false,
    summary: message,
    decisiveError: input.ok ? null : message,
  };
}

/**
 * Maps a command result to the entry status.
 *
 * @param result - Settled command result.
 * @returns The entry status; cancellation and timeout take precedence over the step exit codes.
 */
function readEntryStatus(result: CommandResult): ConsoleEntryStatus {
  if (result.cancelled === true) {
    return "cancelled";
  }

  if (result.timedOut === true) {
    return "timed-out";
  }

  return result.status === "success" ? "success" : "failure";
}

/**
 * Formats one git invocation.
 *
 * @param step - Command step.
 * @param options - Output caps and paths.
 * @returns The console step.
 */
function formatStep(
  step: CommandStepResult,
  options: FormatCommandResultOptions,
): ConsoleStepEntry {
  return {
    argv: step.argv,
    exitCode: step.exitCode,
    durationMs: step.durationMs,
    stdout: capConsoleOutput(step.stdout, options.limits),
    stderr: capConsoleOutput(step.stderr, options.limits),
  };
}

/**
 * Reads the collapsed summary line.
 *
 * @param result - Settled command result.
 * @param status - Entry status.
 * @param decisiveError - Decisive failure line, when the entry failed.
 * @returns The summary text.
 */
function readSummary(
  result: CommandResult,
  status: ConsoleEntryStatus,
  decisiveError: string | null,
): string {
  if (status === "cancelled") {
    return "cancelled";
  }

  if (status === "timed-out") {
    return readTimeoutSummary(result.timedOutAfterMs);
  }

  if (status === "failure") {
    return decisiveError ?? "command failed";
  }

  const summary =
    result.steps.length === 0
      ? "completed"
      : result.steps.length === 1
        ? "1 step completed"
        : `${result.steps.length} steps completed`;
  const warnings = result.warnings?.map(sanitizeConsoleLine).join("; ");

  return warnings === undefined || warnings.length === 0 ? summary : `${summary}; ${warnings}`;
}

/**
 * Reads the decisive failure line from a failed result.
 *
 * @param result - Settled command result.
 * @returns The most relevant stderr line, or a generic exit message when stderr is empty.
 */
function readDecisiveError(result: CommandResult): string {
  for (let stepIndex = result.steps.length - 1; stepIndex >= 0; stepIndex -= 1) {
    const step = result.steps[stepIndex];

    if (step === undefined) {
      continue;
    }

    const line = readDecisiveLine(step.stderr);

    if (line !== null) {
      return line;
    }
  }

  const exitCode = result.steps.at(-1)?.exitCode ?? null;

  return exitCode === null ? "command failed" : `git exited with code ${exitCode}`;
}

/**
 * Reads the last fatal, error, or non-empty stderr line.
 *
 * @param stderr - Captured standard error.
 * @returns The decisive line, or null when stderr is blank.
 */
function readDecisiveLine(stderr: string): string | null {
  const lines = stderr
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];

    if (line !== undefined && /\b(fatal|error)\b/i.test(line)) {
      return line;
    }
  }

  return lines.at(-1) ?? null;
}

/**
 * Reads the timed-out summary line.
 *
 * @param timedOutAfterMs - Timeout that expired, or null when the client did not report one.
 * @returns The timed-out summary text.
 */
function readTimeoutSummary(timedOutAfterMs: number | null | undefined): string {
  if (timedOutAfterMs === null || timedOutAfterMs === undefined) {
    return "timed out";
  }

  return `timed out after ${Math.round(timedOutAfterMs / 1000)} seconds`;
}

/**
 * Reads the working directory to display.
 *
 * @param cwd - Directory the command ran in.
 * @param repositoryRoot - Repository root, or null when no root read is available.
 * @returns Null when the directory is the root, otherwise the sanitized single-line directory.
 */
function readDisplayCwd(cwd: string | null, repositoryRoot: string | null): string | null {
  if (cwd === null || cwd.length === 0) {
    return null;
  }

  if (repositoryRoot === null) {
    return sanitizeConsoleLine(cwd);
  }

  return isSamePath(cwd, repositoryRoot) ? null : sanitizeConsoleLine(cwd);
}
