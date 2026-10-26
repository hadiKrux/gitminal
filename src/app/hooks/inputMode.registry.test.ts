import { beforeEach, describe, expect, it } from "bun:test";
import { readInputMode, registerInputMode, resetInputModes } from "@/app/hooks/inputMode.registry";

beforeEach(() => {
  resetInputModes();
});

describe("input mode registry", () => {
  it("reads a registered mode and clears it on cleanup", () => {
    const cleanup = registerInputMode("search-input", "search");

    expect(readInputMode("search-input")).toBe("search");

    cleanup();

    expect(readInputMode("search-input")).toBeNull();
  });

  it("replaces a mode for the same renderable and keeps the newer owner", () => {
    const cleanupFirst = registerInputMode("field", "field");
    const cleanupSecond = registerInputMode("field", "search");

    expect(readInputMode("field")).toBe("search");

    cleanupFirst();

    expect(readInputMode("field")).toBe("search");

    cleanupSecond();

    expect(readInputMode("field")).toBeNull();
  });

  it("returns null for an unknown or absent renderable", () => {
    expect(readInputMode("missing")).toBeNull();
    expect(readInputMode(null)).toBeNull();
  });
});
