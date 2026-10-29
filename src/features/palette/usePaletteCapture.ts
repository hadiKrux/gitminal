import { useState } from "react";
import { useCommandTargets } from "@/app/hooks/useCommandTargets";
import { useKeymap } from "@/app/hooks/useKeymap";
import { useRepository } from "@/app/hooks/useRepository";
import { capturePaletteEntries } from "@/features/palette/palette.capture";
import { readRecentCommandIds } from "@/features/palette/palette.search";
import type { PaletteCapture } from "./usePaletteCapture.types";

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
    capturePaletteEntries({
      repository,
      keymap,
      deriveTarget: targets.deriveTarget,
      remotes: repository.signals.remotes,
    }),
  );

  return { entries, recentCommandIds, repository, keymap, targets };
}

export type { PaletteCapture } from "./usePaletteCapture.types";
