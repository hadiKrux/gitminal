/** Props accepted by the `Button` primitive. */
export interface ButtonProps {
  /** Stable renderable id used by tests and focus restoration. */
  readonly id?: string;
  /** Visible label. */
  readonly label: string;
  /** Optional leading marker from `ICONS`. */
  readonly icon?: string;
  /** Whether to render only the icon and omit the label text. */
  readonly iconOnly?: boolean;
  /** Whether the control is the focused index of its owning feature. */
  readonly focused?: boolean;
  /** Whether the control cannot be activated. */
  readonly disabled?: boolean;
  /** Text explaining why a disabled control cannot run; shown next to the label. */
  readonly reason?: string;
  /** Activation callback for a click or the owning feature's `nav.activate`. */
  readonly onPress?: () => void;
}
