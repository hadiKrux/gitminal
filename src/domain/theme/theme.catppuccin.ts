import type {
  CatppuccinRoles,
  FlavorDefinition,
  HexColor,
  ThemeFlavor,
  ThemeName,
  ThemeTokens,
} from "./theme.types";

/** Official Catppuccin Mocha roles. */
export const MOCHA_ROLES: CatppuccinRoles = Object.freeze({
  base: "#1e1e2e",
  mantle: "#181825",
  surface0: "#313244",
  surface1: "#45475a",
  surface2: "#585b70",
  overlay1: "#7f849c",
  subtext0: "#a6adc8",
  text: "#cdd6f4",
  mauve: "#cba6f7",
  red: "#f38ba8",
  peach: "#fab387",
  yellow: "#f9e2af",
  green: "#a6e3a1",
  teal: "#94e2d5",
  pink: "#f5c2e7",
  sapphire: "#74c7ec",
  blue: "#89b4fa",
});

/** Official Catppuccin Macchiato roles. */
const MACCHIATO_ROLES: CatppuccinRoles = Object.freeze({
  base: "#24273a",
  mantle: "#1e2030",
  surface0: "#363a4f",
  surface1: "#494d64",
  surface2: "#5b6078",
  overlay1: "#8087a2",
  subtext0: "#a5adcb",
  text: "#cad3f5",
  mauve: "#c6a0f6",
  red: "#ed8796",
  peach: "#f5a97f",
  yellow: "#eed49f",
  green: "#a6da95",
  teal: "#8bd5ca",
  pink: "#f5bde6",
  sapphire: "#7dc4e4",
  blue: "#8aadf4",
});

/** Official Catppuccin Frappe roles. */
const FRAPPE_ROLES: CatppuccinRoles = Object.freeze({
  base: "#303446",
  mantle: "#292c3c",
  surface0: "#414559",
  surface1: "#51576d",
  surface2: "#626880",
  overlay1: "#838ba7",
  subtext0: "#a5adce",
  text: "#c6d0f5",
  mauve: "#ca9ee6",
  red: "#e78284",
  peach: "#ef9f76",
  yellow: "#e5c890",
  green: "#a6d189",
  teal: "#81c8be",
  pink: "#f4b8e4",
  sapphire: "#85c1dc",
  blue: "#8caaee",
});

/** Official Catppuccin Latte roles. */
const LATTE_ROLES: CatppuccinRoles = Object.freeze({
  base: "#eff1f5",
  mantle: "#e6e9ef",
  surface0: "#ccd0da",
  surface1: "#bcc0cc",
  surface2: "#acb0be",
  overlay1: "#8c8fa1",
  subtext0: "#6c6f85",
  text: "#4c4f69",
  mauve: "#8839ef",
  red: "#d20f39",
  peach: "#fe640b",
  yellow: "#df8e1d",
  green: "#40a02b",
  teal: "#179299",
  pink: "#ea76cb",
  sapphire: "#209fb5",
  blue: "#1e66f5",
});

/** The default built-in theme name. */
export const DEFAULT_THEME_NAME: ThemeName = "catppuccin-mocha";

/** Every built-in theme name in picker order. */
export const THEME_NAMES: readonly ThemeName[] = Object.freeze([
  "catppuccin-mocha",
  "catppuccin-macchiato",
  "catppuccin-frappe",
  "catppuccin-latte",
]);

/**
 * The four built-in definitions before token derivation.
 *
 * Mocha's diff backgrounds are the documented example. The Macchiato, Frappe, and Latte pairs are
 * provisional hand-picked values until the contrast-safe derivation from the capability milestone
 * replaces them; nothing verifies their contrast yet.
 */
const FLAVOR_DEFINITIONS: readonly FlavorDefinition[] = [
  {
    name: "catppuccin-mocha",
    label: "Catppuccin Mocha",
    variant: "dark",
    roles: MOCHA_ROLES,
    diffAddBackground: "#1f3b2c",
    diffRemoveBackground: "#3b1f2a",
  },
  {
    name: "catppuccin-macchiato",
    label: "Catppuccin Macchiato",
    variant: "dark",
    roles: MACCHIATO_ROLES,
    diffAddBackground: "#343c45",
    diffRemoveBackground: "#3c3245",
  },
  {
    name: "catppuccin-frappe",
    label: "Catppuccin Frappe",
    variant: "dark",
    roles: FRAPPE_ROLES,
    diffAddBackground: "#3e464e",
    diffRemoveBackground: "#463d4d",
  },
  {
    name: "catppuccin-latte",
    label: "Catppuccin Latte",
    variant: "light",
    roles: LATTE_ROLES,
    diffAddBackground: "#dae7dd",
    diffRemoveBackground: "#ecd6de",
  },
];

/** Every built-in flavor keyed by name. */
export const THEME_FLAVORS: Readonly<Record<ThemeName, ThemeFlavor>> = Object.freeze(
  Object.fromEntries(
    FLAVOR_DEFINITIONS.map((definition) => [definition.name, createFlavor(definition)]),
  ) as Record<ThemeName, ThemeFlavor>,
);

/**
 * Looks up a built-in flavor by name.
 *
 * @param name - The requested theme name.
 * @returns The matching flavor, or `undefined` for an unknown name.
 */
export function getThemeFlavor(name: string): ThemeFlavor | undefined {
  if (!Object.hasOwn(THEME_FLAVORS, name)) {
    return undefined;
  }

  return THEME_FLAVORS[name as ThemeName];
}

/**
 * Builds one flavor from its palette roles.
 *
 * The result is frozen because `THEME_FLAVORS` stores it once and every consumer receives it by
 * reference; an accidental mutation would change the theme process-wide.
 *
 * @param definition - The flavor definition.
 * @returns The fully specified, frozen flavor.
 */
function createFlavor(definition: FlavorDefinition): ThemeFlavor {
  const { roles } = definition;

  return Object.freeze({
    name: definition.name,
    label: definition.label,
    variant: definition.variant,
    tokens: createTokens(roles, definition.diffAddBackground, definition.diffRemoveBackground),
  });
}

/**
 * Maps Catppuccin roles onto the Gitminal token table.
 *
 * The token object and its graph array are frozen because the same instance is handed to every
 * consumer by reference.
 *
 * @param roles - The flavor's palette roles.
 * @param diffAddBackground - Explicit added-line background.
 * @param diffRemoveBackground - Explicit removed-line background.
 * @returns The final, frozen token set.
 */
function createTokens(
  roles: CatppuccinRoles,
  diffAddBackground: HexColor,
  diffRemoveBackground: HexColor,
): ThemeTokens {
  return Object.freeze({
    background: roles.base,
    panel: roles.mantle,
    surface: roles.surface0,
    border: roles.surface1,
    focus: roles.mauve,
    text: roles.text,
    muted: roles.subtext0,
    dim: roles.overlay1,
    selection: roles.surface2,
    accent: roles.mauve,
    success: roles.green,
    warning: roles.yellow,
    error: roles.red,
    info: roles.blue,
    scrollbar: roles.surface2,
    tag: roles.peach,
    branchLocal: roles.mauve,
    branchRemote: roles.sapphire,
    diffAdd: roles.green,
    diffRemove: roles.red,
    diffAddBackground,
    diffRemoveBackground,
    diffContext: roles.overlay1,
    diffHunk: roles.blue,
    graph: Object.freeze([
      roles.mauve,
      roles.blue,
      roles.teal,
      roles.peach,
      roles.pink,
      roles.green,
    ]),
  });
}
