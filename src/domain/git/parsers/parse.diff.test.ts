import { describe, expect, it } from "bun:test";
import { parseDiff, parseFileDiff } from "@/domain/git/parsers/parse.diff";

/** Single-hunk patch with context, remove, and add lines. */
const SINGLE_HUNK = [
  "diff --git a/src/app.ts b/src/app.ts",
  "index 1111111..2222222 100644",
  "--- a/src/app.ts",
  "+++ b/src/app.ts",
  "@@ -1,3 +1,4 @@ function head()",
  " const a = 1",
  "-const b = 2",
  "+const b = 3",
  "+const c = 4",
  " const d = 5",
  "",
].join("\n");

/** Two-hunk patch whose second hunk starts at line 10. */
const MULTIPLE_HUNKS = [
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

/** Rename patch carrying rename and similarity metadata. */
const RENAME_PATCH = [
  "diff --git a/old name.txt b/new name.txt",
  "similarity index 90%",
  "rename from old name.txt",
  "rename to new name.txt",
  "index 1111111..2222222 100644",
  "--- a/old name.txt",
  "+++ b/new name.txt",
  "@@ -1 +1 @@",
  "-old",
  "+new",
  "",
].join("\n");

/** Mode-only patch with no hunks. */
const MODE_ONLY = [
  "diff --git a/script.sh b/script.sh",
  "old mode 100644",
  "new mode 100755",
  "",
].join("\n");

/** Binary notice patch without `---` or `+++` lines. */
const BINARY_PATCH = [
  "diff --git a/image.png b/image.png",
  "index 1111111..2222222 100644",
  "Binary files a/image.png and b/image.png differ",
  "",
].join("\n");

/** Patch carrying the no-newline marker on both sides. */
const NO_NEWLINE = [
  "diff --git a/a.txt b/a.txt",
  "--- a/a.txt",
  "+++ b/a.txt",
  "@@ -1,2 +1,2 @@",
  " one",
  "-two",
  "\\ No newline at end of file",
  "+two",
  "\\ No newline at end of file",
  "",
].join("\n");

/** Synthetic conflict patch whose markers are context lines. */
const CONFLICT_PATCH = [
  "diff --git a/conflict.txt b/conflict.txt",
  "--- a/conflict.txt",
  "+++ b/conflict.txt",
  "@@ -1,5 +1,5 @@",
  " <<<<<<< HEAD",
  " ours",
  " =======",
  " theirs",
  " >>>>>>> feature",
  "",
].join("\n");

describe("parseDiff", () => {
  it("parses a single hunk with correct old and new line numbers", () => {
    const result = parseFileDiff(SINGLE_HUNK);

    expect(result.ok).toBeTrue();
    expect(result.file).toMatchObject({
      path: "src/app.ts",
      status: "modified",
      headerLines: [
        "diff --git a/src/app.ts b/src/app.ts",
        "index 1111111..2222222 100644",
        "--- a/src/app.ts",
        "+++ b/src/app.ts",
      ],
    });
    expect(result.file?.hunks).toHaveLength(1);
    expect(result.file?.hunks[0]).toMatchObject({
      oldStart: 1,
      oldCount: 3,
      newStart: 1,
      newCount: 4,
      heading: "function head()",
    });
    expect(
      result.file?.hunks[0]?.lines.map((line) => [line.kind, line.oldLine, line.newLine]),
    ).toEqual([
      ["context", 1, 1],
      ["remove", 2, null],
      ["add", null, 2],
      ["add", null, 3],
      ["context", 3, 4],
    ]);
    expect(result.warnings).toEqual([]);
  });

  it("parses multiple hunks and numbers each from its own header", () => {
    const result = parseFileDiff(MULTIPLE_HUNKS);

    expect(result.file?.hunks).toHaveLength(2);
    expect(result.file?.hunks[1]?.oldStart).toBe(10);
    expect(
      result.file?.hunks[1]?.lines.map((line) => [line.kind, line.oldLine, line.newLine]),
    ).toEqual([
      ["context", 10, 10],
      ["add", null, 11],
      ["context", 11, 12],
    ]);
  });

  it("keeps rename headers and reports both paths", () => {
    const result = parseFileDiff(RENAME_PATCH);

    expect(result.file?.status).toBe("renamed");
    expect(result.file?.path).toBe("new name.txt");
    expect(result.file?.oldPath).toBe("old name.txt");
    expect(result.file?.headerLines).toContain("rename from old name.txt");
    expect(result.file?.headerLines).toContain("rename to new name.txt");
  });

  it("reports a mode-only change with no hunks", () => {
    const result = parseFileDiff(MODE_ONLY);

    expect(result.file?.modeOnly).toBeTrue();
    expect(result.file?.hunks).toEqual([]);
    expect(result.file?.path).toBe("script.sh");
    expect(result.file?.headerLines).toContain("old mode 100644");
    expect(result.file?.headerLines).toContain("new mode 100755");
  });

  it("reports a binary notice without hunks", () => {
    const result = parseFileDiff(BINARY_PATCH);

    expect(result.file?.binary).toBeTrue();
    expect(result.file?.hunks).toEqual([]);
    expect(result.file?.path).toBe("image.png");
  });

  it("keeps the no-newline marker as meta without consuming line numbers", () => {
    const result = parseFileDiff(NO_NEWLINE);

    const hunk = result.file?.hunks[0];

    expect(result.file?.hasNoNewlineMarker).toBeTrue();
    expect(hunk?.lines.map((line) => line.kind)).toEqual([
      "context",
      "remove",
      "meta",
      "add",
      "meta",
    ]);
    expect(hunk?.lines[2]?.text).toBe("\\ No newline at end of file");
    expect(hunk?.lines[3]?.newLine).toBe(2);
  });

  it("parses conflict markers from a synthetic patch as numbered context", () => {
    const result = parseFileDiff(CONFLICT_PATCH, { status: "conflicted" });

    const lines = result.file?.hunks[0]?.lines ?? [];

    expect(result.file?.status).toBe("conflicted");
    expect(result.file?.conflict).toBeTrue();
    expect(lines).toHaveLength(5);
    expect(lines[0]).toMatchObject({ kind: "context", oldLine: 1, newLine: 1 });
    expect(lines[0]?.text).toBe(" <<<<<<< HEAD");
    expect(lines[4]?.text).toBe(" >>>>>>> feature");
  });

  it("keeps a raw conflict marker inside a hunk as meta", () => {
    const result = parseFileDiff(
      [
        "diff --git a/conflict.txt b/conflict.txt",
        "--- a/conflict.txt",
        "+++ b/conflict.txt",
        "@@ -1 +1 @@",
        "<<<<<<< HEAD",
        "",
      ].join("\n"),
    );

    expect(result.file?.hunks[0]?.lines[0]?.kind).toBe("meta");
    expect(result.warnings.some((warning) => warning.kind === "unknown-hunk-line")).toBeTrue();
  });

  it("parses every file of a multi-file patch", () => {
    const result = parseDiff(`${SINGLE_HUNK}${MULTIPLE_HUNKS}`);

    expect(result.ok).toBeTrue();
    expect(result.files.map((file) => file.path)).toEqual(["src/app.ts", "file.txt"]);
  });

  it("returns an empty file list for empty input", () => {
    expect(parseDiff("")).toEqual({ ok: true, files: [], warnings: [] });
    expect(parseFileDiff("")).toEqual({ ok: true, file: null, warnings: [] });
  });

  it("uses the caller path when a header omits it", () => {
    const result = parseFileDiff("Binary files /dev/null and b/weird name differ\n", {
      path: "weird name",
    });

    expect(result.file?.path).toBe("weird name");
    expect(result.file?.binary).toBeTrue();
  });

  it("returns a typed error for a malformed hunk header", () => {
    const result = parseFileDiff(
      ["diff --git a/x b/x", "--- a/x", "+++ b/x", "@@ broken @@", ""].join("\n"),
    );

    expect(result.ok).toBeFalse();

    if (!result.ok) {
      expect(result.error.kind).toBe("malformed-hunk-header");
      expect(result.error.line).toBe(4);
    }
  });

  it("returns a typed error for content before any file header", () => {
    const result = parseDiff("unexpected content\n");

    expect(result.ok).toBeFalse();

    if (!result.ok) {
      expect(result.error.kind).toBe("content-before-file-header");
    }
  });

  it("returns a typed error for combined diff output", () => {
    const result = parseDiff("diff --cc conflict.txt\nindex 1,2..3\n");

    expect(result.ok).toBeFalse();

    if (!result.ok) {
      expect(result.error.kind).toBe("combined-diff-unsupported");
    }
  });

  it("reports a hunk count mismatch as a warning", () => {
    const result = parseFileDiff(
      ["diff --git a/x b/x", "--- a/x", "+++ b/x", "@@ -1,4 +1,4 @@", " only", ""].join("\n"),
    );

    expect(result.ok).toBeTrue();
    expect(
      result.warnings.filter((warning) => warning.kind === "hunk-count-mismatch"),
    ).toHaveLength(2);
  });

  it("never throws on malformed input", () => {
    expect(() => parseDiff("@@ -1 +1 @@\n")).not.toThrow();
    expect(() => parseDiff("\0\0\0")).not.toThrow();
    expect(() => parseDiff("diff --git \n")).not.toThrow();
  });
});
