import type { ReactNode } from "react";
import { ICONS } from "@/theme/icons";
import type { HexColor } from "@/theme/theme.types";
import { useTokens } from "@/theme/useTokens";
import { SWATCH_WIDTH } from "@/ui/Swatch.constants";

/**
 * Renders a small color preview.
 *
 * The swatch is a filled `<box>` with the caller's resolved `HexColor`, never a hex literal, so the
 * theme picker can show a flavor without holding a palette value. When the caller passes `null`,
 * because the terminal has no usable color, the swatch renders the plain marker from `ICONS.swatch`
 * instead. Both branches occupy the same fixed width, so the name column of a list stays aligned in
 * every capability, and the row's name, variant label, and active marker carry all of the meaning.
 *
 * @param props - Resolved fill color, or `null` for the plain marker.
 * @returns The swatch cell.
 */
export function Swatch(props: { readonly color: HexColor | null }): ReactNode {
  const tokens = useTokens();

  if (props.color === null) {
    return (
      <box width={SWATCH_WIDTH} height={1} flexShrink={0}>
        <text fg={tokens.dim} wrapMode="none">
          {ICONS.swatch}
        </text>
      </box>
    );
  }

  return <box width={SWATCH_WIDTH} height={1} flexShrink={0} backgroundColor={props.color} />;
}
