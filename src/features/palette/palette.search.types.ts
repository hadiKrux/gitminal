import type { PaletteCommandEntry, PaletteRow } from "@/features/palette/CommandRow.types";

/** Inputs that decide the visible palette rows. */
export interface BuildPaletteRowsInput {
  /** Every captured palette command, in catalogue order. */
  readonly entries: readonly PaletteCommandEntry[];
  /** Current search text. */
  readonly query: string;
  /** Session recents, most recent first. */
  readonly recentCommandIds: readonly string[];
  /** Characters available on one rendered line. */
  readonly textBudget: number;
}

/** Rendered rows plus the number of commands that matched. */
export interface PaletteRows {
  /** Group headers and command options in render order. */
  readonly rows: readonly PaletteRow[];
  /** Number of command rows that survived filtering; zero drives the empty state. */
  readonly matchCount: number;
}
