import { useCallback, useState } from "react";
import { useAction } from "@/app/hooks/useAction";
import type {
  ModalControlCycle,
  ModalControlCycleOptions,
  ModalControlDirection,
  ModalControlResolution,
} from "@/app/hooks/useModalControlCycle.types";

/** Scope every modal control action is registered in. */
const OVERLAY_SCOPE = "overlay" as const;

/**
 * Owns the keyboard control cycle shared by destructive modal dialogs.
 *
 * Up and Down step through the caller's visible control order and clamp at both ends, so a hidden
 * control can never take focus. Left and Right defer to the caller's horizontal rule, because the
 * three modals differ there: some always focus a footer action, while others move between a select
 * and the footer. The hook registers only `nav.up`, `nav.down`, `nav.left`, and `nav.right` in the
 * overlay scope; activation, submission, and native focus stay with the caller.
 *
 * @param options - Visible order, initial control, and the optional horizontal rule.
 * @returns The current control.
 */
export function useModalControlCycle<TControl extends string>(
  options: ModalControlCycleOptions<TControl>,
): ModalControlCycle<TControl> {
  const [control, setControl] = useState<TControl>(options.initial);

  const move = useCallback(
    (delta: number): void => {
      setControl((current) => stepControl(options.order, current, delta));
    },
    [options.order],
  );

  const runHorizontal = useCallback(
    (direction: ModalControlDirection): void => {
      const resolution = options.onHorizontal?.({ control, direction });

      applyResolution(resolution, setControl, move);
    },
    [control, move, options],
  );

  useAction("nav.up", { scope: OVERLAY_SCOPE }, () => {
    move(-1);
  });
  useAction("nav.down", { scope: OVERLAY_SCOPE }, () => {
    move(1);
  });
  useAction("nav.left", { scope: OVERLAY_SCOPE }, () => {
    runHorizontal("left");
  });
  useAction("nav.right", { scope: OVERLAY_SCOPE }, () => {
    runHorizontal("right");
  });

  return { control };
}

/**
 * Applies one horizontal resolution to the control state.
 *
 * @param resolution - Caller rule result, or undefined when the modal has no horizontal rule.
 * @param setControl - State setter for the focused control.
 * @param move - Offset operation used by a `step` resolution.
 */
function applyResolution<TControl extends string>(
  resolution: ModalControlResolution<TControl> | undefined,
  setControl: (control: TControl) => void,
  move: (delta: number) => void,
): void {
  if (resolution === undefined || resolution.kind === "none") {
    return;
  }

  if (resolution.kind === "focus") {
    setControl(resolution.control);

    return;
  }

  move(resolution.delta);
}

/**
 * Steps through a control order with clamping.
 *
 * An unknown current control resolves to the first entry on a downward step, matching the previous
 * per-modal behavior when a control order shrinks.
 *
 * @param order - Visible controls in navigation order.
 * @param current - Control focused before the step.
 * @param delta - Requested offset.
 * @returns The control that should own focus next.
 */
function stepControl<TControl extends string>(
  order: readonly TControl[],
  current: TControl,
  delta: number,
): TControl {
  const index = order.indexOf(current);
  const next = Math.min(Math.max(0, index + delta), order.length - 1);

  return order[next] ?? current;
}
