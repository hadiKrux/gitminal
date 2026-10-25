import {
  TOP_BAR_ACTION_BUTTONS_WIDTH,
  TOP_BAR_ACTION_GAPS_WIDTH,
  TOP_BAR_CHROME_WIDTH,
  TOP_BAR_REASON_MAX_WIDTH,
  TOP_BAR_REASON_MIN_WIDTH,
  TOP_BAR_STATUS_MIN_WIDTH,
} from "@/features/top-bar/TopBar.constants";
import type { TopBarBudgets } from "@/features/top-bar/topBar.budgets.types";

/**
 * Splits the top-bar width between the status strip and the disabled reasons.
 *
 * Reservations come from the actual reason text rather than the maximum reason width, so a short
 * reason such as "no remote" never hides the branch. Reasons are the first thing to shrink and the
 * filled buttons keep their padding, because the padding is part of the button width in every
 * focus state. The status strip keeps a real minimum that leaves room for the branch and the sync
 * badge. The returned `reasonWidth` is a cap; a shorter reason still renders at its own length.
 *
 * @param terminalWidth - Terminal width in columns.
 * @param disabledReasons - Display reason of each disabled action, in render order.
 * @returns The status and per-reason column budgets.
 */
export function calculateTopBarBudgets(
  terminalWidth: number,
  disabledReasons: readonly string[],
): TopBarBudgets {
  const baseWidth = TOP_BAR_ACTION_BUTTONS_WIDTH + TOP_BAR_ACTION_GAPS_WIDTH;
  const usable = Math.max(
    TOP_BAR_STATUS_MIN_WIDTH + baseWidth,
    terminalWidth - TOP_BAR_CHROME_WIDTH,
  );

  if (disabledReasons.length === 0) {
    return {
      statusWidth: Math.max(TOP_BAR_STATUS_MIN_WIDTH, usable - baseWidth),
      reasonWidth: 0,
    };
  }

  const idealReasons = disabledReasons.map((reason) =>
    Math.min(TOP_BAR_REASON_MAX_WIDTH, Math.max(TOP_BAR_REASON_MIN_WIDTH, reason.length)),
  );
  const availableForReasons = usable - baseWidth - TOP_BAR_STATUS_MIN_WIDTH;
  const idealTotal = sum(idealReasons) + idealReasons.length;
  const reasonWidth =
    idealTotal <= availableForReasons
      ? Math.max(...idealReasons)
      : clampReasonWidth(availableForReasons, idealReasons.length);
  const renderedTotal =
    sum(idealReasons.map((width) => Math.min(width, reasonWidth))) + idealReasons.length;

  return {
    statusWidth: Math.max(TOP_BAR_STATUS_MIN_WIDTH, usable - baseWidth - renderedTotal),
    reasonWidth,
  };
}

/**
 * Fits one shared reason cap into the space left after the labels and the status minimum.
 *
 * @param available - Columns left for every reason and its separating space.
 * @param count - Number of disabled actions.
 * @returns A cap between the documented minimum and maximum.
 */
function clampReasonWidth(available: number, count: number): number {
  const perReason = Math.floor((available - count) / count);

  return Math.min(TOP_BAR_REASON_MAX_WIDTH, Math.max(TOP_BAR_REASON_MIN_WIDTH, perReason));
}

/**
 * Sums a list of column widths.
 *
 * @param values - Widths to add.
 * @returns The total.
 */
function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
