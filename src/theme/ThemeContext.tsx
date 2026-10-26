import { createContext } from "react";
import type { ThemeContextValue } from "@/theme/ThemeContext.types";

/**
 * Context carrying the resolved theme and its session controls.
 *
 * `ThemeProvider` is the only writer. Components read colors through `useTokens`, theme metadata
 * through `useTheme`, and the picker controls through `useThemeControls`.
 */
export const ThemeContext = createContext<ThemeContextValue | null>(null);
