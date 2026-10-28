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

/**
 * Builds a synthetic failed step for a plan rejection.
 *
 * A planner that rejects its input never spawns git, but the rejected outcome still has to reach the
 * console and the failure surface as one step carrying the planner's own message. The step has no
 * argv and no duration, so it cannot be mistaken for a real invocation.
 *
 * @param stderr - Error text shown by the console and the error surface.
 * @returns A step with no argv and no duration.
 */
export function createFailureStep(stderr: string): CommandStepResult {
  return { argv: [], exitCode: 1, durationMs: 0, stdout: "", stderr };
}

/**
 * Builds a synthetic failed invocation for an unsafe remote or ref name.
 *
 * A rejected name must never reach git, so the failure is reported through the same invocation shape
 * a real call returns. Callers keep their normal result handling instead of adding a second error
 * path for validation.
 *
 * @param stderr - Error text shown by the console and the error surface.
 * @returns A failed invocation result with no argv, cwd, or duration.
 */
export function createInvalidNameResult(stderr: string): GitInvocationResult {
  return {
    argv: [],
    cwd: "",
    exitCode: 1,
    terminationSignal: null,
    stdout: "",
    stderr,
    durationMs: 0,
    cancelled: false,
    timedOut: false,
    timedOutAfterMs: null,
    spawnError: null,
    ok: false,
  };
}
