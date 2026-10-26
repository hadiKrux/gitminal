import type { GraphCommit, GraphLaneAssignment, GraphLaneRow, GraphLaneState } from "./graph.types";

/** Cell drawn for the commit itself. */
const NODE_CELL = "*";

/** Cell drawn for a lane that passes through the row unchanged. */
const VERTICAL_CELL = "|";

/** Cell drawn for a new lane that starts in this row. */
const DIVERGE_CELL = "\\";

/** Cell drawn for a lane that converges into the commit in this row. */
const CONVERGE_CELL = "/";

/** Cell drawn for a free lane. */
const EMPTY_CELL = " ";

/**
 * Assigns lane columns for one ordered page of commits.
 *
 * The state is a list of lane columns, each holding the OID that lane expects next. A commit takes
 * the leftmost lane expecting its OID, or the leftmost free lane when no lane expects it, which
 * handles a branch start and a disconnected lane without corrupting existing columns. The first
 * parent continues in the node's lane, every additional parent starts a lane to the right, and any
 * other lane that expected the same commit is drawn as a converging edge and released. Passing the
 * returned state into the next page keeps the columns continuous across a page boundary.
 *
 * The result is pure and depends only on the input order, so callers compute lanes once per page
 * instead of once per render.
 *
 * @param commits - Commits in display order.
 * @param previous - Lane state returned by the previous page, or undefined for the first page.
 * @returns One lane row per commit plus the state for the next page.
 */
export function assignGraphLanes(
  commits: readonly GraphCommit[],
  previous?: GraphLaneState,
): GraphLaneAssignment {
  const lanes: (string | null)[] = [...(previous?.lanes ?? [])];
  const rows: GraphLaneRow[] = [];

  for (const commit of commits) {
    rows.push(assignRow(lanes, commit));
    trimTrailingFreeLanes(lanes);
  }

  return { rows, state: { lanes: [...lanes] } };
}

/**
 * Assigns the cells of one commit row and advances the lane state.
 *
 * @param lanes - Mutable lane columns, updated in place.
 * @param commit - Commit for this row.
 * @returns The lane row.
 */
function assignRow(lanes: (string | null)[], commit: GraphCommit): GraphLaneRow {
  const before = [...lanes];
  const matching = findLanesExpecting(lanes, commit.oid);
  const nodeColumn = matching[0] ?? allocateFreeLane(lanes, 0);
  const converging = matching.slice(1);
  const diverging: number[] = [];

  lanes[nodeColumn] = commit.parents[0] ?? null;

  for (const parent of commit.parents.slice(1)) {
    const column = allocateFreeLane(lanes, nodeColumn + 1);

    lanes[column] = parent;
    diverging.push(column);
  }

  for (const column of converging) {
    lanes[column] = null;
  }

  return {
    oid: commit.oid,
    nodeColumn,
    cells: buildRowCells(before, lanes, nodeColumn, diverging, converging),
  };
}

/**
 * Lists the columns whose lane expects one commit.
 *
 * @param lanes - Current lane columns.
 * @param oid - Commit OID.
 * @returns Matching column indexes in ascending order.
 */
function findLanesExpecting(lanes: readonly (string | null)[], oid: string): readonly number[] {
  const columns: number[] = [];

  for (let index = 0; index < lanes.length; index += 1) {
    if (lanes[index] === oid) {
      columns.push(index);
    }
  }

  return columns;
}

/**
 * Allocates a free lane at or after one column.
 *
 * Existing free slots are reused before the row grows, and a new column is appended only when no
 * slot at or after the start is free.
 *
 * @param lanes - Mutable lane columns.
 * @param from - First column to consider.
 * @returns The allocated column index.
 */
function allocateFreeLane(lanes: (string | null)[], from: number): number {
  for (let index = from; index < lanes.length; index += 1) {
    if (lanes[index] === null) {
      return index;
    }
  }

  lanes.push(null);

  return lanes.length - 1;
}

/**
 * Builds the single-character cells of one row.
 *
 * The node marks the commit, a backslash marks each new parent lane, a slash marks each lane that
 * converges into the commit, and a vertical bar marks every lane that passes through unchanged.
 * Cells after the last used column are trimmed.
 *
 * @param before - Lane columns before the row was applied.
 * @param after - Lane columns after the row was applied.
 * @param nodeColumn - Column of the commit node.
 * @param diverging - Columns started by an additional parent.
 * @param converging - Columns that converged into the commit.
 * @returns One cell per used column.
 */
function buildRowCells(
  before: readonly (string | null)[],
  after: readonly (string | null)[],
  nodeColumn: number,
  diverging: readonly number[],
  converging: readonly number[],
): readonly string[] {
  const width = Math.max(before.length, after.length, nodeColumn + 1);
  const cells: string[] = [];

  for (let index = 0; index < width; index += 1) {
    cells.push(readCell(before, index, nodeColumn, diverging, converging));
  }

  while (cells.length > nodeColumn + 1 && cells.at(-1) === EMPTY_CELL) {
    cells.pop();
  }

  return cells;
}

/**
 * Reads one row cell.
 *
 * @param before - Lane columns before the row was applied.
 * @param index - Column index.
 * @param nodeColumn - Column of the commit node.
 * @param diverging - Columns started by an additional parent.
 * @param converging - Columns that converged into the commit.
 * @returns The cell character.
 */
function readCell(
  before: readonly (string | null)[],
  index: number,
  nodeColumn: number,
  diverging: readonly number[],
  converging: readonly number[],
): string {
  if (index === nodeColumn) {
    return NODE_CELL;
  }

  if (diverging.includes(index)) {
    return DIVERGE_CELL;
  }

  if (converging.includes(index)) {
    return CONVERGE_CELL;
  }

  return before[index] === null || before[index] === undefined ? EMPTY_CELL : VERTICAL_CELL;
}

/**
 * Removes free lanes at the end of the state.
 *
 * Only trailing free lanes are removed, so every live lane keeps its column and the next page sees
 * the same columns. A hole between live lanes is kept as a space cell.
 *
 * @param lanes - Mutable lane columns.
 */
function trimTrailingFreeLanes(lanes: (string | null)[]): void {
  while (lanes.at(-1) === null) {
    lanes.pop();
  }
}
