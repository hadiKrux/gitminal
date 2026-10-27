import type { ReactNode } from "react";
import { GraphLanes } from "@/features/graph/GraphLanes";
import {
  GRAPH_CLEAN_TREE_MESSAGE,
  GRAPH_PENDING_LABEL,
  GRAPH_PENDING_LINE_CELL,
  GRAPH_PENDING_NODE_CELL,
  GRAPH_PENDING_ROW_RENDERABLE_ID,
} from "@/features/graph/graph.constants";
import { useTokens } from "@/theme/useTokens";
import { ListRow } from "@/ui/ListRow";

/**
 * Renders the always-first Pending Changes row.
 *
 * The row shows the unstaged count on the first line and the "Commit Changes" label on the second,
 * matching the graph reference. A clean working tree shows "Working tree clean" and the row remains
 * selectable, so the composer stays reachable for staged-only changes and the first commit.
 *
 * When the loaded window has commits, the row is the top of the tree: it draws a commit symbol in
 * the first lane and continues that lane on its second line, so the graph reads as one shape down
 * to the newest commit. It always occupies exactly one lane, so its text sits right after that lane
 * and lines up with a linear commit row. The row suppresses the `ListRow` selection marker, so the
 * dark selected fill and the focused region border identify the cursor row without a leading glyph.
 *
 * @param props - Unstaged count, whether a commit follows, selection and focus flags, and the mouse
 * handler.
 * @returns The composed pending row.
 */
export function PendingChangesRow(props: {
  readonly unstagedCount: number;
  readonly connected: boolean;
  readonly selected: boolean;
  readonly focused: boolean;
  readonly onMouseDown?: () => void;
}): ReactNode {
  const tokens = useTokens();
  const countText =
    props.unstagedCount > 0
      ? `${props.unstagedCount} unstaged ${props.unstagedCount === 1 ? "file" : "files"}`
      : GRAPH_CLEAN_TREE_MESSAGE;
  const nodeCells = props.connected ? [GRAPH_PENDING_NODE_CELL] : [];
  const lineCells = props.connected ? [GRAPH_PENDING_LINE_CELL] : [];

  return (
    <ListRow
      id={GRAPH_PENDING_ROW_RENDERABLE_ID}
      selected={props.selected}
      focused={props.focused}
      showMarker={false}
      onMouseDown={props.onMouseDown}
    >
      <box flexDirection="column" flexGrow={1} flexShrink={1}>
        <box flexDirection="row" flexShrink={0}>
          <GraphLanes cells={nodeCells} width={1} />
          <text fg={props.unstagedCount > 0 ? tokens.warning : tokens.muted} wrapMode="none">
            {countText}
          </text>
        </box>
        <box flexDirection="row" flexShrink={0}>
          <GraphLanes cells={lineCells} width={1} />
          <text fg={tokens.text} wrapMode="none">
            {GRAPH_PENDING_LABEL}
          </text>
        </box>
      </box>
    </ListRow>
  );
}
