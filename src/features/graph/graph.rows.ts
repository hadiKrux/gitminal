import { assignGraphLanes } from "@/domain/graph/graph.lanes";
import type { GraphCommit } from "@/domain/graph/graph.types";
import type { RepositorySelection } from "@/domain/repository/repository.types";
import { GRAPH_PENDING_ROW_ID } from "@/features/graph/graph.constants";
import type {
  CommitRowView,
  GraphDisplayRow,
  GraphRevealTarget,
  SearchResultView,
} from "@/features/graph/graph.types";

/** Prefix every graph body row renderable id shares. */
const GRAPH_ROW_RENDERABLE_PREFIX = "graph-row:";

/** Prefix every commit search result row renderable id shares. */
const GRAPH_SEARCH_ROW_RENDERABLE_PREFIX = "graph-search-row:";

/**
 * Builds display rows and computes lanes once for one loaded window.
 *
 * @param rows - Loaded commits in display order.
 * @returns Prepared commit rows, skipping a commit with no display payload.
 */
export function buildCommitRows(rows: readonly GraphCommit[]): readonly CommitRowView[] {
  const assignment = assignGraphLanes(rows);
  const views: CommitRowView[] = [];

  for (let index = 0; index < rows.length; index += 1) {
    const commit = rows[index];
    const lane = assignment.rows[index];

    if (commit?.row === undefined || lane === undefined) {
      continue;
    }

    views.push({
      kind: "commit",
      id: commit.oid,
      row: commit.row,
      lanes: lane.cells,
      below: lane.below,
      nodeColumn: lane.nodeColumn,
    });
  }

  return views;
}

/**
 * Builds the full graph body rows: the always-first Pending Changes row plus commits.
 *
 * @param commitRows - Prepared commit rows.
 * @param pendingTotal - Number of unstaged tracked changes plus untracked entries.
 * @returns The rows in display order.
 */
export function buildDisplayRows(
  commitRows: readonly CommitRowView[],
  pendingTotal: number,
): readonly GraphDisplayRow[] {
  return [
    { kind: "pending", id: GRAPH_PENDING_ROW_ID, unstagedCount: pendingTotal },
    ...commitRows,
  ];
}

/**
 * Reads the row identity represented by the provider selection.
 *
 * @param selection - Current right-pane selection.
 * @returns `pending`, a commit OID, or null for a non-graph selection.
 */
export function readSelectedRowId(selection: RepositorySelection): string | null {
  if (selection.kind === "pending") {
    return GRAPH_PENDING_ROW_ID;
  }

  if (selection.kind === "commit") {
    return selection.oid;
  }

  return null;
}

/**
 * Builds the stable renderable id of one graph body row.
 *
 * The Pending Changes row and every commit row share this id shape, so the reveal target can map a
 * row id from the display list straight onto the mounted renderable without a second lookup.
 *
 * @param rowId - Row identity from the display row list.
 * @returns The renderable id the graph scrollbox can reveal.
 */
export function graphRowRenderableId(rowId: string): string {
  return `${GRAPH_ROW_RENDERABLE_PREFIX}${rowId}`;
}

/**
 * Builds the stable renderable id of one commit search result row.
 *
 * @param oid - Full commit OID of the result.
 * @returns The renderable id the graph scrollbox can reveal.
 */
export function searchResultRowId(oid: string): string {
  return `${GRAPH_SEARCH_ROW_RENDERABLE_PREFIX}${oid}`;
}

/**
 * Builds the reveal target of the normal graph body.
 *
 * The provider selection is the reveal anchor, so a selection the graph did not cause, such as a
 * stash or worktree selection, reveals nothing. The revision is the selected row's own position, not
 * the cursor position: a cursor move renders once before the selection dispatch reaches the provider,
 * and using the cursor position there would reveal the old row with a new revision and pull a freely
 * scrolled viewport back to it.
 *
 * @param rows - Mounted graph rows in display order.
 * @param selectedRowId - Provider-selected graph row id, or null for a non-graph selection.
 * @returns The renderable id to reveal and its position in the body.
 */
export function readGraphRevealTarget(
  rows: readonly GraphDisplayRow[],
  selectedRowId: string | null,
): GraphRevealTarget {
  if (selectedRowId === null) {
    return { childId: null, revision: 0 };
  }

  const index = rows.findIndex((row) => row.id === selectedRowId);

  return {
    childId: graphRowRenderableId(selectedRowId),
    revision: Math.max(0, index),
  };
}

/**
 * Builds the reveal target of the flat commit search result body.
 *
 * @param results - Prepared search results in display order.
 * @param selectedIndex - Position of the result cursor.
 * @returns The renderable id to reveal and the result cursor position.
 */
export function readSearchRevealTarget(
  results: readonly SearchResultView[],
  selectedIndex: number,
): GraphRevealTarget {
  const result = results[selectedIndex];

  return {
    childId: result === undefined ? null : searchResultRowId(result.id),
    revision: selectedIndex,
  };
}
