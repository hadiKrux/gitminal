import type { ReactNode } from "react";

/** A modal entry shape the entry surface can render. */
export interface OverlayEntrySurfaceModal {
  /** Discriminator. */
  readonly kind: "modal";
  /** Stable entry id used as the React key. */
  readonly id: string;
  /**
   * Renders the modal content.
   *
   * @param context - Helpers supplied by the overlay host.
   * @returns The modal content node.
   */
  readonly render: (context: { readonly close: (afterRestore?: () => void) => void }) => ReactNode;
}

/** A confirmation entry shape the entry surface can render. */
export interface OverlayEntrySurfaceConfirm {
  /** Discriminator. */
  readonly kind: "confirm";
  /** Stable entry id used as the React key. */
  readonly id: string;
  /** Modal title. */
  readonly title: string;
  /** Scope and consequence text. */
  readonly description: string;
  /** Primary action label. */
  readonly confirmLabel: string;
  /** Visible warning for a non-exact destructive label. */
  readonly labelWarning?: string;
  /** True when focus defaults to Cancel. */
  readonly destructive: boolean;
  /** Runs only when the primary action is activated. */
  readonly onConfirm: () => void;
}

/** Every entry the surface can render. */
export type OverlayEntrySurfaceEntry = OverlayEntrySurfaceModal | OverlayEntrySurfaceConfirm;

/** Props accepted by `OverlayEntrySurface`. */
export interface OverlayEntrySurfaceProps {
  /** Open entry to render. */
  readonly entry: OverlayEntrySurfaceEntry;
  /** Closes the entry and restores focus, then runs the optional completion. */
  readonly onClose: (afterRestore?: () => void) => void;
}
