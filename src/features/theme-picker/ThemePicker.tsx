import type { ReactNode } from "react";
import {
  THEME_PICKER_HEIGHT,
  THEME_PICKER_TITLE,
  THEME_PICKER_WIDTH,
} from "@/features/theme-picker/ThemePicker.constants";
import type { ThemePickerProps } from "@/features/theme-picker/ThemePicker.types";
import { ThemeRow } from "@/features/theme-picker/ThemeRow";
import { useThemePicker } from "@/features/theme-picker/useThemePicker";
import { useTokens } from "@/theme/useTokens";
import { ModalActions } from "@/ui/ModalActions";
import { ModalFrame } from "@/ui/ModalFrame";
import { ScrollableList } from "@/ui/ScrollableList";

/**
 * Renders the theme picker modal content.
 *
 * The entry content is exactly what `OverlayHost` renders inside `ModalFrame`: the custom row list,
 * the optional `theme.json` note, and the footer actions. The list is a `<scrollbox>` of `ThemeRow`
 * boxes with `viewportCulling`, not a `<select>`, because each row carries a swatch, a light-or-dark
 * label, and an active marker. Highlighting a row previews that theme live; Enter or Apply persists
 * it and closes, and Esc or Cancel restores the theme that was active when the picker opened. The
 * picker owns no global action and never reads a key itself: `useThemePicker` registers only
 * overlay-scoped handlers through the shared keymap.
 *
 * @param props - Overlay close callback and an optional persistence override.
 * @returns The theme picker modal.
 */
export function ThemePicker(props: ThemePickerProps): ReactNode {
  const tokens = useTokens();
  const picker = useThemePicker({ onClose: props.onClose, persist: props.persist });

  return (
    <ModalFrame title={THEME_PICKER_TITLE} width={THEME_PICKER_WIDTH} height={THEME_PICKER_HEIGHT}>
      <ScrollableList viewportCulling>
        {picker.rows.map((row, index) => (
          <ThemeRow
            key={row.name}
            row={row}
            selected={index === picker.highlightedIndex}
            focused={picker.focusedZone === "rows" && index === picker.highlightedIndex}
            onPress={() => {
              picker.select(index);
            }}
          />
        ))}
      </ScrollableList>
      {picker.note === null ? null : (
        <text fg={tokens.muted} wrapMode="none">
          {picker.note}
        </text>
      )}
      <ModalActions actions={picker.actions} />
    </ModalFrame>
  );
}
