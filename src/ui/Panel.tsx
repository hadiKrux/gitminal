import type { BoxProps } from "@opentui/react";
import type { ReactNode } from "react";
import { ICONS } from "@/theme/icons";
import { useTokens } from "@/theme/useTokens";

/**
 * Renders a bordered shell panel with its title embedded in the top border.
 *
 * The frame receives its stable region identity from `useFocusRegion` through `boxProps`. When the
 * derived focus state says the region owns focus, the border is drawn with the focus token even
 * when a descendant input holds native focus, and the title gains a leading focus marker so color
 * is never the only signal. The title is drawn by the native box border as `-- Title --`, which
 * keeps the panel body starting directly below the border instead of after a separate header row.
 *
 * @param props - Box props plus the derived focus flag and an optional border title.
 * @returns The bordered panel.
 */
export function Panel(props: BoxProps & { focused?: boolean; title?: string }): ReactNode {
  const { focused = false, title, children, ...boxProps } = props;
  const tokens = useTokens();
  const borderColor = focused ? tokens.focus : (boxProps.borderColor ?? tokens.border);
  const borderTitle = title === undefined ? undefined : panelTitle(title, focused);

  return (
    <box
      {...boxProps}
      border
      borderColor={borderColor}
      title={borderTitle}
      titleColor={focused ? tokens.text : tokens.muted}
      flexDirection="column"
    >
      {children}
    </box>
  );
}

/**
 * Formats a panel title for the top border, adding the focus marker and one space of padding.
 *
 * @param title - Plain panel title.
 * @param focused - Whether the panel's region currently owns focus.
 * @returns The border title text.
 */
function panelTitle(title: string, focused: boolean): string {
  return focused ? ` ${ICONS.focus} ${title} ` : ` ${title} `;
}
