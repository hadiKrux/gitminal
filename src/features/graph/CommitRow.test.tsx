import { describe, expect, it, setSystemTime } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import type { GraphLaneCell, GraphRow } from "@/domain/graph/graph.types";
import { CommitRow } from "@/features/graph/CommitRow";
import type { CommitRowView } from "@/features/graph/graph.types";
import { ShellTestProviders } from "@/test/shell.harness";
import { ICONS } from "@/theme/icons";

/**
 * Builds one parsed commit row.
 *
 * @param overrides - Fields to override.
 * @returns The commit row.
 */
function graphRow(overrides: Partial<GraphRow> = {}): GraphRow {
  return {
    oid: "a".repeat(40),
    parents: [],
    authorName: "Alice Ng",
    authorEmail: "alice@example.com",
    authorDate: "2026-10-25T09:30:00+00:00",
    committerTimestamp: Math.floor(new Date(2026, 9, 25, 9, 30).getTime() / 1000),
    decorations: [],
    subject: "Add the commit graph",
    body: "",
    fileCount: 3,
    additions: 10,
    deletions: 2,
    files: [],
    ...overrides,
  };
}

/**
 * Builds one graph cell.
 *
 * @param overrides - Edge, kind, and lane overrides.
 * @returns The graph cell.
 */
function cell(overrides: Partial<GraphLaneCell> = {}): GraphLaneCell {
  return { up: false, down: false, left: false, right: false, kind: "line", lane: 0, ...overrides };
}

/**
 * Builds a commit cell with a lane continuing below it.
 *
 * @param overrides - Edge and lane overrides.
 * @returns The commit cell.
 */
function commitCell(overrides: Partial<GraphLaneCell> = {}): GraphLaneCell {
  return cell({ down: true, kind: "commit", ...overrides });
}

/**
 * Builds a vertical continuation cell.
 *
 * @param lane - Lane identity for coloring.
 * @returns The continuation cell.
 */
function verticalCell(lane: number = 0): GraphLaneCell {
  return cell({ up: true, down: true, lane });
}

/**
 * Builds one prepared row view.
 *
 * @param row - Parsed row.
 * @param lanes - Lane cells.
 * @param below - Continuation lane cells.
 * @returns The prepared view.
 */
function view(
  row: GraphRow,
  lanes: readonly GraphLaneCell[] = [commitCell()],
  below: readonly GraphLaneCell[] = [],
): CommitRowView {
  return { kind: "commit", id: row.oid, row, lanes, below, nodeColumn: 0 };
}

/**
 * Renders one commit row.
 *
 * @param commitView - Prepared row.
 * @param options - Width and selection flags.
 * @returns The renderer setup.
 */
async function renderRow(
  commitView: CommitRowView,
  options: {
    readonly width?: number;
    readonly terminalWidth?: number;
    readonly selected?: boolean;
  } = {},
): Promise<Awaited<ReturnType<typeof testRender>>> {
  const width = options.width ?? 80;
  const terminalWidth = options.terminalWidth ?? width;
  const setup = await testRender(
    <ShellTestProviders>
      <box flexDirection="column" width={width} height={4}>
        <CommitRow
          view={commitView}
          width={width}
          selected={options.selected ?? true}
          focused={options.selected ?? true}
        />
      </box>
    </ShellTestProviders>,
    { width: terminalWidth, height: 5 },
  );

  await act(async () => {
    await setup.renderOnce();
  });

  return setup;
}

describe("CommitRow", () => {
  it("renders lane cells, subject, and file count without a selection marker", async () => {
    const row = graphRow({ subject: "Merge pull request #4", fileCount: 17 });
    const setup = await renderRow(
      view(
        row,
        [commitCell({ right: true }), cell({ down: true, left: true, lane: 1 })],
        [verticalCell(0), verticalCell(1)],
      ),
    );
    const frame = setup.captureCharFrame();
    const firstLine = frame.split("\n")[0] ?? "";

    expect(
      firstLine.startsWith(`${ICONS.graphCommit}${ICONS.graphHorizontal}${ICONS.graphDownLeft}`),
    ).toBe(true);
    expect(frame).not.toContain(">");
    expect(frame).toContain(ICONS.graphVertical);
    expect(frame).toContain("Merge pull request #4");
    expect(frame).toContain("17");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("continues the live lanes on the metadata line", async () => {
    const row = graphRow({ subject: "Merge work", authorName: "Alice Ng", decorations: [] });
    const setup = await renderRow(view(row, [commitCell()], [verticalCell()]), { width: 60 });
    const lines = setup.captureCharFrame().split("\n");

    expect(lines[0]?.startsWith(`${ICONS.graphCommit} Merge work`)).toBe(true);
    expect(lines[1]?.startsWith(`${ICONS.graphVertical} Alice Ng`)).toBe(true);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("starts the text right after the row's own lane grid", async () => {
    const narrow = await renderRow(
      view(graphRow({ subject: "One lane" }), [commitCell()], [verticalCell()]),
      { width: 60 },
    );
    const wide = await renderRow(
      view(
        graphRow({ subject: "Three lanes" }),
        [
          commitCell({ right: true }),
          cell({ down: true, left: true, right: true, lane: 1 }),
          cell({ down: true, left: true, lane: 2 }),
        ],
        [verticalCell(0), verticalCell(1), verticalCell(2)],
      ),
      { width: 60 },
    );
    const narrowLines = narrow.captureCharFrame().split("\n");
    const wideLines = wide.captureCharFrame().split("\n");

    // One lane is two cells, three lanes are six, so the branch row is indented four cells further.
    expect(narrowLines[0]?.indexOf("One lane")).toBe(2);
    expect(narrowLines[1]?.indexOf("Alice Ng")).toBe(2);
    expect(wideLines[0]?.indexOf("Three lanes")).toBe(6);
    expect(wideLines[1]?.indexOf("Alice Ng")).toBe(6);
    expect(narrowLines[1]?.startsWith(ICONS.graphVertical)).toBe(true);

    await act(async () => {
      await narrow.dispose();
      await wide.dispose();
    });
  });

  it("truncates the subject without hiding the file count", async () => {
    const subject = "x".repeat(100);
    const setup = await renderRow(view(graphRow({ subject, fileCount: 8 })), { width: 50 });
    const frame = setup.captureCharFrame();

    expect(frame).toContain("...");
    expect(frame).not.toContain(subject);
    expect(frame).toContain("8");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("budgets the row from its container width when the terminal is wider", async () => {
    const subject = "A very long commit subject that must truncate inside the graph panel";
    const setup = await renderRow(
      view(graphRow({ subject, fileCount: 42, decorations: ["refs/heads/main"] })),
      { width: 40, terminalWidth: 80 },
    );
    const frame = setup.captureCharFrame();
    const subjectLine = frame.split("\n")[0] ?? "";

    expect(frame).toContain("...");
    expect(frame).not.toContain(subject);
    expect(subjectLine.trimEnd().endsWith("42")).toBe(true);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("orders badges tag, then local, then remote", async () => {
    const setup = await renderRow(
      view(
        graphRow({
          decorations: [
            "refs/remotes/origin/remoteone",
            "refs/heads/localone",
            "tag: refs/tags/tagone",
          ],
        }),
      ),
      { width: 80 },
    );
    const frame = setup.captureCharFrame();
    const tagIndex = frame.indexOf("tagone");
    const localIndex = frame.indexOf("localone");
    const remoteIndex = frame.indexOf("remoteone");

    expect(tagIndex).toBeGreaterThan(-1);
    expect(localIndex).toBeGreaterThan(tagIndex);
    expect(remoteIndex).toBeGreaterThan(localIndex);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("shows the first badges and a +N overflow marker when space is tight", async () => {
    const decorations = Array.from({ length: 12 }, (_, index) => `refs/heads/branch${index}`);
    const setup = await renderRow(view(graphRow({ decorations })), { width: 46 });
    const frame = setup.captureCharFrame();

    expect(frame).toMatch(/\+\d+/);
    expect(frame).toContain("branch0");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("separates the author from an overflow-only badge group", async () => {
    const decorations = Array.from({ length: 4 }, (_, index) => `refs/heads/branch${index}`);
    const setup = await renderRow(view(graphRow({ decorations, authorName: "Alice Ng" })), {
      width: 16,
    });
    const metadataLine = setup.captureCharFrame().split("\n")[1] ?? "";

    expect(metadataLine).toContain("+4 Alice Ng");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("keeps author names up to twelve characters and shortens longer names", async () => {
    const short = await renderRow(view(graphRow({ authorName: "John Doe" })));
    expect(short.captureCharFrame()).toContain("John Doe");
    await act(async () => {
      await short.dispose();
    });

    const initials = await renderRow(view(graphRow({ authorName: "Alexandria Smith" })));
    expect(initials.captureCharFrame()).toContain("AS");
    await act(async () => {
      await initials.dispose();
    });

    const single = await renderRow(view(graphRow({ authorName: "Extraordinarily" })));
    expect(single.captureCharFrame()).toContain("EX");
    await act(async () => {
      await single.dispose();
    });
  });

  it("shows a twelve-hour time with the compact date for each commit", async () => {
    setSystemTime(new Date(2026, 9, 25, 14, 0).getTime());

    const today = await renderRow(
      view(
        graphRow({ committerTimestamp: Math.floor(new Date(2026, 9, 25, 9, 30).getTime() / 1000) }),
      ),
    );
    expect(today.captureCharFrame()).toContain("9:30 AM");
    await act(async () => {
      await today.dispose();
    });

    const thisYear = await renderRow(
      view(
        graphRow({ committerTimestamp: Math.floor(new Date(2026, 7, 11, 8, 0).getTime() / 1000) }),
      ),
    );
    expect(thisYear.captureCharFrame()).toContain("11 Aug 8:00 AM");
    await act(async () => {
      await thisYear.dispose();
    });

    const older = await renderRow(
      view(
        graphRow({ committerTimestamp: Math.floor(new Date(2025, 7, 11, 8, 0).getTime() / 1000) }),
      ),
    );
    expect(older.captureCharFrame()).toContain("11 Aug 2025 8:00 AM");
    await act(async () => {
      await older.dispose();
    });

    setSystemTime();
  });
});
