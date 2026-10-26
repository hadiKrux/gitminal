import type {
  CommandErrorSink,
  CommandRunnerHook,
  CommandStatusWriters,
} from "@/app/hooks/useCommandRunner.types";
import type { CommandRequest, CommandResult } from "@/domain/commands/commands.types";
import { capConsoleOutput } from "@/domain/console/console.buffer";
import { createConsoleEntryId, formatCommandResult } from "@/domain/console/console.format";
import {
  sanitizeCommandResult,
  sanitizeConsoleLine,
  sanitizeConsoleText,
} from "@/domain/console/console.sanitize";
import type { ConsoleEntry } from "@/domain/console/console.types";
import { redactCommandResult, redactText } from "@/domain/git/git.redact";

/**
 * Commands whose failure leaves the repository unchanged enough that retrying is meaningful.
 *
 * A remote operation can fail before touching the remote or the local repository, so the error
 * overlay offers Retry with the captured request. The force-push variants are deliberately
 * excluded: their confirmation captures a branch and upstream, and a retry from the error overlay
 * would bypass that fresh revalidation. Local mutation commands are excluded for the same safety
 * reason.
 */
const RETRYABLE_COMMANDS: ReadonlySet<string> = new Set([
  "remote.fetch",
  "remote.fetchPrune",
  "remote.pull",
  "remote.push",
  "remote.pushNoVerify",
]);

/** Maximum lines retained in the error overlay detail block. */
const ERROR_DETAIL_MAX_LINES = 60;

/**
 * Commit commands whose failure can be bypassed with `--no-verify`.
 *
 * The hint is worded for "this commit", so it must never reach a push, fetch, or any other command
 * whose hook, such as `pre-push`, has a different bypass.
 */
const COMMIT_HOOK_COMMANDS: ReadonlySet<string> = new Set([
  "commit.submit",
  "commit.submitNoVerify",
  "commit.amend",
  "commit.amendNoVerify",
]);

/**
 * Text fragments that identify a commit hook or its runner output.
 *
 * Only the hook names a commit invokes are matched, plus the `.git/hooks/` path those runners print.
 * A bare "hook" or "husky" match is deliberately absent: a branch name or an unrelated failure that
 * happens to contain the word must not receive commit advice.
 */
const HOOK_FAILURE_PATTERNS: readonly RegExp[] = Object.freeze([
  /pre-commit/i,
  /prepare-commit-msg/i,
  /commit-msg/i,
  /post-commit/i,
  /\.git\/hooks\//i,
]);

/** Hint appended to a hook failure so the user knows the documented bypass. */
const HOOK_BYPASS_HINT =
  "This looks like a git hook failure. --no-verify bypasses the hook for this commit; the hook output above names the reason.";

/**
 * Applies the status or error effect for a settled result.
 *
 * Cancellation and timeout are warnings. A successful result with warnings, such as a missing
 * upstream ref in a scoped Fetch, becomes a warning that names the affected branch instead of a
 * success message; it never reaches the error sink. A settled failure routes the redacted details,
 * the console entry link, and a retry handle when retry is meaningful to the error surface.
 *
 * @param result - Redacted result.
 * @param operationLabel - Human-readable label.
 * @param message - Decisive message for the error sink.
 * @param outcome - Status writers plus the error detail fields.
 */
export function applyCommandOutcome(
  result: CommandResult,
  operationLabel: string,
  message: string,
  outcome: CommandStatusWriters & {
    readonly consoleEntryId: string | null;
    readonly details: string;
    readonly retry?: () => void;
  },
): void {
  if (result.cancelled === true) {
    outcome.setStatus({ kind: "warning", message: "cancelled" });

    return;
  }

  if (result.timedOut === true) {
    outcome.setStatus({ kind: "warning", message: readTimeoutMessage(result.timedOutAfterMs) });

    return;
  }

  if (result.status === "success") {
    const warning = result.warnings?.join("; ");

    if (warning !== undefined && warning.length > 0) {
      outcome.setStatus({ kind: "warning", message: warning });

      return;
    }

    outcome.setStatus({ kind: "success", message: `${operationLabel} completed` });

    return;
  }

  outcome.errorSink({
    commandId: result.commandId,
    operationLabel,
    message,
    details: outcome.details,
    consoleEntryId: outcome.consoleEntryId,
    retry: outcome.retry,
  });
}

/**
 * Builds the redacted detail block shown by the error overlay.
 *
 * Every step contributes its argv, its output, and its exit line. The result arrives already
 * redacted and sanitized, and the block is capped with the shared console head-and-tail rule so a
 * huge git output cannot bloat the stored error detail.
 *
 * @param result - Redacted failed result.
 * @returns The capped detail text.
 */
export function buildErrorDetails(result: CommandResult): string {
  const lines: string[] = [];

  for (const step of result.steps) {
    lines.push(`$ ${step.argv.join(" ")}`);

    if (step.stderr.trim().length > 0) {
      lines.push(...step.stderr.trimEnd().split("\n"));
    }

    if (step.stdout.trim().length > 0) {
      lines.push(...step.stdout.trimEnd().split("\n"));
    }

    lines.push(`exit ${readExitLabel(step.exitCode)} (${step.durationMs}ms)`);
  }

  if (lines.length === 0) {
    lines.push(result.blockedReason ?? "command failed without output");
  }

  return capErrorDetails(appendCommitHookHint(result, lines.join("\n")));
}

/**
 * Appends the `--no-verify` hint only for a commit command that failed in a commit hook.
 *
 * The command gate keeps push and every other failure free of wording about "this commit", and the
 * narrowed pattern keeps a failure that merely contains the word "hook" from receiving advice.
 *
 * @param result - Redacted failed result.
 * @param details - Detail block built from the settled result.
 * @returns The details, with the hint appended for a commit hook failure.
 */
function appendCommitHookHint(result: CommandResult, details: string): string {
  return COMMIT_HOOK_COMMANDS.has(result.commandId)
    ? appendHookHint(details, readFailureOutput(result))
    : details;
}

/**
 * Reads the combined failure output of a result.
 *
 * @param result - Redacted failed result.
 * @returns The stderr of every failed step, joined with newlines.
 */
function readFailureOutput(result: CommandResult): string {
  return result.steps
    .filter((step) => step.exitCode !== 0)
    .map((step) => step.stderr)
    .join("\n");
}

/**
 * Appends the documented `--no-verify` hint when the failure names a git hook.
 *
 * The hint is additive: a non-hook failure and an empty failure text return the details unchanged,
 * so the overlay keeps its exact existing content. It names the bypass without hiding the hook
 * output, which stays in the detail block above the hint.
 *
 * @param details - Detail block built from the settled result.
 * @param failureText - Decisive failure text such as a step's stderr.
 * @returns The details, with the hint appended for a hook failure.
 */
export function appendHookHint(details: string, failureText: string): string {
  return isHookFailureText(failureText) ? `${details}\n${HOOK_BYPASS_HINT}` : details;
}

/**
 * Reports whether a failure text names a git hook.
 *
 * @param failureText - Decisive failure text such as a step's stderr.
 * @returns True when the text names a hook or a hook runner.
 */
export function isHookFailureText(failureText: string): boolean {
  return HOOK_FAILURE_PATTERNS.some((pattern) => pattern.test(failureText));
}

/**
 * Builds a retry handler for a command whose failure is safe to repeat.
 *
 * The closure captures the full original request, including any form values, so a retry re-runs
 * exactly the command the user started without storing a second copy of its input. The orchestrator
 * stores the error detail before any rejection can escape, so a retry whose post-result refresh or
 * another awaited collaborator rejects is consumed here instead of becoming an unhandled rejection
 * that would terminate the TUI.
 *
 * @param request - Original request, including any form values.
 * @param runner - Ref holding the current orchestrator entry point.
 * @returns The retry handler, or undefined when the command is not retryable.
 */
export function createRetryHandler(
  request: CommandRequest,
  runner: { readonly current: CommandRunnerHook["runCommand"] | null },
): (() => void) | undefined {
  if (!RETRYABLE_COMMANDS.has(request.commandId)) {
    return undefined;
  }

  return () => {
    const pending = runner.current?.(request);

    void pending?.catch(() => {});
  };
}

/**
 * Reports an unexpected failure once, appending or reusing exactly one console entry.
 *
 * A thrown handler never produced a result, so this builds a failure entry from the captured
 * command id, cwd, and the redacted message. A rejection after a result was already appended, such
 * as a failing post-result refresh, updates that entry to a failure instead of appending a second
 * one and reports a distinct `Refresh after <label>` operation, so the overlay title, the linked
 * entry status, and the entry summary all describe the same failure. The overlay message keeps its
 * newlines; the entry summary and the linked error line are flattened, and the stored detail block
 * is capped with the shared console head-and-tail rule.
 *
 * @param input - Request, collaborators, paths, and any entry appended before the failure.
 * @param error - Thrown value.
 */
export function reportUnexpectedFailure(
  input: {
    readonly request: CommandRequest;
    readonly operationLabel: string;
    readonly cwd: string;
    readonly repositoryRoot: string | null;
    readonly append: (entry: ConsoleEntry) => void;
    readonly replaceEntry: (entry: ConsoleEntry) => void;
    readonly closeOriginatingOverlay: () => void;
    readonly endOperation: () => void;
    readonly errorSink: CommandErrorSink;
    readonly retry?: () => void;
    readonly appendedEntry: ConsoleEntry | null;
  },
  error: unknown,
): void {
  input.endOperation();

  const rawMessage = error instanceof Error ? error.message : String(error);
  const message = sanitizeConsoleText(redactText(rawMessage));
  const line = sanitizeConsoleLine(message);
  const appendedEntry = input.appendedEntry;
  const operationLabel =
    appendedEntry === null ? input.operationLabel : `Refresh after ${input.operationLabel}`;
  const entry =
    appendedEntry === null
      ? appendThrownFailure(input, {
          request: input.request,
          operationLabel,
          cwd: input.cwd,
          repositoryRoot: input.repositoryRoot,
          message,
        })
      : replaceWithFailure(
          { replaceEntry: input.replaceEntry, appendedEntry },
          operationLabel,
          line,
        );

  input.closeOriginatingOverlay();
  input.errorSink({
    commandId: input.request.commandId,
    operationLabel,
    message,
    details: capErrorDetails(message),
    consoleEntryId: entry.id,
    retry: input.retry,
  });
}

/**
 * Appends one console entry for an unexpected failure.
 *
 * @param input - Console append collaborator.
 * @param failure - Command identity, message, and paths.
 * @returns The appended entry.
 */
function appendThrownFailure(
  input: { readonly append: (entry: ConsoleEntry) => void },
  failure: {
    readonly request: CommandRequest;
    readonly operationLabel: string;
    readonly cwd: string;
    readonly repositoryRoot: string | null;
    readonly message: string;
  },
): ConsoleEntry {
  const entry = formatThrownFailure({
    commandId: failure.request.commandId,
    operationLabel: failure.operationLabel,
    cwd: failure.cwd,
    repositoryRoot: failure.repositoryRoot,
    message: failure.message,
    id: createConsoleEntryId(),
    at: Date.now(),
  });

  input.append(entry);

  return entry;
}

/**
 * Replaces an already-appended entry with a failure that describes the post-result rejection.
 *
 * @param input - Replacement collaborator and the entry that was appended before the failure.
 * @param operationLabel - Distinct operation label reported by the overlay.
 * @param line - Single-line failure message for the row summary and decisive error.
 * @returns The replacement entry.
 */
function replaceWithFailure(
  input: {
    readonly replaceEntry: (entry: ConsoleEntry) => void;
    readonly appendedEntry: ConsoleEntry;
  },
  operationLabel: string,
  line: string,
): ConsoleEntry {
  const entry: ConsoleEntry = {
    ...input.appendedEntry,
    operationLabel,
    status: "failure",
    exitCode: null,
    cancelled: false,
    timedOut: false,
    summary: line,
    decisiveError: line,
  };

  input.replaceEntry(entry);

  return entry;
}

/**
 * Caps the error-overlay detail block with the shared console rule.
 *
 * @param message - Redacted, sanitized failure message.
 * @returns The capped detail text.
 */
function capErrorDetails(message: string): string {
  return capConsoleOutput(message, { maxLines: ERROR_DETAIL_MAX_LINES }).text;
}

/**
 * Formats the console entry for an unexpected failure that has no settled result.
 *
 * A thrown handler never produced a result object, but every app-triggered command must still be
 * visible with its outcome and an error overlay must link to it. The entry keeps the command id, the
 * captured cwd, and the redacted failure message supplied by the caller. The message is flattened to
 * one row for the summary and the decisive error line, because both render in single-line rows.
 *
 * @param input - Command identity, message, paths, and entry metadata.
 * @returns The failure console entry.
 */
export function formatThrownFailure(input: {
  readonly commandId: string;
  readonly operationLabel: string;
  readonly cwd: string;
  readonly repositoryRoot: string | null;
  readonly message: string;
  readonly id: string;
  readonly at: number;
}): ConsoleEntry {
  const result = sanitizeCommandResult(
    redactCommandResult({
      commandId: input.commandId,
      status: "failure",
      operationLabel: input.operationLabel,
      steps: [],
      cwd: input.cwd,
      progress: [],
    }),
  );
  const entry = formatCommandResult(result, {
    id: input.id,
    at: input.at,
    repositoryRoot: input.repositoryRoot,
  });
  const line = sanitizeConsoleLine(input.message);

  return { ...entry, summary: line, decisiveError: line };
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
 * Reads an exit-code label for the error detail block.
 *
 * @param exitCode - Exit code, or null when the child was terminated.
 * @returns The code as text, or `signal` when no code was recorded.
 */
function readExitLabel(exitCode: number | null): string {
  return exitCode === null ? "signal" : String(exitCode);
}
