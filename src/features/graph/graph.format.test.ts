import { describe, expect, it } from "bun:test";
import { formatCommitDate } from "@/features/graph/graph.format";

/** Current clock the cases format against. */
const NOW_MS = new Date(2026, 9, 25, 14, 0).getTime();

/**
 * Reads one local wall-clock time as epoch seconds.
 *
 * @param year - Calendar year.
 * @param monthIndex - Zero-based month.
 * @param day - Day of the month.
 * @param hour - Hour in the twenty-four-hour clock.
 * @param minute - Minute of the hour.
 * @returns Epoch seconds for that local time.
 */
function localTimestamp(
  year: number,
  monthIndex: number,
  day: number,
  hour: number,
  minute: number,
): number {
  return Math.floor(new Date(year, monthIndex, day, hour, minute).getTime() / 1000);
}

describe("formatCommitDate", () => {
  it("shows only the twelve-hour time for a commit from today", () => {
    expect(formatCommitDate(localTimestamp(2026, 9, 25, 9, 30), NOW_MS)).toBe("9:30 AM");
  });

  it("reads midnight as 12:00 AM and noon as 12:00 PM", () => {
    expect(formatCommitDate(localTimestamp(2026, 9, 25, 0, 5), NOW_MS)).toBe("12:05 AM");
    expect(formatCommitDate(localTimestamp(2026, 9, 25, 12, 5), NOW_MS)).toBe("12:05 PM");
  });

  it("appends the twelve-hour time to a date in the current year", () => {
    expect(formatCommitDate(localTimestamp(2026, 7, 11, 8, 5), NOW_MS)).toBe("11 Aug 8:05 AM");
  });

  it("appends the year and the twelve-hour time to an older commit", () => {
    expect(formatCommitDate(localTimestamp(2025, 7, 11, 20, 5), NOW_MS)).toBe(
      "11 Aug 2025 8:05 PM",
    );
  });

  it("returns an empty string for an invalid timestamp", () => {
    expect(formatCommitDate(Number.NaN, NOW_MS)).toBe("");
  });
});
