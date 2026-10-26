import type { ThemeToken } from "./theme.tokens";

/** Color support level of the current terminal. */
export type ThemeColorCapability = "truecolor" | "color-256" | "monochrome";

/** Built-in Catppuccin flavor names accepted in `config.json`. */
export type ThemeName =
  | "catppuccin-mocha"
  | "catppuccin-macchiato"
  | "catppuccin-frappe"
  | "catppuccin-latte";

/** Light or dark classification shown in the theme picker. */
export type ThemeVariant = "dark" | "light";

/** A validated `#RRGGBB` color from the built-in palette or a theme override. */
export type HexColor = `#${string}`;

/** The Catppuccin source roles used by the Gitminal token table. */
export interface CatppuccinRoles {
  /** Base background. */
  readonly base: HexColor;
  /** Mantle background. */
  readonly mantle: HexColor;
  /** Lowest surface. */
  readonly surface0: HexColor;
  /** Middle surface. */
  readonly surface1: HexColor;
  /** Highest surface. */
  readonly surface2: HexColor;
  /** Overlay used for dim text. */
  readonly overlay1: HexColor;
  /** Secondary text. */
  readonly subtext0: HexColor;
  /** Primary text. */
  readonly text: HexColor;
  /** Mauve accent. */
  readonly mauve: HexColor;
  /** Red error. */
  readonly red: HexColor;
  /** Peach tag color. */
  readonly peach: HexColor;
  /** Yellow warning. */
  readonly yellow: HexColor;
  /** Green success. */
  readonly green: HexColor;
  /** Teal graph lane. */
  readonly teal: HexColor;
  /** Pink graph lane. */
  readonly pink: HexColor;
  /** Sapphire remote branch color. */
  readonly sapphire: HexColor;
  /** Blue info color. */
  readonly blue: HexColor;
}

/** One built-in flavor definition before its tokens are derived. */
export interface FlavorDefinition {
  /** Stable built-in name. */
  readonly name: ThemeName;
  /** Display name. */
  readonly label: string;
  /** Light or dark classification. */
  readonly variant: ThemeVariant;
  /** Official palette roles used by the token table. */
  readonly roles: CatppuccinRoles;
  /** Explicit added-line background. */
  readonly diffAddBackground: HexColor;
  /** Explicit removed-line background. */
  readonly diffRemoveBackground: HexColor;
}

/** The final color assigned to every visual token. */
export type ThemeTokens = {
  readonly [Token in Exclude<ThemeToken, "graph">]: HexColor;
} & {
  readonly graph: readonly HexColor[];
};

/** One fully specified built-in theme flavor. */
export interface ThemeFlavor {
  /** Stable built-in name. */
  readonly name: ThemeName;
  /** Display name used by the picker and help. */
  readonly label: string;
  /** Light or dark classification. */
  readonly variant: ThemeVariant;
  /** Final token colors. */
  readonly tokens: ThemeTokens;
}

/** A theme resolved for the current session, including non-blocking warnings. */
export interface ResolvedTheme extends ThemeFlavor {
  /** Capability that produced the final token colors; the base resolution is truecolor. */
  readonly capability: ThemeColorCapability;
  /** Warnings produced while resolving the requested theme. */
  readonly warnings: readonly string[];
}

/** Options accepted by the theme resolver. */
export interface ResolveThemeOptions {
  /** Raw parsed `theme.json` from the config loader, or `null` when absent. */
  readonly overrides?: unknown;
}

/** Environment input for color capability detection. */
export interface DetectColorCapabilityOptions {
  /** Environment variables read for `COLORTERM`, `TERM`, and `NO_COLOR`. */
  readonly env?: Readonly<Record<string, string | undefined>>;
}

/** Validated `theme.json` override layer ready to merge over a built-in flavor. */
export interface ThemeOverrideLayer {
  /** Per-token color overrides, keyed by known token names. */
  readonly tokens: Partial<Record<Exclude<ThemeToken, "graph">, HexColor>>;
  /** Graph lane colors, or `null` when the built-in lane order is kept. */
  readonly graph: readonly HexColor[] | null;
}

/** Readable two-tone palette used when the terminal reports no color support. */
export interface MonochromePalette {
  /** Base background. */
  readonly background: HexColor;
  /** Raised surface. */
  readonly surface: HexColor;
  /** Inactive border. */
  readonly border: HexColor;
  /** Focused border. */
  readonly focus: HexColor;
  /** Primary text. */
  readonly text: HexColor;
  /** Secondary text. */
  readonly muted: HexColor;
  /** Dimmed text. */
  readonly dim: HexColor;
  /** Selected background. */
  readonly selection: HexColor;
}
