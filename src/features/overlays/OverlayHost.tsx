import { type ReactNode, useEffect } from "react";
import { useFocusState } from "@/app/hooks/useFocusState";
import { useOverlay } from "@/app/hooks/useOverlay";
import { useStatus } from "@/app/hooks/useStatus";
import { ConfirmModal } from "@/features/overlays/ConfirmModal";
import { CONFIRM_MODAL_FRAME_ID } from "@/features/overlays/ConfirmModal.constants";
import { MODAL_FRAME_ID } from "@/ui/ModalFrame.constants";
import { Overlay } from "@/ui/Overlay";

/**
 * Renders the single open overlay entry and projects its focus and footer effects.
 *
 * The host owns three effects: the blocking `Overlay` layer, the footer's modal hint mode while an
 * entry exists, and initial native focus. Focus moves to the entry's `initialFocusId`, or to the
 * frame the entry renders, with one retry on the next tick because a select or input can mount after
 * the effect runs. Modal entries render their own content and register their own overlay actions;
 * confirm entries render `ConfirmModal`, which owns the focused footer action.
 *
 * @returns The overlay layer plus the open entry, or null when nothing is open.
 */
export function OverlayHost(): ReactNode {
  const overlay = useOverlay();
  const { setHintMode } = useStatus();
  const { focusRenderable } = useFocusState();
  const entry = overlay.entry;
  const isOpen = entry !== null;

  useEffect(() => {
    setHintMode(isOpen ? "modal" : "context");
  }, [isOpen, setHintMode]);

  useEffect(() => {
    if (entry === null) {
      return;
    }

    const focusId = readInitialFocusId(entry);

    if (focusRenderable(focusId)) {
      return;
    }

    const timer = setTimeout(() => {
      focusRenderable(focusId);
    }, 0);

    return () => {
      clearTimeout(timer);
    };
  }, [entry, focusRenderable]);

  if (entry === null) {
    return null;
  }

  return (
    <>
      <Overlay />
      {entry.kind === "confirm" ? (
        <ConfirmModal
          key={entry.id}
          title={entry.title}
          description={entry.description}
          confirmLabel={entry.confirmLabel}
          destructive={entry.destructive}
          onConfirm={entry.onConfirm}
          onCancel={overlay.close}
        />
      ) : (
        entry.render({ close: overlay.close })
      )}
    </>
  );
}

/**
 * Reads the renderable id that should receive native focus for an entry.
 *
 * @param entry - Open overlay entry.
 * @returns The entry's initial focus id, or the frame id its component renders.
 */
function readInitialFocusId(entry: {
  readonly kind: "modal" | "confirm";
  readonly initialFocusId?: string;
}): string {
  if (entry.initialFocusId !== undefined) {
    return entry.initialFocusId;
  }

  return entry.kind === "confirm" ? CONFIRM_MODAL_FRAME_ID : MODAL_FRAME_ID;
}
