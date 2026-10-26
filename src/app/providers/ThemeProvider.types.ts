import type { ReactNode } from "react";
import type { ThemeColorCapability } from "@/domain/theme/theme.types";

/** Props accepted by `ThemeProvider`. */
export interface ThemeProviderProps {
  /** Provider content. */
  readonly children?: ReactNode;
  /**
   * Theme name override for tests and embeddings; defaults to the configured theme.
   *
   * This is a static value, not a live preview: it wins over `config.theme` for the whole mount, and
   * the picker preview still works through provider state.
   */
  readonly themeName?: string;
  /**
   * Color capability override for tests and embeddings.
   *
   * Detection reads `COLORTERM`, `TERM`, and `NO_COLOR` from the environment when omitted, so a
   * test can pin truecolor, 256-color, or monochrome without touching the process environment.
   */
  readonly capability?: ThemeColorCapability;
}
