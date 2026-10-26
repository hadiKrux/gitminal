import { describe, expect, it } from "bun:test";
import {
  applyDiffLimits,
  applyFileDiffLimits,
  DIFF_LIMIT_DEFAULTS,
  isDiffOversized,
} from "@/domain/diff/diff.limits";
import { parseFileDiff } from "@/domain/git/parsers/parse.diff";

/** Two-hunk parsed fixture with correct declared counts. */
const PARSED_TWO_HUNK_DIFF = [
  "diff --git a/file.txt b/file.txt",
  "--- a/file.txt",
  "+++ b/file.txt",
  "@@ -1,2 +1,2 @@",
  "-old line",
  "+new line",
  " context",
  "@@ -10,2 +10,3 @@ section",
  " context",
  "+added line",
  " context",
  "",
].join("\n");

/** A two-hunk diff used by the cap tests. */
const TWO_HUNK_DIFF = [
  "diff --git a/file.txt b/file.txt",
  "index 1111111..2222222 100644",
  "--- a/file.txt",
  "+++ b/file.txt",
  "@@ -1,2 +1,2 @@",
  "-old line",
  "+new line",
  " context",
  "@@ -10,2 +10,3 @@",
  " context",
  "+added line",
  " context",
  "",
].join("\n");

describe("applyDiffLimits", () => {
  it("keeps a diff below both caps and reports no truncation", () => {
    const result = applyDiffLimits(TWO_HUNK_DIFF);

    expect(result.truncated).toBe(false);
    expect(result.shownLines).toBe(result.totalLines);
    expect(result.text).toBe(TWO_HUNK_DIFF);
  });

  it("drops whole hunks when the line cap is reached", () => {
    const result = applyDiffLimits(TWO_HUNK_DIFF, { maxLines: 8 });

    expect(result.truncated).toBe(true);
    expect(result.text).toContain("@@ -1,2 +1,2 @@");
    expect(result.text).not.toContain("@@ -10,2 +10,3 @@");
    expect(result.text.startsWith("diff --git a/file.txt b/file.txt")).toBe(true);
  });

  it("drops whole hunks when the byte cap is reached", () => {
    const result = applyDiffLimits(TWO_HUNK_DIFF, { maxBytes: 160 });

    expect(result.truncated).toBe(true);
    expect(result.text).toContain("+new line");
    expect(result.text).not.toContain("+added line");
  });

  it("never leaves a dangling hunk header", () => {
    const result = applyDiffLimits(TWO_HUNK_DIFF, { maxLines: 8 });

    for (const hunkHeader of result.text.split("\n").filter((line) => line.startsWith("@@ "))) {
      expect(hunkHeader.length).toBeGreaterThan(0);
    }

    expect(result.text.trimEnd().split("\n").at(-1)).toBe(" context");
  });

  it("reports the original and retained sizes", () => {
    const result = applyDiffLimits(TWO_HUNK_DIFF, { maxLines: 8 });

    expect(result.totalLines).toBe(12);
    expect(result.shownLines).toBe(8);
    expect(result.totalBytes).toBe(Buffer.byteLength(TWO_HUNK_DIFF, "utf8"));
    expect(result.shownBytes).toBe(Buffer.byteLength(result.text, "utf8"));
    expect(DIFF_LIMIT_DEFAULTS.maxLines).toBeGreaterThan(0);
  });

  it("handles an empty diff", () => {
    const result = applyDiffLimits("");

    expect(result).toEqual({
      text: "",
      truncated: false,
      totalLines: 0,
      shownLines: 0,
      totalBytes: 0,
      shownBytes: 0,
    });
  });
});

describe("applyFileDiffLimits", () => {
  /**
   * Parses the two-hunk fixture.
   *
   * @returns The parsed file.
   */
  function parsedFile() {
    const result = parseFileDiff(PARSED_TWO_HUNK_DIFF);

    if (!result.ok || result.file === null) {
      throw new Error("fixture did not parse");
    }

    return result.file;
  }

  it("keeps every hunk below both caps and recomputes each header", () => {
    const result = applyFileDiffLimits(parsedFile());

    expect(result.truncated).toBeFalse();
    expect(result.totalLines).toBe(11);
    expect(result.shownLines).toBe(11);
    expect(result.totalBytes).toBe(Buffer.byteLength(PARSED_TWO_HUNK_DIFF, "utf8"));
    expect(result.file.raw).toContain("@@ -1,2 +1,2 @@");
    expect(result.file.raw).toContain("@@ -10,2 +10,3 @@ section");
    expect(result.file.hunks).toHaveLength(2);
  });

  it("drops a whole hunk at the line cap and keeps the prefix valid", () => {
    const result = applyFileDiffLimits(parsedFile(), { maxLines: 8 });

    expect(result.truncated).toBeTrue();
    expect(result.shownLines).toBe(7);
    expect(result.totalLines).toBe(11);
    expect(result.file.hunks).toHaveLength(1);
    expect(result.file.raw).toContain("@@ -1,2 +1,2 @@");
    expect(result.file.raw).not.toContain("@@ -10,2 +10,3 @@ section");

    const reparsed = parseFileDiff(result.file.raw);

    expect(reparsed.ok).toBeTrue();
    expect(reparsed.file?.hunks).toHaveLength(1);
  });

  it("drops a whole hunk at the byte cap", () => {
    const result = applyFileDiffLimits(parsedFile(), { maxBytes: 120 });

    expect(result.truncated).toBeTrue();
    expect(result.file.hunks).toHaveLength(1);
    expect(result.shownBytes).toBe(Buffer.byteLength(result.file.raw, "utf8"));
  });

  it("keeps only the header when the first hunk cannot fit", () => {
    const result = applyFileDiffLimits(parsedFile(), { maxLines: 4 });

    expect(result.truncated).toBeTrue();
    expect(result.file.hunks).toEqual([]);
    expect(result.file.raw.startsWith("diff --git a/file.txt b/file.txt")).toBeTrue();
    expect(result.file.raw).not.toContain("@@ ");
  });
});

describe("isDiffOversized", () => {
  it("compares a known size against the byte cap", () => {
    expect(isDiffOversized(101, { maxBytes: 100 })).toBeTrue();
    expect(isDiffOversized(100, { maxBytes: 100 })).toBeFalse();
    expect(isDiffOversized(null)).toBeFalse();
    expect(isDiffOversized(-1)).toBeFalse();
    expect(isDiffOversized(Number.NaN)).toBeFalse();
  });

  it("uses the default byte cap when no override is given", () => {
    expect(isDiffOversized(DIFF_LIMIT_DEFAULTS.maxBytes + 1)).toBeTrue();
    expect(isDiffOversized(DIFF_LIMIT_DEFAULTS.maxBytes)).toBeFalse();
  });
});
