import { describe, expect, it, setSystemTime } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import type { GraphRow } from "@/domain/graph/graph.types";
import { CommitRow } from "@/features/graph/CommitRow";
import type { CommitRowView } from "@/features/graph/graph.types";
import { ShellTestProviders } from "@/test/shell.harness";

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
 * Builds one prepared row view.
 *
 * @param row - Parsed row.
 * @param lanes - Lane cells.
 * @returns The prepared view.
 */
function view(row: GraphRow, lanes: readonly string[] = ["*"]): CommitRowView {
  return { kind: "commit", id: row.oid, row, lanes, nodeColumn: 0 };
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
  it("renders lane cells, the selection marker, subject, and file count", async () => {
    const row = graphRow({ subject: "Merge pull request #4", fileCount: 17 });
    const setup = await renderRow(view(row, ["*", "|", "\\"]));
    const frame = setup.captureCharFrame();

    expect(frame).toContain(">");
    expect(frame).toContain("*");
    expect(frame).toContain("|");
    expect(frame).toContain("\\");
    expect(frame).toContain("Merge pull request #4");
    expect(frame).toContain("17");

    await act(async () => {
      await setup.dispose();
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

  it("formats today as local time, the current year as day and month, and older as a year too", async () => {
    setSystemTime(new Date(2026, 9, 25, 14, 0).getTime());

    const today = await renderRow(
      view(
        graphRow({ committerTimestamp: Math.floor(new Date(2026, 9, 25, 9, 30).getTime() / 1000) }),
      ),
    );
    expect(today.captureCharFrame()).toContain("09:30");
    await act(async () => {
      await today.dispose();
    });

    const thisYear = await renderRow(
      view(
        graphRow({ committerTimestamp: Math.floor(new Date(2026, 7, 11, 8, 0).getTime() / 1000) }),
      ),
    );
    expect(thisYear.captureCharFrame()).toContain("11 Aug");
    await act(async () => {
      await thisYear.dispose();
    });

    const older = await renderRow(
      view(
        graphRow({ committerTimestamp: Math.floor(new Date(2025, 7, 11, 8, 0).getTime() / 1000) }),
      ),
    );
    expect(older.captureCharFrame()).toContain("11 Aug 2025");
    await act(async () => {
      await older.dispose();
    });

    setSystemTime();
  });
});
