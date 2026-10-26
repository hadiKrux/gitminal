import { useCallback } from "react";
import { useAction } from "@/app/hooks/useAction";
import { useOverlay } from "@/app/hooks/useOverlay";
import { ThemePicker } from "@/features/theme-picker/ThemePicker";
import { THEME_PICKER_OVERLAY_ID } from "@/features/theme-picker/ThemePicker.constants";

/**
 * Registers `app.themePicker` once as a global action in the app layer.
 *
 * The action opens the picker as an `OverlayModalEntry`, so `OverlayHost` renders it through
 * `ModalFrame` and the overlay provider owns the keyboard and focus restore. This hook is the single
 * owner of the global action: the picker feature itself only registers overlay-scoped handlers, so a
 * duplicate global registration is a development error rather than a second opener. The entry
 * declares no toggle action, because F-19 keeps global actions unreachable while an overlay is open;
 * Esc and Cancel close it.
 */
export function useThemePickerAction(): void {
  const overlay = useOverlay();

  /** Opens the theme picker as the single open overlay entry. */
  const openPicker = useCallback((): void => {
    overlay.open({
      kind: "modal",
      id: THEME_PICKER_OVERLAY_ID,
      render: ({ close }) => <ThemePicker onClose={close} />,
    });
  }, [overlay]);

  useAction("app.themePicker", { scope: "global", owner: "app" }, openPicker);
}
