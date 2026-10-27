import { describe, expect, it } from "bun:test";
import { formatCommitDateTime } from "@/lib/time";

describe("formatCommitDateTime", () => {
  it("formats a strict ISO date with its wall clock time and offset", () => {
    expect(formatCommitDateTime("2026-10-25T09:30:00+05:00")).toBe(
      "Sun, 25 Oct 2026 9:30 AM +05:00",
    );
  });

  it("keeps the reported offset instead of converting the time", () => {
    expect(formatCommitDateTime("2026-10-26T11:00:00+01:00")).toBe(
      "Mon, 26 Oct 2026 11:00 AM +01:00",
    );
    expect(formatCommitDateTime("2026-10-26T23:59:00-08:00")).toBe(
      "Mon, 26 Oct 2026 11:59 PM -08:00",
    );
  });

  it("normalizes the UTC shorthand and a compact offset", () => {
    expect(formatCommitDateTime("2026-10-25T09:30:00Z")).toBe("Sun, 25 Oct 2026 9:30 AM +00:00");
    expect(formatCommitDateTime("2026-10-25T09:30:00+0530")).toBe(
      "Sun, 25 Oct 2026 9:30 AM +05:30",
    );
  });

  it("accepts an optional seconds and fractional part", () => {
    expect(formatCommitDateTime("2026-10-25T09:30:45+05:00")).toBe(
      "Sun, 25 Oct 2026 9:30 AM +05:00",
    );
    expect(formatCommitDateTime("2026-10-25T09:30:45.123Z")).toBe(
      "Sun, 25 Oct 2026 9:30 AM +00:00",
    );
  });

  it("uses 12 AM and 12 PM for midnight and noon", () => {
    expect(formatCommitDateTime("2026-10-25T00:15:00Z")).toBe("Sun, 25 Oct 2026 12:15 AM +00:00");
    expect(formatCommitDateTime("2026-10-25T12:15:00Z")).toBe("Sun, 25 Oct 2026 12:15 PM +00:00");
  });

  it("returns malformed or timezone-less input unchanged", () => {
    expect(formatCommitDateTime("not a date")).toBe("not a date");
    expect(formatCommitDateTime("2026-10-25T09:30:00")).toBe("2026-10-25T09:30:00");
    expect(formatCommitDateTime("2026-02-30T09:30:00Z")).toBe("2026-02-30T09:30:00Z");
    expect(formatCommitDateTime("2026-10-25T24:00:00Z")).toBe("2026-10-25T24:00:00Z");
  });
});
