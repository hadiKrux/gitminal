import { Fragment, type ReactNode } from "react";
import { ConfirmModal } from "@/features/overlays/ConfirmModal";
import type { OverlayEntrySurfaceProps } from "@/features/overlays/OverlayEntrySurface.types";

/**
 * Renders the open modal or confirmation entry through its owning component.
 *
 * A confirm entry renders `ConfirmModal` with Cancel as its cancel path; a modal entry renders the
 * content supplied by the opening feature and receives the same close operation. A fresh key per
 * entry id resets local focus state when one entry replaces another.
 *
 * @param props - Open entry and the close operation.
 * @returns The entry content.
 */
export function OverlayEntrySurface(props: OverlayEntrySurfaceProps): ReactNode {
  const entry = props.entry;

  if (entry.kind === "confirm") {
    return (
      <ConfirmModal
        key={entry.id}
        title={entry.title}
        description={entry.description}
        confirmLabel={entry.confirmLabel}
        labelWarning={entry.labelWarning}
        destructive={entry.destructive}
        onConfirm={entry.onConfirm}
        onCancel={props.onClose}
      />
    );
  }

  return <Fragment key={entry.id}>{entry.render({ close: props.onClose })}</Fragment>;
}
