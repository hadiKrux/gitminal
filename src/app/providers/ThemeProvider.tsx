import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { useConfig } from "@/app/hooks/useConfig";
import type { ThemeProviderProps } from "@/app/providers/ThemeProvider.types";
import { applyThemeCapability, detectColorCapability } from "@/domain/theme/theme.capability";
import { resolveTheme } from "@/domain/theme/theme.resolve";
import { ThemeContext } from "@/theme/ThemeContext";
import type { ThemeContextValue, ThemeControls } from "@/theme/ThemeContext.types";

/**
 * Resolves the active theme and provides its tokens and controls to the app.
 *
 * The provider owns the active base theme name, the `theme.json` override layer from
 * `ConfigProvider`, and the capability for the current terminal. Resolution has two memoized stages:
 * the requested name and override layer produce a truecolor theme, and the capability maps that theme
 * onto final colors, so a capability change never re-resolves the override file. An unknown
 * configured name falls back to Mocha with a warning, and the resolution warnings are published
 * through `useTheme()` so the app-layer configuration warning reporter and Help can surface them.
 *
 * `preview`, `commit`, and `restore` are session-only: they swap the active name and let every
 * consumer re-render through `useTokens`, which is what makes picker highlighting live without
 * re-reading a file. A reload that changes the configured name resets the session name, so the file
 * stays the source of truth; a preview that a reload does not mention keeps rendering until the
 * picker commits or restores it.
 *
 * @param props - Optional static theme and capability overrides plus provider content.
 * @returns The theme context provider.
 */
export function ThemeProvider(props: ThemeProviderProps): ReactNode {
  const { config, themeOverrides } = useConfig();
  const configuredName = props.themeName ?? config.theme;
  const [activeName, setActiveName] = useState(configuredName);
  const detectedCapability = useMemo(
    () => props.capability ?? detectColorCapability(),
    [props.capability],
  );

  useEffect(() => {
    setActiveName(configuredName);
  }, [configuredName]);

  const baseTheme = useMemo(
    () => resolveTheme(activeName, { overrides: themeOverrides }),
    [activeName, themeOverrides],
  );
  const theme = useMemo(
    () => applyThemeCapability(baseTheme, detectedCapability),
    [baseTheme, detectedCapability],
  );

  /** Previews one theme for the session without persisting it. */
  const preview = useCallback((name: string): void => {
    setActiveName(name);
  }, []);

  /** Makes one theme the active name after it was persisted. */
  const commit = useCallback((name: string): void => {
    setActiveName(name);
  }, []);

  /** Restores the theme that was active before a preview started. */
  const restore = useCallback((previous: string): void => {
    setActiveName(previous);
  }, []);

  const controls = useMemo<ThemeControls>(
    () => ({ preview, commit, restore }),
    [preview, commit, restore],
  );
  const value = useMemo<ThemeContextValue>(() => ({ theme, controls }), [theme, controls]);

  return <ThemeContext.Provider value={value}>{props.children}</ThemeContext.Provider>;
}
