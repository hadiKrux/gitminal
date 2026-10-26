import { useTerminalDimensions } from "@opentui/react";

/**
 * Reads the terminal size and the content budget a modal leaves for its body.
 *
 * This is the read-only projection the palette and help share: it wraps OpenTUI's
 * `useTerminalDimensions` so both surfaces take the visible row capacity and the truncation budget
 * from one place instead of measuring the terminal twice. The caller passes the rows and columns its
 * own chrome occupies, such as the title row, the search row, the footer, the borders, and the
 * padding, because only the owning surface knows that layout; the hook never guesses it. A terminal
 * smaller than the chrome reports zero content rather than a negative count, so a caller's row loop
 * and truncation stay safe at any size.
 *
 * @param budget - Rows and columns the caller's own chrome reserves. Defaults to zero per axis.
 * @returns The terminal `width` and `height`, the `visibleRows` left for body content, and the
 * `textBudget` characters available on one body line.
 */
export function useTerminalSize(
  budget: { readonly reservedRows?: number; readonly reservedColumns?: number } = {},
): {
  readonly width: number;
  readonly height: number;
  readonly visibleRows: number;
  readonly textBudget: number;
} {
  const { width, height } = useTerminalDimensions();

  return {
    width,
    height,
    visibleRows: readCellBudget(height, budget.reservedRows ?? 0),
    textBudget: readCellBudget(width, budget.reservedColumns ?? 0),
  };
}

/**
 * Subtracts reserved cells from one measured terminal dimension.
 *
 * A negative or fractional reserve is treated as its whole non-negative value, so a caller can pass
 * a measured offset without the budget ever growing past the terminal size.
 *
 * @param dimension - Measured terminal width or height in cells.
 * @param reserved - Cells the owning surface's chrome occupies on that axis.
 * @returns The whole cells left for content, never below zero.
 */
function readCellBudget(dimension: number, reserved: number): number {
  const available = Math.floor(dimension) - Math.max(0, Math.floor(reserved));

  return Math.max(0, available);
}
