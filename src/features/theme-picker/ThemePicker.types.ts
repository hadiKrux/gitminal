import type { ThemePersist } from "@/features/theme-picker/useThemePicker.types";

/** Props accepted by `ThemePicker`. */
export interface ThemePickerProps {
  /** Closes the overlay that renders the picker. */
  readonly onClose: () => void;
  /** Persistence override used by tests; defaults to the shared configuration writer. */
  readonly persist?: ThemePersist;
}
