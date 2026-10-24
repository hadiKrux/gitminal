import type { CommandResult } from "@/domain/commands/commands.types";

/**
 * Abort controller of the invocation currently owned by the orchestrator.
 *
 * The controller and its settled promise are module-scoped rather than per-hook-instance, because
 * more than one component can call `useCommandRunner` (the composition root and the top bar) while
 * the domain runner still serializes writes to one command at a time. Quit must abort whichever
 * instance started the child.
 */
let activeController: AbortController | null = null;

/** Settled promise of the active orchestration, awaited by `abortActiveCommand`. */
let activeExecution: Promise<CommandResult> | null = null;

/**
 * Reports whether an orchestration is still applying its post-result effects.
 *
 * The domain write latch is released when a handler returns, but the orchestrator keeps the
 * operation state until the refresh, console append, and status write settle. Availability reads
 * this flag so a second mutation cannot start during that window and replace the active operation.
 *
 * @returns True while an orchestration owns the single active slot.
 */
export function isCommandOrchestrationActive(): boolean {
  return activeExecution !== null;
}

/**
 * Stores the controller and execution of a newly started orchestration.
 *
 * @param controller - Controller handed to the active invocation.
 * @param execution - Promise that settles after every post-result effect.
 */
export function recordCommandExecution(
  controller: AbortController,
  execution: Promise<CommandResult>,
): void {
  activeController = controller;
  activeExecution = execution;
}

/**
 * Clears the active slot when the recorded execution settles.
 *
 * @param execution - Execution that finished; a stale promise never clears a newer slot.
 */
export function clearCommandExecution(execution: Promise<CommandResult>): void {
  if (activeExecution !== execution) {
    return;
  }

  activeController = null;
  activeExecution = null;
}

/**
 * Clears the active orchestration slot.
 *
 * Test isolation only. A test that disposes a renderer while a post-result refresh is still running
 * would otherwise leave a non-null slot in this module and make every later command in the same
 * process return `operation-in-progress`. Production code never calls it.
 */
export function resetCommandOrchestration(): void {
  activeController = null;
  activeExecution = null;
}

/**
 * Aborts the active invocation and resolves after every post-result effect has settled.
 *
 * Shared by every `useCommandRunner` instance, so the quit handler can wait for a child started by
 * another surface. When no command is running it resolves immediately.
 *
 * @returns A promise resolved after the active orchestration settles.
 */
export async function abortActiveCommand(): Promise<void> {
  activeController?.abort();

  const execution = activeExecution;

  if (execution === null) {
    return;
  }

  try {
    await execution;
  } catch {
    // The command already reported its own failure; quit only needs the settlement.
  }
}
