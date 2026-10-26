import { useContext } from "react";
import type { ThemeTokens } from "@/domain/theme/theme.types";
import { ThemeContext } from "@/theme/ThemeContext";

/**
 * Reads the resolved theme tokens.
 *
 * This is the only supported way for a component to read colors. Reading tokens through the
 * provider keeps theme previews and reloads reactive and keeps hex literals out of components.
 *
 * @returns The resolved token set for the active theme.
 * @throws When called outside a `ThemeProvider`.
 */
export function useTokens(): ThemeTokens {
  const context = useContext(ThemeContext);

  if (!context) {
    throw new Error("useTokens must be used within a ThemeProvider.");
  }

  return context.theme.tokens;
}
