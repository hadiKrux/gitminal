import type {
  GraphCommit,
  GraphLaneAssignment,
  GraphLaneCell,
  GraphLaneRow,
  GraphLaneState,
} from "./graph.types";

/** How one pipe behaves at the commit row it was built for. */
type PipeKind = "terminates" | "starts" | "continues";

/**
 * One graph edge segment within a single commit row.
 *
 * A pipe starts at `fromPos` on the top edge of the row and ends at `toPos` on the bottom edge, so a
 * pipe whose positions differ draws a horizontal run across the gutter. `toHash` is the commit the
 * lane expects below the row, or null for the first-parent pipe of a root commit, which has no line
 * below it. `lane` carries the originating lane for per-branch coloring.
 */
interface Pipe {
  readonly fromPos: number;
  readonly toPos: number;
  readonly toHash: string | null;
  readonly kind: PipeKind;
  readonly lane: number;
}

/** Sort order of pipe kinds, matching the row renderer's bottom-to-top priority. */
const PIPE_KIND_ORDER: Readonly<Record<PipeKind, number>> = Object.freeze({
  terminates: 0,
  starts: 1,
  continues: 2,
});

/** Empty cell with no line connections. */
const EMPTY_CELL: GraphLaneCell = Object.freeze({
  up: false,
  down: false,
  left: false,
  right: false,
  kind: "line",
  lane: 0,
});

/**
 * Assigns graph lanes for one ordered page of commits.
 *
 * This is the lazygit pipe model. Each row turns the incoming pipes into the outgoing pipes: a lane
 * that expects the current commit terminates into the node, a lane that passes the node stays live
 * and moves left into any free column before the node, and every additional parent of a merge
 * starts a new lane. The node takes the leftmost pipe that expects it, so a branch is joined by a
 * horizontal run rather than by a jump. Passing the returned state into the next page keeps the
 * columns continuous across a page boundary.
 *
 * Each row carries the geometry of the commit line and of the continuation line below it. The UI
 * maps that geometry onto box-drawing glyphs, so the engine stays pure and never knows a glyph.
 *
 * @param commits - Commits in display order.
 * @param previous - Lane state returned by the previous page, or undefined for the first page.
 * @returns One lane row per commit plus the state for the next page.
 */
export function assignGraphLanes(
  commits: readonly GraphCommit[],
  previous?: GraphLaneState,
): GraphLaneAssignment {
  let pipes = restorePipes(previous);
  const rows: GraphLaneRow[] = [];

  for (const commit of commits) {
    pipes = getNextPipes(pipes, commit);
    rows.push(renderRow(pipes, commit));
  }

  return { rows, state: { lanes: readLaneState(pipes) } };
}

/**
 * Rebuilds the pipes a previous page ended with.
 *
 * Only the column and the expected commit matter below a page boundary, so each live lane becomes a
 * continuing pipe in its own column. A page that starts on an empty window has no pipes.
 *
 * @param previous - Lane state returned by the previous page, or undefined.
 * @returns Incoming pipes in column order.
 */
function restorePipes(previous: GraphLaneState | undefined): readonly Pipe[] {
  const pipes: Pipe[] = [];

  for (let column = 0; column < (previous?.lanes.length ?? 0); column += 1) {
    const expected = previous?.lanes[column];

    if (expected !== null && expected !== undefined) {
      pipes.push({
        fromPos: column,
        toPos: column,
        toHash: expected,
        kind: "continues",
        lane: column,
      });
    }
  }

  return pipes;
}

/**
 * Reads the lane state to carry into the next page.
 *
 * Terminating pipes end at the current commit and have no meaning below the page, and a root
 * commit's pipe to no parent leaves the lane free. Every other pipe keeps its expected commit.
 * Trailing free columns are trimmed while a hole between live lanes keeps its place.
 *
 * @param pipes - Pipes after the last rendered row.
 * @returns One expected commit or null per lane column.
 */
function readLaneState(pipes: readonly Pipe[]): readonly (string | null)[] {
  let width = 0;

  for (const pipe of pipes) {
    width = Math.max(width, pipe.toPos + 1);
  }

  const lanes: (string | null)[] = Array.from({ length: width }, () => null);

  for (const pipe of pipes) {
    if (pipe.kind !== "terminates" && pipe.toHash !== null) {
      lanes[pipe.toPos] = pipe.toHash;
    }
  }

  while (lanes.at(-1) === null) {
    lanes.pop();
  }

  return lanes;
}

/**
 * Builds the pipes of one commit row.
 *
 * The port follows lazygit's lane assignment: the node takes the leftmost pipe expecting its OID,
 * terminating pipes bend into the node, pipes left of the node move to the nearest free column,
 * merge parents take fresh columns, and pipes right of the node slide left into any gap. Tracking
 * which columns are taken or traversed is what stops two lines from occupying one cell.
 *
 * @param previous - Pipes entering the row from above.
 * @param commit - Commit for this row.
 * @returns The pipes leaving the row.
 */
function getNextPipes(previous: readonly Pipe[], commit: GraphCommit): readonly Pipe[] {
  const current = previous.filter(isLivePipe);
  const position = readNodePosition(current, commit.oid);
  const columns: PipeColumns = {
    taken: new Set<number>([position]),
    traversed: new Set<number>(),
    continuing: readContinuingPositions(current, commit.oid),
  };
  const pipes: Pipe[] = [
    {
      fromPos: position,
      toPos: position,
      toHash: commit.parents[0] ?? null,
      kind: "starts",
      lane: position,
    },
    ...readJoiningPipes(current, commit, position, columns),
    ...readMergePipes(commit, position, columns),
    ...readShiftingPipes(current, commit, position, columns),
  ];

  return pipes.sort(comparePipes);
}

/** Mutable column bookkeeping shared by the steps of one commit row. */
interface PipeColumns {
  /** Columns a pipe already lands on. */
  readonly taken: Set<number>;
  /** Columns a pipe already starts on, ends on, or crosses. */
  readonly traversed: Set<number>;
  /** Columns a live pipe occupies before the row is applied. */
  readonly continuing: Set<number>;
}

/**
 * Reports whether a pipe from the previous row is still live.
 *
 * @param pipe - Pipe entering the row.
 * @returns True unless the pipe ended in the previous row or left the tree.
 */
function isLivePipe(pipe: Pipe): boolean {
  return pipe.kind !== "terminates" && pipe.toHash !== null;
}

/**
 * Reads the column the current commit occupies.
 *
 * A commit takes the leftmost live pipe that expects it, or a fresh column after the rightmost live
 * pipe when it starts a disconnected history.
 *
 * @param current - Live pipes entering the row.
 * @param oid - Commit OID.
 * @returns The node column.
 */
function readNodePosition(current: readonly Pipe[], oid: string): number {
  let maxPosition = -1;

  for (const pipe of current) {
    maxPosition = Math.max(maxPosition, pipe.toPos);

    if (pipe.toHash === oid) {
      return pipe.toPos;
    }
  }

  return maxPosition + 1;
}

/**
 * Reads the columns a continuing pipe occupies before the row is applied.
 *
 * @param current - Live pipes entering the row.
 * @param oid - Commit OID.
 * @returns Columns that must stay free for a pipe that does not end at this commit.
 */
function readContinuingPositions(current: readonly Pipe[], oid: string): Set<number> {
  const positions = new Set<number>();

  for (const pipe of current) {
    if (pipe.toHash !== oid) {
      positions.add(pipe.toPos);
    }
  }

  return positions;
}

/**
 * Builds the pipes that join the node and the pipes left of it that stay live.
 *
 * @param current - Live pipes entering the row.
 * @param commit - Commit for the row.
 * @param position - Node column.
 * @param columns - Mutable column bookkeeping.
 * @returns The joining and left-shifting pipes.
 */
function readJoiningPipes(
  current: readonly Pipe[],
  commit: GraphCommit,
  position: number,
  columns: PipeColumns,
): readonly Pipe[] {
  const pipes: Pipe[] = [];

  for (const pipe of current) {
    if (pipe.toHash === commit.oid) {
      pipes.push({
        fromPos: pipe.toPos,
        toPos: position,
        toHash: pipe.toHash,
        kind: "terminates",
        lane: pipe.lane,
      });
      traverse(columns, pipe.toPos, position);
    } else if (pipe.toPos < position) {
      const available = readNextPositionForContinuing(columns.traversed);

      pipes.push({
        fromPos: pipe.toPos,
        toPos: available,
        toHash: pipe.toHash,
        kind: "continues",
        lane: pipe.lane,
      });
      traverse(columns, pipe.toPos, available);
    }
  }

  return pipes;
}

/**
 * Builds one pipe per additional parent of a merge.
 *
 * @param commit - Commit for the row.
 * @param position - Node column.
 * @param columns - Mutable column bookkeeping.
 * @returns The new branch pipes.
 */
function readMergePipes(
  commit: GraphCommit,
  position: number,
  columns: PipeColumns,
): readonly Pipe[] {
  const pipes: Pipe[] = [];

  for (const parent of commit.parents.slice(1)) {
    const available = readNextPositionForNew(columns);

    pipes.push({
      fromPos: position,
      toPos: available,
      toHash: parent,
      kind: "starts",
      lane: available,
    });
    columns.taken.add(available);
  }

  return pipes;
}

/**
 * Builds the pipes right of the node that slide left into any free column.
 *
 * @param current - Live pipes entering the row.
 * @param commit - Commit for the row.
 * @param position - Node column.
 * @param columns - Mutable column bookkeeping.
 * @returns The shifted continuing pipes.
 */
function readShiftingPipes(
  current: readonly Pipe[],
  commit: GraphCommit,
  position: number,
  columns: PipeColumns,
): readonly Pipe[] {
  const pipes: Pipe[] = [];

  for (const pipe of current) {
    if (pipe.toHash === commit.oid || pipe.toPos <= position) {
      continue;
    }

    const last = readLeftmostFreePosition(pipe.toPos, position, columns);

    pipes.push({
      fromPos: pipe.toPos,
      toPos: last,
      toHash: pipe.toHash,
      kind: "continues",
      lane: pipe.lane,
    });
    traverse(columns, pipe.toPos, last);
  }

  return pipes;
}

/**
 * Reads the first column a continuing pipe may move into.
 *
 * @param traversed - Columns already crossed by another pipe.
 * @returns The leftmost free column.
 */
function readNextPositionForContinuing(traversed: ReadonlySet<number>): number {
  let column = 0;

  while (traversed.has(column)) {
    column += 1;
  }

  return column;
}

/**
 * Reads the first column a new branch lane may start in.
 *
 * @param columns - Mutable column bookkeeping.
 * @returns The leftmost column that is neither taken nor reserved for a continuing pipe.
 */
function readNextPositionForNew(columns: PipeColumns): number {
  let column = 0;

  while (columns.taken.has(column) || columns.continuing.has(column)) {
    column += 1;
  }

  return column;
}

/**
 * Reads how far one pipe may slide left before it hits a taken or traversed column.
 *
 * @param from - Column the pipe currently occupies.
 * @param position - Node column, the leftmost column it may approach.
 * @param columns - Mutable column bookkeeping.
 * @returns The column the pipe lands on.
 */
function readLeftmostFreePosition(from: number, position: number, columns: PipeColumns): number {
  let last = from;

  for (let column = from; column > position; column -= 1) {
    if (columns.taken.has(column) || columns.traversed.has(column)) {
      break;
    }

    last = column;
  }

  return last;
}

/**
 * Marks every column a pipe crosses and the column it lands on.
 *
 * @param columns - Mutable column bookkeeping.
 * @param from - Column the pipe starts in.
 * @param to - Column the pipe ends in.
 */
function traverse(columns: PipeColumns, from: number, to: number): void {
  for (let column = Math.min(from, to); column <= Math.max(from, to); column += 1) {
    columns.traversed.add(column);
  }

  columns.taken.add(to);
}

/**
 * Orders pipes by their landing column, then by kind.
 *
 * @param left - First pipe.
 * @param right - Second pipe.
 * @returns The sort order.
 */
function comparePipes(left: Pipe, right: Pipe): number {
  return left.toPos - right.toPos || PIPE_KIND_ORDER[left.kind] - PIPE_KIND_ORDER[right.kind];
}

/**
 * Renders the cells of one commit row from its pipes.
 *
 * A pipe that starts and ends in different columns paints a horizontal run across every column it
 * crosses: the two end cells connect inward and the cells between connect on both sides. A pipe
 * that does not terminate connects its end cell downward, and a pipe that does not start connects
 * its start cell upward. The node cell becomes a commit or merge cell, and the continuation line
 * carries every lane that stays live below the row.
 *
 * @param pipes - Pipes leaving the row.
 * @param commit - Commit for this row.
 * @returns The lane row.
 */
function renderRow(pipes: readonly Pipe[], commit: GraphCommit): GraphLaneRow {
  const cells: MutableGraphLaneCell[] = [];
  let nodeColumn = 0;

  for (const pipe of pipes) {
    if (pipe.kind === "starts") {
      nodeColumn = pipe.fromPos;
    } else if (pipe.kind === "terminates") {
      nodeColumn = pipe.toPos;
    }

    ensureCells(cells, Math.max(pipe.fromPos, pipe.toPos) + 1);
  }

  ensureCells(cells, nodeColumn + 1);

  for (const pipe of pipes) {
    paintPipe(cells, pipe);
  }

  const node = readCell(cells, nodeColumn);

  node.kind = commit.parents.length > 1 ? "merge" : "commit";
  node.lane = nodeColumn;

  for (const pipe of pipes) {
    if (pipe.kind === "starts" && pipe.toHash === null) {
      readCell(cells, pipe.toPos).down = false;
    }
  }

  const below = buildContinuationCells(pipes, cells.length);

  return {
    oid: commit.oid,
    nodeColumn,
    cells: cells.map(freezeCell),
    below,
  };
}

/** Mutable cell used while one row's pipes are painted. */
interface MutableGraphLaneCell {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  kind: GraphLaneCell["kind"];
  lane: number;
}

/**
 * Paints one pipe into the row cells.
 *
 * @param cells - Mutable row cells, already wide enough for the pipe.
 * @param pipe - Pipe to paint.
 */
function paintPipe(cells: MutableGraphLaneCell[], pipe: Pipe): void {
  const left = Math.min(pipe.fromPos, pipe.toPos);
  const right = Math.max(pipe.fromPos, pipe.toPos);

  if (left !== right) {
    for (let column = left + 1; column < right; column += 1) {
      const cell = readCell(cells, column);

      cell.left = true;
      cell.right = true;
      cell.lane = pipe.lane;
    }

    const leftCell = readCell(cells, left);

    leftCell.right = true;
    leftCell.lane = pipe.lane;

    const rightCell = readCell(cells, right);

    rightCell.left = true;
    rightCell.lane = pipe.lane;
  }

  if (pipe.kind !== "terminates") {
    const target = readCell(cells, pipe.toPos);

    target.down = true;
    target.lane = pipe.lane;
  }

  if (pipe.kind !== "starts") {
    readCell(cells, pipe.fromPos).up = true;
  }
}

/**
 * Builds the continuation line that sits below one commit row.
 *
 * Only lanes that stay live below the row get a vertical cell. A terminating lane has ended in the
 * node and a root commit's parent lane has no line below it, so both stay empty.
 *
 * @param pipes - Pipes leaving the row.
 * @param width - Number of lane columns on the commit line.
 * @returns One cell per lane column.
 */
function buildContinuationCells(pipes: readonly Pipe[], width: number): readonly GraphLaneCell[] {
  const cells: GraphLaneCell[] = Array.from({ length: width }, () => EMPTY_CELL);

  for (const pipe of pipes) {
    if (pipe.kind === "terminates" || pipe.toHash === null) {
      continue;
    }

    cells[pipe.toPos] = {
      up: true,
      down: true,
      left: false,
      right: false,
      kind: "line",
      lane: pipe.lane,
    };
  }

  return cells;
}

/**
 * Grows the mutable cell list to one width.
 *
 * @param cells - Mutable row cells.
 * @param width - Required number of columns.
 */
function ensureCells(cells: MutableGraphLaneCell[], width: number): void {
  while (cells.length < width) {
    cells.push(createCell());
  }
}

/**
 * Reads one mutable cell, creating it when the index is not allocated yet.
 *
 * @param cells - Mutable row cells.
 * @param index - Column index.
 * @returns The cell at that column.
 */
function readCell(cells: MutableGraphLaneCell[], index: number): MutableGraphLaneCell {
  const cell = cells[index];

  if (cell !== undefined) {
    return cell;
  }

  const created = createCell();

  cells[index] = created;

  return created;
}

/**
 * Creates one empty mutable cell.
 *
 * @returns The empty cell.
 */
function createCell(): MutableGraphLaneCell {
  return { up: false, down: false, left: false, right: false, kind: "line", lane: 0 };
}

/**
 * Freezes one painted cell.
 *
 * @param cell - Mutable cell.
 * @returns The read-only cell.
 */
function freezeCell(cell: MutableGraphLaneCell): GraphLaneCell {
  return Object.freeze({
    up: cell.up,
    down: cell.down,
    left: cell.left,
    right: cell.right,
    kind: cell.kind,
    lane: cell.lane,
  });
}
