import { describe, expect, it } from "bun:test";
import {
  buildCommitDiffArgs,
  buildCommitFileDiffArgs,
  buildCommitFileListArgs,
} from "@/domain/git/git.diff";
import { readCommitDiff, readStashDiff } from "@/domain/git/git.diff.read-only";
import {
  buildStashDiffArgs,
  buildStashFileDiffArgs,
  buildStashFileListArgs,
} from "@/domain/git/git.stashes";
import type { GitArgPlan, GitInvocationResult } from "@/domain/git/git.types";
import { createScriptedGitClient, fakeGitResult } from "@/test/git.fake";

/** A valid modified-file patch. */
const MODIFIED_PATCH = [
  "diff --git a/one.txt b/one.txt",
  "--- a/one.txt",
  "+++ b/one.txt",
  "@@ -1,1 +1,2 @@",
  " one",
  "+two",
  "",
].join("\n");

/** A valid added-file patch. */
const ADDED_PATCH = [
  "diff --git a/two.txt b/two.txt",
  "new file mode 100644",
  "--- /dev/null",
  "+++ b/two.txt",
  "@@ -0,0 +1,1 @@",
  "+two",
  "",
].join("\n");

/** A valid rename patch carrying both paths. */
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

/** Changed-file list carrying a modified, an added, and a renamed file. */
const NAME_STATUS = "M\0one.txt\0A\0two.txt\0R100\0old.txt\0new.txt\0";

/**
 * Reads a planned argument array as the fake client's key.
 *
 * @param plan - Planned arguments.
 * @returns The joined key.
 */
function argsOf(plan: GitArgPlan): string {
  if (!plan.ok) {
    throw new Error(plan.error);
  }

  return plan.args.join(" ");
}

/**
 * Builds a result whose stdout lost its middle to the client capture limit.
 *
 * @param stdout - Retained stdout text.
 * @returns The truncated result.
 */
function truncatedResult(stdout: string): GitInvocationResult {
  return { ...fakeGitResult(stdout), stdoutTruncated: true };
}

/**
 * Builds the signal used by every read.
 *
 * @returns A fresh, unaborted signal.
 */
function signal(): AbortSignal {
  return new AbortController().signal;
}

describe("read-only diff per-file fallback", () => {
  it("reads a truncated commit diff one file per invocation", async () => {
    const listArgs = argsOf(buildCommitFileListArgs("abc1234"));
    const oneArgs = argsOf(
      buildCommitFileDiffArgs("abc1234", { path: "one.txt", oldPath: null, status: "modified" }, 3),
    );
    const twoArgs = argsOf(
      buildCommitFileDiffArgs("abc1234", { path: "two.txt", oldPath: null, status: "added" }, 3),
    );
    const renameArgs = argsOf(
      buildCommitFileDiffArgs(
        "abc1234",
        { path: "new.txt", oldPath: "old.txt", status: "renamed" },
        3,
      ),
    );
    const { client, calls } = createScriptedGitClient({
      [argsOf(buildCommitDiffArgs("abc1234", 3))]: truncatedResult(
        "diff --git a/one.txt b/one.txt",
      ),
      [listArgs]: fakeGitResult(NAME_STATUS),
      [oneArgs]: fakeGitResult(MODIFIED_PATCH),
      [twoArgs]: fakeGitResult(ADDED_PATCH),
      [renameArgs]: fakeGitResult(RENAME_PATCH),
    });

    const result = await readCommitDiff(client, {
      cwd: "/repo",
      signal: signal(),
      sha: "abc1234",
      contextLines: 3,
    });

    expect(result.ok).toBeTrue();
    expect(result.failure).toBeNull();
    expect(result.files.map((file) => file.path)).toEqual(["one.txt", "two.txt", "new.txt"]);
    expect(result.files.map((file) => file.status)).toEqual(["modified", "added", "renamed"]);
    expect(result.files[2]?.oldPath).toBe("old.txt");
    expect(result.files[2]?.hunks).toHaveLength(1);
    expect(calls.map((call) => call.args.join(" "))).toEqual([
      argsOf(buildCommitDiffArgs("abc1234", 3)),
      listArgs,
      oneArgs,
      twoArgs,
      renameArgs,
    ]);
  });

  it("reads a truncated stash diff one file per invocation", async () => {
    const oneFile = { path: "one.txt", oldPath: null, status: "modified" } as const;
    const listArgs = argsOf(buildStashFileListArgs("stash@{0}"));
    const fileArgs = argsOf(buildStashFileDiffArgs("stash@{0}", oneFile, 3));
    const { client } = createScriptedGitClient({
      [argsOf(buildStashDiffArgs("stash@{0}", 3))]: truncatedResult(
        "diff --git a/one.txt b/one.txt",
      ),
      [listArgs]: fakeGitResult("M\0one.txt\0"),
      [fileArgs]: fakeGitResult(MODIFIED_PATCH),
    });

    const result = await readStashDiff(client, {
      cwd: "/repo",
      signal: signal(),
      stashRef: "stash@{0}",
      contextLines: 3,
    });

    expect(result.ok).toBeTrue();
    expect(result.files.map((file) => file.path)).toEqual(["one.txt"]);
    expect(result.files[0]?.status).toBe("modified");
  });

  it("keeps an ordinary commit diff to one whole-patch invocation", async () => {
    const { client, calls } = createScriptedGitClient({
      [argsOf(buildCommitDiffArgs("abc1234", 3))]: fakeGitResult(MODIFIED_PATCH),
    });

    const result = await readCommitDiff(client, {
      cwd: "/repo",
      signal: signal(),
      sha: "abc1234",
      contextLines: 3,
    });

    expect(result.ok).toBeTrue();
    expect(result.files).toHaveLength(1);
    expect(calls).toHaveLength(1);
  });

  it("fails the diff when a per-file read fails", async () => {
    const listArgs = argsOf(buildCommitFileListArgs("abc1234"));
    const oneArgs = argsOf(
      buildCommitFileDiffArgs("abc1234", { path: "one.txt", oldPath: null, status: "modified" }, 3),
    );
    const { client } = createScriptedGitClient({
      [argsOf(buildCommitDiffArgs("abc1234", 3))]: truncatedResult(
        "diff --git a/one.txt b/one.txt",
      ),
      [listArgs]: fakeGitResult("M\0one.txt\0"),
      [oneArgs]: fakeGitResult("", false, "fatal: bad object"),
    });

    const result = await readCommitDiff(client, {
      cwd: "/repo",
      signal: signal(),
      sha: "abc1234",
      contextLines: 3,
    });

    expect(result.ok).toBeFalse();
    expect(result.files).toEqual([]);
    expect(result.failure?.message).toContain("fatal: bad object");
  });
});
