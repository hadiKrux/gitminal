import type { SyntaxStyle } from "@opentui/core";
import { useContext } from "react";
import { ThemeContext } from "@/theme/ThemeContext";

/**
 * Reads the renderer-bound syntax style.
 *
 * The style is the single instance `ThemeProvider` builds from the active tokens, so every code and
 * diff surface shares one native style and a theme switch updates all of them together.
 *
 * @returns The syntax style for the active renderer and theme.
 * @throws When called outside a `ThemeProvider`.
 */
export function useSyntaxStyle(): SyntaxStyle {
  const context = useContext(ThemeContext);

  if (!context) {
    throw new Error("useSyntaxStyle must be used within a ThemeProvider.");
  }

  return context.syntaxStyle;
}
