import { useEffect } from "react";
import { useFocusState } from "@/app/hooks/useFocusState";

/**
 * Moves native focus into the visible overlay surface when that surface changes.
 *
 * The host remounts this component with a key derived from the visible surface identity, so a queued
 * error that arrives while a modal is open does not re-run the effect and cannot pull focus back to
 * the modal's initial field. Focus is attempted immediately and retried once on the next tick
 * because a select or input can mount after the effect runs.
 *
 * @param props - Renderable id that should receive focus.
 * @returns Nothing; the component renders no UI.
 */
export function OverlayFocus(props: { readonly focusId: string }): null {
  const { focusRenderable } = useFocusState();

  useEffect(() => {
    if (focusRenderable(props.focusId)) {
      return;
    }

    const timer = setTimeout(() => {
      focusRenderable(props.focusId);
    }, 0);

    return () => {
      clearTimeout(timer);
    };
  }, [focusRenderable, props.focusId]);

  return null;
}
