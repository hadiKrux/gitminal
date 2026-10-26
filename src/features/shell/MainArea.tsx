import type { BoxRenderable } from "@opentui/core";
import { type ReactNode, useRef } from "react";
import { readRightPaneRows } from "@/app/hooks/rightPane.layout";
import { useBoxRows } from "@/app/hooks/useBoxRows";

/**
 * Lays out the commit graph, right-pane surface, and diff panel.
 *
 * The component is layout only: it never imports a feature and never creates a region frame, a
 * `Panel`, or a scroll container. Each surface now owns its own focusable frame, border title, and
 * scroll region, so this component only sizes them. The graph takes one third of the main-area width
 * and the right column takes two thirds. One-cell gutters separate the graph from the right column
 * and the right pane from the diff.
 *
 * The right column measures its own height and reserves the right-pane minimum of
 * `RIGHT_PANE_MIN_ROWS` whenever the one-fifth share would be smaller and the column can spare it.
 * The diff takes the remaining rows and shrinks first, down to its own minimum. When the console
 * drawer leaves less room than both minimums need, the reservation is clamped to the rows left
 * after the diff minimum and the column gap, and the composer fills that clamped slot instead of
 * enforcing its own minimum, so the two surfaces never overlap and keep their one-cell gutter in
 * both console states. At short terminals the reservation is larger than the share, which is why
 * the diff holds about two thirds of the right column at 40 rows and about four fifths only once
 * the share exceeds the minimum. A surface is never re-created here; the graph in particular stays
 * mounted across right-pane mode changes because it owns the commit navigator and the
 * graph-window refresher.
 *
 * @param props - The three main-area surfaces supplied by the composition root.
 * @returns The main-area columns.
 */
export function MainArea(props: {
  graph: ReactNode;
  rightPane: ReactNode;
  diffPanel: ReactNode;
}): ReactNode {
  const rightColumnRef = useRef<BoxRenderable | null>(null);
  const { rows: rightColumnRows, onSizeChange } = useBoxRows(rightColumnRef);
  const rightPaneRows = readRightPaneRows(rightColumnRows);

  return (
    <box flexDirection="row" flexGrow={1} gap={1}>
      <box flexDirection="column" flexGrow={1} flexBasis={0}>
        {props.graph}
      </box>

      <box
        ref={rightColumnRef}
        onSizeChange={onSizeChange}
        flexDirection="column"
        flexGrow={2}
        flexBasis={0}
        gap={1}
      >
        <box flexDirection="column" height={rightPaneRows} flexShrink={0}>
          {props.rightPane}
        </box>

        <box flexDirection="column" flexGrow={1} flexBasis={0} flexShrink={1}>
          {props.diffPanel}
        </box>
      </box>
    </box>
  );
}
