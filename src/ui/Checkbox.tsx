// biome-ignore-all lint/a11y/noStaticElementInteractions: OpenTUI boxes are the only layout and hit-test primitive; they have no DOM role.
import type { ReactNode } from "react";
import { ICONS } from "@/theme/icons";
import { useTokens } from "@/theme/useTokens";

/**
 * Renders a checkbox toggle as a marker plus a label.
 *
 * The marker comes from `ICONS.checkboxOn` or `ICONS.checkboxOff`, so the checked state is readable
 * without color. The component is not a native focusable widget and triggers nothing itself:
 * keyboard activation belongs to the owning feature, which calls `onPress` from `nav.activate`,
 * while a mouse click invokes the same `onPress`. A focused toggle colors its marker with the focus
 * token, and a disabled toggle uses the `dim` token and ignores clicks.
 *
 * @param props - Label, checked state, press handler, and optional focus, disabled, and id values.
 * @returns The composed checkbox row.
 */
export function Checkbox(props: {
  readonly label: string;
  readonly checked: boolean;
  readonly onPress: () => void;
  readonly focused?: boolean;
  readonly disabled?: boolean;
  readonly id?: string;
}): ReactNode {
  const tokens = useTokens();
  const disabled = props.disabled === true;
  const foreground = disabled ? tokens.dim : tokens.text;
  const markerColor = disabled || props.focused !== true ? foreground : tokens.focus;

  return (
    <box
      id={props.id}
      flexDirection="row"
      flexShrink={0}
      onMouseDown={disabled ? undefined : props.onPress}
    >
      <text wrapMode="none">
        <span fg={markerColor}>{props.checked ? ICONS.checkboxOn : ICONS.checkboxOff}</span>
        <span fg={foreground}>{` ${props.label}`}</span>
      </text>
    </box>
  );
}
