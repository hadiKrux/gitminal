import { describe, expect, it } from "bun:test";
import { parseWorktrees } from "@/domain/git/parsers/parse.worktrees";

/** Recorded porcelain output covering every documented worktree state. */
const PORCELAIN = [
  "worktree /repo",
  "HEAD aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "branch refs/heads/main",
  "",
  "worktree /repo-feature",
  "HEAD bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "branch refs/heads/feature/x",
  "",
  "worktree /repo-detached",
  "HEAD cccccccccccccccccccccccccccccccccccccccc",
  "detached",
  "",
  "worktree /repo-locked",
  "HEAD dddddddddddddddddddddddddddddddddddddddd",
  "branch refs/heads/locked",
  "locked on a removable volume",
  "",
  "worktree /repo-prunable",
  "HEAD eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
  "detached",
  "prunable gitdir file points to non-existent location",
  "",
  "worktree /repo-bare",
  "bare",
  "",
].join("\n");

describe("parseWorktrees", () => {
  it("parses the main worktree with its branch", () => {
    const [main] = parseWorktrees(PORCELAIN);

    expect(main).toEqual({
      path: "/repo",
      headOid: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      branch: "main",
      detached: false,
      bare: false,
      locked: false,
      lockReason: null,
      prunable: false,
      pruneReason: null,
      current: false,
      dirty: false,
    });
  });

  it("parses a linked worktree with a slash branch", () => {
    const linked = parseWorktrees(PORCELAIN)[1];

    expect(linked?.path).toBe("/repo-feature");
    expect(linked?.branch).toBe("feature/x");
  });

  it("parses a detached worktree without a branch", () => {
    const detached = parseWorktrees(PORCELAIN)[2];

    expect(detached?.detached).toBeTrue();
    expect(detached?.branch).toBeNull();
    expect(detached?.headOid).toBe("cccccccccccccccccccccccccccccccccccccccc");
  });

  it("parses a locked worktree and its reason", () => {
    const locked = parseWorktrees(PORCELAIN)[3];

    expect(locked?.locked).toBeTrue();
    expect(locked?.lockReason).toBe("on a removable volume");
  });

  it("parses a prunable worktree and its reason", () => {
    const prunable = parseWorktrees(PORCELAIN)[4];

    expect(prunable?.prunable).toBeTrue();
    expect(prunable?.pruneReason).toBe("gitdir file points to non-existent location");
  });

  it("parses a bare worktree without a branch or HEAD", () => {
    const bare = parseWorktrees(PORCELAIN)[5];

    expect(bare).toEqual({
      path: "/repo-bare",
      headOid: null,
      branch: null,
      detached: false,
      bare: true,
      locked: false,
      lockReason: null,
      prunable: false,
      pruneReason: null,
      current: false,
      dirty: false,
    });
  });

  it("parses every block in order", () => {
    expect(parseWorktrees(PORCELAIN).map((worktree) => worktree.path)).toEqual([
      "/repo",
      "/repo-feature",
      "/repo-detached",
      "/repo-locked",
      "/repo-prunable",
      "/repo-bare",
    ]);
  });

  it("treats a lock or prune marker without a reason as a null reason", () => {
    const stdout = [
      "worktree /repo",
      "HEAD abc",
      "branch refs/heads/main",
      "locked",
      "prunable",
    ].join("\n");
    const [worktree] = parseWorktrees(stdout);

    expect(worktree?.locked).toBeTrue();
    expect(worktree?.lockReason).toBeNull();
    expect(worktree?.prunable).toBeTrue();
    expect(worktree?.pruneReason).toBeNull();
  });

  it("handles carriage returns and ignores blocks without a path", () => {
    const stdout = "worktree /repo\r\nHEAD abc\r\nbranch refs/heads/main\r\n";

    expect(parseWorktrees(stdout)).toHaveLength(1);
    expect(parseWorktrees("bare\n")).toEqual([]);
  });

  it("returns an empty list for empty output", () => {
    expect(parseWorktrees("")).toEqual([]);
  });
});
