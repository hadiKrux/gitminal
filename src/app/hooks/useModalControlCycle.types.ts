/** Horizontal navigation direction inside an overlay modal. */
export type ModalControlDirection = "left" | "right";

/**
 * Outcome of one horizontal navigation request.
 *
 * `focus` moves the cycle to a named control, `step` moves it by an offset inside the current
 * order, and `none` leaves the control unchanged so a caller can keep a differing rule.
 */
export type ModalControlResolution<TControl extends string> =
  | { readonly kind: "focus"; readonly control: TControl }
  | { readonly kind: "step"; readonly delta: number }
  | { readonly kind: "none" };

/** Input passed to a caller-supplied horizontal rule. */
export interface ModalHorizontalInput<TControl extends string> {
  /** Control that currently owns the keyboard focus. */
  readonly control: TControl;
  /** Requested direction. */
  readonly direction: ModalControlDirection;
}

/** Inputs accepted by `useModalControlCycle`. */
export interface ModalControlCycleOptions<TControl extends string> {
  /** Every focusable control in vertical navigation order. */
  readonly order: readonly TControl[];
  /** Control focused when the modal mounts. */
  readonly initial: TControl;
  /**
   * Whether the cycle owns Up and Down.
   *
   * Defaults to true. A modal whose list owns the vertical keys, such as the theme picker, sets this
   * to false so its own `nav.up` and `nav.down` handlers stay the single registration for those
   * actions and the cycle only owns Left and Right.
   */
  readonly registerVerticalNavigation?: boolean;
  /**
   * Applies the modal's left and right rule.
   *
   * Up and Down step through `order` unless the caller owns them; only the horizontal rule differs
   * between modals, so a caller supplies it here instead of duplicating the cycle.
   */
  readonly onHorizontal?: (
    input: ModalHorizontalInput<TControl>,
  ) => ModalControlResolution<TControl>;
  /**
   * Runs synchronously whenever the focused control changes.
   *
   * A caller uses this to move native focus to the new control before the next key is dispatched,
   * which is what lets a select own Up and Down immediately after the cycle steps onto it. It runs
   * from the key handler, never during render.
   *
   * @param control - Control that now owns the keyboard focus.
   */
  readonly onControlChange?: (control: TControl) => void;
}

/** Control state exposed to a modal. */
export interface ModalControlCycle<TControl extends string> {
  /** Control that currently owns the keyboard focus. */
  readonly control: TControl;
  /**
   * Steps the focused control by an offset and clamps at both ends.
   *
   * A modal that owns the vertical keys itself, such as the theme picker while its row list is
   * focused, calls this when focus is inside the footer instead of registering a second `nav.up` or
   * `nav.down` handler.
   *
   * @param delta - Offset inside the control order; negative moves up.
   */
  readonly move: (delta: number) => void;
  /**
   * Focuses one named control synchronously.
   *
   * A select confirmation uses this to hand focus to the next field or to the primary action, so a
   * second Enter press makes progress instead of refocusing the select that just confirmed.
   *
   * @param control - Control that should own the keyboard focus.
   */
  readonly focusControl: (control: TControl) => void;
}
