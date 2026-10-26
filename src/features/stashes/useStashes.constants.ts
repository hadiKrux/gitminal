import type { CommandAvailabilityReason } from "@/domain/commands/commands.types";

/** Region the stashes hook owns. */
export const STASHES_REGION_ID = "stashes" as const;

/** Soft cap on rendered stash rows; the panel reports the hidden count above it. */
export const STASH_MAX_RENDERED_ROWS = 2000;

/** Overlay entry id of the Create Stash modal. */
export const CREATE_STASH_OVERLAY_ID = "stashes.create";

/** Prefix of the Delete Stash overlay entry id, suffixed with the object name. */
export const DELETE_STASH_OVERLAY_ID_PREFIX = "stashes.delete:";

/** Title of the shared Pop stash confirmation. */
export const POP_STASH_TITLE = "Pop stash";

/**
 * Availability reasons that only describe the working tree, so the create modal still opens.
 *
 * The checkbox is the remedy for the only-untracked case, and the empty and clean cases are better
 * explained inside the form than by silently refusing to open it. Every other reason, such as an
 * operation in progress or an unreadable repository, keeps the panel read-only.
 */
export const STASH_CREATE_MODAL_REASONS: ReadonlySet<CommandAvailabilityReason> = new Set([
  "no-commits-yet",
  "nothing-to-stash",
  "only-untracked-changes",
]);
