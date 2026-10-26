import { useCallback, useState } from "react";
import { useAction } from "@/app/hooks/useAction";
import type {
  FooterActionCycle,
  FooterActionCycleInput,
} from "@/app/hooks/useFooterActionCycle.types";

/**
 * Owns the two-action footer cycle shared by the Create Tag and Create Stash modals.
 *
 * Left focuses the first action, Right focuses the last action, and Activate runs the focused
 * action through the caller's rule, so a disabled primary action can refuse without the hook
 * knowing what the action does. The hook registers only `nav.left`, `nav.right`, and
 * `nav.activate` in the overlay scope; form submission and focus stay with the caller.
 *
 * @param input - Action count, initial index, and the activation rule.
 * @returns The focused index, its setter, and the activation handler.
 */
export function useFooterActionCycle(input: FooterActionCycleInput): FooterActionCycle {
  const [focusedAction, setFocusedAction] = useState(input.initialIndex ?? 0);

  /** Runs the focused action through the caller's rule. */
  const activateFocusedAction = useCallback((): void => {
    input.onActivate(focusedAction);
  }, [focusedAction, input]);

  /** Focuses the first footer action. */
  const focusFirst = useCallback((): void => {
    setFocusedAction(0);
  }, []);

  /** Focuses the last footer action. */
  const focusLast = useCallback((): void => {
    setFocusedAction(Math.max(0, input.actionCount - 1));
  }, [input.actionCount]);

  useAction("nav.left", { scope: "overlay" }, focusFirst);
  useAction("nav.right", { scope: "overlay" }, focusLast);
  useAction("nav.activate", { scope: "overlay" }, activateFocusedAction);

  return {
    focusedAction,
    focusAction: setFocusedAction,
    activateFocusedAction,
  };
}
