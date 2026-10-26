/** Rows the right-pane slot reserves for its surface whenever the column can spare them. */
export const RIGHT_PANE_MIN_ROWS = 11;

/** Minimum rows the diff panel keeps when the right column must shrink. */
const DIFF_MIN_ROWS = 3;

/** The right column's vertical split: one part right pane and four parts diff. */
const RIGHT_COLUMN_PARTS = 5;

/**
 * Reads the rows the right-pane slot gets inside one main-area height.
 *
 * The right column splits its height one part for the right-pane surface and four parts for the
 * diff, but the composer needs more than that share at short terminals. The slot therefore reserves
 * `RIGHT_PANE_MIN_ROWS` whenever the column can spare them; the diff takes whatever remains and
 * shrinks first, down to its own three-row minimum. When the console drawer leaves less room than
 * both minimums need, the clamp returns only the rows left after that diff minimum and the one-cell
 * column gap, so the wrapper and the surface that fills it still fit the column.
 *
 * @param mainAreaRows - Laid-out height of the main area in rows.
 * @returns The rows to give the right-pane wrapper.
 */
export function readRightPaneRows(mainAreaRows: number): number {
  if (mainAreaRows <= 0) {
    return RIGHT_PANE_MIN_ROWS;
  }

  const rightColumnRows = Math.max(0, Math.floor(mainAreaRows) - 1);
  const share = Math.floor(rightColumnRows / RIGHT_COLUMN_PARTS);
  const available = Math.max(0, rightColumnRows - DIFF_MIN_ROWS);

  return Math.min(Math.max(RIGHT_PANE_MIN_ROWS, share), available);
}
