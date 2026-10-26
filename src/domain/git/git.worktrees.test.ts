import { describe, expect, it } from "bun:test";
import type { GitClient, GitInvocationResult, WorktreeRecord } from "@/domain/git/git.types";
import {
  buildListWorktreesArgs,
  buildWorktreeBranchMap,
  markCurrentWorktree,
  planAddWorktreeExistingBranch,
  planAddWorktreeNewBranch,
  planRemoveWorktree,
  readWorktreeDirty,
  readWorktrees,
  validateNewWorktree,
} from "@/domain/git/git.worktrees";

/**
 * Builds an invocation result.
 *
 * @param stdout - Captured output.
 * @param ok - Whether git exited cleanly.
 * @returns The synthetic result.
 */
function result(stdout: string, ok: boolean = true): GitInvocationResult {
  return {
    argv: ["git"],
    cwd: "/repo",
    exitCode: ok ? 0 : 1,
    terminationSignal: null,
    stdout,
    stderr: ok ? "" : "fatal: invalid worktree",
    durationMs: 1,
    cancelled: false,
    timedOut: false,
    timedOutAfterMs: null,
    spawnError: null,
    ok,
  };
}

/**
 * Builds a worktree record.
 *
 * @param path - Worktree path.
 * @param branch - Checked-out branch, or null for detached.
 * @returns The record.
 */
function worktree(path: string, branch: string | null): WorktreeRecord {
  return {
    path,
    headOid: "head-oid",
    branch,
    detached: branch === null,
    bare: false,
    locked: false,
    lockReason: null,
    prunable: false,
    pruneReason: null,
    current: false,
    dirty: false,
  };
}

describe("buildListWorktreesArgs", () => {
  it("reads the porcelain worktree list", () => {
    expect(buildListWorktreesArgs()).toEqual(["worktree", "list", "--porcelain"]);
  });
});

describe("readWorktrees", () => {
  const porcelain = [
    "worktree /repo",
    "HEAD aaaa",
    "branch refs/heads/main",
    "",
    "worktree /repo-topic",
    "HEAD bbbb",
    "branch refs/heads/topic",
    "",
  ].join("\n");

  it("runs the list read and marks the current worktree", async () => {
    let args: readonly string[] = [];
    const client: GitClient = {
      gitPath: "git",
      invoke: async (options) => {
        args = options.args;

        return result(porcelain);
      },
    };

    const read = await readWorktrees(
      client,
      { cwd: "/repo", signal: new AbortController().signal },
      "/repo",
    );

    expect(args).toEqual(buildListWorktreesArgs());
    expect(read.ok).toBeTrue();
    expect(read.worktrees.map((entry) => entry.current)).toEqual([true, false]);
  });

  it("returns the classified failure", async () => {
    const client: GitClient = { gitPath: "git", invoke: async () => result("", false) };
    const read = await readWorktrees(
      client,
      { cwd: "/repo", signal: new AbortController().signal },
      "/repo",
    );

    expect(read.ok).toBeFalse();
    expect(read.worktrees).toEqual([]);
    expect(read.failure?.message).toBe("fatal: invalid worktree");
  });

  it("fails a truncated read", async () => {
    const client: GitClient = {
      gitPath: "git",
      invoke: async () => ({ ...result(porcelain), stdoutTruncated: true }),
    };
    const read = await readWorktrees(
      client,
      { cwd: "/repo", signal: new AbortController().signal },
      "/repo",
    );

    expect(read.ok).toBeFalse();
    expect(read.failure?.message).toBe("git worktree list --porcelain output was truncated");
  });
});

describe("markCurrentWorktree", () => {
  const worktrees = [worktree("/repo", "main"), worktree("/repo-topic", "topic")];

  it("marks the worktree whose path equals the root", () => {
    expect(markCurrentWorktree(worktrees, "/repo").map((entry) => entry.current)).toEqual([
      true,
      false,
    ]);
  });

  it("ignores a trailing separator on either value", () => {
    expect(markCurrentWorktree(worktrees, "/repo/").map((entry) => entry.current)).toEqual([
      true,
      false,
    ]);
  });

  it("marks nothing without a root", () => {
    expect(markCurrentWorktree(worktrees, null).map((entry) => entry.current)).toEqual([
      false,
      false,
    ]);
  });

  it("does not mutate the input", () => {
    markCurrentWorktree(worktrees, "/repo");

    expect(worktrees[0]?.current).toBeFalse();
  });
});

describe("buildWorktreeBranchMap", () => {
  it("maps each checked-out branch to its worktree", () => {
    const map = buildWorktreeBranchMap([
      worktree("/repo", "main"),
      worktree("/repo-topic", "topic"),
      worktree("/repo-detached", null),
    ]);

    expect([...map.keys()]).toEqual(["main", "topic"]);
    expect(map.get("topic")?.path).toBe("/repo-topic");
    expect(map.has("null")).toBeFalse();
  });

  it("excludes detached and bare entries", () => {
    const bare: WorktreeRecord = { ...worktree("/repo-bare", null), bare: true };
    const map = buildWorktreeBranchMap([bare, worktree("/repo-detached", null)]);

    expect(map.size).toBe(0);
  });

  it("keeps the first worktree for a duplicated branch", () => {
    const map = buildWorktreeBranchMap([
      worktree("/repo", "main"),
      worktree("/repo-copy", "main"),
      worktree("/repo-topic", "topic"),
    ]);

    expect(map.get("main")?.path).toBe("/repo");
  });
});

describe("readWorktreeDirty", () => {
  it("runs canonical status inside the worktree path", async () => {
    let args: readonly string[] = [];
    let cwd = "";
    let touchesIndex = false;
    const client: GitClient = {
      gitPath: "git",
      invoke: async (options) => {
        args = options.args;
        cwd = options.cwd;
        touchesIndex = options.touchesIndex === true;

        return result("? untracked.txt\0");
      },
    };

    const read = await readWorktreeDirty(
      client,
      { cwd: "/repo", signal: new AbortController().signal },
      "/repo-topic",
    );

    expect(args).toEqual(["status", "--porcelain=v2", "--branch", "-z", "--untracked-files=all"]);
    expect(cwd).toBe("/repo-topic");
    expect(touchesIndex).toBeTrue();
    expect(read).toEqual({ ok: true, dirty: true, failure: null });
  });

  it("reports a clean worktree from branch headers only", async () => {
    const client: GitClient = {
      gitPath: "git",
      invoke: async () =>
        result("# branch.oid aaaa\0# branch.head main\0# branch.upstream origin/main\0"),
    };

    const read = await readWorktreeDirty(
      client,
      { cwd: "/repo", signal: new AbortController().signal },
      "/repo-topic",
    );

    expect(read.dirty).toBeFalse();
  });

  it("detects a change in newline-separated output", async () => {
    const client: GitClient = {
      gitPath: "git",
      invoke: async () =>
        result("# branch.head main\n1 .M N... 100644 100644 100644 aaaa bbbb file.txt\n"),
    };

    const read = await readWorktreeDirty(
      client,
      { cwd: "/repo", signal: new AbortController().signal },
      "/repo-topic",
    );

    expect(read.dirty).toBeTrue();
  });

  it("returns the classified failure", async () => {
    const client: GitClient = { gitPath: "git", invoke: async () => result("", false) };
    const read = await readWorktreeDirty(
      client,
      { cwd: "/repo", signal: new AbortController().signal },
      "/repo-topic",
    );

    expect(read.ok).toBeFalse();
    expect(read.dirty).toBeFalse();
    expect(read.failure?.message).toBe("fatal: invalid worktree");
  });

  it("fails a truncated read", async () => {
    const client: GitClient = {
      gitPath: "git",
      invoke: async () => ({ ...result("? file\0"), stdoutTruncated: true }),
    };
    const read = await readWorktreeDirty(
      client,
      { cwd: "/repo", signal: new AbortController().signal },
      "/repo-topic",
    );

    expect(read.ok).toBeFalse();
    expect(read.failure?.message).toBe("git status in the worktree output was truncated");
  });

  it("rejects an unusable path without invoking git", async () => {
    let invoked = false;
    const client: GitClient = {
      gitPath: "git",
      invoke: async () => {
        invoked = true;

        return result("");
      },
    };

    const read = await readWorktreeDirty(
      client,
      { cwd: "/repo", signal: new AbortController().signal },
      "--upload-pack",
    );

    expect(invoked).toBeFalse();
    expect(read.ok).toBeFalse();
    expect(read.failure?.message).toBe('invalid worktree path "--upload-pack"');
  });
});

describe("validateNewWorktree", () => {
  const worktrees = [worktree("/repo", "main"), worktree("/repo-topic", "topic")];
  const facts = {
    branches: ["main", "topic"],
    worktrees,
    pathExists: false,
  };

  it("accepts a new branch from HEAD", () => {
    expect(
      validateNewWorktree({ path: "/repo-feature", mode: "new", branch: "feature" }, facts),
    ).toBeNull();
  });

  it("accepts an existing branch that is not checked out elsewhere", () => {
    expect(
      validateNewWorktree(
        { path: "/repo-old", mode: "existing", branch: "old" },
        {
          ...facts,
          branches: [...facts.branches, "old"],
        },
      ),
    ).toBeNull();
  });

  it("requires a path", () => {
    expect(validateNewWorktree({ path: "", mode: "new", branch: "feature" }, facts)).toBe(
      "path is required",
    );
  });

  it("rejects an existing path", () => {
    expect(
      validateNewWorktree(
        { path: "/repo-feature", mode: "new", branch: "feature" },
        {
          ...facts,
          pathExists: true,
        },
      ),
    ).toBe("path already exists");
  });

  it("rejects an option-like path", () => {
    expect(validateNewWorktree({ path: "-oops", mode: "new", branch: "feature" }, facts)).toBe(
      "invalid path",
    );
  });

  it("rejects an invalid branch name", () => {
    expect(
      validateNewWorktree({ path: "/repo-feature", mode: "new", branch: "bad name" }, facts),
    ).toBe("invalid branch name");
  });

  it("rejects a new branch that already exists", () => {
    expect(validateNewWorktree({ path: "/repo-feature", mode: "new", branch: "main" }, facts)).toBe(
      "branch already exists",
    );
  });

  it("rejects an existing branch that does not exist", () => {
    expect(
      validateNewWorktree({ path: "/repo-feature", mode: "existing", branch: "missing" }, facts),
    ).toBe("branch does not exist");
  });

  it("rejects a branch checked out in another worktree", () => {
    expect(
      validateNewWorktree({ path: "/repo-feature", mode: "existing", branch: "main" }, facts),
    ).toBe("branch is checked out in another worktree");
  });

  it("accepts branch records where the facts carry them", () => {
    expect(
      validateNewWorktree(
        { path: "/repo-feature", mode: "existing", branch: "main" },
        {
          branches: [{ name: "main" }],
          worktrees: [],
          pathExists: false,
        },
      ),
    ).toBeNull();
  });
});

describe("worktree planners", () => {
  it("plans a new branch from HEAD", () => {
    expect(planAddWorktreeNewBranch({ path: "/repo-feature", branch: "feature" })).toEqual({
      ok: true,
      args: ["worktree", "add", "-b", "feature", "/repo-feature", "HEAD"],
    });
  });

  it("plans an existing branch", () => {
    expect(planAddWorktreeExistingBranch({ path: "/repo-topic", branch: "topic" })).toEqual({
      ok: true,
      args: ["worktree", "add", "/repo-topic", "topic"],
    });
  });

  it("selects no flag, one --force, or two -f flags", () => {
    expect(planRemoveWorktree("/repo-topic", { force: 0 })).toEqual({
      ok: true,
      args: ["worktree", "remove", "/repo-topic"],
    });
    expect(planRemoveWorktree("/repo-topic", { force: 1 })).toEqual({
      ok: true,
      args: ["worktree", "remove", "--force", "/repo-topic"],
    });
    expect(planRemoveWorktree("/repo-topic", { force: 2 })).toEqual({
      ok: true,
      args: ["worktree", "remove", "-f", "-f", "/repo-topic"],
    });
  });

  it("rejects an unsafe path or branch", () => {
    expect(planAddWorktreeNewBranch({ path: "-oops", branch: "feature" }).ok).toBeFalse();
    expect(planAddWorktreeNewBranch({ path: "/repo-feature", branch: "bad name" }).ok).toBeFalse();
    expect(planAddWorktreeExistingBranch({ path: "", branch: "topic" }).ok).toBeFalse();
    expect(planRemoveWorktree("-oops", { force: 0 }).ok).toBeFalse();
    expect(planRemoveWorktree("bad\npath", { force: 2 }).ok).toBeFalse();
  });
});
