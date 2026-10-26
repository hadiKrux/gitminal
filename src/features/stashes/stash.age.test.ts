import { describe, expect, it } from "bun:test";
import { formatStashAge } from "@/features/stashes/stash.age";

/** Clock value used to keep the boundaries deterministic. */
const NOW_MS = 1_700_000_000_000;

/**
 * Formats an age measured in whole days before the fixed clock.
 *
 * @param days - Days before the clock.
 * @returns The rendered relative age.
 */
function ageInDays(days: number): string {
  return formatStashAge(1_700_000_000 - days * 86_400, NOW_MS);
}

describe("formatStashAge", () => {
  it("reports unknown age for a missing timestamp", () => {
    expect(formatStashAge(0, NOW_MS)).toBe("unknown age");
  });

  it("renders the small units", () => {
    expect(ageInDays(0)).toBe("just now");
    expect(formatStashAge(1_700_000_000 - 600, NOW_MS)).toBe("10m ago");
    expect(formatStashAge(1_700_000_000 - 7_300, NOW_MS)).toBe("2h ago");
    expect(ageInDays(2)).toBe("2d ago");
  });

  it("switches from days to months at 30 days", () => {
    expect(ageInDays(29)).toBe("29d ago");
    expect(ageInDays(30)).toBe("1mo ago");
    expect(ageInDays(59)).toBe("1mo ago");
    expect(ageInDays(60)).toBe("2mo ago");
  });

  it("never renders 0y ago around the year boundary", () => {
    expect(ageInDays(359)).toBe("11mo ago");
    expect(ageInDays(360)).toBe("12mo ago");
    expect(ageInDays(364)).toBe("12mo ago");
    expect(ageInDays(365)).toBe("1y ago");
    expect(ageInDays(730)).toBe("2y ago");
  });
});
