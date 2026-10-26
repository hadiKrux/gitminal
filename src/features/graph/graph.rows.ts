import { assignGraphLanes } from "@/domain/graph/graph.lanes";
import type { GraphCommit } from "@/domain/graph/graph.types";
import type { RepositorySelection } from "@/domain/repository/repository.types";
import { GRAPH_PENDING_ROW_ID } from "@/features/graph/graph.constants";
import type { CommitRowView, GraphDisplayRow } from "@/features/graph/graph.types";

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
