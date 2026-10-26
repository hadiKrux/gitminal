import type { ScrollBoxRenderable } from "@opentui/core";
import { type RefObject, useCallback, useEffect, useRef, useState } from "react";

/** Measured scrollbox viewport size in cells. */
interface ScrollViewportSize {
  /** Content width in cells, excluding the vertical scrollbar column. */
  readonly width: number;
  /** Visible height in lines. */
  readonly height: number;
}

/** Size reported before the first layout. */
const EMPTY_VIEWPORT_SIZE: ScrollViewportSize = Object.freeze({ width: 0, height: 0 });

/**
 * Measures the laid-out width and height of one scrollbox viewport.
 *
 * A panel that renders rows inside a scrollbox must budget against the cells the rows actually get.
 * The scrollbox itself is one column wider than its viewport when the vertical scrollbar appears, so
 * measuring the surrounding box, or the scrollbox box, clips the last cell of a row that fills the
 * width. The viewport height is likewise smaller than the panel: the scrollbox shares the panel with
 * its header and the status footer, and the console drawer changes the space the panel receives. This
 * hook reads both dimensions, falls back to the scrollbox box before layout has published a
 * viewport, and reports zero before the first layout. It re-reads after every render so a content or
 * overflow change that toggles the scrollbar cannot leave the budget one cell too wide and a footer
 * change cannot leave the row count one row too high, and the `onSizeChange` callback schedules
 * another render so the re-read happens after the resize layout settles. Unchanged sizes are
 * deduplicated, and the last measured size is kept after the ref unmounts.
 *
 * @param ref - Ref attached to the scrollbox whose viewport should be measured.
 * @returns The measured content width and height plus the scrollbox `onSizeChange` callback.
 */
export function useScrollViewportSize(ref: RefObject<ScrollBoxRenderable | null>): {
  readonly width: number;
  readonly height: number;
  readonly onSizeChange: () => void;
} {
  const [size, setSize] = useState<ScrollViewportSize>(EMPTY_VIEWPORT_SIZE);
  const [, setSizeRevision] = useState(0);
  const previousSizeRef = useRef<ScrollViewportSize>(EMPTY_VIEWPORT_SIZE);

  /** Reads the viewport size after layout, content, overflow, or a resize, and stores a change. */
  const syncSize = useCallback((): void => {
    const scrollbox = ref.current;

    if (scrollbox === null) {
      return;
    }

    const width = readMeasurement(scrollbox.viewport.width, scrollbox.width);

    if (width === null) {
      return;
    }

    const height = readMeasurement(scrollbox.viewport.height, scrollbox.height) ?? 0;

    if (width === previousSizeRef.current.width && height === previousSizeRef.current.height) {
      return;
    }

    const next = { width, height };

    previousSizeRef.current = next;
    setSize(next);
  }, [ref]);

  useEffect(() => {
    syncSize();
  });

  /** Schedules a post-layout re-read after the scrollbox reports a new size. */
  const onSizeChange = useCallback((): void => {
    setSizeRevision((revision) => revision + 1);
  }, []);

  return { width: size.width, height: size.height, onSizeChange };
}

/**
 * Reads one measured dimension, preferring the viewport and falling back to the scrollbox box.
 *
 * @param viewportValue - Laid-out viewport dimension, or a non-numeric value before layout.
 * @param fallbackValue - Laid-out scrollbox dimension used before the viewport is published.
 * @returns A whole non-negative cell count, or null when neither value is a finite number.
 */
function readMeasurement(
  viewportValue: number | undefined,
  fallbackValue: number | undefined,
): number | null {
  const candidate =
    typeof viewportValue === "number" && viewportValue > 0 ? viewportValue : fallbackValue;

  if (typeof candidate !== "number" || !Number.isFinite(candidate)) {
    return null;
  }

  return Math.max(0, Math.floor(candidate));
}
