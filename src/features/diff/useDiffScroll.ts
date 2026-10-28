import type { ScrollBoxRenderable } from "@opentui/core";
import { type RefObject, useMemo } from "react";
import { useActions } from "@/app/hooks/useAction";
import type { ActionBatchRegistration } from "@/app/hooks/useAction.types";
import type { ScrollChildIntoViewTarget } from "@/app/hooks/useScrollSelectedRow.types";
import {
  DIFF_SCROLL_COLUMNS,
  DIFF_SCROLL_FAST_LINES,
  DIFF_SCROLL_LINES,
} from "./diffPanel.constants";
import type { DiffScroll } from "./useDiffScroll.types";

/**
 * Owns the diff panel's keyboard viewport scrolling.
 *
 * The panel renders exactly one scrollbox, so every expanded file shares the vertical and
 * horizontal offset. Each callback moves that box by an absolute line or column step; OpenTUI clamps
 * the offset at both edges, so a key at an edge is a silent no-op that never wraps and never moves
 * the selected row. Nothing is reported to the status line. The callbacks are plain functions
 * because `useActions` reads the latest batch through a ref, matching `buildActionRegistrations` in
 * `diff.actions.ts`. Reveal targets are width-capped section headers and file rows, so keyboard row
 * navigation never changes the horizontal offset; the horizontal scrollbar is hidden, so
 * `diff.scrollLeft` and `diff.scrollRight` are the supported keyboard horizontal controls.
 *
 * @param scrollRef - Ref attached to the diff panel's single scrollbox.
 * @returns The six scroll callbacks and the reveal target for `useScrollSelectedRow`.
 */
export function useDiffScroll(scrollRef: RefObject<ScrollBoxRenderable | null>): DiffScroll {
  /**
   * Moves the shared viewport by a number of rows.
   *
   * @param delta - Rows to move; positive scrolls down.
   */
  function scrollByLines(delta: number): void {
    scrollRef.current?.scrollBy(delta, "absolute");
  }

  /**
   * Moves the shared viewport by a number of columns.
   *
   * @param delta - Columns to move; positive scrolls right.
   */
  function scrollByColumns(delta: number): void {
    scrollRef.current?.scrollBy({ x: delta, y: 0 }, "absolute");
  }

  /** Scrolls the viewport down by one line. */
  function scrollDown(): void {
    scrollByLines(DIFF_SCROLL_LINES);
  }

  /** Scrolls the viewport up by one line. */
  function scrollUp(): void {
    scrollByLines(-DIFF_SCROLL_LINES);
  }

  /** Scrolls the viewport down by the fast line step. */
  function scrollFastDown(): void {
    scrollByLines(DIFF_SCROLL_FAST_LINES);
  }

  /** Scrolls the viewport up by the fast line step. */
  function scrollFastUp(): void {
    scrollByLines(-DIFF_SCROLL_FAST_LINES);
  }

  /** Scrolls the viewport left by the column step. */
  function scrollLeft(): void {
    scrollByColumns(-DIFF_SCROLL_COLUMNS);
  }

  /** Scrolls the viewport right by the column step. */
  function scrollRight(): void {
    scrollByColumns(DIFF_SCROLL_COLUMNS);
  }

  const scrollTarget = useMemo<ScrollChildIntoViewTarget>(
    () => ({
      /**
       * Reveals one diff row through the panel's own scrollbox.
       *
       * The revealed row is width-capped, so this moves the viewport vertically without changing the
       * horizontal offset.
       *
       * @param childId - Renderable id of the row to reveal.
       */
      scrollChildIntoView: (childId: string): void => {
        scrollRef.current?.scrollChildIntoView(childId);
      },
    }),
    [scrollRef],
  );
  const scope = { scope: "diff" } as const;
  const registrations: readonly ActionBatchRegistration[] = [
    { actionId: "diff.scrollDown", options: scope, handler: scrollDown },
    { actionId: "diff.scrollUp", options: scope, handler: scrollUp },
    { actionId: "diff.scrollFastDown", options: scope, handler: scrollFastDown },
    { actionId: "diff.scrollFastUp", options: scope, handler: scrollFastUp },
    { actionId: "diff.scrollLeft", options: scope, handler: scrollLeft },
    { actionId: "diff.scrollRight", options: scope, handler: scrollRight },
  ];

  useActions(registrations);

  return {
    scrollDown,
    scrollUp,
    scrollFastDown,
    scrollFastUp,
    scrollLeft,
    scrollRight,
    scrollTarget,
  };
}
