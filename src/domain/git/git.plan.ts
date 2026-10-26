import type { GitArgPlan } from "./git.types";

/**
 * Wraps a planned argument array in a frozen success result.
 *
 * Every git planner returns the same small plan shape, so the four feature modules share this
 * helper instead of copying the freeze logic.
 *
 * @param args - Planned arguments, without the executable.
 * @returns The frozen plan.
 */
export function planGitArgs(args: readonly string[]): GitArgPlan {
  return Object.freeze({ ok: true, args: Object.freeze([...args]) });
}

/**
 * Wraps a planning error in a frozen failure result.
 *
 * @param error - User-facing error text.
 * @returns The frozen plan.
 */
export function planGitError(error: string): GitArgPlan {
  return Object.freeze({ ok: false, error });
}
