import type { PaletteRow } from "./CommandRow.types";

/** Handlers that run or refuse the highlighted command. */
export interface PaletteDispatch {
  /**
   * Runs the highlighted command after revalidation.
   *
   * @param rows - Rendered rows.
   * @param selectableIndex - Highlighted row index.
   */
  readonly activate: (rows: readonly PaletteRow[], selectableIndex: number) => void;
  /**
   * Activates the option value reported by the native select.
   *
   * @param value - Encoded option value.
   */
  readonly selectValue: (value: string) => void;
}
