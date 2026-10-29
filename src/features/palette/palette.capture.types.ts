import type { CommandTargetHandle } from "@/app/hooks/useCommandTargets.types";
import type { ResolvedKeymap } from "@/domain/keymap/keymap.types";
import type { PaletteAvailabilitySource } from "@/features/palette/palette.targets.types";

/**
 * One capture of the palette command catalogue.
 *
 * The capture reads three inputs and nothing else: the shared target derivation, the repository
 * surface that answers availability, and the resolved keymap that supplies the displayed shortcuts.
 * That keeps the capture testable without a mounted palette or any provider.
 */
export interface PaletteEntryCaptureInput {
  /** Existing remote names; absent for catalogue-only callers. */
  readonly remotes?: readonly string[];
  /** Repository surface that answers the availability question. */
  readonly repository: PaletteAvailabilitySource;
  /** Resolved keymap the displayed shortcuts come from. */
  readonly keymap: ResolvedKeymap;
  /** Shared derivation from the app layer. */
  readonly deriveTarget: CommandTargetHandle["deriveTarget"];
}
