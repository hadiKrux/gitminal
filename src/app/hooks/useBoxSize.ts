import type { BoxRenderable } from "@opentui/core";
import { type RefObject, useCallback, useEffect, useState } from "react";

/** Measured box size in whole cells. */
type BoxSize = { readonly rows: number; readonly columns: number };

/** Size reported before layout publishes a finite width and height. */
const EMPTY_SIZE: BoxSize = { rows: 0, columns: 0 };

/**
 * Measures the laid-out size of one box.
 *
 * A panel body that shares a column with another surface does not know how many rows or columns it
 * actually gets until layout runs. This hook reads the box size after every render, stores only a
 * changed whole-cell value, and reports zero on both axes before the first layout, so the caller can
 * fall back to a documented budget for one frame without a render loop. An axis the box reports as
 * non-finite keeps its last measured value instead of collapsing to zero mid-session. The returned
 * `onSizeChange` callback schedules a post-layout re-read, because a resize can change the box size
 * without any other state update in the measured subtree.
 *
 * @param ref - Ref attached to the box whose size should be measured.
 * @returns The measured rows and columns plus the box `onSizeChange` callback.
 */
export function useBoxSize(ref: RefObject<BoxRenderable | null>): {
  readonly rows: number;
  readonly columns: number;
  readonly onSizeChange: () => void;
} {
  const [size, setSize] = useState<BoxSize>(EMPTY_SIZE);
  const [, setSizeRevision] = useState(0);

  useEffect(() => {
    const box = ref.current;

    setSize((previous) => {
      const next = {
        rows: readCells(box?.height ?? Number.NaN, previous.rows),
        columns: readCells(box?.width ?? Number.NaN, previous.columns),
      };

      return previous.rows === next.rows && previous.columns === next.columns ? previous : next;
    });
  });

  /** Schedules a post-layout re-read after the box reports a new size. */
  const onSizeChange = useCallback((): void => {
    setSizeRevision((revision) => revision + 1);
  }, []);

  return { rows: size.rows, columns: size.columns, onSizeChange };
}

/**
 * Reads one measured axis as whole non-negative cells.
 *
 * @param value - Measured width or height in cells.
 * @param fallback - Last measured value for that axis.
 * @returns The whole cell count, or the fallback when the value is not finite.
 */
function readCells(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : fallback;
}
