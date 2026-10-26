import { describe, expect, it } from "bun:test";
import { clampIndex } from "@/lib/list";

describe("clampIndex", () => {
  it("keeps an index that is already inside the list", () => {
    expect(clampIndex(0, 3)).toBe(0);
    expect(clampIndex(2, 3)).toBe(2);
  });

  it("clamps an index past either end", () => {
    expect(clampIndex(5, 3)).toBe(2);
    expect(clampIndex(-2, 3)).toBe(0);
  });

  it("truncates a fractional index toward zero", () => {
    expect(clampIndex(1.8, 3)).toBe(1);
    expect(clampIndex(-0.5, 3)).toBe(0);
  });

  it("returns zero for an empty list or a non-finite index", () => {
    expect(clampIndex(1, 0)).toBe(0);
    expect(clampIndex(1, -1)).toBe(0);
    expect(clampIndex(Number.NaN, 3)).toBe(0);
    expect(clampIndex(Number.POSITIVE_INFINITY, 3)).toBe(0);
  });
});
