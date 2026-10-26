import { describe, expect, it } from "bun:test";
import { collapseFileDiff } from "@/domain/diff/diff.collapse";
import {
  buildCommitDiffArgs,
  buildDeleteUntrackedArgs,
  buildStageArgs,
  buildStagedDiffArgs,
  buildUnstageArgs,
  buildUntrackedContentArgs,
  buildWorkingDiffArgs,
  deleteAllUntracked,
  deleteUntrackedFile,
  discardFile,
  discardPaths,
  literalPathspec,
  probeBinary,
  probeSize,
  readConflictDiff,
  readStagedDiff,
  readUntrackedContent,
  readWorkingDiff,
  resolveDiffReadContextLines,
  stageFile,
  stagePaths,
  unstageFile,
} from "@/domain/git/git.diff";
import { readCommitDiff, readStashDiff } from "@/domain/git/git.diff.read-only";
import { createScriptedGitClient, fakeGitResult } from "@/test/git.fake";

/** Working-tree patch for a file whose name contains brackets. */
const WORKING_PATCH = [
  "diff --git a/src/a[1].txt b/src/a[1].txt",
  "index 1111111..2222222 100644",
  "--- a/src/a[1].txt",
  "+++ b/src/a[1].txt",
  "@@ -1,2 +1,2 @@",
  " one",
  "-two",
  "+TWO",
  "",
].join("\n");

/** Rename patch carrying both paths. */
const RENAME_PATCH = [
  "diff --git a/old.txt b/new.txt",
  "similarity index 90%",
  "rename from old.txt",
  "rename to new.txt",
  "--- a/old.txt",
  "+++ b/new.txt",
  "@@ -1 +1 @@",
  "-old",
  "+new",
  "",
].join("\n");

/** Deletion patch whose new side is `/dev/null`. */
const DELETED_PATCH = [
  "diff --git a/gone.txt b/gone.txt",
  "deleted file mode 100644",
  "index 1111111..0000000",
  "--- a/gone.txt",
  "+++ /dev/null",
  "@@ -1,2 +0,0 @@",
  "-one",
  "-two",
  "",
].join("\n");

/** No-index patch for an untracked file. */
const UNTRACKED_PATCH = [
  "diff --git a/notes.txt b/notes.txt",
  "new file mode 100644",
  "index 0000000..1111111",
  "--- /dev/null",
  "+++ b/notes.txt",
  "@@ -0,0 +1,2 @@",
  "+first",
  "+second",
  "",
].join("\n");

/** No-index patch for a conflicted working-tree file. */
const CONFLICT_CONTENT = [
  "diff --git a/conflict.txt b/conflict.txt",
  "new file mode 100644",
  "index 0000000..1111111",
  "--- /dev/null",
  "+++ b/conflict.txt",
  "@@ -0,0 +1,5 @@",
  "+<<<<<<< HEAD",
  "+ours",
  "+=======",
  "+theirs",
  "+>>>>>>> feature",
  "",
].join("\n");

/** Multi-file commit patch. */
const COMMIT_PATCH = `${WORKING_PATCH}${DELETED_PATCH}`;

/** Canonical status output for an untracked new path. */
const UNTRACKED_STATUS = ["# branch.oid abc", "# branch.head main", "? new.txt", ""].join("\0");

/** Canonical status output for a tracked new path. */
const TRACKED_STATUS = [
  "# branch.oid abc",
  "# branch.head main",
  "1 .M N... 100644 100644 100644 aaaaaaa bbbbbbb new.txt",
  "",
].join("\0");

/** Status argument key used by the scripted client. */
const STATUS_KEY = "status --porcelain=v2 --branch -z --untracked-files=all";

/**
 * Creates a signal for one test invocation.
 *
 * @returns A fresh abort signal.
 */
function signal(): AbortSignal {
  return new AbortController().signal;
}

describe("literal pathspecs", () => {
  it("wraps a path without rewriting it", () => {
    expect(literalPathspec("a[1].txt")).toBe(":(literal)a[1].txt");
    expect(literalPathspec("src/*.ts")).toBe(":(literal)src/*.ts");
  });

  it("rejects an empty path and an empty target set", () => {
    expect(buildWorkingDiffArgs({ path: "", oldPath: null }, 3).ok).toBeFalse();
    expect(buildStageArgs([]).ok).toBeFalse();
  });
});

describe("diff read builders", () => {
  it("builds the working diff with literal paths", () => {
    const plan = buildWorkingDiffArgs({ path: "src/a[1].txt", oldPath: null }, 3);

    expect(plan).toEqual({
      ok: true,
      args: ["diff", "--no-color", "-U20", "--", ":(literal)src/a[1].txt"],
    });
  });

  it("builds the staged diff with --cached", () => {
    const plan = buildStagedDiffArgs({ path: "staged.txt", oldPath: null }, 2);

    expect(plan).toEqual({
      ok: true,
      args: ["diff", "--cached", "--no-color", "-U20", "--", ":(literal)staged.txt"],
    });
  });

  it("builds a rename read with both paths and rename detection", () => {
    const plan = buildWorkingDiffArgs({ path: "new.txt", oldPath: "old.txt" }, 3);

    expect(plan).toEqual({
      ok: true,
      args: ["diff", "-M", "--no-color", "-U20", "--", ":(literal)old.txt", ":(literal)new.txt"],
    });
  });

  it("builds the untracked read as a no-index comparison against /dev/null", () => {
    const plan = buildUntrackedContentArgs("notes.txt", 3);

    expect(plan).toEqual({
      ok: true,
      args: ["diff", "--no-index", "--no-color", "-U20", "--", "/dev/null", "notes.txt"],
    });
    expect(buildUntrackedContentArgs("/absolute.txt", 3).ok).toBeFalse();
  });

  it("builds the commit read with the documented flags", () => {
    const plan = buildCommitDiffArgs("abc1234", 3);

    expect(plan).toEqual({
      ok: true,
      args: ["show", "--no-color", "-U20", "--format=", "--diff-merges=first-parent", "abc1234"],
    });
    expect(buildCommitDiffArgs("--help", 3).ok).toBeFalse();
  });

  it("reads with the collapse window and keeps a zero-context read at zero", () => {
    expect(resolveDiffReadContextLines(3)).toBe(20);
    expect(resolveDiffReadContextLines(19)).toBe(20);
    expect(resolveDiffReadContextLines(20)).toBe(21);
    expect(resolveDiffReadContextLines(0)).toBe(0);
    expect(resolveDiffReadContextLines(25)).toBe(26);
    expect(resolveDiffReadContextLines(5000)).toBe(1000);
  });

  it("builds stage and unstage commands with both rename paths", () => {
    const targets = [{ path: "new.txt", oldPath: "old.txt" }];

    expect(buildStageArgs(targets)).toEqual({
      ok: true,
      args: ["add", "--", ":(literal)old.txt", ":(literal)new.txt"],
    });
    expect(buildUnstageArgs(targets)).toEqual({
      ok: true,
      args: ["restore", "--staged", "--", ":(literal)old.txt", ":(literal)new.txt"],
    });
  });

  it("builds the scoped clean command without -x", () => {
    const plan = buildDeleteUntrackedArgs(["a.txt", "b.txt"], true);

    expect(plan).toEqual({
      ok: true,
      args: ["clean", "-f", "-d", "--", ":(literal)a.txt", ":(literal)b.txt"],
    });
    expect(JSON.stringify(plan)).not.toContain("-x");
  });
});

describe("diff readers", () => {
  it("reads and parses the working diff of a bracket path", async () => {
    const { client, calls } = createScriptedGitClient({
      "diff --no-color -U20 -- :(literal)src/a[1].txt": fakeGitResult(WORKING_PATCH),
    });

    const result = await readWorkingDiff(client, {
      cwd: "/repo",
      signal: signal(),
      path: "src/a[1].txt",
      contextLines: 3,
    });

    expect(result.ok).toBeTrue();
    expect(result.file?.path).toBe("src/a[1].txt");
    expect(result.file?.hunks[0]?.lines[1]).toMatchObject({ kind: "remove", oldLine: 2 });
    expect(calls[0]?.args).toEqual(["diff", "--no-color", "-U20", "--", ":(literal)src/a[1].txt"]);
    expect(calls[0]?.operationClass).toBe("read");
  });

  it("reads the staged diff with the cached comparison", async () => {
    const { client, calls } = createScriptedGitClient({
      "diff --cached --no-color -U20 -- :(literal)staged.txt": fakeGitResult(WORKING_PATCH),
    });

    const result = await readStagedDiff(client, {
      cwd: "/repo",
      signal: signal(),
      path: "staged.txt",
      contextLines: 2,
    });

    expect(result.ok).toBeTrue();
    expect(calls[0]?.args).toContain("--cached");
  });

  it("reads a rename with both paths and keeps the header", async () => {
    const { client } = createScriptedGitClient({
      "diff -M --no-color -U20 -- :(literal)old.txt :(literal)new.txt": fakeGitResult(RENAME_PATCH),
    });

    const result = await readWorkingDiff(client, {
      cwd: "/repo",
      signal: signal(),
      path: "new.txt",
      oldPath: "old.txt",
      contextLines: 3,
    });

    expect(result.file?.status).toBe("renamed");
    expect(result.file?.path).toBe("new.txt");
    expect(result.file?.oldPath).toBe("old.txt");
  });

  it("reads a deleted file as removed lines", async () => {
    const { client } = createScriptedGitClient({
      "diff --no-color -U20 -- :(literal)gone.txt": fakeGitResult(DELETED_PATCH),
    });

    const result = await readWorkingDiff(client, {
      cwd: "/repo",
      signal: signal(),
      path: "gone.txt",
      contextLines: 3,
    });

    expect(result.file?.status).toBe("deleted");
    expect(result.file?.hunks[0]?.lines.every((line) => line.kind === "remove")).toBeTrue();
  });

  it("reads untracked content from a no-index diff and accepts exit 1", async () => {
    const { client, calls } = createScriptedGitClient({
      "diff --no-index --no-color -U20 -- /dev/null notes.txt": fakeGitResult(
        UNTRACKED_PATCH,
        false,
      ),
    });

    const result = await readUntrackedContent(client, {
      cwd: "/repo",
      signal: signal(),
      path: "notes.txt",
      contextLines: 3,
    });

    expect(result.ok).toBeTrue();
    expect(result.file?.status).toBe("added");
    expect(result.file?.hunks[0]?.lines.every((line) => line.kind === "add")).toBeTrue();
    expect(calls[0]?.args).toEqual([
      "diff",
      "--no-index",
      "--no-color",
      "-U20",
      "--",
      "/dev/null",
      "notes.txt",
    ]);
  });

  it("builds a synthetic conflict patch and never invokes --cc", async () => {
    const { client, calls } = createScriptedGitClient({
      "diff --no-index --no-color -U0 -- /dev/null conflict.txt": fakeGitResult(
        CONFLICT_CONTENT,
        false,
      ),
    });

    const result = await readConflictDiff(client, {
      cwd: "/repo",
      signal: signal(),
      path: "conflict.txt",
      contextLines: 3,
    });

    expect(result.ok).toBeTrue();
    expect(result.file?.status).toBe("conflicted");
    expect(result.file?.conflict).toBeTrue();
    expect(result.file?.hunks).toHaveLength(1);
    expect(result.file?.hunks[0]?.oldCount).toBe(5);
    expect(result.file?.hunks[0]?.newCount).toBe(5);
    expect(result.file?.hunks[0]?.lines[0]?.text).toBe(" <<<<<<< HEAD");
    expect(result.file?.hunks[0]?.lines[4]?.text).toBe(" >>>>>>> feature");
    expect(calls.some((call) => call.args.includes("--cc"))).toBeFalse();
    expect(calls.some((call) => call.args.includes("--combined"))).toBeFalse();
  });

  it("reports a binary conflict without building hunks", async () => {
    const binary = [
      "diff --git a/bin.dat b/bin.dat",
      "new file mode 100644",
      "index 0000000..1111111",
      "Binary files /dev/null and b/bin.dat differ",
      "",
    ].join("\n");
    const { client, calls } = createScriptedGitClient({
      "diff --no-index --no-color -U0 -- /dev/null bin.dat": fakeGitResult(binary, false),
    });

    const result = await readConflictDiff(client, {
      cwd: "/repo",
      signal: signal(),
      path: "bin.dat",
      contextLines: 3,
    });

    expect(result.file?.binary).toBeTrue();
    expect(result.file?.status).toBe("conflicted");
    expect(calls.some((call) => call.args.includes("--cc"))).toBeFalse();
  });

  it("returns a classified failure instead of throwing", async () => {
    const { client } = createScriptedGitClient({
      "diff --no-color -U20 -- :(literal)missing.txt": fakeGitResult(
        "",
        false,
        "fatal: not a git repository",
      ),
    });

    const result = await readWorkingDiff(client, {
      cwd: "/repo",
      signal: signal(),
      path: "missing.txt",
      contextLines: 3,
    });

    expect(result.ok).toBeFalse();
    expect(result.file).toBeNull();
    expect(result.failure?.kind).toBe("not-a-repository");
  });

  it("reads a commit diff as a multi-file patch", async () => {
    const { client } = createScriptedGitClient({
      "show --no-color -U20 --format= --diff-merges=first-parent abc1234":
        fakeGitResult(COMMIT_PATCH),
    });

    const result = await readCommitDiff(client, {
      cwd: "/repo",
      signal: signal(),
      sha: "abc1234",
      contextLines: 3,
    });

    expect(result.ok).toBeTrue();
    expect(result.files.map((file) => file.status)).toEqual(["modified", "deleted"]);
  });

  it("reads a stash diff through git stash show", async () => {
    const { client, calls } = createScriptedGitClient({
      "stash show -p --no-color -U20 stash@{0}": fakeGitResult(WORKING_PATCH),
    });

    const result = await readStashDiff(client, {
      cwd: "/repo",
      signal: signal(),
      stashRef: "stash@{0}",
      contextLines: 2,
    });

    expect(result.ok).toBeTrue();
    expect(result.files).toHaveLength(1);
    expect(calls[0]?.args).toEqual(["stash", "show", "-p", "--no-color", "-U20", "stash@{0}"]);
  });
});

describe("diff read collapse", () => {
  it("collapses a long unchanged run from a -U20 read to a marker at the configured context", async () => {
    const patch = [
      "diff --git a/long.txt b/long.txt",
      "--- a/long.txt",
      "+++ b/long.txt",
      "@@ -1,22 +1,22 @@",
      ...Array.from({ length: 20 }, (_, index) => ` c${index + 1}`),
      "-old",
      "+new",
      "",
    ].join("\n");
    const { client } = createScriptedGitClient({
      "diff --no-color -U20 -- :(literal)long.txt": fakeGitResult(patch),
    });

    const read = await readWorkingDiff(client, {
      cwd: "/repo",
      signal: signal(),
      path: "long.txt",
      contextLines: 3,
    });

    expect(read.ok).toBeTrue();

    if (read.file === null) {
      return;
    }

    expect(read.file.hunks[0]?.lines.filter((line) => line.kind === "context")).toHaveLength(20);

    const segments = collapseFileDiff(read.file, 3);

    expect(segments.map((segment) => segment.kind)).toEqual(["diff", "collapsed", "diff"]);
    expect(segments[1]).toMatchObject({ kind: "collapsed", count: 14, oldStart: 4, newStart: 4 });
  });

  it("collapses a -U21 read at the maximum configured context of 20", async () => {
    const patch = [
      "diff --git a/max.txt b/max.txt",
      "--- a/max.txt",
      "+++ b/max.txt",
      "@@ -1,86 +1,86 @@",
      ...Array.from({ length: 21 }, (_, index) => ` c${index + 1}`),
      "-old one",
      "+new one",
      ...Array.from({ length: 42 }, (_, index) => ` c${index + 22}`),
      "-old two",
      "+new two",
      ...Array.from({ length: 21 }, (_, index) => ` c${index + 64}`),
      "",
    ].join("\n");
    const { client, calls } = createScriptedGitClient({
      "diff --no-color -U21 -- :(literal)max.txt": fakeGitResult(patch),
    });

    const read = await readWorkingDiff(client, {
      cwd: "/repo",
      signal: signal(),
      path: "max.txt",
      contextLines: 20,
    });

    expect(calls[0]?.args).toEqual(["diff", "--no-color", "-U21", "--", ":(literal)max.txt"]);
    expect(read.ok).toBeTrue();

    if (read.file === null) {
      return;
    }

    const segments = collapseFileDiff(read.file, 20);

    expect(segments.map((segment) => segment.kind)).toEqual(["diff", "collapsed", "diff"]);
    expect(segments[1]).toMatchObject({ kind: "collapsed", count: 2, oldStart: 43, newStart: 43 });
  });
});

describe("diff probes", () => {
  it("detects a binary working diff from numstat", async () => {
    const { client, calls } = createScriptedGitClient({
      "diff --numstat --no-color -- :(literal)bin.dat": fakeGitResult("-\t-\tbin.dat\n"),
    });

    const result = await probeBinary(client, {
      cwd: "/repo",
      signal: signal(),
      path: "bin.dat",
      section: "working",
    });

    expect(result).toEqual({ ok: true, binary: true, failure: null });
    expect(calls[0]?.args).toEqual(["diff", "--numstat", "--no-color", "--", ":(literal)bin.dat"]);
  });

  it("probes the staged and untracked sections with their own comparisons", async () => {
    const staged = createScriptedGitClient({
      "diff --cached --numstat --no-color -- :(literal)x.bin": fakeGitResult("1\t0\tx.bin\n"),
    });
    const untracked = createScriptedGitClient({
      "diff --no-index --numstat -- /dev/null u.bin": fakeGitResult(
        "-\t-\t/dev/null => u.bin\n",
        false,
      ),
    });

    expect(
      (
        await probeBinary(staged.client, {
          cwd: "/repo",
          signal: signal(),
          path: "x.bin",
          section: "staged",
        })
      ).binary,
    ).toBeFalse();
    expect(
      (
        await probeBinary(untracked.client, {
          cwd: "/repo",
          signal: signal(),
          path: "u.bin",
          section: "untracked",
        })
      ).binary,
    ).toBeTrue();
  });

  it("reads a staged size from the index blob", async () => {
    const { client, calls } = createScriptedGitClient({
      "cat-file -s :0:file.txt": fakeGitResult("42\n"),
    });

    const result = await probeSize(client, {
      cwd: "/repo",
      signal: signal(),
      path: "file.txt",
      section: "staged",
    });

    expect(result).toEqual({ ok: true, sizeBytes: 42, failure: null });
    expect(calls[0]?.args).toEqual(["cat-file", "-s", ":0:file.txt"]);
  });

  it("measures a working-tree file on disk instead of its index blob", async () => {
    const { client, calls } = createScriptedGitClient({});
    const requested: string[] = [];

    const result = await probeSize(
      client,
      {
        cwd: "/repo",
        signal: signal(),
        path: "src/grown.bin",
        section: "working",
      },
      async (absolutePath) => {
        requested.push(absolutePath);

        return 900_000;
      },
    );

    expect(result).toEqual({ ok: true, sizeBytes: 900_000, failure: null });
    expect(requested).toEqual(["/repo/src/grown.bin"]);
    expect(calls).toHaveLength(0);
  });

  it("reports an unknown size when an untracked file is missing", async () => {
    const { client } = createScriptedGitClient({});

    const result = await probeSize(
      client,
      {
        cwd: "/repo",
        signal: signal(),
        path: "untracked.txt",
        section: "untracked",
      },
      async () => null,
    );

    expect(result).toEqual({ ok: true, sizeBytes: null, failure: null });
  });

  it("rejects a working-tree path that escapes the repository root", async () => {
    const { client } = createScriptedGitClient({});

    const result = await probeSize(
      client,
      {
        cwd: "/repo",
        signal: signal(),
        path: "../outside.txt",
        section: "working",
      },
      async () => 1,
    );

    expect(result.ok).toBeFalse();
    expect(result.sizeBytes).toBeNull();
  });

  it("keeps an environmental staged cat-file failure classified", async () => {
    const { client } = createScriptedGitClient({
      "cat-file -s :0:file.txt": fakeGitResult("", false, "fatal: not a git repository"),
    });

    const result = await probeSize(client, {
      cwd: "/repo",
      signal: signal(),
      path: "file.txt",
      section: "staged",
    });

    expect(result.ok).toBeFalse();
    expect(result.sizeBytes).toBeNull();
    expect(result.failure?.kind).toBe("not-a-repository");
  });
});

describe("diff file actions", () => {
  it("stages one file with a literal pathspec as a write", async () => {
    const { client, calls } = createScriptedGitClient({
      "add -- :(literal)a[1].txt": fakeGitResult(""),
    });

    const result = await stageFile(client, {
      cwd: "/repo",
      signal: signal(),
      targets: [{ path: "a[1].txt", oldPath: null }],
    });

    expect(result.ok).toBeTrue();
    expect(result.partial).toBeFalse();
    expect(calls[0]?.args).toEqual(["add", "--", ":(literal)a[1].txt"]);
    expect(calls[0]?.operationClass).toBe("write");
  });

  it("unstages a rename with both paths", async () => {
    const { client, calls } = createScriptedGitClient({
      "restore --staged -- :(literal)old.txt :(literal)new.txt": fakeGitResult(""),
    });

    const result = await unstageFile(client, {
      cwd: "/repo",
      signal: signal(),
      targets: [{ path: "new.txt", oldPath: "old.txt" }],
    });

    expect(result.ok).toBeTrue();
    expect(calls[0]?.args).toEqual([
      "restore",
      "--staged",
      "--",
      ":(literal)old.txt",
      ":(literal)new.txt",
    ]);
  });

  it("discards a plain tracked file with git restore", async () => {
    const { client, calls } = createScriptedGitClient({
      "restore -- :(literal)file.txt": fakeGitResult(""),
    });

    const result = await discardFile(client, {
      cwd: "/repo",
      signal: signal(),
      targets: [{ path: "file.txt", oldPath: null }],
    });

    expect(result.ok).toBeTrue();
    expect(calls[0]?.args).toEqual(["restore", "--", ":(literal)file.txt"]);
  });

  it("restores a rename's old path and removes the new path only when it is untracked", async () => {
    const { client, calls } = createScriptedGitClient({
      "restore -- :(literal)old.txt": fakeGitResult(""),
      [STATUS_KEY]: fakeGitResult(UNTRACKED_STATUS),
      "clean -f -- :(literal)new.txt": fakeGitResult(""),
    });

    const result = await discardPaths(client, {
      cwd: "/repo",
      signal: signal(),
      targets: [{ path: "new.txt", oldPath: "old.txt" }],
    });

    expect(result.ok).toBeTrue();
    expect(result.partial).toBeFalse();
    expect(calls.map((call) => call.args)).toEqual([
      ["restore", "--", ":(literal)old.txt"],
      ["status", "--porcelain=v2", "--branch", "-z", "--untracked-files=all"],
      ["clean", "-f", "--", ":(literal)new.txt"],
    ]);
  });

  it("leaves a tracked new path in place and reports the partial discard", async () => {
    const { client, calls } = createScriptedGitClient({
      "restore -- :(literal)old.txt": fakeGitResult(""),
      [STATUS_KEY]: fakeGitResult(TRACKED_STATUS),
    });

    const result = await discardPaths(client, {
      cwd: "/repo",
      signal: signal(),
      targets: [{ path: "new.txt", oldPath: "old.txt" }],
    });

    expect(result.ok).toBeTrue();
    expect(result.partial).toBeTrue();
    expect(result.warnings).toHaveLength(1);
    expect(calls.some((call) => call.args[0] === "clean")).toBeFalse();
  });

  it("leaves the new path in place when the status read fails", async () => {
    const { client, calls } = createScriptedGitClient({
      "restore -- :(literal)old.txt": fakeGitResult(""),
      [STATUS_KEY]: fakeGitResult("", false, "fatal: not a git repository"),
    });

    const result = await discardPaths(client, {
      cwd: "/repo",
      signal: signal(),
      targets: [{ path: "new.txt", oldPath: "old.txt" }],
    });

    expect(result.ok).toBeTrue();
    expect(result.partial).toBeTrue();
    expect(calls.some((call) => call.args[0] === "clean")).toBeFalse();
  });

  it("deletes one untracked file with a scoped clean", async () => {
    const { client, calls } = createScriptedGitClient({
      "clean -f -- :(literal)notes.txt": fakeGitResult(""),
    });

    const result = await deleteUntrackedFile(client, {
      cwd: "/repo",
      signal: signal(),
      targets: [{ path: "notes.txt", oldPath: null }],
    });

    expect(result.ok).toBeTrue();
    expect(calls[0]?.args).toEqual(["clean", "-f", "--", ":(literal)notes.txt"]);
  });

  it("deletes all untracked paths with one -f -d clean", async () => {
    const { client, calls } = createScriptedGitClient({
      "clean -f -d -- :(literal)a.txt :(literal)dir/b.txt": fakeGitResult(""),
    });

    const result = await deleteAllUntracked(client, {
      cwd: "/repo",
      signal: signal(),
      targets: [
        { path: "a.txt", oldPath: null },
        { path: "dir/b.txt", oldPath: null },
      ],
    });

    expect(result.ok).toBeTrue();
    expect(calls[0]?.args).toEqual([
      "clean",
      "-f",
      "-d",
      "--",
      ":(literal)a.txt",
      ":(literal)dir/b.txt",
    ]);
  });

  it("stages only the section path set and never a whole-tree pathspec", async () => {
    const { client, calls } = createScriptedGitClient({
      "add -- :(literal)a.txt :(literal)b.txt": fakeGitResult(""),
    });

    const result = await stagePaths(client, {
      cwd: "/repo",
      signal: signal(),
      targets: [
        { path: "a.txt", oldPath: null },
        { path: "b.txt", oldPath: null },
      ],
    });

    expect(result.ok).toBeTrue();
    expect(calls[0]?.args).toEqual(["add", "--", ":(literal)a.txt", ":(literal)b.txt"]);

    for (const call of calls) {
      expect(call.args).not.toContain(".");
      expect(call.args).not.toContain("-A");
      expect(call.args).not.toContain("-x");
      expect(call.args).not.toContain("--cc");
    }
  });

  it("rejects an empty path set without invoking git", async () => {
    const { client, calls } = createScriptedGitClient({});

    const result = await stagePaths(client, {
      cwd: "/repo",
      signal: signal(),
      targets: [],
    });

    expect(result.ok).toBeFalse();
    expect(result.reason).toBe("no-paths");
    expect(result.failure).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("rejects an empty path value without invoking git", async () => {
    const { client, calls } = createScriptedGitClient({});

    const result = await discardPaths(client, {
      cwd: "/repo",
      signal: signal(),
      targets: [{ path: "", oldPath: null }],
    });

    expect(result.reason).toBe("invalid-path");
    expect(calls).toHaveLength(0);
  });

  it("reports a failed write as a classified failure", async () => {
    const { client } = createScriptedGitClient({
      "add -- :(literal)file.txt": fakeGitResult("", false, "fatal: pathspec did not match"),
    });

    const result = await stageFile(client, {
      cwd: "/repo",
      signal: signal(),
      targets: [{ path: "file.txt", oldPath: null }],
    });

    expect(result.ok).toBeFalse();
    expect(result.failure?.message).toContain("pathspec did not match");
  });
});
