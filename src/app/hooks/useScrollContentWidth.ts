import type { ScrollBoxRenderable } from "@opentui/core";
import type { RefObject } from "react";
import { useScrollViewportSize } from "@/app/hooks/useScrollViewportSize";

/**
 * Measures the laid-out content width of one scrollbox viewport.
 *
 * A panel that renders rows inside a scrollbox must budget against the cells the rows actually get.
 * The scrollbox itself is one column wider than its viewport when the vertical scrollbar appears, so
 * measuring the surrounding box, or the scrollbox box, clips the last cell of a row that fills the
 * width. This hook is the width-only view of `useScrollViewportSize`, which reads the viewport width
 * and falls back to the scrollbox width before layout has published a viewport. It re-reads after
 * every render so a content or overflow change that toggles the scrollbar cannot leave the budget one
 * cell too wide, and the `onSizeChange` callback schedules another render so the re-read happens
 * after the resize layout settles. Unchanged widths are deduplicated.
 *
 * @param ref - Ref attached to the scrollbox whose viewport width the rows should fit.
 * @returns The measured content width and the scrollbox `onSizeChange` callback.
 */
export function useScrollContentWidth(ref: RefObject<ScrollBoxRenderable | null>): {
  readonly width: number;
  readonly onSizeChange: () => void;
} {
  const { width, onSizeChange } = useScrollViewportSize(ref);

  return { width, onSizeChange };
}
