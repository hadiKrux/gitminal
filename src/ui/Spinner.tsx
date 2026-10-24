import { useTimeline } from "@opentui/react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { ICONS } from "@/theme/icons";
import { useTokens } from "@/theme/useTokens";
import { SPINNER_INTERVAL_MS } from "@/ui/Spinner.constants";

/**
 * Renders a single-line spinner that cycles `ICONS.spinnerFrames`.
 *
 * A looped OpenTUI timeline never calls `onComplete`, so the animation is driven by an animation
 * item whose `onUpdate` reads `animation.progress` each frame. The cycle spans every frame, so each
 * frame stays visible for about `intervalMs`. The frame index is compared against the previous value
 * before `setState`, so a frame that does not advance the index does not re-render. The timeline
 * pauses and unregisters on unmount through `useTimeline`.
 *
 * @param props - Optional foreground color and frame interval, used by tests to shorten the cycle.
 * @returns One spinner frame as text.
 */
export function Spinner(props: { readonly fg?: string; readonly intervalMs?: number }): ReactNode {
  const tokens = useTokens();
  const frames = ICONS.spinnerFrames;
  const [intervalMs] = useState(() => props.intervalMs ?? SPINNER_INTERVAL_MS);
  const cycleMs = intervalMs * Math.max(1, frames.length);
  const [frameIndex, setFrameIndex] = useState(0);
  const frameIndexRef = useRef(0);
  const timeline = useTimeline({ duration: cycleMs, loop: true });

  useEffect(() => {
    timeline.add(
      {},
      {
        duration: cycleMs,
        onUpdate: (animation) => {
          const next = readSpinnerFrameIndex(animation.progress, frames.length);

          if (next === frameIndexRef.current) {
            return;
          }

          frameIndexRef.current = next;
          setFrameIndex(next);
        },
      },
    );

    return () => {
      timeline.resetItems();
    };
  }, [cycleMs, timeline]);

  return (
    <text fg={props.fg ?? tokens.accent} wrapMode="none" flexShrink={0}>
      {frames[frameIndex] ?? frames[0] ?? ""}
    </text>
  );
}

/**
 * Maps an animation progress value to a spinner frame index.
 *
 * The final frame is inclusive of progress `1`, so a completed cycle never reads past the array.
 *
 * @param progress - Animation progress from `0` to `1`.
 * @param frameCount - Number of available frames.
 * @returns A valid zero-based frame index.
 */
export function readSpinnerFrameIndex(progress: number, frameCount: number): number {
  if (frameCount <= 0) {
    return 0;
  }

  const clamped = Math.min(1, Math.max(0, progress));
  const index = Math.floor(clamped * frameCount);

  return Math.min(frameCount - 1, index);
}
