import { useState } from "react";
import { useCommandTargets } from "@/app/hooks/useCommandTargets";
import type { CommandTargetHandle } from "@/app/hooks/useCommandTargets.types";
import { useKeymap } from "@/app/hooks/useKeymap";
import { useRepository } from "@/app/hooks/useRepository";
import type { ResolvedKeymap } from "@/domain/keymap/keymap.types";
import type { PaletteCommandEntry } from "@/features/palette/CommandRow.types";
import { capturePaletteEntries } from "@/features/palette/palette.capture";
import { readRecentCommandIds } from "@/features/palette/palette.search";
import type { PaletteAvailabilitySource } from "@/features/palette/palette.targets.types";

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

/**
 * Captures the palette entries when the palette opens.
 *
 * Every palette-invocable descriptor is captured once, which is when the overlay opens. Each entry
 * carries the explicit target derived from the provider and focus projections, the availability the
 * user sees, and the effective shortcuts. The hook never reads a hidden surface while the palette is
 * open and never re-derives the list on keystroke.
 *
 * @returns The captured entries and the projections the activation path re-reads.
 */
export function usePaletteCapture(): PaletteCapture {
  const repository = useRepository();
  const keymap = useKeymap();
  const targets = useCommandTargets();
  const [recentCommandIds] = useState(() => readRecentCommandIds());
  const [entries] = useState(() =>
    capturePaletteEntries({ repository, keymap, deriveTarget: targets.deriveTarget }),
  );

  return { entries, recentCommandIds, repository, keymap, targets };
}
