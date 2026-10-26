import { describe, expect, it } from "bun:test";
import type { DiffSectionView, RepositorySnapshot } from "@/domain/repository/repository.types";
import {
  buildRows,
  countDiffLines,
  readReadOnlyTitle,
  readStatusLetter,
  shouldAutoCollapseDiff,
} from "@/features/diff/diff.rows";

/** One working section with two files. */
const SECTIONS: readonly DiffSectionView[] = [
  {
    section: "working",
    title: "Working Directory",
    paths: ["a.txt", "b.txt"],
    files: [
      {
        id: "working::a.txt",
        section: "working",
        statusLetter: "M",
        status: "modified",
        path: "a.txt",
        oldPath: null,
        conflicted: false,
      },
      {
        id: "working::b.txt",
        section: "working",
        statusLetter: "M",
        status: "modified",
        path: "b.txt",
        oldPath: null,
        conflicted: false,
      },
    ],
  },
];

describe("diff rows", () => {
  it("hides file rows for a collapsed section and keeps the header", () => {
    const rows = buildRows({
      readOnly: false,
      readOnlyFiles: [],
      sections: SECTIONS,
      expandedSections: { working: false, staged: true, untracked: true },
    });

    expect(rows.map((row) => row.id)).toEqual(["section::working"]);
  });

  it("lists read-only files without section headers", () => {
    const rows = buildRows({
      readOnly: true,
      readOnlyFiles: SECTIONS[0]?.files ?? [],
      sections: SECTIONS,
      expandedSections: { working: true, staged: true, untracked: true },
    });

    expect(rows.map((row) => row.id)).toEqual(["working::a.txt", "working::b.txt"]);
    expect(rows.every((row) => row.kind === "file")).toBe(true);
  });

  it("maps statuses to the documented row letters", () => {
    expect(readStatusLetter("conflicted")).toBe("U");
    expect(readStatusLetter("copied")).toBe("C");
    expect(readStatusLetter("modified")).toBe("M");
  });

  it("counts only add and remove lines", () => {
    expect(countDiffLines(undefined)).toBeNull();
    expect(
      countDiffLines({
        request: { section: "working", path: "a.txt", oldPath: null },
        status: "loaded",
        generation: 1,
        file: {
          path: "a.txt",
          oldPath: null,
          status: "modified",
          headerLines: [],
          binary: false,
          modeOnly: false,
          conflict: false,
          hasNoNewlineMarker: false,
          raw: "",
          hunks: [
            {
              oldStart: 1,
              oldCount: 1,
              newStart: 1,
              newCount: 1,
              header: "",
              heading: null,
              lines: [
                { kind: "context", text: "x", oldLine: 1, newLine: 1 },
                { kind: "add", text: "y", oldLine: null, newLine: 2 },
                { kind: "remove", text: "z", oldLine: 2, newLine: null },
              ],
            },
          ],
        },
        segments: [],
        limits: null,
        message: null,
        sizeBytes: null,
      }),
    ).toEqual({ add: 1, remove: 1 });
  });

  it("collapses only binary, oversized, or empty text diffs", () => {
    expect(shouldAutoCollapseDiff(undefined)).toBe(false);
    expect(shouldAutoCollapseDiff({ ...emptyState(), status: "binary" })).toBe(true);
    expect(shouldAutoCollapseDiff({ ...emptyState(), status: "oversized" })).toBe(true);
    expect(shouldAutoCollapseDiff({ ...emptyState(), status: "loaded", file: null })).toBe(true);
  });

  it("names the selected commit or stash in the read-only title", () => {
    expect(readReadOnlyTitle({ kind: "commit", oid: "abcdef1234" }, null)).toBe("Commit abcdef1");
    expect(
      readReadOnlyTitle({ kind: "stash", objectName: "aaa111" }, {
        stashes: [{ objectName: "aaa111", subject: "work in progress" }],
      } as unknown as RepositorySnapshot),
    ).toBe("Stash work in progress");
    expect(readReadOnlyTitle({ kind: "pending" }, null)).toBe("Diffs");
  });
});

/**
 * Builds the neutral load state used by the collapse assertions.
 *
 * @returns A loaded empty state without a file.
 */
function emptyState() {
  return {
    request: { section: "working" as const, path: "a.txt", oldPath: null },
    status: "loaded" as const,
    generation: 1,
    file: null,
    segments: [],
    limits: null,
    message: null,
    sizeBytes: null,
  };
}
