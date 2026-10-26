import { describe, expect, it } from "bun:test";
import { isPlainObject } from "@/lib/object";

describe("isPlainObject", () => {
  it("accepts objects and rejects null, arrays, and primitives", () => {
    expect(isPlainObject({})).toBeTrue();
    expect(isPlainObject({ theme: "catppuccin-mocha" })).toBeTrue();
    expect(isPlainObject(Object.create(null))).toBeTrue();
    expect(isPlainObject(null)).toBeFalse();
    expect(isPlainObject([])).toBeFalse();
    expect(isPlainObject([{ theme: "catppuccin-mocha" }])).toBeFalse();
    expect(isPlainObject("{}")).toBeFalse();
    expect(isPlainObject(1)).toBeFalse();
    expect(isPlainObject(true)).toBeFalse();
    expect(isPlainObject(undefined)).toBeFalse();
  });
});
