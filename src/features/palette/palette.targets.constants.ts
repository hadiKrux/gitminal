/** Palette constants for command target capture and revalidation. */

/**
 * Message shown when the owning surface for a command is not mounted, for example a sidebar panel
 * hidden by the collapsed layout. The command is never dispatched to a hidden surface.
 */
export const PALETTE_HIDDEN_SURFACE_MESSAGE = "The owning surface is not available";

/** Reason text used when the freshly derived target no longer matches the captured one. */
export const PALETTE_STALE_TARGET_REASON = "invalid-target";
