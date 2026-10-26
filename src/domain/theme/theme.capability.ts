import { nearestPaletteColor } from "./theme.capability.palette";
import { MONO_PALETTES } from "./theme.catppuccin";
import type {
  DetectColorCapabilityOptions,
  HexColor,
  ResolvedTheme,
  ThemeColorCapability,
  ThemeTokens,
} from "./theme.types";

/** Environment value that turns color off entirely. */
const NO_COLOR_VARIABLE = "NO_COLOR";

/** Environment value that names the terminal color flavor. */
const COLORTERM_VARIABLE = "COLORTERM";

/** Environment value that names the terminal type. */
const TERM_VARIABLE = "TERM";

/** Terminal type that reports no styling support at all. */
const DUMB_TERMINAL = "dumb";

/**
 * Detects the terminal color capability.
 *
 * `NO_COLOR` present and non-empty forces monochrome, because the user asked for it. Presence is
 * tested without trimming, matching no-color.org: a whitespace-only value still disables color. A
 * `COLORTERM` naming truecolor or 24-bit selects truecolor, and a `TERM` containing `256color`
 * selects the 256-color fallback. `TERM=dumb`, or a terminal that reports neither variable, is
 * monochrome. Every other terminal keeps the 256-color baseline, so an unrecognized modern terminal
 * stays usable instead of dropping to two tones. Detection is pure and environment-injectable for
 * tests; production reads the process environment.
 *
 * @param options - Environment override used by tests.
 * @returns The detected capability.
 */
export function detectColorCapability(
  options: DetectColorCapabilityOptions = {},
): ThemeColorCapability {
  const env = options.env ?? process.env;

  if ((env[NO_COLOR_VARIABLE] ?? "").length > 0) {
    return "monochrome";
  }

  const colorTerm = readEnvironment(env, COLORTERM_VARIABLE);
  const term = readEnvironment(env, TERM_VARIABLE);

  if (colorTerm.includes("truecolor") || colorTerm.includes("24bit")) {
    return "truecolor";
  }

  if (term.includes("256color") || colorTerm.includes("256color")) {
    return "color-256";
  }

  return term.length === 0 || term === DUMB_TERMINAL ? "monochrome" : "color-256";
}

/**
 * Reads one lowercased environment value.
 *
 * @param env - Environment variables.
 * @param name - Variable name.
 * @returns The lowercased value, or an empty string.
 */
function readEnvironment(env: Readonly<Record<string, string | undefined>>, name: string): string {
  return (env[name] ?? "").toLowerCase();
}

/**
 * Applies one color capability to a resolved theme.
 *
 * Truecolor keeps the theme by reference, so a memoized resolved theme stays cheap to reuse. The
 * 256-color capability snaps each color to the nearest entry of the xterm 256-color cube and
 * grayscale ramp, and monochrome remaps every token onto a readable two-tone palette for the
 * theme's variant. The mapping changes color values only: the theme name, label, variant, warnings,
 * and the graph lane count are preserved, so names, markers, and layout carry the same meaning.
 *
 * @param theme - Resolved theme before capability mapping.
 * @param capability - Terminal capability detected by `detectColorCapability`.
 * @returns The resolved theme with capability-mapped tokens.
 */
export function applyThemeCapability(
  theme: ResolvedTheme,
  capability: ThemeColorCapability,
): ResolvedTheme {
  if (capability === "truecolor") {
    return theme;
  }

  return {
    ...theme,
    capability,
    tokens:
      capability === "color-256"
        ? mapToPalette(theme.tokens)
        : mapToMonochrome(theme.tokens, theme.variant),
  };
}

/**
 * Maps every token color to the nearest xterm 256-color palette entry.
 *
 * @param tokens - Source tokens.
 * @returns The mapped token table with frozen graph lanes.
 */
function mapToPalette(tokens: ThemeTokens): ThemeTokens {
  return Object.freeze({
    background: nearestPaletteColor(tokens.background),
    panel: nearestPaletteColor(tokens.panel),
    surface: nearestPaletteColor(tokens.surface),
    border: nearestPaletteColor(tokens.border),
    focus: nearestPaletteColor(tokens.focus),
    text: nearestPaletteColor(tokens.text),
    muted: nearestPaletteColor(tokens.muted),
    dim: nearestPaletteColor(tokens.dim),
    selection: nearestPaletteColor(tokens.selection),
    accent: nearestPaletteColor(tokens.accent),
    success: nearestPaletteColor(tokens.success),
    warning: nearestPaletteColor(tokens.warning),
    error: nearestPaletteColor(tokens.error),
    info: nearestPaletteColor(tokens.info),
    scrollbar: nearestPaletteColor(tokens.scrollbar),
    tag: nearestPaletteColor(tokens.tag),
    branchLocal: nearestPaletteColor(tokens.branchLocal),
    branchRemote: nearestPaletteColor(tokens.branchRemote),
    diffAdd: nearestPaletteColor(tokens.diffAdd),
    diffRemove: nearestPaletteColor(tokens.diffRemove),
    diffAddBackground: nearestPaletteColor(tokens.diffAddBackground),
    diffRemoveBackground: nearestPaletteColor(tokens.diffRemoveBackground),
    diffContext: nearestPaletteColor(tokens.diffContext),
    diffHunk: nearestPaletteColor(tokens.diffHunk),
    graph: Object.freeze(tokens.graph.map(nearestPaletteColor)),
  });
}

/**
 * Builds the frozen monochrome token table for one variant.
 *
 * Every token receives a value from the variant's readable two-tone palette: accents, statuses, and
 * diff signs collapse to the primary text so the `+` and `-` signs and the `ICONS` markers carry the
 * meaning instead of color, while the background classes and the alternating graph lanes keep
 * structure visible.
 *
 * @param tokens - Source tokens; only the graph lane count is reused.
 * @param variant - Light or dark variant that selects the palette.
 * @returns The frozen monochrome token table.
 */
function mapToMonochrome(tokens: ThemeTokens, variant: ResolvedTheme["variant"]): ThemeTokens {
  const palette = variant === "light" ? MONO_PALETTES.light : MONO_PALETTES.dark;
  const alternateLane: HexColor = palette.border;

  return Object.freeze({
    background: palette.background,
    panel: palette.background,
    surface: palette.surface,
    border: palette.border,
    focus: palette.focus,
    text: palette.text,
    muted: palette.muted,
    dim: palette.dim,
    selection: palette.selection,
    accent: palette.text,
    success: palette.text,
    warning: palette.text,
    error: palette.text,
    info: palette.text,
    scrollbar: palette.border,
    tag: palette.text,
    branchLocal: palette.text,
    branchRemote: palette.text,
    diffAdd: palette.text,
    diffRemove: palette.text,
    diffAddBackground: palette.background,
    diffRemoveBackground: palette.background,
    diffContext: palette.dim,
    diffHunk: palette.muted,
    graph: Object.freeze(
      tokens.graph.map((_, index) => (index % 2 === 0 ? palette.text : alternateLane)),
    ),
  });
}
