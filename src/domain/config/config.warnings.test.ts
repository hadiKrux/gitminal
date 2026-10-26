import { describe, expect, it } from "bun:test";
import {
  boundConfigWarnings,
  combineConfigurationWarnings,
  MAX_CONFIG_WARNINGS,
  THEME_WARNING_PREFIX,
} from "@/domain/config/config.warnings";

describe("boundConfigWarnings", () => {
  it("keeps a short list exact", () => {
    expect(boundConfigWarnings(["one", "two"])).toEqual(["one", "two"]);
  });

  it("summarizes the remainder past the documented bound", () => {
    const warnings = Array.from({ length: MAX_CONFIG_WARNINGS + 3 }, (_, index) => `w${index}`);
    const bounded = boundConfigWarnings(warnings);

    expect(bounded).toHaveLength(MAX_CONFIG_WARNINGS);
    expect(bounded.at(-1)).toBe("4 more configuration warnings were omitted.");
  });
});

describe("combineConfigurationWarnings", () => {
  it("returns the configuration warnings when theme resolution reported none", () => {
    expect(combineConfigurationWarnings(["config warning"], [])).toEqual(["config warning"]);
  });

  it("prefixes theme warnings and keeps configuration warnings first", () => {
    expect(combineConfigurationWarnings(["config warning"], ["Unknown token"])).toEqual([
      "config warning",
      `${THEME_WARNING_PREFIX}Unknown token`,
    ]);
  });

  it("bounds the combined list once, covering both sources", () => {
    const configWarnings = Array.from({ length: MAX_CONFIG_WARNINGS }, (_, index) => `c${index}`);
    const combined = combineConfigurationWarnings(configWarnings, ["theme warning"]);
    const last = combined.at(-1) ?? "";

    expect(combined).toHaveLength(MAX_CONFIG_WARNINGS);
    expect(last).toContain("more configuration warnings were omitted.");
    expect(combined.some((warning) => warning.startsWith(THEME_WARNING_PREFIX))).toBeFalse();
  });
});
