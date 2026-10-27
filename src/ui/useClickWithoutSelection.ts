import { useRenderer } from "@opentui/react";
import { useCallback, useRef } from "react";

/**
 * Builds the mouse-down handler that an interactive primitive runs for a click.
 *
 * OpenTUI starts a global text selection on a left-button down over selectable text, and a plain
 * click that never drags leaves that selection in place, so a click on a button or a list row would
 * highlight its label and leave the highlight behind. Every one of these primitives is a `<box>`
 * with text children, so the text under the pointer is always selectable and the click cannot
 * prevent the selection from starting. Clearing it here runs before the owning action and before
 * the next frame, so the label is never painted selected, while text outside a clickable primitive
 * stays selectable for copy. The handler is always attached, including for an inert control,
 * because the selection starts before the action would be skipped.
 *
 * @param onMouseDown - Owning feature's click action, or undefined for an inert control.
 * @returns The mouse-down handler for the primitive's clickable box.
 */
export function useClickWithoutSelection(onMouseDown?: () => void): () => void {
  const renderer = useRenderer();
  const action = useRef(onMouseDown);

  action.current = onMouseDown;

  return useCallback((): void => {
    renderer.clearSelection();
    action.current?.();
  }, [renderer]);
}
