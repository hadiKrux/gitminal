import { DEFAULT_THEME_NAME, getThemeFlavor } from "./theme.catppuccin";
import type { ResolvedTheme, ThemeFlavor } from "./theme.types";

/**
 * Resolves the active built-in theme.
 *
 * `theme.json` overrides and capability detection are deferred; this core resolves one built-in
 * flavor and always returns a usable token set. An unknown or empty name falls back to Catppuccin
 * Mocha with a warning, so a bad theme value can never prevent launch.
 *
 * @param name - The requested theme name from configuration.
 * @returns The resolved theme tokens and any warning.
 */
export function resolveTheme(name: string | null | undefined): ResolvedTheme {
  const requested = name?.trim() ?? "";

  if (requested.length === 0) {
    return toResolvedTheme(readDefaultFlavor(), []);
  }

  const flavor = getThemeFlavor(requested);

  if (flavor) {
    return toResolvedTheme(flavor, []);
  }

  return toResolvedTheme(readDefaultFlavor(), [
    `Unknown theme "${requested}"; using "${DEFAULT_THEME_NAME}".`,
  ]);
}

/**
 * Reads the default flavor, which the catalogue always defines.
 *
 * @returns The default Catppuccin Mocha flavor.
 */
function readDefaultFlavor(): ThemeFlavor {
  const flavor = getThemeFlavor(DEFAULT_THEME_NAME);

  if (!flavor) {
    throw new Error(`Default theme "${DEFAULT_THEME_NAME}" is not defined.`);
  }

  return flavor;
}

/**
 * Adds resolution warnings to a flavor.
 *
 * @param flavor - The selected flavor.
 * @param warnings - Warnings produced while resolving.
 * @returns The resolved theme.
 */
function toResolvedTheme(flavor: ThemeFlavor, warnings: readonly string[]): ResolvedTheme {
  return {
    name: flavor.name,
    label: flavor.label,
    variant: flavor.variant,
    tokens: flavor.tokens,
    warnings,
  };
}
