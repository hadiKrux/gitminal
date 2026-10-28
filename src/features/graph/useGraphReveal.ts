import { useRenderer } from "@opentui/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useScrollSelectedRow } from "@/app/hooks/useScrollSelectedRow";
import type { ScrollChildIntoViewTarget } from "@/app/hooks/useScrollSelectedRow.types";
import { readGraphRowOriginLines, readGraphVisibleRows } from "@/features/graph/graph.window";
import type { GraphRevealInput } from "@/features/graph/useGraphReveal.types";

/**
 * Keeps the active graph row inside the panel's own scrollbox.
 *
 * The reveal runs when the row id or its position changes, which covers cursor movement and external
 * selection changes. Every change also schedules one correction on the next renderer frame, because
 * the immediate reveal effect runs before OpenTUI publishes the new row layout and its geometry can
 * be stale. That covers a body switch and a reload that inserts rows above the selection while the
 * row id stays the same; the frame event fires after the layout is applied. For the graph body, a viewport-height change reveals only
 * when the active row was visible before the change, which keeps a growing status footer from clipping
 * the cursor without pulling a freely scrolled viewport back. The search body has no status footer, so
 * it keeps the plain target and frame reveals. Content resizes inside one body, which happen when an
 * older page is appended, never reveal for that reason.
 *
 * Every reveal skips a child that has no published layout yet, so stale zero geometry can never
 * scroll the viewport to the top.
 *
 * @param input - Scrollbox ref, row to reveal, body identity, and measured viewport height.
 */
export function useGraphReveal(input: GraphRevealInput): void {
  const renderer = useRenderer();
  const [layoutRevision, setLayoutRevision] = useState(0);
  const { bodyKey, scrollRef } = input;
  const previousHeightRef = useRef(input.viewportHeight);
  const previousTargetRef = useRef<{
    readonly bodyKey: string;
    readonly childId: string | null;
    readonly revision: number;
  } | null>(null);

  const scrollTarget = useMemo<ScrollChildIntoViewTarget>(
    () => ({
      /**
       * Reveals one laid-out row through the graph panel's own scrollbox.
       *
       * @param childId - Renderable id of the row to reveal.
       */
      scrollChildIntoView: (childId: string): void => {
        const box = scrollRef.current;
        const child = box?.content.findDescendantById(childId);

        if (box === null || child === undefined || child.height <= 0) {
          return;
        }

        box.scrollChildIntoView(childId);
      },
    }),
    [scrollRef],
  );

  useEffect(() => {
    const previous = previousTargetRef.current;
    const next = {
      bodyKey,
      childId: input.target.childId,
      revision: input.target.revision,
    };

    if (
      previous !== null &&
      previous.bodyKey === next.bodyKey &&
      previous.childId === next.childId &&
      previous.revision === next.revision
    ) {
      return;
    }

    previousTargetRef.current = next;

    /** Reveals the active row once after the committed body has been laid out and painted. */
    const handleFrame = (): void => {
      setLayoutRevision((revision) => revision + 1);
    };

    renderer.once("frame", handleFrame);
    // The commit may already have requested a frame; requesting one here guarantees a frame is
    // emitted after the listener is registered on an on-demand renderer.
    renderer.requestRender();

    return () => {
      renderer.off("frame", handleFrame);
    };
  }, [bodyKey, input.target.childId, input.target.revision, renderer]);

  useEffect(() => {
    const previous = previousHeightRef.current;

    previousHeightRef.current = input.viewportHeight;

    if (previous === input.viewportHeight || bodyKey !== "graph" || input.target.childId === null) {
      return;
    }

    const box = scrollRef.current;

    if (box === null || box.viewport.height <= 0) {
      return;
    }

    const origin = readGraphRowOriginLines(box, input.firstRowId);
    const previousVisible = readGraphVisibleRows(box.scrollTop, previous, origin);
    const row = input.target.revision;

    if (row < previousVisible.first || row > previousVisible.last) {
      return;
    }

    setLayoutRevision((revision) => revision + 1);
  }, [
    bodyKey,
    input.firstRowId,
    input.target.childId,
    input.target.revision,
    input.viewportHeight,
    scrollRef,
  ]);

  useScrollSelectedRow(input.target.childId, input.target.revision, scrollTarget);
  useScrollSelectedRow(input.target.childId, layoutRevision, scrollTarget);
}
