import type { ThemeToken } from "@/domain/theme/theme.tokens";

/**
 * A theme token used as a syntax foreground.
 *
 * `graph` is excluded because it is a lane color list, not a single foreground color.
 */
type SyntaxToken = Exclude<ThemeToken, "graph">;

/**
 * Scope and token pairs, kept as entries because `constructor` is a reserved object key.
 */
const SYNTAX_SCOPE_ENTRIES: readonly (readonly [string, SyntaxToken])[] = Object.freeze([
  ["default", "text"],
  ["variable", "text"],
  ["property", "text"],
  ["keyword", "accent"],
  ["import", "accent"],
  ["cImport", "accent"],
  ["type", "branchRemote"],
  ["tag", "branchRemote"],
  ["function", "info"],
  ["constructor", "info"],
  ["label", "info"],
  ["module", "info"],
  ["markup", "info"],
  ["string", "tag"],
  ["character", "tag"],
  ["attribute", "tag"],
  ["number", "warning"],
  ["boolean", "warning"],
  ["constant", "warning"],
  ["comment", "muted"],
  ["operator", "dim"],
  ["punctuation", "dim"],
]);

/**
 * Tree-sitter capture scopes mapped onto resolved theme tokens.
 *
 * Only base scopes are listed because OpenTUI resolves a dotted capture such as `keyword.return`
 * through its base scope before falling back to `default`, so one entry covers a whole family. The
 * map stays small on purpose: keyword, type, callable, literal, numeric, comment, and punctuation
 * are the only distinctions a diff pane needs. Green and red are absent because they stay reserved
 * for added and removed diff lines, and `spell`, `none`, `embedded`, and `conceal` are absent
 * because they are markers rather than content and a color would override the captures they share a
 * node with.
 */
export const SYNTAX_SCOPE_TOKENS: Readonly<Record<string, SyntaxToken>> = Object.freeze(
  Object.fromEntries(SYNTAX_SCOPE_ENTRIES),
);
