import { SyntaxStyle } from "@opentui/core";
import { useRenderer } from "@opentui/react";
import { useEffect, useMemo } from "react";
import type { ThemeTokens } from "@/domain/theme/theme.types";
import { buildSyntaxStyles } from "@/theme/syntax.styles";

/**
 * Creates the renderer-bound syntax style for one resolved token set.
 *
 * The style is rebuilt when the tokens change, which covers theme previews, committed themes, and
 * capability downgrades, and the previous instance is destroyed so a live theme switch cannot leak
 * native styles. The provider calls this once, making it the only syntax style the app creates.
 *
 * @param tokens - Resolved theme tokens for the active theme and capability.
 * @returns The syntax style bound to the active renderer.
 */
export function useThemeSyntaxStyle(tokens: ThemeTokens): SyntaxStyle {
  const renderer = useRenderer();
  const syntaxStyle = useMemo(
    () => SyntaxStyle.fromStyles(buildSyntaxStyles(tokens), renderer.nativeScene),
    [tokens, renderer],
  );

  useEffect(
    () => () => {
      syntaxStyle.destroy();
    },
    [syntaxStyle],
  );

  return syntaxStyle;
}
