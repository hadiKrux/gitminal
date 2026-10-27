import { describeCommandReason } from "@/domain/commands/commands.reasons";
import { COMPOSER_COMMIT_LABEL, COMPOSER_NOTHING_TO_COMMIT_LABEL } from "./composer.constants";
import type {
  ComposerPanelText,
  ComposerPanelTextInput,
  ComposerViewFlags,
  ComposerViewInput,
} from "./composer.types";

/**
 * Derives every boolean and text flag the composer renders.
 *
 * A missing message leaves the primary button enabled, because attempting the commit is how the
 * composer learns to show the message error; until then the button carries no reason text. A
 * missing staged file keeps the button disabled and says "Nothing to commit" in its label. Neither
 * reason repeats as a tooltip or state text, while a missing identity and a running operation have
 * no other place to explain themselves and therefore render the shared reason line.
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
    commitDisabled: primary !== null && primary !== "message-required",
    commitReason: silentReason ? undefined : (input.blockedReason ?? undefined),
    showStateText: primary === "missing-git-identity" || primary === "operation-in-progress",
  };
}

/**
 * Reads the panel and primary-button text for one commit enablement.
 *
 * A missing staged file renames the button instead of explaining itself elsewhere, while a missing
 * message keeps the normal label and only produces an inline error after the user attempted the
 * commit with an empty draft. Every other blocked reason becomes the shared reason text.
 *
 * @param input - Enablement result plus the message-required attempt flag.
 * @returns The button label, the blocked reason text, and the inline message error.
 */
export function readComposerPanelText(input: ComposerPanelTextInput): ComposerPanelText {
  const reason = input.reason;

  return {
    commitLabel:
      reason === "nothing-to-commit" ? COMPOSER_NOTHING_TO_COMMIT_LABEL : COMPOSER_COMMIT_LABEL,
    blockedReason: input.available
      ? null
      : describeCommandReason(reason ?? "operation-in-progress"),
    messageError:
      input.messageAttempted && reason === "message-required" ? "message required" : null,
  };
}
