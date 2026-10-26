import type { GitOperationClass } from "@/domain/git/git.types";
import { toCommandStep } from "./commands.steps";
import type {
  CommandAvailabilityReason,
  CommandExecutionOutcome,
  CommandFormValues,
  CommandHandlerContext,
  CommandStepResult,
} from "./commands.types";

/**
 * Reads one form value as a string.
 *
 * A modal may hand a boolean or a list for a field that expects text, and an absent field is the
 * normal state of an optional input. Both cases read as an empty string, so a planner sees one
 * shape and rejects the value through its own validation instead of a separate form rule.
 *
 * @param values - Values collected by the owning modal, or undefined.
 * @param key - Exact form key from the command contract.
 * @returns The string value, or an empty string when absent or another type.
 */
export function readFormString(values: CommandFormValues | undefined, key: string): string {
  const value = values?.[key];

  return typeof value === "string" ? value : "";
}

/**
 * Reads one form value as a boolean.
 *
 * A checkbox may arrive as a boolean or as the `"true"`/`"false"` strings a text form produces, so
 * both spellings are accepted. Every other value, including an absent field, is false.
 *
 * @param values - Values collected by the owning modal, or undefined.
 * @param key - Exact form key from the command contract.
 * @returns True when the field is checked.
 */
export function readFormBoolean(values: CommandFormValues | undefined, key: string): boolean {
  const value = values?.[key];

  return value === true || value === "true";
}

/**
 * Reads one form value as one of a fixed set of choices.
 *
 * @param values - Values collected by the owning modal, or undefined.
 * @param key - Exact form key from the command contract.
 * @param allowed - Choices the command accepts.
 * @returns The selected choice, or null when the value is absent or not allowed.
 */
export function readFormChoice<T extends string>(
  values: CommandFormValues | undefined,
  key: string,
  allowed: readonly T[],
): T | null {
  const value = values?.[key];

  if (typeof value !== "string") {
    return null;
  }

  return allowed.find((choice) => choice === value) ?? null;
}

/**
 * Runs one planned git invocation and converts it into a command step.
 *
 * The operation class decides the timeout and the client's serialization lane, so a local write, a
 * network push, and an index-touching read each get the documented treatment without the executor
 * repeating client options.
 *
 * @param context - Handler context carrying the root, client, and signal.
 * @param args - Validated argument array produced by a domain planner.
 * @param operationClass - Read, write, or network invocation class.
 * @returns The settled command step.
 */
export async function invokeCommandStep(
  context: CommandHandlerContext,
  args: readonly string[],
  operationClass: GitOperationClass,
): Promise<CommandStepResult> {
  const result = await context.client.invoke({
    args,
    cwd: context.cwd,
    signal: context.signal,
    operationClass,
  });

  return toCommandStep(result);
}

/**
 * Reports whether a step exited cleanly.
 *
 * @param step - Settled command step.
 * @returns True when the invocation completed without a non-zero exit.
 */
export function didStepSucceed(step: CommandStepResult): boolean {
  return step.exitCode === 0;
}

/**
 * Builds a blocked outcome that runs no git invocation.
 *
 * @param reason - Machine-readable blocked reason.
 * @returns A blocked outcome with no steps.
 */
export function blockedOutcome(reason: CommandAvailabilityReason): CommandExecutionOutcome {
  return { steps: [], blockedReason: reason };
}
