import type { BoxProps } from "@opentui/react";
import type { ReactNode } from "react";
import { useTokens } from "@/theme/useTokens";

/**
 * Renders a bordered shell panel with its title embedded in the top border.
 *
 * The frame receives its stable region identity from `useFocusRegion` through `boxProps`. When the
 * derived focus state says the region owns focus, the border and the title color switch to the focus
 * and text tokens even when a descendant input holds native focus. The title text itself never
 * changes, so the border reads as a plain `+- Title ----+` in every focus state. The title is drawn
 * by the native box border, which keeps the panel body starting directly below the border instead of
 * after a separate header row.
 *
 * @param props - Box props plus the derived focus flag and an optional border title.
 * @returns The bordered panel.
 */
export function Panel(props: BoxProps & { focused?: boolean; title?: string }): ReactNode {
  const { focused = false, title, children, ...boxProps } = props;
  const tokens = useTokens();
  const borderColor = focused ? tokens.focus : (boxProps.borderColor ?? tokens.border);

  return (
    <box
      {...boxProps}
      border
      borderColor={borderColor}
      title={title === undefined ? undefined : ` ${title} `}
      titleColor={focused ? tokens.text : tokens.muted}
      flexDirection="column"
    >
      {children}
    </box>
  );
}
