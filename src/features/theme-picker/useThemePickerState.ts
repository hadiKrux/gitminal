import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useModalControlCycle } from "@/app/hooks/useModalControlCycle";
import type {
  ModalControlResolution,
  ModalHorizontalInput,
} from "@/app/hooks/useModalControlCycle.types";
import { useTheme } from "@/app/hooks/useTheme";
import { applyThemeCapability } from "@/domain/theme/theme.capability";
import { THEME_FLAVORS, THEME_NAMES } from "@/domain/theme/theme.catppuccin";
import type { HexColor, ThemeColorCapability, ThemeName } from "@/domain/theme/theme.types";
import { INITIAL_CONTROL, PICKER_CONTROLS } from "@/features/theme-picker/useThemePicker.constants";
import type {
  ThemePickerControl,
  ThemePickerFocusZone,
  ThemePickerRow,
  ThemePickerViewState,
} from "@/features/theme-picker/useThemePicker.types";
import { useThemeControls } from "@/theme/useThemeControls";

/**
 * Owns the picker's highlight, focus zone, footer cycle, and unmount restore.
 *
 * The highlight is the live preview: moving it writes the provider through `ThemeControls`, so the
 * picker never re-reads a file. `settle` marks the picker as applied or cancelled, which stops the
 * unmount guard from restoring the previous theme after the user has already chosen one.
 *
 * @returns The view state the commit and navigation hooks share.
 */
export function useThemePickerState(): ThemePickerViewState {
  const theme = useTheme();
  const controls = useThemeControls();
  const [highlightedIndex, setHighlightedIndex] = useState(() => readThemeIndex(theme.name));
  const [focusedZone, setFocusedZone] = useState<ThemePickerFocusZone>("rows");
  const previousName = useRef<ThemeName>(theme.name);
  const settled = useRef(false);
  const rows = useMemo(
    () => buildRows(theme.name, theme.capability),
    [theme.name, theme.capability],
  );
  const cycle = useModalControlCycle<ThemePickerControl>({
    order: PICKER_CONTROLS,
    initial: INITIAL_CONTROL,
    registerVerticalNavigation: false,
    onHorizontal: (input) =>
      readHorizontalControl(input, () => {
        setFocusedZone("actions");
      }),
  });

  useEffect(
    () => () => {
      if (!settled.current) {
        controls.restore(previousName.current);
      }
    },
    [controls],
  );

  /** Marks the picker as settled so the unmount guard stops restoring the previous theme. */
  const settle = useCallback((): void => {
    settled.current = true;
  }, []);

  return {
    theme,
    controls,
    rows,
    highlightedIndex,
    setHighlightedIndex,
    focusedZone,
    setFocusedZone,
    cycle,
    previousName: previousName.current,
    settle,
  };
}

/**
 * Applies the picker's Left and Right rule.
 *
 * Left moves from Apply to Cancel and right moves back, which is the only horizontal choice in a
 * two-action footer. A horizontal step means the footer now owns focus, so the caller moves the focus
 * zone before the control changes.
 *
 * @param input - Focused control and requested direction.
 * @param onFocusActions - Callback that moves keyboard focus into the footer actions.
 * @returns The control to focus next.
 */
function readHorizontalControl(
  input: ModalHorizontalInput<ThemePickerControl>,
  onFocusActions: () => void,
): ModalControlResolution<ThemePickerControl> {
  onFocusActions();

  return {
    kind: "focus",
    control: input.direction === "left" ? "cancel" : "apply",
  };
}

/**
 * Builds every picker row for the active theme name and capability.
 *
 * The swatch fill comes from the capability-mapped tokens, so a 256-color terminal previews the
 * quantized color the app would actually render instead of the raw truecolor value. A monochrome
 * terminal has no swatch fill, so the row falls back to the plain marker from `Swatch` and the name,
 * variant label, and active marker carry all meaning.
 *
 * @param activeName - Theme currently rendered, including a live preview.
 * @param capability - Terminal capability that decides the final swatch color.
 * @returns The rows in picker order.
 */
function buildRows(
  activeName: ThemeName,
  capability: ThemeColorCapability,
): readonly ThemePickerRow[] {
  return Object.freeze(
    THEME_NAMES.map((name) => {
      const flavor = THEME_FLAVORS[name];

      return {
        name,
        label: flavor.label,
        variant: flavor.variant,
        active: name === activeName,
        swatchColor: readSwatchColor(name, capability),
      };
    }),
  );
}

/**
 * Reads one flavor's swatch fill for the current capability.
 *
 * The flavor is mapped through the same capability stage the provider uses, so the picker never
 * shows a color the rest of the app would not render. Monochrome keeps the marker path instead.
 *
 * @param name - Built-in theme name.
 * @param capability - Terminal capability.
 * @returns The mapped fill color, or `null` when the marker replaces the swatch.
 */
function readSwatchColor(name: ThemeName, capability: ThemeColorCapability): HexColor | null {
  if (capability === "monochrome") {
    return null;
  }

  const flavor = THEME_FLAVORS[name];
  const mapped = applyThemeCapability(
    { ...flavor, capability: "truecolor", warnings: [] },
    capability,
  );

  return mapped.tokens.background;
}

/**
 * Reads the index of one theme name.
 *
 * @param name - Theme name to find.
 * @returns Its index in picker order, or zero when it is not a built-in flavor.
 */
function readThemeIndex(name: ThemeName): number {
  const index = THEME_NAMES.indexOf(name);

  return index === -1 ? 0 : index;
}
