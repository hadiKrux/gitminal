import { useContext } from "react";
import { ThemeContext } from "@/theme/ThemeContext";
import type { ThemeControls } from "@/theme/ThemeContext.types";

/**
 * Reads the session-only theme controls.
 *
 * The theme picker is the only consumer: it previews on highlight, commits on apply, and restores
 * the previous theme when it closes without applying. Features read these controls instead of
 * writing theme state, so the provider stays the single owner of the active theme name.
 *
 * @returns The preview, commit, and restore controls.
 * @throws When called outside a `ThemeProvider`.
 */
export function useThemeControls(): ThemeControls {
  const context = useContext(ThemeContext);

  if (!context) {
    throw new Error("useThemeControls must be used within a ThemeProvider.");
  }

  return context.controls;
}
