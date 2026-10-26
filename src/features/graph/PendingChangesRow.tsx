import type { ReactNode } from "react";
import {
  GRAPH_CLEAN_TREE_MESSAGE,
  GRAPH_PENDING_LABEL,
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
 * @param props - Unstaged count, selection and focus flags, and the mouse handler.
 * @returns The composed pending row.
 */
export function PendingChangesRow(props: {
  readonly unstagedCount: number;
  readonly selected: boolean;
  readonly focused: boolean;
  readonly onMouseDown?: () => void;
}): ReactNode {
  const tokens = useTokens();
  const countText =
    props.unstagedCount > 0
      ? `${props.unstagedCount} unstaged ${props.unstagedCount === 1 ? "file" : "files"}`
      : GRAPH_CLEAN_TREE_MESSAGE;

  return (
    <ListRow
      id={GRAPH_PENDING_ROW_RENDERABLE_ID}
      selected={props.selected}
      focused={props.focused}
      onMouseDown={props.onMouseDown}
    >
      <box flexDirection="column" flexGrow={1} flexShrink={1}>
        <text fg={props.unstagedCount > 0 ? tokens.warning : tokens.muted} wrapMode="none">
          {countText}
        </text>
        <text fg={tokens.text} wrapMode="none">
          {GRAPH_PENDING_LABEL}
        </text>
      </box>
    </ListRow>
  );
}
