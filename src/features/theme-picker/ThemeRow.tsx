import type { ReactNode } from "react";
import {
  THEME_ROW_DARK_LABEL,
  THEME_ROW_LIGHT_LABEL,
} from "@/features/theme-picker/ThemeRow.constants";
import type { ThemePickerRow } from "@/features/theme-picker/useThemePicker.types";
import { ICONS } from "@/theme/icons";
import { useTokens } from "@/theme/useTokens";
import { ListRow } from "@/ui/ListRow";
import { Swatch } from "@/ui/Swatch";

/**
 * Renders one theme row in the picker list.
 *
 * The row is a custom `<box>` row rather than a `<select>` option because it needs a swatch, a
 * light-or-dark label, and an active marker in one line. It composes `ListRow` for the selection
 * marker and background and `Swatch` for the color cell. The active row carries the `*` marker from
 * `ICONS.currentBranch` next to its name, so the active theme is identifiable without color, which
 * is also the state the picker lists when a preview is showing.
 *
 * @param props - Row data, selection flags, and the click handler.
 * @returns The composed theme row.
 */
export function ThemeRow(props: {
  readonly row: ThemePickerRow;
  readonly selected: boolean;
  readonly focused: boolean;
  readonly onPress: () => void;
}): ReactNode {
  const tokens = useTokens();
  const variantLabel = props.row.variant === "light" ? THEME_ROW_LIGHT_LABEL : THEME_ROW_DARK_LABEL;

  return (
    <ListRow
      id={themeRowId(props.row.name)}
      selected={props.selected}
      focused={props.focused}
      onMouseDown={props.onPress}
    >
      <box flexDirection="row" height={1} flexShrink={1} overflow="hidden">
        <Swatch color={props.row.swatchColor} />
        <text fg={tokens.text} wrapMode="none">
          {` ${props.row.label}`}
          <span fg={tokens.muted}>{` ${variantLabel}`}</span>
          {props.row.active ? <span fg={tokens.accent}>{` ${ICONS.currentBranch}`}</span> : null}
        </text>
      </box>
    </ListRow>
  );
}

/**
 * Builds the stable renderable id of one theme row.
 *
 * @param name - Built-in theme name, which is the row identity.
 * @returns The row renderable id.
 */
export function themeRowId(name: string): string {
  return `theme-row:${name}`;
}
