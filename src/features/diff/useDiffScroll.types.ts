import type { ScrollChildIntoViewTarget } from "@/app/hooks/useScrollSelectedRow.types";

/**
 * Keyboard scroll controls one diff panel owns.
 *
 * Every callback moves the panel's single `ScrollBoxRenderable` and clamps at its edges. None of
 * them changes the selected row, and none of them reports anything when there is nothing to scroll.
 */
export interface DiffScroll {
  /** Scrolls the shared viewport down by one line. */
  readonly scrollDown: () => void;
  /** Scrolls the shared viewport up by one line. */
  readonly scrollUp: () => void;
  /** Scrolls the shared viewport down by the fast line step. */
  readonly scrollFastDown: () => void;
  /** Scrolls the shared viewport up by the fast line step. */
  readonly scrollFastUp: () => void;
  /** Scrolls the shared viewport left by the column step. */
  readonly scrollLeft: () => void;
  /** Scrolls the shared viewport right by the column step. */
  readonly scrollRight: () => void;
  /** Reveal target used by `useScrollSelectedRow` for the diff panel's own scrollbox. */
  readonly scrollTarget: ScrollChildIntoViewTarget;
}
