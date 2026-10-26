import type { ComposerViewFlags, ComposerViewInput } from "./composer.types";

/**
 * Derives every boolean and text flag the composer renders.
 *
 * The message and staged-file reasons are already visible in the button label and the inline form
 * error, so they do not repeat as tooltips or state text. A missing identity and a running operation
 * have no other place to explain themselves, so they render the shared reason line.
 *
 * @param input - Enablement and draft state.
 * @returns The presentation flags.
 */
export function readComposerView(input: ComposerViewInput): ComposerViewFlags {
  const amendActive = input.amendShortHash !== null;
  const primary = input.primaryReason;
  const silentReason = primary === "message-required" || primary === "nothing-to-commit";

  return {
    textareaDisabled: input.committing || (input.stagedCount === 0 && !amendActive),
    commitDisabled: primary !== null,
    commitReason: silentReason ? undefined : (input.blockedReason ?? undefined),
    showStateText: primary === "missing-git-identity" || primary === "operation-in-progress",
  };
}
