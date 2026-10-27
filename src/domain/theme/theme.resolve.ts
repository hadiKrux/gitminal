import { isPlainObject } from "@/lib/object";
import { DEFAULT_THEME_NAME, getThemeFlavor } from "./theme.catppuccin";
import type { ThemeToken } from "./theme.tokens";
import { THEME_TOKEN_NAMES } from "./theme.tokens";
import type {
  HexColor,
  ResolvedTheme,
  ResolveThemeOptions,
  ThemeFlavor,
  ThemeOverrideLayer,
  ThemeTokens,
} from "./theme.types";

/** Every accepted color is a six-digit `#RRGGBB` value. */
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

/**
 * Resolves the active built-in theme and layers the optional `theme.json` overrides.
 *
 * The layer order is the selected built-in flavor, then the per-token overrides and the graph lane
 * array from `theme.json`. An unknown or empty theme name falls back to Catppuccin Mocha with a
 * warning. The override file is validated entry by entry: an unknown token name, an invalid color
 * value, or an unsupported schema version is ignored with a warning while the base token is kept, so
 * a bad override can never prevent launch. Capability mapping stays in `theme.capability.ts`.
 *
 * @param name - The requested theme name from configuration.
 * @param options - Raw `theme.json` value to layer over the base theme.
 * @returns The resolved theme tokens with resolution warnings and the truecolor capability.
 */
export function resolveTheme(
  name: string | null | undefined,
  options: ResolveThemeOptions = {},
): ResolvedTheme {
  const warnings: string[] = [];
  const flavor = readFlavor(name?.trim() ?? "", warnings);
  const layer = readOverrideLayer(options.overrides, warnings);

  return toResolvedTheme(flavor, mergeOverrideLayer(flavor, layer), warnings);
}

/**
 * Reads one built-in flavor by name.
 *
 * @param requested - The requested theme name, already trimmed.
 * @param warnings - Warning accumulator.
 * @returns The matched flavor, or the default flavor with an unknown-name warning.
 */
function readFlavor(requested: string, warnings: string[]): ThemeFlavor {
  if (requested.length === 0) {
    return readDefaultFlavor();
  }

  const flavor = getThemeFlavor(requested);

  if (flavor) {
    return flavor;
  }

  warnings.push(`Unknown theme "${requested}"; using "${DEFAULT_THEME_NAME}".`);

  return readDefaultFlavor();
}

/**
 * Reads the default flavor, which the catalogue always defines.
 *
 * @returns The default Catppuccin Mocha flavor.
 * @throws When the catalogue does not define the documented default flavor.
 */
function readDefaultFlavor(): ThemeFlavor {
  const flavor = getThemeFlavor(DEFAULT_THEME_NAME);

  if (!flavor) {
    throw new Error(`Default theme "${DEFAULT_THEME_NAME}" is not defined.`);
  }

  return flavor;
}

/**
 * Validates one raw `theme.json` value.
 *
 * @param raw - Parsed file value, or `null` and `undefined` when absent.
 * @param warnings - Warning accumulator.
 * @returns The validated override layer, or `null` when the file is absent or unusable.
 */
function readOverrideLayer(raw: unknown, warnings: string[]): ThemeOverrideLayer | null {
  if (raw === null || raw === undefined) {
    return null;
  }

  if (!isPlainObject(raw)) {
    warnings.push("theme.json is not a JSON object; the base theme is in use.");

    return null;
  }

  if (!isSupportedVersion(raw.version)) {
    warnings.push("Unsupported version in theme.json; the file was ignored.");

    return null;
  }

  const colors = raw.colors;

  if (!isPlainObject(colors)) {
    warnings.push("theme.json has no colors object; the base theme is in use.");

    return null;
  }

  return {
    tokens: readTokenOverrides(colors, warnings),
    graph: readGraphLanes(colors.graph, warnings),
  };
}

/**
 * Reports whether a `theme.json` version is supported.
 *
 * @param version - Raw version value.
 * @returns True when the version is absent or one, per F-20.
 */
function isSupportedVersion(version: unknown): boolean {
  return version === undefined || version === 1;
}

/**
 * Reads every accepted per-token color override.
 *
 * @param colors - The required `colors` object.
 * @param warnings - Warning accumulator.
 * @returns The accepted token overrides; `graph` is handled separately.
 */
function readTokenOverrides(
  colors: Record<string, unknown>,
  warnings: string[],
): Partial<Record<Exclude<ThemeToken, "graph">, HexColor>> {
  const tokens: Partial<Record<Exclude<ThemeToken, "graph">, HexColor>> = {};

  for (const [token, value] of Object.entries(colors)) {
    if (token === "graph") {
      continue;
    }

    if (!THEME_TOKEN_NAMES.includes(token as ThemeToken)) {
      warnings.push(`Unknown token "${token}" in theme.json; the base color was kept.`);

      continue;
    }

    if (typeof value !== "string" || !HEX_COLOR_PATTERN.test(value)) {
      warnings.push(`Invalid color for "${token}" in theme.json; the base color was kept.`);

      continue;
    }

    tokens[token as Exclude<ThemeToken, "graph">] = value.toLowerCase() as HexColor;
  }

  return tokens;
}

/**
 * Reads the optional graph lane list.
 *
 * An entry that is not a valid color is dropped with a warning, and a list with no valid colors
 * leaves the built-in lane order in place.
 *
 * @param raw - Raw `graph` value.
 * @param warnings - Warning accumulator.
 * @returns The lane colors, or `null` when the built-in lanes are kept.
 */
function readGraphLanes(raw: unknown, warnings: string[]): readonly HexColor[] | null {
  if (raw === undefined) {
    return null;
  }

  if (!Array.isArray(raw)) {
    warnings.push(
      'The "graph" color list in theme.json must be an array; the base lanes were kept.',
    );

    return null;
  }

  const lanes: HexColor[] = [];

  for (const value of raw) {
    if (typeof value !== "string" || !HEX_COLOR_PATTERN.test(value)) {
      warnings.push("Invalid graph lane color in theme.json; the base lane was kept.");

      continue;
    }

    lanes.push(value.toLowerCase() as HexColor);
  }

  if (lanes.length === 0) {
    warnings.push(
      'The "graph" color list in theme.json has no valid colors; the base lanes were kept.',
    );

    return null;
  }

  return Object.freeze(lanes);
}

/**
 * Layers the validated overrides over one built-in flavor.
 *
 * The built-in token object is returned by reference when nothing overrides it, so an unconfigured
 * theme keeps its frozen catalogue instance.
 *
 * @param flavor - The selected built-in flavor.
 * @param layer - Validated overrides, or `null` when `theme.json` is absent.
 * @returns The token table with per-token overrides and graph lane colors applied.
 */
function mergeOverrideLayer(flavor: ThemeFlavor, layer: ThemeOverrideLayer | null): ThemeTokens {
  if (layer === null) {
    return flavor.tokens;
  }

  if (layer.graph === null && Object.keys(layer.tokens).length === 0) {
    return flavor.tokens;
  }

  return Object.freeze({
    ...flavor.tokens,
    ...layer.tokens,
    graph: Object.freeze(layer.graph ?? flavor.tokens.graph),
  });
}

/**
 * Builds the resolved theme from a flavor and its final tokens.
 *
 * @param flavor - The selected flavor.
 * @param tokens - Final tokens after any override layer.
 * @param warnings - Warnings produced while resolving.
 * @returns The resolved theme with the truecolor base capability.
 */
function toResolvedTheme(
  flavor: ThemeFlavor,
  tokens: ThemeTokens,
  warnings: readonly string[],
): ResolvedTheme {
  return {
    name: flavor.name,
    label: flavor.label,
    variant: flavor.variant,
    capability: "truecolor",
    tokens,
    warnings,
  };
}
