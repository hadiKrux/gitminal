import { describe, expect, it } from "bun:test";
import {
  TOP_BAR_ACTION_GAPS_WIDTH,
  TOP_BAR_ACTION_LABELS_WIDTH,
  TOP_BAR_CHROME_WIDTH,
  TOP_BAR_FOCUS_MARKER_WIDTH,
  TOP_BAR_STATUS_MIN_WIDTH,
} from "@/features/top-bar/TopBar.constants";
import { calculateTopBarBudgets } from "@/features/top-bar/topBar.budgets";

/**
 * Builds a reason of the requested length.
 *
 * @param length - Character count.
 * @returns A reason-shaped string.
 */
function reason(length: number): string {
  return "r".repeat(length);
}

/**
 * Computes the row width a budget would consume.
 *
 * @param terminalWidth - Terminal width.
 * @param reasons - Disabled reasons.
 * @param statusWidth - Budgeted status width.
 * @param reasonWidth - Budgeted reason cap.
 * @returns The columns consumed by the status and action strips.
 */
function consumedWidth(
  reasons: readonly string[],
  statusWidth: number,
  reasonWidth: number,
): number {
  const renderedReasons = reasons.reduce(
    (total, value) => total + Math.min(value.length, reasonWidth) + 1,
    0,
  );

  return (
    statusWidth +
    TOP_BAR_ACTION_LABELS_WIDTH +
    TOP_BAR_ACTION_GAPS_WIDTH +
    TOP_BAR_FOCUS_MARKER_WIDTH +
    renderedReasons
  );
}

describe("calculateTopBarBudgets", () => {
  for (const terminalWidth of [80, 100]) {
    it(`keeps the status minimum and fits the row with no disabled actions at ${terminalWidth}`, () => {
      const budgets = calculateTopBarBudgets(terminalWidth, []);

      expect(budgets.reasonWidth).toBe(0);
      expect(budgets.statusWidth).toBeGreaterThanOrEqual(TOP_BAR_STATUS_MIN_WIDTH);
      expect(consumedWidth([], budgets.statusWidth, budgets.reasonWidth)).toBeLessThanOrEqual(
        terminalWidth - TOP_BAR_CHROME_WIDTH,
      );
    });

    it(`reserves the actual reason width for one disabled action at ${terminalWidth}`, () => {
      const reasons = ["detached HEAD"];
      const budgets = calculateTopBarBudgets(terminalWidth, reasons);

      expect(budgets.reasonWidth).toBeGreaterThanOrEqual(reasons[0]?.length ?? 0);
      expect(budgets.statusWidth).toBeGreaterThanOrEqual(TOP_BAR_STATUS_MIN_WIDTH);
      expect(consumedWidth(reasons, budgets.statusWidth, budgets.reasonWidth)).toBeLessThanOrEqual(
        terminalWidth - TOP_BAR_CHROME_WIDTH,
      );
    });

    it(`keeps the branch readable with two short reasons at ${terminalWidth}`, () => {
      const reasons = ["no remote", "no remote"];
      const budgets = calculateTopBarBudgets(terminalWidth, reasons);

      expect(budgets.reasonWidth).toBe(9);
      expect(budgets.statusWidth).toBeGreaterThanOrEqual(TOP_BAR_STATUS_MIN_WIDTH);
      // A 4-character branch plus the sync badge and its separator must fit.
      expect(budgets.statusWidth).toBeGreaterThanOrEqual(4 + 1 + 10 + TOP_BAR_FOCUS_MARKER_WIDTH);
      expect(consumedWidth(reasons, budgets.statusWidth, budgets.reasonWidth)).toBeLessThanOrEqual(
        terminalWidth - TOP_BAR_CHROME_WIDTH,
      );
    });

    it(`shrinks two maximum reasons instead of overflowing at ${terminalWidth}`, () => {
      const reasons = [reason(28), reason(28)];
      const budgets = calculateTopBarBudgets(terminalWidth, reasons);

      expect(budgets.reasonWidth).toBeLessThan(28);
      expect(budgets.statusWidth).toBe(TOP_BAR_STATUS_MIN_WIDTH);
      expect(consumedWidth(reasons, budgets.statusWidth, budgets.reasonWidth)).toBeLessThanOrEqual(
        terminalWidth - TOP_BAR_CHROME_WIDTH,
      );
    });
  }
});
