import type { GitInvocationResult } from "@/domain/git/git.types";
import type { CommandStepResult } from "./commands.types";

/**
 * Converts one settled git invocation into a command step.
 *
 * Steps keep the exact argv, exit status, duration, and captured output so the console can show
 * each invocation of a composite command. Termination flags are reported only when set, which keeps
 * a successful step free of undefined boolean noise.
 *
 * @param result - Settled invocation.
 * @param nonFatal - True when a non-zero exit is the documented non-fatal outcome.
 * @returns The command step.
 */
export function toCommandStep(
  result: GitInvocationResult,
  nonFatal: boolean = false,
): CommandStepResult {
  return {
    argv: result.argv,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    stdout: result.stdout,
    stderr: result.stderr,
    stdoutTruncated: result.stdoutTruncated || undefined,
    stderrTruncated: result.stderrTruncated || undefined,
    cancelled: result.cancelled || undefined,
    timedOut: result.timedOut || undefined,
    timedOutAfterMs: result.timedOut ? result.timedOutAfterMs : undefined,
    nonFatal: nonFatal || undefined,
  };
}
