import type { PaletteSelectOption } from "@/features/palette/CommandRow.types";

/** Options accepted by `useCommandPalette`. */
export interface UseCommandPaletteOptions {
  /**
   * Closes the overlay entry that renders the palette.
   *
   * @param afterRestore - Work the overlay provider runs once the captured background focus is
   * restored. The palette passes its owning handler or its refusal focus move here, so dispatch is
   * caused by the restore instead of racing it.
   */
  readonly onClose: (afterRestore?: () => void) => void;
}

/** Effective keys the modal footer advertises. */
export interface PaletteHintKeys {
  /** Key that runs the highlighted command. */
  readonly activate: string;
  /** Key that closes the palette. */
  readonly close: string;
  /** Key that moves focus to the result list. */
  readonly nextField: string;
}

/** State and callbacks the palette view renders. */
export interface PaletteHandle {
  /** Current search text. */
  readonly query: string;
  /** Replaces the search text and resets the highlight to the first matching command. */
  readonly setQuery: (value: string) => void;
  /** Options handed to the native select, including group headers. */
  readonly options: readonly PaletteSelectOption[];
  /** Highlighted option index, always a selectable command row. */
  readonly highlightedIndex: number;
  /** Number of commands that survived filtering. */
  readonly matchCount: number;
  /** Option window height for the native select. */
  readonly optionRows: number;
  /** Effective shortcut keys for the modal footer. */
  readonly hints: PaletteHintKeys;
  /**
   * Records the option the native select reports.
   *
   * @param value - Encoded option value highlighted by the widget.
   */
  readonly highlightOption: (value: string) => void;
  /**
   * Activates the option value reported by the native select.
   *
   * @param value - Encoded option value.
   */
  readonly selectValue: (value: string) => void;
}
