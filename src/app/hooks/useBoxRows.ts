import type { BoxRenderable } from "@opentui/core";
import { type RefObject, useCallback, useEffect, useState } from "react";

/**
 * Measures the laid-out row height of one box.
 *
 * A panel body that shares a column with another surface does not know how many rows it actually
 * gets until layout runs. This hook reads the box height after every render, stores only a changed
 * whole-row value, and reports zero before the first layout, so the caller can fall back to a
 * documented budget for one frame without a render loop. The returned `onSizeChange` callback
 * schedules a post-layout re-read, because a resize can change the box height without any other
 * state update in the measured subtree.
 *
 * @param ref - Ref attached to the box whose height should be measured.
 * @returns The measured row count and the box `onSizeChange` callback.
 */
export function useBoxRows(ref: RefObject<BoxRenderable | null>): {
  readonly rows: number;
  readonly onSizeChange: () => void;
} {
  const [rows, setRows] = useState(0);
  const [, setSizeRevision] = useState(0);

  useEffect(() => {
    const height = ref.current?.height;

    if (typeof height !== "number" || !Number.isFinite(height)) {
      return;
    }

    const next = Math.max(0, Math.floor(height));

    setRows((previous) => (previous === next ? previous : next));
  });

  /** Schedules a post-layout re-read after the box reports a new size. */
  const onSizeChange = useCallback((): void => {
    setSizeRevision((revision) => revision + 1);
  }, []);

  return { rows, onSizeChange };
}
