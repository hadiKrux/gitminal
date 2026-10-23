import { type ReactNode, useMemo } from "react";
import { useConfig } from "@/app/hooks/useConfig";
import type { ThemeProviderProps } from "@/app/providers/ThemeProvider.types";
import { resolveTheme } from "@/domain/theme/theme.resolve";
import { ThemeContext } from "@/theme/ThemeContext";

/**
 * Resolves the active theme and provides its tokens to the app.
 *
 * Resolution is synchronous and always yields a token set, so a fresh install boots on Catppuccin
 * Mocha without any configuration file. An unknown configured name falls back to Mocha with a
 * warning. Theme file overrides and capability detection land with the theme picker milestone; the
 * `themeName` prop is a static test and embedding override, not a live preview.
 *
 * @param props - Optional theme override and provider content.
 * @returns The theme context provider.
 */
export function ThemeProvider(props: ThemeProviderProps): ReactNode {
  const { config } = useConfig();
  const resolved = useMemo(
    () => resolveTheme(props.themeName ?? config.theme),
    [props.themeName, config.theme],
  );

  return <ThemeContext.Provider value={resolved}>{props.children}</ThemeContext.Provider>;
}
