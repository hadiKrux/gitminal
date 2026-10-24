import type { ReactNode } from "react";
import { useFocusRegion } from "@/app/hooks/useFocusRegion";
import { Panel } from "@/ui/Panel";

/**
 * Places the commit graph, right-pane surface, and diff panel inside their region frames.
 *
 * The component receives every feature surface as a ReactNode and never imports a feature. The
 * graph takes one third of the main-area width and the right column takes two thirds. The right
 * column splits its height one part for the active right-pane surface and four parts for the diff
 * panel, so the diff holds about four fifths of the height at 40 rows, matching the mockup. One-cell
 * gutters separate the graph from the right column and the right pane from the diff.
 *
 * @param props - The three main-area surfaces supplied by the composition root.
 * @returns The main-area columns.
 */
export function MainArea(props: {
  graph: ReactNode;
  rightPane: ReactNode;
  diffPanel: ReactNode;
}): ReactNode {
  const graph = useFocusRegion("graph");
  const rightPane = useFocusRegion("right-pane");
  const diff = useFocusRegion("diff");

  return (
    <box flexDirection="row" flexGrow={1} gap={1}>
      <Panel
        {...graph.regionProps}
        focused={graph.focused}
        title="Commits"
        flexGrow={1}
        flexBasis={0}
      >
        <scrollbox flexGrow={1} focusable={false} viewportCulling>
          {props.graph}
        </scrollbox>
      </Panel>

      <box flexDirection="column" flexGrow={2} flexBasis={0}>
        <Panel
          {...rightPane.regionProps}
          focused={rightPane.focused}
          title="Right pane"
          flexGrow={1}
          flexBasis={0}
        >
          <scrollbox flexGrow={1} focusable={false} viewportCulling>
            {props.rightPane}
          </scrollbox>
        </Panel>

        <Panel
          {...diff.regionProps}
          focused={diff.focused}
          title="Diffs"
          flexGrow={4}
          flexBasis={0}
          minHeight={3}
        >
          <scrollbox flexGrow={1} focusable={false} viewportCulling>
            {props.diffPanel}
          </scrollbox>
        </Panel>
      </box>
    </box>
  );
}
