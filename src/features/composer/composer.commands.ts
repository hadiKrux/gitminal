import { describeCommandReason } from "@/domain/commands/commands.reasons";
import type { CommandAvailabilityReason } from "@/domain/commands/commands.types";
import type { GitIdentity } from "@/domain/git/git.types";
import {
  COMPOSER_MAX_VISIBLE_ROWS,
  COMPOSER_MIN_ROWS,
  COMPOSER_RESERVED_ROWS,
} from "./composer.constants";
import type { ComposerEnablement, ComposerEnablementInput } from "./composer.types";

/** One commit variant exposed by the options menu and the palette. */
export const COMMIT_VARIANTS = Object.freeze([
  {
    commandId: "commit.submit",
    label: "Commit",
    description: "Commit the staged files",
    amend: false,
  },
  {
    commandId: "commit.submitNoVerify",
    label: "Commit --no-verify",
    description: "Commit the staged files without running hooks",
    amend: false,
  },
  {
    commandId: "commit.amend",
    label: "Commit --amend",
    description: "Replace the previous commit with the staged files",
    amend: true,
  },
  {
    commandId: "commit.amendNoVerify",
    label: "Amend --no-verify",
    description: "Replace the previous commit without running hooks",
    amend: true,
  },
]);

/**
 * Reads the menu text for one commit variant reason.
 *
 * The shared reason catalogue stays the source for every other surface. Amend additionally gets the
 * product's own wording, "no previous commit", because that condition only means something for a
 * history rewrite and the menu is where the user chooses it.
 *
 * @param reason - Shared availability reason, or null when the variant may run.
 * @param amend - True for the amend variants.
 * @returns The menu reason text, or null when the variant may run.
 */
export function describeCommitVariantReason(
  reason: CommandAvailabilityReason | null,
  amend: boolean,
): string | null {
  if (reason === null) {
    return null;
  }

  return reason === "no-commits-yet" && amend
    ? "no previous commit"
    : describeCommandReason(reason);
}

/**
 * Reads whether one commit variant may run from the composer's own state.
 *
 * The order is deliberate: a running operation explains the block first, then a missing identity,
 * then the structural HEAD rule for amend, then the staged-file rule for a normal commit, and last
 * the message requirement. The same rule produces the Commit button label, the inline error, and the
 * menu row reasons, so they never disagree.
 *
 * @param input - Draft, staged count, identity, HEAD state, amend flag, and committing state.
 * @returns Availability plus the shared reason when it is blocked.
 */
export function readComposerCommandState(input: ComposerEnablementInput): ComposerEnablement {
  if (input.committing) {
    return { available: false, reason: "operation-in-progress" };
  }

  if (readMissingIdentity(input.identity) !== null) {
    return { available: false, reason: "missing-git-identity" };
  }

  if (input.amend) {
    if (!input.headExists) {
      return { available: false, reason: "no-commits-yet" };
    }

    return hasMessage(input.draft)
      ? { available: true, reason: null }
      : { available: false, reason: "message-required" };
  }

  if (input.stagedCount === 0) {
    return { available: false, reason: "nothing-to-commit" };
  }

  return hasMessage(input.draft)
    ? { available: true, reason: null }
    : { available: false, reason: "message-required" };
}

/**
 * Reads which identity value is missing.
 *
 * @param identity - Configured commit identity.
 * @returns The missing values, or null when both are configured.
 */
export function readMissingIdentity(
  identity: GitIdentity,
): "user.name" | "user.email" | "user.name and user.email" | null {
  if (identity.name === null && identity.email === null) {
    return "user.name and user.email";
  }

  if (identity.name === null) {
    return "user.name";
  }

  return identity.email === null ? "user.email" : null;
}

/**
 * Reads the visible textarea height for a draft.
 *
 * @param message - Current draft.
 * @param maxRows - Maximum rows before the textarea scrolls. Defaults to eight.
 * @returns A row count between one and the cap.
 */
export function readComposerVisibleRows(
  message: string,
  maxRows: number = COMPOSER_MAX_VISIBLE_ROWS,
): number {
  const rows = message.split("\n").length;

  return Math.min(Math.max(1, Math.floor(maxRows)), Math.max(1, rows));
}

/**
 * Reads the textarea row cap from the composer's measured body height.
 *
 * The body reserves rows for the staged line, identity line, message label, buttons, and one
 * reason or state row, so the cap is the space left inside the slot the composer actually got. It
 * shrinks with the clamped right-pane slot, down to one row when the console drawer leaves eight
 * rows, instead of pushing the More and Commit controls out of the panel or over the diff. It never
 * exceeds the documented eight rows. One row is the safe first-frame value before layout publishes
 * the body height.
 *
 * @param bodyRows - Measured composer body rows, excluding the panel border.
 * @returns A row cap between one and the documented eight rows.
 */
export function readComposerRowCap(bodyRows: number): number {
  const available = bodyRows - COMPOSER_RESERVED_ROWS;

  return Math.min(COMPOSER_MAX_VISIBLE_ROWS, Math.max(COMPOSER_MIN_ROWS, available));
}

/**
 * Reports whether a draft contains a non-whitespace character.
 *
 * @param message - Current draft.
 * @returns True when the trimmed draft is non-empty.
 */
function hasMessage(message: string): boolean {
  return message.trim().length > 0;
}
