import { describe, expect, it } from "bun:test";
import { DEFAULT_THEME_NAME, getThemeFlavor, THEME_NAMES } from "@/domain/theme/theme.catppuccin";
import { resolveTheme } from "@/domain/theme/theme.resolve";
import type { HexColor, ThemeTokens } from "@/domain/theme/theme.types";

/** Prefix kept outside the string so colours are not written as hex literals. */
const HEX_PREFIX = "#";

/**
 * Builds a `#RRGGBB` value from six digits.
 *
 * @param digits - Six hexadecimal digits without the leading `#`.
 * @returns The color value.
 */
function color(digits: string): HexColor {
  return `${HEX_PREFIX}${digits}` as HexColor;
}

/**
 * Reads the tokens of one built-in flavor.
 *
 * @param name - Built-in theme name.
 * @returns The flavor tokens.
 */
function baseTokens(name = DEFAULT_THEME_NAME): ThemeTokens {
  return getThemeFlavor(name)?.tokens as ThemeTokens;
}

describe("resolveTheme base selection", () => {
  it("uses Catppuccin Mocha when no theme is requested", () => {
    for (const name of [undefined, null, "", "   "]) {
      const theme = resolveTheme(name);

      expect(theme.name).toBe(DEFAULT_THEME_NAME);
      expect(theme.label).toBe("Catppuccin Mocha");
      expect(theme.variant).toBe("dark");
      expect(theme.capability).toBe("truecolor");
      expect(theme.warnings).toEqual([]);
    }
  });

  it("resolves every built-in flavor by name", () => {
    for (const name of THEME_NAMES) {
      const theme = resolveTheme(name);

      expect(theme.name).toBe(name);
      expect(theme.warnings).toEqual([]);
      expect(theme.tokens).toBe(baseTokens(name));
    }
  });

  it("falls back to Mocha with a warning for an unknown theme", () => {
    const theme = resolveTheme("solarized");

    expect(theme.name).toBe(DEFAULT_THEME_NAME);
    expect(theme.tokens).toBe(baseTokens());
    expect(theme.warnings).toEqual(['Unknown theme "solarized"; using "catppuccin-mocha".']);
  });
});

describe("resolveTheme override layer", () => {
  it("applies a single token override over the base theme", () => {
    const accent = color("112233");
    const theme = resolveTheme("catppuccin-latte", { overrides: { colors: { accent } } });

    expect(theme.tokens.accent).toBe(accent);
    expect(theme.tokens.background).toBe(baseTokens("catppuccin-latte").background);
    expect(theme.warnings).toEqual([]);
  });

  it("changes only the tokens it names", () => {
    const base = baseTokens("catppuccin-frappe");
    const theme = resolveTheme("catppuccin-frappe", {
      overrides: { colors: { background: color("010203"), text: color("fdfcfb") } },
    });
    const changed = Object.entries(theme.tokens).filter(
      ([key, value]) => JSON.stringify(value) !== JSON.stringify(base[key as keyof ThemeTokens]),
    );

    expect(changed.map(([key]) => key).sort()).toEqual(["background", "text"]);
  });

  it("applies a graph lane override", () => {
    const lanes = [color("111111"), color("222222"), color("333333")];
    const theme = resolveTheme("catppuccin-mocha", { overrides: { colors: { graph: lanes } } });

    expect(theme.tokens.graph).toEqual(lanes);
    expect(Object.isFrozen(theme.tokens.graph)).toBe(true);
    expect(theme.tokens.text).toBe(baseTokens().text);
  });

  it("ignores an unknown token and keeps the base color", () => {
    const theme = resolveTheme("catppuccin-mocha", {
      overrides: { colors: { sparkle: color("abcdef") } },
    });

    expect(theme.tokens).toBe(baseTokens());
    expect(theme.warnings).toEqual([
      'Unknown token "sparkle" in theme.json; the base color was kept.',
    ]);
  });

  it("ignores an invalid color and keeps the base color", () => {
    for (const value of ["red", `${HEX_PREFIX}12345`, 7, null]) {
      const theme = resolveTheme("catppuccin-mocha", { overrides: { colors: { accent: value } } });

      expect(theme.tokens.accent).toBe(baseTokens().accent);
      expect(theme.warnings).toEqual([
        'Invalid color for "accent" in theme.json; the base color was kept.',
      ]);
    }
  });

  it("lowercases an accepted override color", () => {
    const theme = resolveTheme("catppuccin-mocha", {
      overrides: { colors: { accent: `${HEX_PREFIX}ABCDEF` } },
    });

    expect(theme.tokens.accent).toBe(color("abcdef"));
  });

  it("normalizes an invalid graph entry and keeps the valid ones", () => {
    const theme = resolveTheme("catppuccin-mocha", {
      overrides: { colors: { graph: [color("111111"), "nope"] } },
    });

    expect(theme.tokens.graph).toEqual([color("111111")]);
    expect(theme.warnings).toEqual([
      "Invalid graph lane color in theme.json; the base lane was kept.",
    ]);
  });

  it("keeps the base lanes when the graph list has no valid colors", () => {
    const theme = resolveTheme("catppuccin-mocha", { overrides: { colors: { graph: [] } } });

    expect(theme.tokens.graph).toBe(baseTokens().graph);
    expect(theme.warnings).toEqual([
      'The "graph" color list in theme.json has no valid colors; the base lanes were kept.',
    ]);
  });

  it("keeps the base lanes when graph is not a list", () => {
    const theme = resolveTheme("catppuccin-mocha", { overrides: { colors: { graph: 3 } } });

    expect(theme.tokens.graph).toBe(baseTokens().graph);
    expect(theme.warnings).toEqual([
      'The "graph" color list in theme.json must be an array; the base lanes were kept.',
    ]);
  });
});

describe("resolveTheme unusable override files", () => {
  it("keeps the base theme when theme.json is not an object", () => {
    const theme = resolveTheme("catppuccin-mocha", { overrides: ["colors"] });

    expect(theme.tokens).toBe(baseTokens());
    expect(theme.warnings).toEqual(["theme.json is not a JSON object; the base theme is in use."]);
  });

  it("keeps the base theme when theme.json has no colors object", () => {
    const theme = resolveTheme("catppuccin-mocha", { overrides: { version: 1 } });

    expect(theme.tokens).toBe(baseTokens());
    expect(theme.warnings).toEqual(["theme.json has no colors object; the base theme is in use."]);
  });

  it("ignores an unsupported theme.json version", () => {
    const theme = resolveTheme("catppuccin-mocha", {
      overrides: { version: 2, colors: { accent: color("112233") } },
    });

    expect(theme.tokens).toBe(baseTokens());
    expect(theme.warnings).toEqual(["Unsupported version in theme.json; the file was ignored."]);
  });

  it("reports the unknown theme and the override warnings together", () => {
    const theme = resolveTheme("nope", { overrides: { colors: { sparkle: color("112233") } } });

    expect(theme.warnings).toHaveLength(2);
  });
});
