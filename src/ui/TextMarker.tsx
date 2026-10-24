import type { ReactNode } from "react";
import { ICONS } from "@/theme/icons";
import { useTokens } from "@/theme/useTokens";

/**
 * Renders a leading focus, selection, or state marker.
 *
 * Markers always come from `ICONS`. The caller pairs a state marker with a text label, so the
 * marker is never the only signal.
 *
 * @param props - Marker override and focus or selection flags.
 * @returns A one-line marker.
 */
export function TextMarker(props: {
  focused?: boolean;
  selected?: boolean;
  marker?: string;
}): ReactNode {
  const tokens = useTokens();
  const marker =
    props.marker ??
    (props.focused ? ICONS.focus : props.selected ? ICONS.selected : ICONS.unselected);

  return (
    <text fg={props.focused ? tokens.focus : tokens.muted} wrapMode="none">
      {marker}
    </text>
  );
}
