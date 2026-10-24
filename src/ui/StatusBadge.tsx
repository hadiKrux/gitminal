import type { ReactNode } from "react";

/**
 * Renders a single-line status badge as a marker plus a label.
 *
 * Both runs are always present, so the badge still reads on a monochrome terminal and when the
 * caller's color choice is unavailable.
 *
 * @param props - Marker from `ICONS`, visible label, and foreground color.
 * @returns The badge text run.
 */
export function StatusBadge(props: {
  readonly marker: string;
  readonly label: string;
  readonly fg: string;
}): ReactNode {
  return (
    <text fg={props.fg} wrapMode="none" flexShrink={0}>
      <span>{props.marker}</span>
      <span> {props.label}</span>
    </text>
  );
}
