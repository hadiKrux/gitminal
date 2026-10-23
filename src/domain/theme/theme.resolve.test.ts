import { describe, expect, it } from "bun:test";
import { DEFAULT_THEME_NAME, THEME_NAMES } from "@/domain/theme/theme.catppuccin";
import { resolveTheme } from "@/domain/theme/theme.resolve";

describe("resolveTheme", () => {
  it("uses Catppuccin Mocha when no theme is requested", () => {
    for (const name of [undefined, null, "", "   "]) {
      const theme = resolveTheme(name);

      expect(theme.name).toBe(DEFAULT_THEME_NAME);
      expect(theme.label).toBe("Catppuccin Mocha");
      expect(theme.variant).toBe("dark");
      expect(theme.warnings).toEqual([]);
    }
  });

  it("resolves every built-in flavor by name", () => {
    for (const name of THEME_NAMES) {
      const theme = resolveTheme(name);

      expect(theme.name).toBe(name);
      expect(theme.warnings).toEqual([]);
      expect(theme.tokens.background).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("falls back to Mocha with a warning for an unknown theme", () => {
    const theme = resolveTheme("solarized");

    expect(theme.name).toBe(DEFAULT_THEME_NAME);
    expect(theme.tokens).toEqual(resolveTheme(DEFAULT_THEME_NAME).tokens);
    expect(theme.warnings).toEqual(['Unknown theme "solarized"; using "catppuccin-mocha".']);
  });
});
