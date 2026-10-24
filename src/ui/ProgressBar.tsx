import { FrameBufferRenderable, RGBA } from "@opentui/core";
import { extend, useTerminalDimensions } from "@opentui/react";
import { type ReactNode, useCallback, useEffect, useRef } from "react";
import { useTokens } from "@/theme/useTokens";
import {
  PROGRESS_BAR_MAX_WIDTH,
  PROGRESS_BAR_MIN_WIDTH,
  PROGRESS_BAR_REDRAW_INTERVAL_MS,
} from "@/ui/ProgressBar.constants";

// OpenTUI 0.6.6 has no React intrinsic for its frame buffer, so the primitive registers OpenTUI's
// own renderable once. Architecture section 6 sanctions this single registration.
extend({ "frame-buffer": FrameBufferRenderable });

declare module "@opentui/react" {
  interface OpenTUIComponents {
    /** One-row cell buffer used only by the progress bar. */
    "frame-buffer": typeof FrameBufferRenderable;
  }
}

/**
 * Renders a one-row determinate progress bar with a text label.
 *
 * The track is drawn with the `surface` token and the filled portion with `accent`, using cell
 * rectangles rather than glyphs, so the bar width is exact on every font. Progress is clamped to
 * `0`-`100`, the filled cell count is rounded, and the width is clamped to `8`-`24` cells. A very
 * narrow bar is only rendered through the primitive's caller, which hides it below eight cells.
 *
 * Redraws happen only when the rounded filled count, the width, a terminal resize, or a theme color
 * changes, and are throttled to about one every 100 ms. A resize reallocates the renderable buffer,
 * so the effect also depends on the terminal height; a height-only resize with an unchanged width
 * still redraws the cleared buffer. The primitive allocates only the two colors it needs, never a
 * per-cell array.
 *
 * @param props - Percent, width, an optional trailing label, and an optional renderable id for tests.
 * @returns The progress bar with its label.
 */
export function ProgressBar(props: {
  readonly percent: number;
  readonly width: number;
  readonly id?: string;
  readonly label?: string;
}): ReactNode {
  const tokens = useTokens();
  const dimensions = useTerminalDimensions();
  const width = clampProgressBarWidth(props.width);
  const filled = calculateProgressFill(props.percent, width);
  const renderableRef = useRef<FrameBufferRenderable | null>(null);
  const lastDrawAtRef = useRef(0);
  const lastDrawnWidthRef = useRef(-1);
  const lastTerminalHeightRef = useRef(-1);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const draw = useCallback((): void => {
    const renderable = renderableRef.current;

    if (renderable === null) {
      return;
    }

    renderable.frameBuffer.fillRect(0, 0, width, 1, RGBA.fromHex(tokens.surface));

    if (filled > 0) {
      renderable.frameBuffer.fillRect(0, 0, filled, 1, RGBA.fromHex(tokens.accent));
    }

    renderable.requestRender();
    lastDrawAtRef.current = Date.now();
    lastDrawnWidthRef.current = width;
  }, [filled, tokens.accent, tokens.surface, width]);

  const latestDrawRef = useRef(draw);

  useEffect(() => {
    latestDrawRef.current = draw;
  }, [draw]);

  useEffect(() => {
    const widthChanged = lastDrawnWidthRef.current !== width;
    const heightChanged = lastTerminalHeightRef.current !== dimensions.height;
    const elapsed = Date.now() - lastDrawAtRef.current;

    lastTerminalHeightRef.current = dimensions.height;

    if (!widthChanged && !heightChanged && elapsed >= PROGRESS_BAR_REDRAW_INTERVAL_MS) {
      draw();
      return;
    }

    if (timerRef.current !== null) {
      return;
    }

    // A width change reallocates and clears the renderable buffer during the next layout pass, so
    // the redraw waits one throttle window instead of racing that layout. A height-only resize also
    // clears the buffer, so it follows the same delayed redraw path.
    const delay =
      widthChanged || heightChanged
        ? PROGRESS_BAR_REDRAW_INTERVAL_MS
        : PROGRESS_BAR_REDRAW_INTERVAL_MS - elapsed;

    timerRef.current = setTimeout(
      () => {
        timerRef.current = null;
        latestDrawRef.current();
      },
      Math.max(0, delay),
    );
  }, [dimensions.height, draw, width]);

  useEffect(
    () => () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    },
    [],
  );

  return (
    <box flexDirection="row" height={1} flexShrink={0}>
      <frame-buffer id={props.id} ref={renderableRef} width={width} height={1} />
      {props.label === undefined ? null : (
        <text fg={tokens.muted} wrapMode="none">
          {" "}
          {props.label}
        </text>
      )}
    </box>
  );
}

/**
 * Clamps a requested bar width into the documented range.
 *
 * @param width - Requested width in cells.
 * @returns An integer width between 8 and 24.
 */
export function clampProgressBarWidth(width: number): number {
  if (!Number.isFinite(width)) {
    return PROGRESS_BAR_MIN_WIDTH;
  }

  return Math.min(PROGRESS_BAR_MAX_WIDTH, Math.max(PROGRESS_BAR_MIN_WIDTH, Math.round(width)));
}

/**
 * Calculates how many cells of a bar are filled.
 *
 * @param percent - Progress from `0` to `100`; values outside the range are clamped and a
 * non-finite value is treated as zero.
 * @param width - Bar width in cells; the value is clamped to the documented range first.
 * @returns The rounded filled cell count between `0` and the clamped width.
 */
export function calculateProgressFill(percent: number, width: number): number {
  const cells = clampProgressBarWidth(width);

  if (!Number.isFinite(percent)) {
    return 0;
  }

  const clamped = Math.min(100, Math.max(0, percent));

  return Math.min(cells, Math.max(0, Math.round((clamped / 100) * cells)));
}
