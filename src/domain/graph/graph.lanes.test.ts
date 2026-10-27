import { describe, expect, it } from "bun:test";
import { assignGraphLanes } from "@/domain/graph/graph.lanes";
import type { GraphCommit, GraphLaneCell, GraphLaneRow } from "@/domain/graph/graph.types";

/**
 * Builds a commit row for lane assignment.
 *
 * @param oid - Commit OID.
 * @param parents - Parent OIDs.
 * @returns The commit.
 */
function commit(oid: string, parents: readonly string[] = []): GraphCommit {
  return { oid, parents };
}

/**
 * Reads the connected edges of one cell as a stable string.
 *
 * @param cell - Graph cell.
 * @returns Edge names joined by `+`, or `none`.
 */
function readEdges(cell: GraphLaneCell): string {
  const edges = [
    cell.up ? "up" : "",
    cell.down ? "down" : "",
    cell.left ? "left" : "",
    cell.right ? "right" : "",
  ].filter((edge) => edge.length > 0);

  return edges.length === 0 ? "none" : edges.join("+");
}

/**
 * Reports whether a continuation cell is a vertical lane.
 *
 * @param cell - Graph cell.
 * @returns True for a cell with a top and bottom edge and no horizontal edge.
 */
function isVertical(cell: GraphLaneCell): boolean {
  return cell.up && cell.down && !cell.left && !cell.right;
}

/**
 * Reads the commit line of one row as edge strings.
 *
 * @param row - Lane row.
 * @returns One edge string per cell.
 */
function readRowEdges(row: GraphLaneRow | undefined): readonly string[] {
  return (row?.cells ?? []).map(readEdges);
}

describe("assignGraphLanes", () => {
  it("keeps linear history in one lane and continues it below every commit", () => {
    const assignment = assignGraphLanes([commit("A", ["B"]), commit("B", ["C"]), commit("C")]);

    expect(assignment.rows.map((row) => row.nodeColumn)).toEqual([0, 0, 0]);
    expect(assignment.rows.map((row) => row.cells.length)).toEqual([1, 1, 1]);
    expect(assignment.rows.map((row) => row.below.map(isVertical))).toEqual([
      [true],
      [true],
      [false],
    ]);
    expect(assignment.rows.map((row) => row.cells[0]?.kind)).toEqual([
      "commit",
      "commit",
      "commit",
    ]);
    expect(assignment.state.lanes).toEqual([]);
  });

  it("starts a new lane for a branch tip that no lane expects", () => {
    const assignment = assignGraphLanes([commit("A", ["B"]), commit("X", ["Y"])]);

    expect(assignment.rows[0]?.nodeColumn).toBe(0);
    expect(readRowEdges(assignment.rows[0])).toEqual(["down"]);
    expect(assignment.rows[1]?.nodeColumn).toBe(1);
    expect(readRowEdges(assignment.rows[1])).toEqual(["up+down", "down"]);
    expect(assignment.rows[1]?.below.map(isVertical)).toEqual([true, true]);
    expect(assignment.state.lanes).toEqual(["B", "Y"]);
  });

  it("draws a merge fork to the right and a join back into the node", () => {
    const assignment = assignGraphLanes([
      commit("A", ["B", "C"]),
      commit("B", ["D"]),
      commit("C", ["D"]),
      commit("D"),
    ]);

    expect(assignment.rows[0]?.nodeColumn).toBe(0);
    expect(readRowEdges(assignment.rows[0])).toEqual(["down+right", "down+left"]);
    expect(assignment.rows[0]?.cells.map((cell) => cell.kind)).toEqual(["merge", "line"]);
    expect(assignment.rows[2]?.nodeColumn).toBe(1);
    expect(readRowEdges(assignment.rows[2])).toEqual(["up+down", "up+down"]);
    expect(assignment.rows[3]?.nodeColumn).toBe(0);
    expect(readRowEdges(assignment.rows[3])).toEqual(["up+right", "up+left"]);
    expect(assignment.rows[3]?.below.map(isVertical)).toEqual([false, false]);
    expect(assignment.state.lanes).toEqual([]);
  });

  it("joins a branch with a horizontal run and keeps the freed column free", () => {
    const assignment = assignGraphLanes([
      commit("A", ["B", "C"]),
      commit("B", ["D"]),
      commit("C", ["D"]),
      commit("D", ["E"]),
    ]);

    // Both lanes expected D: one rejoins the node from the right and the other continues below it.
    expect(readRowEdges(assignment.rows[3])).toEqual(["up+down+right", "up+left"]);
    expect(assignment.rows[3]?.below.map(isVertical)).toEqual([true, false]);
    expect(assignment.state.lanes).toEqual(["E"]);
  });

  it("draws one fork cell per parent for an octopus merge", () => {
    const assignment = assignGraphLanes([commit("A", ["B", "C", "D", "E"])]);

    expect(readRowEdges(assignment.rows[0])).toEqual([
      "down+right",
      "down+left+right",
      "down+left+right",
      "down+left",
    ]);
    expect(assignment.rows[0]?.below.map(isVertical)).toEqual([true, true, true, true]);
    expect(assignment.state.lanes).toEqual(["B", "C", "D", "E"]);
  });

  it("keeps disconnected lanes apart and fills a hole below the node", () => {
    const disconnected = assignGraphLanes([
      commit("A", ["A1"]),
      commit("X", ["X1"]),
      commit("X1"),
      commit("A1"),
    ]);

    expect(disconnected.rows.map((row) => row.nodeColumn)).toEqual([0, 1, 1, 0]);
    expect(disconnected.rows[3]?.cells.length).toBe(1);
    expect(disconnected.rows[3]?.below.map(isVertical)).toEqual([false]);

    const hole = assignGraphLanes([commit("A", ["B", "C"]), commit("B"), commit("C")]);

    expect(readRowEdges(hole.rows[1])).toEqual(["up", "up+down"]);
    expect(hole.rows[1]?.below.map(isVertical)).toEqual([false, true]);
    expect(hole.rows[2]?.nodeColumn).toBe(1);
  });

  it("carries lane continuity across a page boundary", () => {
    const first = assignGraphLanes([commit("A", ["B", "C"]), commit("B", ["D"])]);
    const second = assignGraphLanes([commit("C", ["D"]), commit("D")], first.state);

    expect(first.state.lanes).toEqual(["D", "C"]);
    expect(readRowEdges(first.rows[0])).toEqual(["down+right", "down+left"]);
    expect(first.rows[1]?.below.map(isVertical)).toEqual([true, true]);
    expect(second.rows[0]?.nodeColumn).toBe(1);
    expect(readRowEdges(second.rows[0])).toEqual(["up+down", "up+down"]);
    expect(readRowEdges(second.rows[1])).toEqual(["up+right", "up+left"]);
    expect(second.state.lanes).toEqual([]);
  });
});
