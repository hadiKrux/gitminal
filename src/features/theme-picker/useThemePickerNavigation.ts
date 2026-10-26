import { useCallback } from "react";
import { useAction } from "@/app/hooks/useAction";
import { HIGHLIGHT_STEPS } from "@/features/theme-picker/useThemePicker.constants";
import type {
  ThemePickerNavigation,
  UseThemePickerNavigationOptions,
} from "@/features/theme-picker/useThemePicker.types";
import { clampIndex } from "@/lib/list";

/**
 * Owns the picker's row highlight movement and overlay key registrations.
 *
 * Up and Down move the highlight and preview the new theme while the rows own focus, and step the
 * footer controls while the actions own focus. Every handler is overlay-scoped, so the picker only
 * sees keys while it is the open modal; `app.themePicker` belongs to the app layer and is never
 * registered here.
 *
 * @param input - Picker view state and the commit handlers the activation keys run.
 * @returns The navigation handlers the view can reuse.
 */
export function useThemePickerNavigation(
  input: UseThemePickerNavigationOptions,
): ThemePickerNavigation {
  const { state, commit } = input;
  const {
    cycle,
    controls,
    focusedZone,
    highlightedIndex,
    rows,
    setFocusedZone,
    setHighlightedIndex,
  } = state;

  /** Highlights one row and previews it. */
  const select = useCallback(
    (index: number): void => {
      const next = clampIndex(index, rows.length);
      const row = rows[next];

      if (row === undefined) {
        return;
      }

      setFocusedZone("rows");
      setHighlightedIndex(next);
      controls.preview(row.name);
    },
    [controls, rows, setFocusedZone, setHighlightedIndex],
  );

  /** Moves the highlight by one row and previews the new row. */
  const move = useCallback(
    (delta: number): void => {
      select(highlightedIndex + delta);
    },
    [highlightedIndex, select],
  );

  /** Runs the focused footer control. */
  const activate = useCallback((): void => {
    if (focusedZone === "rows") {
      commit.apply();

      return;
    }

    if (cycle.control === "cancel") {
      commit.cancel();

      return;
    }

    commit.apply();
  }, [commit, cycle.control, focusedZone]);

  /**
   * Moves keyboard focus between the theme rows and the modal footer actions.
   *
   * The picker has exactly two destinations, so both directions toggle, matching the palette and help
   * field traversal. The highlighted row keeps its preview while the footer owns focus.
   */
  const moveZone = useCallback((): void => {
    setFocusedZone(focusedZone === "rows" ? "actions" : "rows");
  }, [focusedZone, setFocusedZone]);

  useAction("nav.up", { scope: "overlay" }, () => {
    if (focusedZone === "actions") {
      cycle.move(-1);

      return;
    }

    move(HIGHLIGHT_STEPS.up);
  });
  useAction("nav.down", { scope: "overlay" }, () => {
    if (focusedZone === "actions") {
      cycle.move(1);

      return;
    }

    move(HIGHLIGHT_STEPS.down);
  });
  useAction("nav.activate", { scope: "overlay" }, activate);
  useAction("overlay.close", { scope: "overlay" }, commit.cancel);
  useAction("focus.next", { scope: "overlay" }, moveZone);
  useAction("focus.previous", { scope: "overlay" }, moveZone);

  return { select, move, activate, moveZone };
}
