import { describe, expect, it } from "bun:test";
import { collapseFileDiff, formatHunkHeader } from "@/domain/diff/diff.collapse";
import type { DiffSegment, FileDiff } from "@/domain/diff/diff.types";
import { parseFileDiff } from "@/domain/git/parsers/parse.diff";

/**
 * Builds a one-hunk patch around a context run.
 *
 * @param contextCount - Number of unchanged lines in the run.
 * @returns The patch text.
 */
function runFixture(contextCount: number): string {
  const lines = ["diff --git a/f.txt b/f.txt", "--- a/f.txt", "+++ b/f.txt"];

  lines.push(`@@ -1,${contextCount + 1} +1,${contextCount} @@`);

  for (let index = 1; index <= contextCount; index += 1) {
    lines.push(` c${index}`);
  }

  lines.push("-removed");

  return `${[...lines, ""].join("\n")}`;
}

/**
 * Parses a fixture that must be valid.
 *
 * @param text - Patch text.
 * @returns The parsed file.
 */
function mustParse(text: string): FileDiff {
  const result = parseFileDiff(text);

  if (!result.ok || result.file === null) {
    throw new Error("fixture did not parse");
  }

  return result.file;
}

/**
 * Re-parses one renderable segment and asserts that its patch matches its range.
 *
 * @param segment - Diff segment to validate.
 */
function expectValidPatch(segment: DiffSegment): void {
  if (segment.kind !== "diff") {
    return;
  }

  const result = parseFileDiff(segment.text);

  expect(result.ok).toBeTrue();

  const hunk = result.file?.hunks[0];

  expect(hunk?.oldStart).toBe(segment.oldStart);
  expect(hunk?.oldCount).toBe(segment.oldCount);
  expect(hunk?.newStart).toBe(segment.newStart);
  expect(hunk?.newCount).toBe(segment.newCount);
  expect(segment.text.split("\n").filter((line) => line.startsWith("@@ "))).toHaveLength(1);
  expect(segment.text.startsWith("diff --git a/f.txt b/f.txt")).toBeTrue();
}

/** Two-hunk patch with no long context run. */
const TWO_HUNKS = [
  "diff --git a/file.txt b/file.txt",
  "--- a/file.txt",
  "+++ b/file.txt",
  "@@ -1,2 +1,2 @@",
  " one",
  "-two",
  "+TWO",
  "@@ -10,2 +10,3 @@ section",
  " ten",
  "+inserted",
  " eleven",
  "",
].join("\n");

describe("collapseFileDiff", () => {
  it("keeps a run exactly at the threshold whole", () => {
    const segments = collapseFileDiff(mustParse(runFixture(7)), 3);

    expect(segments).toHaveLength(1);
    expect(segments[0]?.kind).toBe("diff");
    expect(segments[0]).toMatchObject({
      oldStart: 1,
      oldCount: 8,
      newStart: 1,
      newCount: 7,
    });
    expectValidPatch(segments[0] as DiffSegment);
  });

  it("collapses a run one line over the threshold", () => {
    const segments = collapseFileDiff(mustParse(runFixture(8)), 3);

    expect(segments.map((segment) => segment.kind)).toEqual(["diff", "collapsed", "diff"]);
    expect(segments[1]).toEqual({
      kind: "collapsed",
      count: 2,
      oldStart: 4,
      newStart: 4,
    });
  });

  it("keeps the configured number of context lines at each edge", () => {
    const segments = collapseFileDiff(mustParse(runFixture(4)), 1);

    expect(segments.map((segment) => segment.kind)).toEqual(["diff", "collapsed", "diff"]);

    const first = segments[0] as Extract<DiffSegment, { kind: "diff" }>;
    const collapsed = segments[1] as Extract<DiffSegment, { kind: "collapsed" }>;
    const last = segments[2] as Extract<DiffSegment, { kind: "diff" }>;

    expect(first.oldCount).toBe(1);
    expect(first.newCount).toBe(1);
    expect(collapsed).toMatchObject({ count: 2, oldStart: 2, newStart: 2 });
    expect(last.oldCount).toBe(2);
    expect(last.newCount).toBe(1);
  });

  it("collapses multiple runs in one hunk", () => {
    const patch = [
      "diff --git a/f.txt b/f.txt",
      "--- a/f.txt",
      "+++ b/f.txt",
      "@@ -1,17 +1,17 @@",
      ...Array.from({ length: 8 }, (_, index) => ` c${index + 1}`),
      "-c9",
      "+c9 changed",
      ...Array.from({ length: 8 }, (_, index) => ` c${index + 10}`),
      "",
    ].join("\n");
    const segments = collapseFileDiff(mustParse(patch), 3);

    expect(segments.filter((segment) => segment.kind === "collapsed")).toHaveLength(2);
    expect(segments.map((segment) => segment.kind)).toEqual([
      "diff",
      "collapsed",
      "diff",
      "collapsed",
      "diff",
    ]);
  });

  it("does not collapse when the context count is zero", () => {
    const segments = collapseFileDiff(mustParse(runFixture(8)), 0);

    expect(segments).toHaveLength(1);
    expect(segments[0]?.kind).toBe("diff");
    expectValidPatch(segments[0] as DiffSegment);
  });

  it("never collapses a conflicted file, so its markers stay visible", () => {
    const lines = Array.from({ length: 40 }, (_, index) => `line ${index + 1}`);

    lines[10] = "<<<<<<< HEAD";
    lines[11] = "ours";
    lines[12] = "=======";
    lines[13] = "theirs";
    lines[14] = ">>>>>>> feature";

    const patch = [
      "diff --git a/conflict.txt b/conflict.txt",
      "--- a/conflict.txt",
      "+++ b/conflict.txt",
      "@@ -1,40 +1,40 @@",
      ...lines.map((line) => ` ${line}`),
      "",
    ].join("\n");
    const result = parseFileDiff(patch, { status: "conflicted" });

    expect(result.ok).toBeTrue();

    if (!result.ok || result.file === null) {
      return;
    }

    const segments = collapseFileDiff(result.file, 3);

    expect(result.file.conflict).toBeTrue();
    expect(segments).toHaveLength(1);
    expect(segments[0]?.kind).toBe("diff");

    const text = segments[0]?.kind === "diff" ? segments[0].text : "";

    expect(text).toContain("<<<<<<< HEAD");
    expect(text).toContain("=======");
    expect(text).toContain(">>>>>>> feature");
    expect(text).not.toContain("unchanged");
  });

  it("matches segment boundaries to the parsed line numbers", () => {
    const segments = collapseFileDiff(mustParse(runFixture(8)), 3);
    const [first, collapsed, last] = segments;

    expect(first).toMatchObject({ oldStart: 1, oldCount: 3, newStart: 1, newCount: 3 });
    expect(collapsed).toMatchObject({ oldStart: 4, newStart: 4 });
    expect(last).toMatchObject({ oldStart: 6, oldCount: 4, newStart: 6, newCount: 3 });
    expectValidPatch(first as DiffSegment);
    expectValidPatch(last as DiffSegment);
  });

  it("emits a valid patch per hunk for a multi-hunk file", () => {
    const segments = collapseFileDiff(mustParse(TWO_HUNKS), 3);

    expect(segments).toHaveLength(2);
    expect(segments.map((segment) => (segment.kind === "diff" ? segment.hunkIndex : -1))).toEqual([
      0, 1,
    ]);
    expect(segments[1]).toMatchObject({ oldStart: 10, oldCount: 2, newStart: 10, newCount: 3 });

    for (const segment of segments) {
      if (segment.kind === "diff") {
        const result = parseFileDiff(segment.text);

        expect(result.ok).toBeTrue();
        expect(result.file?.hunks[0]?.heading).toBe(segment.hunkIndex === 1 ? "section" : null);
      }
    }
  });
});

describe("formatHunkHeader", () => {
  it("always writes explicit counts and keeps the heading", () => {
    expect(formatHunkHeader({ oldStart: 1, oldCount: 1, newStart: 2, newCount: 0 }, "fn")).toBe(
      "@@ -1,1 +2,0 @@ fn",
    );
  });
});
