import { useMemo } from "react";
import { useConfig } from "@/app/hooks/useConfig";
import type { ConfigFileLoad } from "@/domain/config/config.types";
import {
  THEME_PICKER_APPLY_BUTTON_ID,
  THEME_PICKER_APPLY_LABEL,
  THEME_PICKER_CANCEL_BUTTON_ID,
  THEME_PICKER_CANCEL_LABEL,
  THEME_PICKER_NOTE_PREFIX,
} from "@/features/theme-picker/ThemePicker.constants";
import type {
  ThemePickerCommit,
  ThemePickerControl,
  ThemePickerFocusZone,
  ThemePickerHandle,
  UseThemePickerOptions,
} from "@/features/theme-picker/useThemePicker.types";
import { useThemePickerCommit } from "@/features/theme-picker/useThemePickerCommit";
import { useThemePickerNavigation } from "@/features/theme-picker/useThemePickerNavigation";
import { useThemePickerState } from "@/features/theme-picker/useThemePickerState";
import type { ButtonProps } from "@/ui/Button.types";

/**
 * Owns the theme picker's highlight, live preview, and persistence.
 *
 * The highlighted row previews immediately through `ThemeProvider`, so moving the highlight is a
 * live preview and never re-reads a file. Enter or Apply commits the highlighted theme, writes the
 * `theme` field through `config.writer.ts`, and closes; a write that fails keeps the theme applied
 * for the session and shows the documented warning. Esc or Cancel restores the theme that was active
 * when the picker opened. Every handler this hook registers is overlay-scoped: `nav.up`, `nav.down`,
 * and `nav.activate` belong to the picker while it is open, `focus.next` and `focus.previous` move
 * between the theme rows and the footer actions, and `overlay.close` restores and closes. The
 * `app.themePicker` global action belongs to the app layer and is never registered here.
 *
 * @param options - Overlay close callback and an optional persistence override.
 * @returns The rows, highlight, note, and footer actions the view renders.
 */
export function useThemePicker(options: UseThemePickerOptions): ThemePickerHandle {
  const config = useConfig();
  const state = useThemePickerState();
  const commit = useThemePickerCommit({ options, state });
  const navigation = useThemePickerNavigation({ state, commit });
  const note = readOverrideNote(config.files);
  const actions = useMemo(
    () => buildActions(state.cycle.control, state.focusedZone, commit),
    [commit, state.cycle.control, state.focusedZone],
  );

  return {
    rows: state.rows,
    highlightedIndex: state.highlightedIndex,
    focusedControl: state.cycle.control,
    focusedZone: state.focusedZone,
    note,
    actions,
    select: navigation.select,
  };
}

/**
 * Builds the Cancel and Apply actions in display order.
 *
 * @param control - Footer control that currently owns the horizontal cycle.
 * @param zone - Zone that currently owns the keyboard; footer actions show focus only from `actions`.
 * @param commit - Apply and cancel handlers.
 * @returns The footer actions with their focus state.
 */
function buildActions(
  control: ThemePickerControl,
  zone: ThemePickerFocusZone,
  commit: ThemePickerCommit,
): readonly ButtonProps[] {
  return [
    {
      id: THEME_PICKER_CANCEL_BUTTON_ID,
      label: THEME_PICKER_CANCEL_LABEL,
      focused: zone === "actions" && control === "cancel",
      onPress: commit.cancel,
    },
    {
      id: THEME_PICKER_APPLY_BUTTON_ID,
      label: THEME_PICKER_APPLY_LABEL,
      focused: zone === "actions" && control === "apply",
      onPress: commit.apply,
    },
  ];
}

/**
 * Builds the `theme.json` note.
 *
 * The note appears only when the file exists, so an unconfigured install never claims overrides that
 * are not there. A file that failed to load still shows the note, because the reader needs to know
 * why the colors did not change. The note states the rule only; the resolved path is shown in the
 * help Configuration section, because a fixed-width picker would clip a long path.
 *
 * @param files - Per-file load outcomes from `ConfigProvider`.
 * @returns The note text, or `null` when no theme file exists.
 */
function readOverrideNote(files: readonly ConfigFileLoad[]): string | null {
  const themeFile = files.find((file) => file.key === "theme");

  if (themeFile === undefined || themeFile.status === "missing") {
    return null;
  }

  return THEME_PICKER_NOTE_PREFIX;
}
