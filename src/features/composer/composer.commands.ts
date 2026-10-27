import { describeCommandReason } from "@/domain/commands/commands.reasons";
import type { CommandAvailabilityReason } from "@/domain/commands/commands.types";
import type { GitIdentity } from "@/domain/git/git.types";
import {
  COMPOSER_BODY_PADDING,
  COMPOSER_META_GAP,
  COMPOSER_REASON_ROWS,
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
 * Reads the message field rows the composer body leaves.
 *
 * Every row the meta row, the button row, and an inline reason line do not use goes to the message
 * field, so the field fills the panel instead of leaving dead space above or below those rows. The
 * reason row only takes its row when it renders. The result never drops below one row, so the field
 * stays visible while the console drawer clamps the slot.
 *
 * @param input - Measured body rows and whether the inline reason line renders.
 * @returns Message field rows, at least one.
 */
export function readComposerFieldRows(input: {
  readonly bodyRows: number;
  readonly showsReason: boolean;
}): number {
  const available =
    input.bodyRows - COMPOSER_RESERVED_ROWS - (input.showsReason ? COMPOSER_REASON_ROWS : 0);

  return Math.max(1, available);
}

/**
 * Reads the columns the identity line may use on the composer meta row.
 *
 * The staged count and the amend indicator sit at the right edge of that row, so the identity gets
 * whatever columns are left inside the horizontal body padding after them and the documented gap. A
 * row too narrow for both keeps the right edge intact and lets the identity truncate, so the result
 * never goes negative.
 *
 * @param input - Measured body columns, the staged count label, and the amend label or null.
 * @returns Columns available to the identity line, never below zero.
 */
export function readComposerIdentityColumns(input: {
  readonly rowColumns: number;
  readonly stagedLabel: string;
  readonly amendLabel: string | null;
}): number {
  const rightColumns =
    input.stagedLabel.length +
    (input.amendLabel === null ? 0 : COMPOSER_META_GAP + input.amendLabel.length);
  const contentColumns = input.rowColumns - COMPOSER_BODY_PADDING * 2;

  return Math.max(0, contentColumns - COMPOSER_META_GAP - rightColumns);
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
