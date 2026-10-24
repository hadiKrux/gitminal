// biome-ignore-all lint/a11y/noStaticElementInteractions: OpenTUI boxes are the only layout and hit-test primitive; they have no DOM role.
import { TextAttributes } from "@opentui/core";
import type { ReactNode } from "react";
import { ICONS } from "@/theme/icons";
import { useTokens } from "@/theme/useTokens";
import type { ButtonProps } from "@/ui/Button.types";

/**
 * Renders a composed text button.
 *
 * The button is a `<box>` with a `<text>` label, never a native focusable widget, because the top
 * bar and modal footers model their focused control as feature view state rather than native focus.
 * A focused control uses the `selection` background and the `text` foreground and gains the focus
 * marker, so focus is never conveyed by color alone. A disabled control uses the `dim` foreground
 * and appends its reason, and a mouse click on it does nothing.
 *
 * Mouse activation goes through the box's mouse handler; the handler never calls `focus()`, because
 * OpenTUI native focus follows the click and the owning feature decides which control it selects.
 *
 * @param props - Label, optional icon, focus and disabled state, reason, and press handler.
 * @returns The composed button.
 */
export function Button(props: ButtonProps): ReactNode {
  const tokens = useTokens();
  const disabled = props.disabled === true;
  const focused = props.focused === true;
  const foreground = disabled ? tokens.dim : focused ? tokens.text : tokens.muted;
  const marker = focused ? `${ICONS.focus} ` : "";

  return (
    <box
      id={props.id}
      flexDirection="row"
      flexShrink={0}
      backgroundColor={focused ? tokens.selection : undefined}
      onMouseDown={disabled ? undefined : props.onPress}
    >
      <text fg={foreground} wrapMode="none" attributes={focused ? TextAttributes.BOLD : undefined}>
        {marker}
        {formatButtonLabel(props.icon, props.label, disabled ? props.reason : undefined)}
      </text>
    </box>
  );
}

/**
 * Builds the button label run.
 *
 * The reason is only meaningful for a disabled control, so an enabled button never renders one even
 * when a caller leaves a stale reason attached.
 *
 * @param icon - Optional leading marker from `ICONS`.
 * @param label - Visible label.
 * @param reason - Disabled reason, or undefined.
 * @returns The label with its optional icon and reason.
 */
function formatButtonLabel(
  icon: string | undefined,
  label: string,
  reason: string | undefined,
): string {
  const parts = icon === undefined ? [label] : [`${icon} ${label}`];

  if (reason !== undefined && reason.length > 0) {
    parts.push(reason);
  }

  return parts.join(" ");
}
