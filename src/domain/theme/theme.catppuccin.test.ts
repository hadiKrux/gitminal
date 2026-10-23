import { describe, expect, it } from "bun:test";
import {
  DEFAULT_THEME_NAME,
  getThemeFlavor,
  MOCHA_ROLES,
  THEME_FLAVORS,
  THEME_NAMES,
} from "@/domain/theme/theme.catppuccin";
import { THEME_TOKEN_NAMES } from "@/domain/theme/theme.tokens";
import type { HexColor } from "@/domain/theme/theme.types";

/** Matches a validated `#RRGGBB` color. */
const HEX_PATTERN = /^#[0-9a-f]{6}$/;

/** Prefixes pinned palette suffixes; a bare `#` stays outside the hex-literal boundary check. */
const HEX_PREFIX = "#";

/**
 * Builds the expected color for a pinned palette value.
 *
 * @param suffix - Six hexadecimal digits without the leading `#`.
 * @returns The expected `#RRGGBB` color.
 */
function mochaColor(suffix: string): HexColor {
  return `${HEX_PREFIX}${suffix}` as HexColor;
}

/** Pinned official Catppuccin Mocha values for every role the token table uses. */
const EXPECTED_MOCHA_ROLES = {
  base: mochaColor("1e1e2e"),
  mantle: mochaColor("181825"),
  surface0: mochaColor("313244"),
  surface1: mochaColor("45475a"),
  surface2: mochaColor("585b70"),
  overlay1: mochaColor("7f849c"),
  subtext0: mochaColor("a6adc8"),
  text: mochaColor("cdd6f4"),
  mauve: mochaColor("cba6f7"),
  red: mochaColor("f38ba8"),
  peach: mochaColor("fab387"),
  yellow: mochaColor("f9e2af"),
  green: mochaColor("a6e3a1"),
  teal: mochaColor("94e2d5"),
  pink: mochaColor("f5c2e7"),
  sapphire: mochaColor("74c7ec"),
  blue: mochaColor("89b4fa"),
} as const;

describe("Catppuccin flavors", () => {
  it("defines the four built-in flavors in picker order", () => {
    expect([...THEME_NAMES]).toEqual([
      "catppuccin-mocha",
      "catppuccin-macchiato",
      "catppuccin-frappe",
      "catppuccin-latte",
    ]);
    expect(Object.keys(THEME_FLAVORS)).toEqual([...THEME_NAMES]);
  });

  it("defaults to Catppuccin Mocha", () => {
    expect(DEFAULT_THEME_NAME).toBe("catppuccin-mocha");
    expect(getThemeFlavor(DEFAULT_THEME_NAME)?.label).toBe("Catppuccin Mocha");
  });

  it("classifies Latte as light and the other flavors as dark", () => {
    const variants = THEME_NAMES.map((name) => [name, getThemeFlavor(name)?.variant]);

    expect(variants).toEqual([
      ["catppuccin-mocha", "dark"],
      ["catppuccin-macchiato", "dark"],
      ["catppuccin-frappe", "dark"],
      ["catppuccin-latte", "light"],
    ]);
  });

  it("defines every token with a valid color in every flavor", () => {
    for (const name of THEME_NAMES) {
      const flavor = getThemeFlavor(name);

      expect(flavor).toBeDefined();

      const tokens = flavor?.tokens as unknown as Record<string, string | readonly string[]>;

      for (const token of THEME_TOKEN_NAMES) {
        const value = tokens[token];

        if (value === undefined) {
          throw new Error(`Missing token "${token}" in theme "${name}".`);
        }

        if (typeof value === "string") {
          expect(value).toMatch(HEX_PATTERN);
        } else {
          expect(value.length).toBeGreaterThan(0);

          for (const color of value) {
            expect(color).toMatch(HEX_PATTERN);
          }
        }
      }
    }
  });

  it("returns undefined for an unknown flavor name", () => {
    expect(getThemeFlavor("not-a-theme")).toBeUndefined();
    expect(getThemeFlavor("Mocha")).toBeUndefined();
  });
});

describe("Catppuccin Mocha token roles", () => {
  it("pins the official Mocha palette roles", () => {
    expect(MOCHA_ROLES).toEqual(EXPECTED_MOCHA_ROLES);
  });

  it("maps every token to its documented Catppuccin role", () => {
    const mocha = getThemeFlavor("catppuccin-mocha") as ReturnType<typeof getThemeFlavor>;

    expect(mocha).toBeDefined();

    const tokens = mocha?.tokens as NonNullable<typeof mocha>["tokens"];

    expect(tokens).toMatchObject({
      background: EXPECTED_MOCHA_ROLES.base,
      panel: EXPECTED_MOCHA_ROLES.mantle,
      surface: EXPECTED_MOCHA_ROLES.surface0,
      border: EXPECTED_MOCHA_ROLES.surface1,
      focus: EXPECTED_MOCHA_ROLES.mauve,
      text: EXPECTED_MOCHA_ROLES.text,
      muted: EXPECTED_MOCHA_ROLES.subtext0,
      dim: EXPECTED_MOCHA_ROLES.overlay1,
      selection: EXPECTED_MOCHA_ROLES.surface2,
      accent: EXPECTED_MOCHA_ROLES.mauve,
      success: EXPECTED_MOCHA_ROLES.green,
      warning: EXPECTED_MOCHA_ROLES.yellow,
      error: EXPECTED_MOCHA_ROLES.red,
      info: EXPECTED_MOCHA_ROLES.blue,
      scrollbar: EXPECTED_MOCHA_ROLES.surface2,
      tag: EXPECTED_MOCHA_ROLES.peach,
      branchLocal: EXPECTED_MOCHA_ROLES.mauve,
      branchRemote: EXPECTED_MOCHA_ROLES.sapphire,
      diffAdd: EXPECTED_MOCHA_ROLES.green,
      diffRemove: EXPECTED_MOCHA_ROLES.red,
      diffContext: EXPECTED_MOCHA_ROLES.overlay1,
      diffHunk: EXPECTED_MOCHA_ROLES.blue,
      graph: [
        EXPECTED_MOCHA_ROLES.mauve,
        EXPECTED_MOCHA_ROLES.blue,
        EXPECTED_MOCHA_ROLES.teal,
        EXPECTED_MOCHA_ROLES.peach,
        EXPECTED_MOCHA_ROLES.pink,
        EXPECTED_MOCHA_ROLES.green,
      ],
    });

    expect(tokens.diffAddBackground).toMatch(HEX_PATTERN);
    expect(tokens.diffRemoveBackground).toMatch(HEX_PATTERN);
    expect(tokens.diffAddBackground).not.toBe(tokens.diffAdd);
    expect(tokens.diffRemoveBackground).not.toBe(tokens.diffRemove);
  });

  it("pins the documented Mocha diff backgrounds", () => {
    const tokens = getThemeFlavor("catppuccin-mocha")?.tokens;

    expect(tokens?.diffAddBackground).toBe(mochaColor("1f3b2c"));
    expect(tokens?.diffRemoveBackground).toBe(mochaColor("3b1f2a"));
  });
});

describe("Catppuccin shared data", () => {
  it("freezes every exported container and the nested token data", () => {
    expect(Object.isFrozen(THEME_NAMES)).toBe(true);
    expect(Object.isFrozen(THEME_TOKEN_NAMES)).toBe(true);
    expect(Object.isFrozen(THEME_FLAVORS)).toBe(true);
    expect(Object.isFrozen(MOCHA_ROLES)).toBe(true);

    for (const name of THEME_NAMES) {
      const flavor = getThemeFlavor(name);

      expect(Object.isFrozen(flavor), name).toBe(true);
      expect(Object.isFrozen(flavor?.tokens), name).toBe(true);
      expect(Object.isFrozen(flavor?.tokens.graph), name).toBe(true);
    }
  });

  it("does not allow mutating the frozen flavor lookup or name list", () => {
    expect(Reflect.set(THEME_FLAVORS, "catppuccin-mocha", getThemeFlavor("catppuccin-latte"))).toBe(
      false,
    );
    expect(Reflect.set(THEME_NAMES, 0, "catppuccin-latte")).toBe(false);
    expect(THEME_FLAVORS["catppuccin-mocha"].name).toBe("catppuccin-mocha");
    expect(THEME_NAMES[0]).toBe("catppuccin-mocha");
  });
});
