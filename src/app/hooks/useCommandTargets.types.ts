import type {
  CommandDescriptor,
  CommandRegion,
  CommandTarget,
} from "@/domain/commands/commands.types";
import type {
  RepositorySelection,
  RepositorySignals,
  RepositorySnapshot,
} from "@/domain/repository/repository.types";

/**
 * Regions whose persisted cursor a command target is derived from.
 *
 * The values are shell region ids that own a cursor. Every member is structurally identical to the
 * shell's `RegionId`, so the value passes straight to `FocusProvider.getCursor`, and the app layer
 * keeps its own copy so a feature never imports another feature folder.
 */
export type CursorRegion = "branches" | "remotes" | "tags" | "stashes" | "worktrees" | "diff";

/**
 * Provider and focus projections a command target is derived from.
 *
 * A target is always an explicit value read from these projections at the moment it is needed, never
 * an ambient cursor read from a hidden surface.
 */
export interface CommandTargetSources {
  /** Latest repository snapshot, or null before the first successful read. */
  readonly snapshot: RepositorySnapshot | null;
  /** Repository signals, used for the current branch fallback. */
  readonly signals: RepositorySignals;
  /** Right-pane selection union, the source of commit and pending targets. */
  readonly selection: RepositorySelection;
  /** Reads one region's persisted cursor. */
  readonly getCursor: (region: CursorRegion) => string | null;
}

/** One target derivation request. */
export interface CommandTargetInput extends CommandTargetSources {
  /** Command whose target is derived. */
  readonly descriptor: CommandDescriptor;
}

/**
 * The shared command target operations the palette and help read.
 *
 * Both discovery surfaces derive the same target, refuse the same owning scope, and compare targets
 * the same way, so a palette entry and a help row always describe the same command.
 */
export interface CommandTargetHandle {
  /**
   * Derives the explicit target a command would dispatch.
   *
   * @param descriptor - Command whose target is derived.
   * @returns The explicit target, or the `none` target when the source is missing.
   */
  readonly deriveTarget: (descriptor: CommandDescriptor) => CommandTarget;
  /**
   * Resolves the owning region of a command scope.
   *
   * @param scope - Command descriptor scope.
   * @returns The owning region, or null for a global or overlay command.
   */
  readonly readOwningRegion: (
    scope: CommandDescriptor["scope"],
  ) => Exclude<CommandRegion, "overlay"> | null;
  /**
   * Compares two explicit command targets by value.
   *
   * @param left - Captured target.
   * @param right - Freshly derived target.
   * @returns True when both targets name the same command target.
   */
  readonly areCommandTargetsEqual: (left: CommandTarget, right: CommandTarget) => boolean;
}
