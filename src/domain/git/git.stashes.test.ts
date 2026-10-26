import { describe, expect, it } from "bun:test";
import {
  buildListStashesArgs,
  buildShowStashArgs,
  getStashCreateAvailability,
  parseSourceBranch,
  planApplyStash,
  planCreateStash,
  planDropStash,
  planPopStash,
  readStashes,
  resolveStashRef,
  sortStashesNewestFirst,
} from "@/domain/git/git.stashes";
import type {
  GitClient,
  GitInvocationResult,
  StashRecord,
  StatusSnapshot,
} from "@/domain/git/git.types";

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
    stderr: ok ? "" : "fatal: not a stash",
    durationMs: 1,
    cancelled: false,
    timedOut: false,
    timedOutAfterMs: null,
    spawnError: null,
    ok,
  };
}

/**
 * Builds a stash record.
 *
 * @param position - Numeric stash position.
 * @param objectName - Stash commit id.
 * @returns The record.
 */
function stash(position: number, objectName: string): StashRecord {
  return {
    index: `stash@{${position}}`,
    objectName,
    subject: `WIP on main: ${objectName}`,
    sourceBranch: "main",
    committedAt: 1700000000 + position,
  };
}

/**
 * Builds a status snapshot with the given change counts.
 *
 * @param counts - Staged, unstaged, and untracked counts, plus HEAD existence.
 * @returns The snapshot.
 */
function status(counts: {
  staged?: number;
  unstaged?: number;
  untracked?: number;
  hasHead?: boolean;
}): StatusSnapshot {
  return {
    headOid: counts.hasHead === false ? null : "head-oid",
    branch: "main",
    detached: false,
    upstream: null,
    ahead: 0,
    behind: 0,
    entries: [],
    conflictedPaths: [],
    stagedCount: counts.staged ?? 0,
    unstagedCount: counts.unstaged ?? 0,
    untrackedCount: counts.untracked ?? 0,
  };
}

describe("buildListStashesArgs", () => {
  it("reads the selector, object, subject, and timestamp in one invocation", () => {
    expect(buildListStashesArgs()).toEqual(["stash", "list", "--format=%gd%x00%H%x00%gs%x00%ct"]);
  });
});

describe("readStashes", () => {
  it("runs the stash list read and parses the result", async () => {
    let args: readonly string[] = [];
    const client: GitClient = {
      gitPath: "git",
      invoke: async (options) => {
        args = options.args;

        return result("stash@{0}\u0000aaaa\u0000WIP on main: one\u000010\n");
      },
    };

    const read = await readStashes(client, {
      cwd: "/repo",
      signal: new AbortController().signal,
    });

    expect(args).toEqual(buildListStashesArgs());
    expect(read.ok).toBeTrue();
    expect(read.stashes[0]?.objectName).toBe("aaaa");
  });

  it("returns the classified failure", async () => {
    const client: GitClient = { gitPath: "git", invoke: async () => result("", false) };
    const read = await readStashes(client, {
      cwd: "/repo",
      signal: new AbortController().signal,
    });

    expect(read.ok).toBeFalse();
    expect(read.stashes).toEqual([]);
    expect(read.failure?.message).toBe("fatal: not a stash");
  });

  it("fails a truncated read", async () => {
    const client: GitClient = {
      gitPath: "git",
      invoke: async () => ({ ...result("stash@{0}\n"), stdoutTruncated: true }),
    };
    const read = await readStashes(client, {
      cwd: "/repo",
      signal: new AbortController().signal,
    });

    expect(read.ok).toBeFalse();
    expect(read.failure?.message).toBe("git stash list output was truncated");
  });
});

describe("sortStashesNewestFirst", () => {
  it("orders by ascending index because stash@{0} is newest", () => {
    const stashes = [stash(1, "b"), stash(0, "a"), stash(3, "d"), stash(2, "c")];

    expect(sortStashesNewestFirst(stashes).map((entry) => entry.index)).toEqual([
      "stash@{0}",
      "stash@{1}",
      "stash@{2}",
      "stash@{3}",
    ]);
  });

  it("does not mutate the input and keeps a deterministic tie-break", () => {
    const stashes = [stash(0, "b"), stash(0, "a")];
    const sorted = sortStashesNewestFirst(stashes);

    expect(stashes.map((entry) => entry.objectName)).toEqual(["b", "a"]);
    expect(sorted.map((entry) => entry.objectName)).toEqual(["a", "b"]);
  });

  it("orders a malformed selector before numeric selectors and ties by object name", () => {
    const malformed = (objectName: string): StashRecord => ({
      ...stash(0, objectName),
      index: "not-a-selector",
    });
    const stashes = [stash(2, "c"), malformed("b"), malformed("a"), stash(0, "d")];
    const sorted = sortStashesNewestFirst(stashes);

    expect(sorted.map((entry) => entry.objectName)).toEqual(["a", "b", "d", "c"]);
  });
});

describe("stash module re-exports", () => {
  it("exposes the source branch parser beside the read module", () => {
    expect(parseSourceBranch("WIP on topic: 1234abc message")).toBe("topic");
  });
});

describe("resolveStashRef", () => {
  const stashes = [stash(0, "newest"), stash(1, "middle"), stash(2, "oldest")];

  it("finds the current selector for a matching object name", () => {
    expect(resolveStashRef(stashes, "middle")).toEqual({ status: "found", index: "stash@{1}" });
  });

  it("finds a moved stash by its object name instead of its old index", () => {
    const moved = [stash(0, "newest"), stash(1, "middle")];

    expect(resolveStashRef(moved, "middle")).toEqual({ status: "found", index: "stash@{1}" });
  });

  it("reports a missing stash", () => {
    expect(resolveStashRef(stashes, "dropped")).toEqual({ status: "missing" });
  });

  it("reports changed when a selector target now holds a different stash", () => {
    expect(resolveStashRef(stashes, "stash@{0}")).toEqual({ status: "changed" });
  });

  it("reports missing for a selector target that no longer exists", () => {
    expect(resolveStashRef(stashes, "stash@{9}")).toEqual({ status: "missing" });
  });
});

describe("getStashCreateAvailability", () => {
  it("reports no reason before the first snapshot", () => {
    expect(getStashCreateAvailability(null, false)).toBeNull();
  });

  it("reports no commits yet in an empty repository", () => {
    expect(getStashCreateAvailability(status({ hasHead: false, staged: 2 }), false)).toBe(
      "no-commits-yet",
    );
  });

  it("reports nothing to stash without any change", () => {
    expect(getStashCreateAvailability(status({}), false)).toBe("nothing-to-stash");
  });

  it("allows staged or unstaged changes", () => {
    expect(getStashCreateAvailability(status({ staged: 1 }), false)).toBeNull();
    expect(getStashCreateAvailability(status({ unstaged: 1 }), false)).toBeNull();
  });

  it("reports only untracked changes until the checkbox is on", () => {
    expect(getStashCreateAvailability(status({ untracked: 2 }), false)).toBe(
      "only-untracked-changes",
    );
    expect(getStashCreateAvailability(status({ untracked: 2 }), true)).toBeNull();
  });

  it("allows tracked changes when untracked files are excluded", () => {
    expect(getStashCreateAvailability(status({ unstaged: 1, untracked: 3 }), false)).toBeNull();
  });
});

describe("stash planners", () => {
  it("plans a tracked-only stash and an untracked-inclusive stash", () => {
    expect(planCreateStash("checkpoint", false)).toEqual({
      ok: true,
      args: ["stash", "push", "-m", "checkpoint"],
    });
    expect(planCreateStash("checkpoint", true)).toEqual({
      ok: true,
      args: ["stash", "push", "-u", "-m", "checkpoint"],
    });
  });

  it("rejects a missing message", () => {
    expect(planCreateStash("", false)).toEqual({
      ok: false,
      error: "stash message is required",
    });
  });

  it("plans apply, pop, drop, and show for the resolved selector", () => {
    expect(planApplyStash("stash@{0}")).toEqual({
      ok: true,
      args: ["stash", "apply", "stash@{0}"],
    });
    expect(planPopStash("stash@{1}")).toEqual({
      ok: true,
      args: ["stash", "pop", "stash@{1}"],
    });
    expect(planDropStash("stash@{2}")).toEqual({
      ok: true,
      args: ["stash", "drop", "stash@{2}"],
    });
    expect(buildShowStashArgs("stash@{3}")).toEqual({
      ok: true,
      args: ["stash", "show", "-p", "--no-color", "stash@{3}"],
    });
  });

  it("rejects an index that is not a stash selector", () => {
    expect(planApplyStash("0")).toEqual({
      ok: false,
      error: 'invalid stash selector "0"',
    });
    expect(planPopStash("HEAD~1").ok).toBeFalse();
    expect(planDropStash("-oops").ok).toBeFalse();
    expect(buildShowStashArgs("stash@{0}; rm -rf /").ok).toBeFalse();
  });
});
