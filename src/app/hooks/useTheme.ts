import { useContext } from "react";
import type { ResolvedTheme } from "@/domain/theme/theme.types";
import { ThemeContext } from "@/theme/ThemeContext";

/**
 * Reads the resolved theme, including its name, label, variant, capability, and warnings.
 *
 * `useTokens` stays in the theme folder and reads the context directly because theme must not
 * import app; this hook is the app-layer reader for components that also need theme metadata.
 *
 * @returns The resolved theme for the current session.
 * @throws When called outside a `ThemeProvider`.
 */
export function useTheme(): ResolvedTheme {
  const context = useContext(ThemeContext);

  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider.");
  }

  return context.theme;
}
