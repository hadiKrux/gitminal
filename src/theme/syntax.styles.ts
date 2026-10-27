import type { StyleDefinitionInput } from "@opentui/core";
import type { ThemeTokens } from "@/domain/theme/theme.types";
import { SYNTAX_SCOPE_TOKENS } from "@/theme/syntax.constants";

/**
 * Builds the OpenTUI syntax style definitions for one resolved token set.
 *
 * Each scope receives a single foreground color from the theme token table, so a theme switch or a
 * capability downgrade changes the highlighting without any syntax-specific palette. The result is
 * pure data; `ThemeProvider` binds it to the active renderer once per token set.
 *
 * @param tokens - Resolved theme tokens for the active theme and capability.
 * @returns Style definitions keyed by tree-sitter capture scope.
 */
export function buildSyntaxStyles(tokens: ThemeTokens): Record<string, StyleDefinitionInput> {
  const styles: Record<string, StyleDefinitionInput> = {};

  for (const [scope, token] of Object.entries(SYNTAX_SCOPE_TOKENS)) {
    styles[scope] = { fg: tokens[token] };
  }

  return styles;
}
