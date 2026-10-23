import type { ReactNode } from "react";

/** Props accepted by `ThemeProvider`. */
export interface ThemeProviderProps {
  /** Provider content. */
  readonly children?: ReactNode;
  /**
   * Theme name override for tests and embeddings only; defaults to the configured theme.
   *
   * This is a static value, not a live preview. The theme picker previews through
   * `ThemeProvider` state once that milestone lands.
   */
  readonly themeName?: string;
}
