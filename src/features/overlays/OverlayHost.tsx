import type { ReactNode } from "react";
import { useEffect } from "react";
import { useOverlay } from "@/app/hooks/useOverlay";
import { useStatus } from "@/app/hooks/useStatus";
import { CONFIRM_MODAL_FRAME_ID } from "@/features/overlays/ConfirmModal.constants";
import { ErrorOverlay } from "@/features/overlays/ErrorOverlay";
import { ERROR_OVERLAY_FRAME_ID } from "@/features/overlays/ErrorOverlay.constants";
import { OverlayEntrySurface } from "@/features/overlays/OverlayEntrySurface";
import { OverlayFocus } from "@/features/overlays/OverlayFocus";
import { useOverlayHostActions } from "@/features/overlays/useOverlayHostActions";
import { MODAL_FRAME_ID } from "@/ui/ModalFrame.constants";
import { Overlay } from "@/ui/Overlay";

/**
 * Renders the single open overlay entry or the persistent error detail.
 *
 * Only one surface renders at a time; an open entry wins over an error detail, so an error that
 * arrives while a modal is open stays queued until the modal closes. The host owns the blocking
 * `Overlay` layer, the footer's modal hint mode while a surface exists, and the surface identity that
 * drives initial focus. Focus moves only when the visible surface changes, because `OverlayFocus` is
 * keyed by the entry id or the error key; a queued error cannot pull focus back to an open modal's
 * initial field. Modal and confirm content is rendered by `OverlayEntrySurface`, and the console and
 * retry actions live in `useOverlayHostActions`.
 *
 * @returns The overlay layer plus the active surface, or null when nothing is open.
 */
export function OverlayHost(): ReactNode {
  const overlay = useOverlay();
  const { setHintMode } = useStatus();
  const { openConsoleEntry, retryError } = useOverlayHostActions();
  const entry = overlay.entry;
  const visibleError = entry === null ? overlay.errorDetail : null;
  const isOpen = entry !== null || overlay.errorDetail !== null;
  const surfaceKey = readSurfaceKey(entry, visibleError);
  const focusId = readSurfaceFocusId(entry, visibleError);

  useEffect(() => {
    setHintMode(isOpen ? "modal" : "context");
  }, [isOpen, setHintMode]);

  if (!isOpen) {
    return null;
  }

  return (
    <>
      <Overlay />
      {surfaceKey === null || focusId === null ? null : (
        <OverlayFocus key={surfaceKey} focusId={focusId} />
      )}
      {entry === null ? null : <OverlayEntrySurface entry={entry} onClose={overlay.close} />}
      {visibleError === null ? null : (
        <ErrorOverlay
          key={readErrorKey(visibleError)}
          title={`${visibleError.operationLabel} failed`}
          message={visibleError.message}
          details={visibleError.details}
          consoleEntryId={visibleError.consoleEntryId}
          canRetry={visibleError.retry !== undefined}
          onDismiss={overlay.dismissError}
          onOpenConsole={() => {
            openConsoleEntry(visibleError.consoleEntryId);
          }}
          onRetry={() => {
            retryError(visibleError.retry);
          }}
        />
      )}
    </>
  );
}

/**
 * Reads the identity key of the visible surface.
 *
 * @param entry - Open entry, or null.
 * @param errorDetail - Visible error detail, or null.
 * @returns A stable key, or null when nothing is visible.
 */
function readSurfaceKey(
  entry: { readonly id: string } | null,
  errorDetail: {
    readonly commandId: string;
    readonly consoleEntryId: string | null;
    readonly message: string;
  } | null,
): string | null {
  if (entry !== null) {
    return `entry:${entry.id}`;
  }

  return errorDetail === null ? null : `error:${readErrorKey(errorDetail)}`;
}

/**
 * Reads the renderable id that should receive native focus for the active surface.
 *
 * @param entry - Open entry, or null.
 * @param errorDetail - Visible error detail, or null.
 * @returns The entry's initial focus id, the error frame id, or null when nothing is visible.
 */
function readSurfaceFocusId(
  entry: {
    readonly kind: "modal" | "confirm";
    readonly initialFocusId?: string;
  } | null,
  errorDetail: object | null,
): string | null {
  if (entry !== null) {
    return readEntryFocusId(entry);
  }

  return errorDetail === null ? null : ERROR_OVERLAY_FRAME_ID;
}

/**
 * Reads the renderable id that should receive native focus for a modal entry.
 *
 * @param entry - Open modal or confirm entry.
 * @returns The entry's initial focus id, or the frame id for its kind.
 */
function readEntryFocusId(entry: {
  readonly kind: "modal" | "confirm";
  readonly initialFocusId?: string;
}): string {
  if (entry.initialFocusId !== undefined) {
    return entry.initialFocusId;
  }

  return entry.kind === "confirm" ? CONFIRM_MODAL_FRAME_ID : MODAL_FRAME_ID;
}

/**
 * Builds a remount key for the error surface.
 *
 * A new error must reset the focused action and the scroll position, so the key changes whenever the
 * visible failure changes.
 *
 * @param detail - Visible error detail.
 * @returns A stable key for this failure.
 */
function readErrorKey(detail: {
  readonly commandId: string;
  readonly consoleEntryId: string | null;
  readonly message: string;
}): string {
  return `${detail.commandId}:${detail.consoleEntryId ?? ""}:${detail.message}`;
}
