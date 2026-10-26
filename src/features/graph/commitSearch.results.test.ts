import { describe, expect, it } from "bun:test";
import {
  clampIndex,
  readEmptyMessage,
  readStatusText,
} from "@/features/graph/commitSearch.results";

/** Base state shared by the status and empty-message assertions. */
const STATE = {
  isOpen: true,
  isResultsMode: true,
  enabled: true,
  isLoading: false,
  error: null,
  done: false,
  count: 3,
  query: "fix",
};

describe("commit search results", () => {
  it("clamps indexes into a possibly empty list", () => {
    expect(clampIndex(5, 3)).toBe(2);
    expect(clampIndex(-2, 3)).toBe(0);
    expect(clampIndex(Number.NaN, 3)).toBe(0);
    expect(clampIndex(1, 0)).toBe(0);
  });

  it("reports a plus marker while more pages may exist", () => {
    expect(readStatusText(STATE)).toBe("3+ matches");
    expect(readStatusText({ ...STATE, done: true })).toBe("3 matches");
    expect(readStatusText({ ...STATE, isLoading: true })).toBe("Searching...");
    expect(readStatusText({ ...STATE, isResultsMode: false })).toBeNull();
  });

  it("reports the no-match message only after the results are exhausted", () => {
    expect(readEmptyMessage({ ...STATE, done: true, count: 0 })).toBe("No commits match fix");
    expect(readEmptyMessage({ ...STATE, done: false, count: 0 })).toBeNull();
    expect(readEmptyMessage({ ...STATE, done: true, count: 2 })).toBeNull();
  });
});
