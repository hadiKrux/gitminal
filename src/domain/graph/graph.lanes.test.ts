import { describe, expect, it } from "bun:test";
import { assignGraphLanes } from "@/domain/graph/graph.lanes";
import type { GraphCommit } from "@/domain/graph/graph.types";

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

describe("assignGraphLanes", () => {
  it("keeps linear history in one lane", () => {
    const assignment = assignGraphLanes([commit("A", ["B"]), commit("B", ["C"]), commit("C")]);

    expect(assignment.rows.map((row) => row.nodeColumn)).toEqual([0, 0, 0]);
    expect(assignment.rows.map((row) => row.cells)).toEqual([["*"], ["*"], ["*"]]);
    expect(assignment.state.lanes).toEqual([]);
  });

  it("starts a new lane for a branch tip that no lane expects", () => {
    const assignment = assignGraphLanes([commit("A", ["B"]), commit("X", ["Y"])]);

    expect(assignment.rows[0]).toEqual({ oid: "A", nodeColumn: 0, cells: ["*"] });
    expect(assignment.rows[1]).toEqual({ oid: "X", nodeColumn: 1, cells: ["|", "*"] });
    expect(assignment.state.lanes).toEqual(["B", "Y"]);
  });

  it("draws a merge edge and a branch node that converge on the shared parent", () => {
    const assignment = assignGraphLanes([
      commit("A", ["B", "C"]),
      commit("B", ["D"]),
      commit("C", ["D"]),
      commit("D"),
    ]);

    expect(assignment.rows[0]).toEqual({ oid: "A", nodeColumn: 0, cells: ["*", "\\"] });
    expect(assignment.rows[1]).toEqual({ oid: "B", nodeColumn: 0, cells: ["*", "|"] });
    expect(assignment.rows[2]).toEqual({ oid: "C", nodeColumn: 1, cells: ["|", "*"] });
    expect(assignment.rows[3]).toEqual({ oid: "D", nodeColumn: 0, cells: ["*", "/"] });
    expect(assignment.state.lanes).toEqual([]);
  });

  it("draws one edge per parent for an octopus merge", () => {
    const assignment = assignGraphLanes([commit("A", ["B", "C", "D", "E"])]);

    expect(assignment.rows[0]).toEqual({
      oid: "A",
      nodeColumn: 0,
      cells: ["*", "\\", "\\", "\\"],
    });
    expect(assignment.state.lanes).toEqual(["B", "C", "D", "E"]);
  });

  it("keeps disconnected lanes apart and preserves a hole between live lanes", () => {
    const disconnected = assignGraphLanes([
      commit("A", ["A1"]),
      commit("X", ["X1"]),
      commit("X1"),
      commit("A1"),
    ]);

    expect(disconnected.rows.map((row) => row.nodeColumn)).toEqual([0, 1, 1, 0]);
    expect(disconnected.rows[1]?.cells).toEqual(["|", "*"]);
    expect(disconnected.rows[2]?.cells).toEqual(["|", "*"]);
    expect(disconnected.rows[3]?.cells).toEqual(["*"]);

    const hole = assignGraphLanes([commit("A", ["B", "C"]), commit("B"), commit("C")]);

    expect(hole.rows[1]).toEqual({ oid: "B", nodeColumn: 0, cells: ["*", "|"] });
    expect(hole.rows[2]).toEqual({ oid: "C", nodeColumn: 1, cells: [" ", "*"] });
  });

  it("carries lane continuity across a page boundary", () => {
    const first = assignGraphLanes([commit("A", ["B", "C"]), commit("B", ["D"])]);
    const second = assignGraphLanes([commit("C", ["D"]), commit("D")], first.state);

    expect(first.state.lanes).toEqual(["D", "C"]);
    expect(first.rows[0]?.cells).toEqual(["*", "\\"]);
    expect(second.rows[0]).toEqual({ oid: "C", nodeColumn: 1, cells: ["|", "*"] });
    expect(second.rows[1]).toEqual({ oid: "D", nodeColumn: 0, cells: ["*", "/"] });
    expect(second.state.lanes).toEqual([]);
  });
});
