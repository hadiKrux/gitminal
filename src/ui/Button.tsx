import { TextAttributes } from "@opentui/core";
import type { ReactNode } from "react";
import { useTokens } from "@/theme/useTokens";
import { BUTTON_HORIZONTAL_PADDING } from "@/ui/Button.constants";
import type { ButtonProps } from "@/ui/Button.types";

/**
 * Renders a filled text button.
 *
 * The button is a `<box>` with a `<text>` label, never a native focusable widget, because the top
 * bar and modal footers model their focused control as feature view state rather than native focus.
 * Every button uses a filled background and one cell of horizontal padding, and its label stays
 * `text` colored, so it reads as a raised control in the mockup's style. An icon-only button renders
 * just its icon. A focused control brightens its background to `selection` and bolds the label, so
 * focus is never conveyed by color alone and no leading marker is added. A disabled control uses the
 * `dim` foreground and appends its reason, and a mouse click on it does nothing.
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
  const foreground = disabled ? tokens.dim : tokens.text;

  return (
    <box
      id={props.id}
      flexDirection="row"
      flexShrink={0}
      backgroundColor={focused ? tokens.selection : tokens.border}
      paddingLeft={BUTTON_HORIZONTAL_PADDING}
      paddingRight={BUTTON_HORIZONTAL_PADDING}
      onMouseDown={disabled ? undefined : props.onPress}
    >
      <text fg={foreground} wrapMode="none" attributes={focused ? TextAttributes.BOLD : undefined}>
        {formatButtonLabel(
          props.icon,
          props.label,
          props.iconOnly === true,
          disabled ? props.reason : undefined,
        )}
      </text>
    </box>
  );
}

/**
 * Builds the button label run.
 *
 * The reason is only meaningful for a disabled control, so an enabled button never renders one even
 * when a caller leaves a stale reason attached. An icon-only button keeps the icon and still shows
 * its disabled reason, but drops the visible label.
 *
 * @param icon - Optional leading marker from `ICONS`.
 * @param label - Visible label.
 * @param iconOnly - Whether to omit the visible label.
 * @param reason - Disabled reason, or undefined.
 * @returns The label with its optional icon and reason.
 */
function formatButtonLabel(
  icon: string | undefined,
  label: string,
  iconOnly: boolean,
  reason: string | undefined,
): string {
  const parts = readLabelParts(icon, label, iconOnly);

  if (reason !== undefined && reason.length > 0) {
    parts.push(reason);
  }

  return parts.join(" ");
}

/**
 * Reads the icon and label run before the disabled reason.
 *
 * @param icon - Optional leading marker from `ICONS`.
 * @param label - Visible label.
 * @param iconOnly - Whether to omit the visible label.
 * @returns The icon and label parts that are actually visible.
 */
function readLabelParts(icon: string | undefined, label: string, iconOnly: boolean): string[] {
  if (icon === undefined) {
    return [label];
  }

  return iconOnly ? [icon] : [`${icon} ${label}`];
}
