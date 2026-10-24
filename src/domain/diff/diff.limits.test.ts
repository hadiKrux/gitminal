import { describe, expect, it } from "bun:test";
import { applyDiffLimits, DIFF_LIMIT_DEFAULTS } from "@/domain/diff/diff.limits";

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
