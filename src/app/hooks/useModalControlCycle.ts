import { useCallback, useMemo, useState } from "react";
import { useActions } from "@/app/hooks/useAction";
import type { ActionBatchRegistration } from "@/app/hooks/useAction.types";
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
 * and the footer. The hook registers `nav.up`, `nav.down`, `nav.left`, and `nav.right` in the overlay
 * scope; a caller that owns the vertical keys itself sets `registerVerticalNavigation` to false so
 * the cycle registers only the horizontal pair and no duplicate registration is rejected. Activation,
 * submission, and native focus stay with the caller.
 *
 * @param options - Visible order, initial control, vertical ownership, and the horizontal rule.
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

  const registerVertical = options.registerVerticalNavigation !== false;
  const registrations = useMemo<readonly ActionBatchRegistration[]>(
    () => buildControlRegistrations(registerVertical, move, runHorizontal),
    [registerVertical, move, runHorizontal],
  );

  useActions(registrations);

  return { control, move };
}

/**
 * Builds the overlay-scoped navigation registrations for one cycle.
 *
 * @param registerVertical - True when the cycle owns Up and Down.
 * @param move - Vertical step operation.
 * @param runHorizontal - Horizontal rule runner.
 * @returns The registrations to install, in display order.
 */
function buildControlRegistrations(
  registerVertical: boolean,
  move: (delta: number) => void,
  runHorizontal: (direction: ModalControlDirection) => void,
): readonly ActionBatchRegistration[] {
  const options = { scope: OVERLAY_SCOPE } as const;
  const registrations: ActionBatchRegistration[] = [];

  if (registerVertical) {
    registrations.push(
      { actionId: "nav.up", options, handler: () => move(-1) },
      { actionId: "nav.down", options, handler: () => move(1) },
    );
  }

  registrations.push(
    { actionId: "nav.left", options, handler: () => runHorizontal("left") },
    { actionId: "nav.right", options, handler: () => runHorizontal("right") },
  );

  return registrations;
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
