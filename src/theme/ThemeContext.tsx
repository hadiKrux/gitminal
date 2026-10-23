import { createContext } from "react";
import type { ResolvedTheme } from "@/domain/theme/theme.types";

/** Context carrying the resolved theme tokens for the current session. */
export const ThemeContext = createContext<ResolvedTheme | null>(null);
