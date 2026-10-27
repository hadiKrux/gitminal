import { describe, expect, it } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import { DEFAULT_CONFIG } from "@/domain/config/config.defaults";
import type { GraphStyle } from "@/domain/config/config.types";
import { assignGraphLanes } from "@/domain/graph/graph.lanes";
import type { GraphLaneRow } from "@/domain/graph/graph.types";
import { GraphLanes } from "@/features/graph/GraphLanes";
import { ShellTestProviders } from "@/test/shell.harness";
import { ICONS } from "@/theme/icons";

const {
  graphCommit: c,
  graphMerge: m,
  graphVertical: v,
  graphHorizontal: h,
  graphUpLeft: ul,
  graphDownLeft: dl,
  graphDownRight: dr,
  graphTeeUp: tu,
  graphMergeSharp: ms,
  graphSharpUpLeft: sul,
  graphSharpDownLeft: sdl,
} = ICONS;

/** One commit fixture: a hash and its parents. */
interface GraphFixtureCommit {
  /** Commit hash. */
  readonly hash: string;
  /** Parent hashes. */
  readonly parents?: readonly string[];
}

/**
 * Builds a React key from the geometry of one lane row.
 *
 * @param row - Assigned lane row.
 * @returns A key that distinguishes rows even when a fixture repeats a hash.
 */
function readRowKey(row: GraphLaneRow): string {
  const signature = row.cells
    .map(
      (cell) =>
        `${cell.kind}${cell.up ? "u" : ""}${cell.down ? "d" : ""}${cell.left ? "l" : ""}${cell.right ? "r" : ""}`,
    )
    .join(",");

  return `${row.oid}:${row.nodeColumn}:${signature}`;
}

/**
 * Renders one assigned lane row per commit and returns the commit lines.
 *
 * @param commits - Commits in display order.
 * @param style - Graph glyph style, defaulting to the built-in rounded style.
 * @returns The rendered commit lines, trimmed at the right edge.
 */
async function renderGraphLines(
  commits: readonly GraphFixtureCommit[],
  style: GraphStyle = DEFAULT_CONFIG.graph.style,
): Promise<readonly string[]> {
  const assignment = assignGraphLanes(
    commits.map((entry) => ({ oid: entry.hash, parents: entry.parents ?? [] })),
  );
  const width = Math.max(...assignment.rows.map((row) => row.cells.length));
  const setup = await testRender(
    <ShellTestProviders config={{ ...DEFAULT_CONFIG, graph: { ...DEFAULT_CONFIG.graph, style } }}>
      <box flexDirection="column" width={40} height={commits.length + 1}>
        {assignment.rows.map((row) => (
          <GraphLanes key={readRowKey(row)} cells={row.cells} width={width} />
        ))}
      </box>
    </ShellTestProviders>,
    { width: 40, height: commits.length + 1 },
  );

  await act(async () => {
    await setup.renderOnce();
  });

  const lines = setup
    .captureCharFrame()
    .split("\n")
    .map((line) => line.trimEnd());

  await act(async () => {
    await setup.dispose();
  });

  return lines.slice(0, commits.length);
}

describe("GraphLanes", () => {
  it("renders lazygit's merge history with box-drawing connectors", async () => {
    const lines = await renderGraphLines([
      { hash: "1", parents: ["2"] },
      { hash: "2", parents: ["3"] },
      { hash: "3", parents: ["4"] },
      { hash: "4", parents: ["5", "7"] },
      { hash: "7", parents: ["5"] },
      { hash: "5", parents: ["8"] },
      { hash: "8", parents: ["9"] },
      { hash: "9", parents: ["A", "B"] },
      { hash: "B", parents: ["D"] },
      { hash: "D", parents: ["D"] },
      { hash: "A", parents: ["E"] },
      { hash: "E", parents: ["F"] },
      { hash: "F", parents: ["D"] },
      { hash: "D", parents: ["G"] },
    ]);

    expect(lines).toEqual([
      `${c}`,
      `${c}`,
      `${c}`,
      `${m}${h}${dl}`,
      `${v} ${c}`,
      `${c}${h}${ul}`,
      `${c}`,
      `${m}${h}${dl}`,
      `${v} ${c}`,
      `${v} ${c}`,
      `${c} ${v}`,
      `${c} ${v}`,
      `${c} ${v}`,
      `${c}${h}${ul}`,
    ]);
  });

  it("renders a lane that slides left into a free column", async () => {
    const lines = await renderGraphLines([
      { hash: "1", parents: ["2"] },
      { hash: "2", parents: ["3", "4"] },
      { hash: "4", parents: ["3", "5"] },
      { hash: "3", parents: ["5"] },
      { hash: "5", parents: ["6"] },
      { hash: "6", parents: ["7"] },
    ]);

    expect(lines).toEqual([
      `${c}`,
      `${m}${h}${dl}`,
      `${v} ${m}${h}${dl}`,
      `${c}${h}${ul} ${v}`,
      `${c}${h}${h}${h}${ul}`,
      `${c}`,
    ]);
  });

  it("renders a tees where several branches join the same commit", async () => {
    const lines = await renderGraphLines([
      { hash: "1", parents: ["2"] },
      { hash: "2", parents: ["3", "4"] },
      { hash: "3", parents: ["5", "4"] },
      { hash: "5", parents: ["7", "8"] },
      { hash: "7", parents: ["4", "A"] },
      { hash: "4", parents: ["B"] },
      { hash: "B", parents: ["C"] },
    ]);

    expect(lines).toEqual([
      `${c}`,
      `${m}${h}${dl}`,
      `${m}${h}${v}${h}${dl}`,
      `${m}${h}${v}${h}${v}${h}${dl}`,
      `${m}${h}${v}${h}${v}${h}${v}${h}${dl}`,
      `${c}${h}${tu}${h}${ul} ${v} ${v}`,
      `${c} ${dr}${h}${h}${h}${ul} ${v}`,
    ]);
  });

  it("renders the sharp style with WGL4 safe corners and an ASCII merge symbol", async () => {
    const lines = await renderGraphLines(
      [
        { hash: "1", parents: ["2"] },
        { hash: "2", parents: ["3"] },
        { hash: "3", parents: ["4"] },
        { hash: "4", parents: ["5", "7"] },
        { hash: "7", parents: ["5"] },
        { hash: "5", parents: ["8"] },
      ],
      "sharp",
    );

    expect(lines).toEqual([
      `${c}`,
      `${c}`,
      `${c}`,
      `${ms}${h}${sdl}`,
      `${v} ${c}`,
      `${c}${h}${sul}`,
    ]);
    expect(lines.join("\n")).not.toContain(dl);
  });
});
