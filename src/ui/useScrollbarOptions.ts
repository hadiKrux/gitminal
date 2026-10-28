import type { ScrollBoxOptions } from "@opentui/core";
import { useTokens } from "@/theme/useTokens";

/**
 * Resolves both scrollbar axes from the active theme, including tracks and arrows.
 *
 * Colors update with theme previews, saved themes, and terminal color capability changes.
 * Callers retain ownership of axis visibility and scrollbar dimensions.
 *
 * @returns Native scrollbar options with no OpenTUI default colors left exposed.
 */
export function useScrollbarOptions(): ScrollBoxOptions["scrollbarOptions"] {
  const tokens = useTokens();

  return {
    trackOptions: {
      foregroundColor: tokens.scrollbar,
      backgroundColor: tokens.background,
    },
    arrowOptions: {
      foregroundColor: tokens.scrollbar,
      backgroundColor: tokens.background,
    },
  };
}
