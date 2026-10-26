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
   * Applies the modal's left and right rule.
   *
   * Up and Down always step through `order`; only the horizontal rule differs between modals, so a
   * caller supplies it here instead of duplicating the cycle.
   */
  readonly onHorizontal?: (
    input: ModalHorizontalInput<TControl>,
  ) => ModalControlResolution<TControl>;
}

/** Control state exposed to a modal. */
export interface ModalControlCycle<TControl extends string> {
  /** Control that currently owns the keyboard focus. */
  readonly control: TControl;
}
