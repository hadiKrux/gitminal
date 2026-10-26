import { describeCommandReason } from "@/domain/commands/commands.reasons";
import type { CommandAvailability } from "@/domain/commands/commands.types";
import type { StashRecord } from "@/domain/git/git.types";
import { readStashMessage } from "@/features/stashes/stash.prefill";
import {
  STASH_CREATE_MODAL_REASONS,
  STASHES_REGION_ID,
} from "@/features/stashes/useStashes.constants";
import type { RepositoryReader } from "@/features/stashes/useStashes.types";

/**
 * Reads the availability of one object-name-keyed stash action.
 *
 * An empty list or missing active row is unavailable with "no stash selected", matching the panel's
 * own refusal, so the footer never advertises an action with no target.
 *
 * @param repository - Current repository context.
 * @param commandId - Apply, pop, or delete.
 * @param stash - Selected stash, or null when the list has no active row.
 * @param totalCount - Number of stashes in the snapshot.
 * @returns The availability result for the target.
 */
export function readStashActionAvailability(
  repository: RepositoryReader,
  commandId: "stash.apply" | "stash.pop" | "stash.delete",
  stash: StashRecord | null,
  totalCount: number,
): CommandAvailability {
  if (totalCount === 0 || stash === null) {
    return { available: false, reason: "no-stash-selected" };
  }

  return repository.getAvailability(
    commandId,
    { kind: "stash", objectName: stash.objectName },
    STASHES_REGION_ID,
  );
}

/**
 * Converts an availability result into display text.
 *
 * @param availability - Result from `getAvailability`.
 * @returns The documented reason text, or null when the command is available.
 */
export function readAvailabilityReason(availability: CommandAvailability): string | null {
  if (availability.available) {
    return null;
  }

  return describeCommandReason(availability.reason ?? "command-not-implemented");
}

/**
 * Reports whether the Create Stash modal may open for the current availability.
 *
 * The panel opens the form even when the working tree would block the command, because the
 * Include untracked files checkbox is the remedy. Only a whole-shell block, an operation in
 * progress, or a command error keeps the panel from opening it.
 *
 * @param availability - Availability of `stash.create` with the config default.
 * @returns True when the modal should open.
 */
export function canOpenCreateModal(availability: CommandAvailability): boolean {
  if (availability.available) {
    return true;
  }

  return availability.reason !== undefined && STASH_CREATE_MODAL_REASONS.has(availability.reason);
}

/**
 * Reads the reason to report when the Create Stash modal cannot open.
 *
 * @param busy - True while another operation owns the write slot.
 * @param availability - Availability of `stash.create`.
 * @returns The display reason.
 */
export function readCreateBlockReason(busy: boolean, availability: CommandAvailability): string {
  if (busy) {
    return describeCommandReason("operation-in-progress");
  }

  return describeCommandReason(availability.reason ?? "command-not-implemented");
}

/**
 * Builds the Pop stash confirmation description.
 *
 * @param stash - Stash being popped.
 * @returns Text naming the display index and the recorded message.
 */
export function buildPopDescription(stash: StashRecord): string {
  return `Pop ${stash.index}: ${readStashMessage(stash)}. It applies the changes and drops the stash only if the apply succeeds.`;
}

/**
 * Reports whether the detected primary state exposes a stash list.
 *
 * A gated state such as a plain directory, a bare repository, or a missing git executable has no
 * stash list to report, so the panel must not claim "No stashes" for it.
 *
 * @param primary - Detected repository primary state.
 * @returns True for a readable work tree, including an empty repository.
 */
export function isReadablePrimary(primary: string): boolean {
  return primary === "normal" || primary === "subdirectory" || primary === "empty";
}
