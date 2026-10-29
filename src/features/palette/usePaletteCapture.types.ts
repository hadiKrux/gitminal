import type { CommandTargetHandle } from "@/app/hooks/useCommandTargets.types";
import type { ResolvedKeymap } from "@/domain/keymap/keymap.types";
import type { PaletteCommandEntry } from "./CommandRow.types";
import type { PaletteAvailabilitySource } from "./palette.targets.types";

/** Entries the palette captured when it opened, plus the projections dispatch re-reads. */
export interface PaletteCapture {
  /** Captured command entries, in catalogue order. */
  readonly entries: readonly PaletteCommandEntry[];
  /** Session recents captured at open time. */
  readonly recentCommandIds: readonly string[];
  /** Repository surface the activation path revalidates against. */
  readonly repository: PaletteAvailabilitySource;
  /** Resolved keymap the footer hints are read from. */
  readonly keymap: ResolvedKeymap;
  /** Target derivation and comparison used by the activation path. */
  readonly targets: CommandTargetHandle;
}
