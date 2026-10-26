import { describe, expect, it } from "bun:test";
import { applyThemeCapability, detectColorCapability } from "@/domain/theme/theme.capability";
import { nearestPaletteColor } from "@/domain/theme/theme.capability.palette";
import { MONO_PALETTES } from "@/domain/theme/theme.catppuccin";
import { resolveTheme } from "@/domain/theme/theme.resolve";
import type { HexColor, ThemeTokens } from "@/domain/theme/theme.types";

/** Matches a validated `#RRGGBB` color. */
const HEX_PATTERN = /^#[0-9a-f]{6}$/;

/**
 * Flattens a token table into its color strings.
 *
 * @param tokens - Token table under test.
 * @returns Every token color, including the graph lanes.
 */
function readTokenColors(tokens: ThemeTokens): readonly string[] {
  return Object.values(tokens).flatMap((value) =>
    typeof value === "string" ? [value] : [...value],
  );
}

describe("detectColorCapability", () => {
  it("detects truecolor from COLORTERM", () => {
    expect(detectColorCapability({ env: { COLORTERM: "truecolor" } })).toBe("truecolor");
    expect(detectColorCapability({ env: { COLORTERM: "24bit" } })).toBe("truecolor");
    expect(detectColorCapability({ env: { COLORTERM: "24BIT", TERM: "xterm" } })).toBe("truecolor");
  });

  it("detects the 256-color fallback from TERM", () => {
    expect(detectColorCapability({ env: { TERM: "xterm-256color" } })).toBe("color-256");
    expect(detectColorCapability({ env: { COLORTERM: "256color" } })).toBe("color-256");
  });

  it("keeps an unrecognized terminal on the 256-color baseline", () => {
    expect(detectColorCapability({ env: { TERM: "xterm" } })).toBe("color-256");
  });

  it("detects monochrome for a dumb or silent terminal", () => {
    expect(detectColorCapability({ env: { TERM: "dumb" } })).toBe("monochrome");
    expect(detectColorCapability({ env: {} })).toBe("monochrome");
  });

  it("honors NO_COLOR even when the terminal reports truecolor", () => {
    expect(detectColorCapability({ env: { NO_COLOR: "1", COLORTERM: "truecolor" } })).toBe(
      "monochrome",
    );
    expect(detectColorCapability({ env: { NO_COLOR: "   ", COLORTERM: "truecolor" } })).toBe(
      "monochrome",
    );
  });

  it("keeps color for an empty NO_COLOR value", () => {
    expect(detectColorCapability({ env: { NO_COLOR: "", COLORTERM: "truecolor" } })).toBe(
      "truecolor",
    );
  });
});

describe("applyThemeCapability with truecolor", () => {
  it("returns the resolved theme by reference", () => {
    const theme = resolveTheme("catppuccin-mocha");

    expect(applyThemeCapability(theme, "truecolor")).toBe(theme);
  });
});

describe("applyThemeCapability with 256 colors", () => {
  it("maps every token onto an xterm palette entry", () => {
    const base = resolveTheme("catppuccin-mocha");
    const mapped = applyThemeCapability(base, "color-256");

    expect(mapped.capability).toBe("color-256");
    expect(mapped.name).toBe(base.name);
    expect(mapped.label).toBe(base.label);
    expect(mapped.variant).toBe(base.variant);
    expect(mapped.warnings).toEqual(base.warnings);
    expect(mapped.tokens.background).not.toBe(base.tokens.background);

    for (const value of readTokenColors(mapped.tokens)) {
      expect(value).toMatch(HEX_PATTERN);

      // A palette entry maps onto itself, which proves the search landed on the palette.
      expect(nearestPaletteColor(value as HexColor)).toBe(value as HexColor);
    }
  });

  it("preserves the graph lane count", () => {
    const base = resolveTheme("catppuccin-latte");
    const mapped = applyThemeCapability(base, "color-256");

    expect(mapped.tokens.graph).toHaveLength(base.tokens.graph.length);
    expect(Object.isFrozen(mapped.tokens.graph)).toBe(true);
  });
});

describe("applyThemeCapability with monochrome", () => {
  it("maps a dark theme onto the dark two-tone palette", () => {
    const mapped = applyThemeCapability(resolveTheme("catppuccin-mocha"), "monochrome");
    const palette = MONO_PALETTES.dark;

    expect(mapped.capability).toBe("monochrome");
    expect(mapped.tokens.background).toBe(palette.background);
    expect(mapped.tokens.text).toBe(palette.text);
    expect(mapped.tokens.focus).toBe(palette.focus);
    expect(mapped.tokens.border).toBe(palette.border);
    expect(mapped.tokens.selection).toBe(palette.selection);
    expect(mapped.tokens.accent).toBe(palette.text);
    expect(mapped.tokens.success).toBe(palette.text);
    expect(mapped.tokens.error).toBe(palette.text);
    expect(mapped.tokens.diffAdd).toBe(palette.text);
    expect(mapped.tokens.diffRemove).toBe(palette.text);
    expect(mapped.tokens.diffAddBackground).toBe(palette.background);
  });

  it("maps a light theme onto the light two-tone palette", () => {
    const mapped = applyThemeCapability(resolveTheme("catppuccin-latte"), "monochrome");

    expect(mapped.tokens.background).toBe(MONO_PALETTES.light.background);
    expect(mapped.tokens.text).toBe(MONO_PALETTES.light.text);
  });

  it("keeps the theme metadata and alternates the graph lanes", () => {
    const base = resolveTheme("catppuccin-frappe");
    const mapped = applyThemeCapability(base, "monochrome");

    expect(mapped.name).toBe(base.name);
    expect(mapped.label).toBe(base.label);
    expect(mapped.variant).toBe(base.variant);
    expect(mapped.warnings).toEqual(base.warnings);
    expect(mapped.tokens.graph).toHaveLength(base.tokens.graph.length);
    expect(mapped.tokens.graph[0]).toBe(MONO_PALETTES.dark.text);
    expect(mapped.tokens.graph[1]).toBe(MONO_PALETTES.dark.border);
  });
});

describe("theme markers", () => {
  it("never changes a token's meaning, so text markers stay authoritative", () => {
    const base = resolveTheme("catppuccin-mocha");
    const mapped = applyThemeCapability(base, "monochrome");

    // Layout, names, and markers live outside the token table; a capability changes colors only.
    expect(Object.keys(mapped.tokens).sort()).toEqual(Object.keys(base.tokens).sort());
  });
});
