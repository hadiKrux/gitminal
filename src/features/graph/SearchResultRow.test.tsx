import { describe, expect, it } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import type { GraphRow } from "@/domain/graph/graph.types";
import type { SearchResultView } from "@/features/graph/graph.types";
import { SearchResultRow } from "@/features/graph/SearchResultRow";
import { ShellTestProviders } from "@/test/shell.harness";

/**
 * Builds one parsed commit row for a search result.
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
    subject: "Add the commit search",
    body: "",
    fileCount: 3,
    additions: 10,
    deletions: 2,
    files: [],
    ...overrides,
  };
}

/**
 * Builds one prepared search result.
 *
 * @param row - Parsed row.
 * @returns The prepared view.
 */
function view(row: GraphRow): SearchResultView {
  return { id: row.oid, row, snippet: null };
}

/**
 * Renders one search result row.
 *
 * @param result - Prepared result.
 * @param options - Container width, terminal width, and search terms.
 * @returns The renderer setup.
 */
async function renderResult(
  result: SearchResultView,
  options: {
    readonly width?: number;
    readonly terminalWidth?: number;
    readonly terms?: readonly string[];
  } = {},
): Promise<Awaited<ReturnType<typeof testRender>>> {
  const width = options.width ?? 80;
  const terminalWidth = options.terminalWidth ?? width;
  const setup = await testRender(
    <ShellTestProviders>
      <box flexDirection="column" width={width} height={4}>
        <SearchResultRow view={result} width={width} terms={options.terms ?? []} selected focused />
      </box>
    </ShellTestProviders>,
    { width: terminalWidth, height: 5 },
  );

  await act(async () => {
    await setup.renderOnce();
  });

  return setup;
}

describe("SearchResultRow", () => {
  it("renders the short hash, subject, file count, author, and date", async () => {
    const setup = await renderResult(view(graphRow({ subject: "Find this commit" })));
    const frame = setup.captureCharFrame();

    expect(frame).toContain("aaaaaaa");
    expect(frame).toContain("Find this commit");
    expect(frame).toContain("Alice Ng");
    expect(frame).toMatch(/25 Oct/);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("budgets the result from its container width when the terminal is wider", async () => {
    const subject = "A very long search result subject that must truncate inside the panel";
    const setup = await renderResult(view(graphRow({ subject, fileCount: 42 })), {
      width: 40,
      terminalWidth: 80,
    });
    const frame = setup.captureCharFrame();
    const subjectLine = frame.split("\n")[0] ?? "";

    expect(frame).toContain("...");
    expect(frame).not.toContain(subject);
    expect(subjectLine.trimEnd().endsWith("42")).toBe(true);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("renders the body snippet with a trailing marker when the match is in the body", async () => {
    const setup = await renderResult(
      {
        ...view(graphRow({ subject: "Subject only" })),
        snippet: { text: "body text with match", leadingEllipsis: false, trailingEllipsis: true },
      },
      { terms: ["match"] },
    );
    const frame = setup.captureCharFrame();

    expect(frame).toContain("body text with match");

    await act(async () => {
      await setup.dispose();
    });
  });
});
