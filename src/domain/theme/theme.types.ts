import type { ThemeToken } from "./theme.tokens";

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
  /** Warnings produced while resolving the requested theme. */
  readonly warnings: readonly string[];
}
