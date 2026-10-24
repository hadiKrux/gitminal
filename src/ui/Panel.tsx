import type { BoxProps } from "@opentui/react";
import type { ReactNode } from "react";
import { useTokens } from "@/theme/useTokens";
import { TextMarker } from "@/ui/TextMarker";

/**
 * Renders a bordered shell panel with an optional focus-marked header.
 *
 * The frame receives its stable region identity from `useFocusRegion` through `boxProps`. When the
 * derived focus state says the region owns focus, the border is drawn with the focus token even
 * when a descendant input holds native focus, and the header marker changes alongside it so color
 * is never the only signal.
 *
 * @param props - Box props plus the derived focus flag and an optional header title.
 * @returns The bordered panel.
 */
export function Panel(props: BoxProps & { focused?: boolean; title?: string }): ReactNode {
  const { focused = false, title, children, ...boxProps } = props;
  const tokens = useTokens();
  const borderColor = focused ? tokens.focus : (boxProps.borderColor ?? tokens.border);

  return (
    <box {...boxProps} border borderColor={borderColor} flexDirection="column">
      {title === undefined ? null : (
        <box flexDirection="row" height={1} flexShrink={0}>
          <TextMarker focused={focused} />
          <text fg={focused ? tokens.text : tokens.muted} wrapMode="none">
            {" "}
            {title}
          </text>
        </box>
      )}
      {children}
    </box>
  );
}
