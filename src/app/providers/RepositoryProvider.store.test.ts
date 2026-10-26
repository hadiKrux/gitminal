import { describe, expect, it } from "bun:test";
import { applyReadToStore, createInitialStore } from "@/app/providers/RepositoryProvider.store";
import { getAvailability } from "@/domain/commands/commands.availability";
import type { CommandContext } from "@/domain/commands/commands.types";
import type {
  BranchRecord,
  RemoteBranchRecord,
  StashRecord,
  TagRecord,
  WorktreeRecord,
} from "@/domain/git/git.types";
import {
  createRepositorySignals,
  detectRepositoryState,
} from "@/domain/repository/repository.states";
import type {
  RepositoryListFailures,
  RepositoryReadResult,
  RepositorySelection,
  RepositorySignals,
  RepositorySnapshot,
} from "@/domain/repository/repository.types";

/** Initial selection used by every store fixture. */
const INITIAL_SELECTION: RepositorySelection = Object.freeze({ kind: "pending" });

/**
 * Builds a loaded signal set with overrides.
 *
 * @param overrides - Signal values to override.
 * @returns The signal set.
 */
function signals(overrides: Partial<RepositorySignals> = {}): RepositorySignals {
  return createRepositorySignals({
    loaded: true,
    insideWorkTree: true,
    repositoryRoot: "/repo",
    cwd: "/repo",
    headExists: true,
    branch: "main",
    remotes: ["origin"],
    ...overrides,
  });
}

/**
 * Builds one local branch record.
 *
 * @param name - Branch name.
 * @returns The branch record.
 */
function branch(name: string): BranchRecord {
  return {
    name,
    head: name === "main",
    tipOid: "abc123",
    committerDate: null,
    upstream: null,
    upstreamRemote: null,
    upstreamBranch: null,
    ahead: 0,
    behind: 0,
    worktreePath: null,
    upstreamStatus: "none",
  };
}

/**
 * Builds one stash record.
 *
 * @param objectName - Immutable stash object name.
 * @returns The stash record.
 */
function stash(objectName: string): StashRecord {
  return {
    index: "stash@{0}",
    objectName,
    subject: "WIP on main: abc123 work",
    sourceBranch: "main",
    committedAt: 1_700_000_000,
  };
}

/**
 * Builds one remote-tracking branch record.
 *
 * @param remote - Remote name.
 * @param branchName - Branch name inside the remote.
 * @returns The remote branch record.
 */
function remoteBranch(remote: string, branchName: string): RemoteBranchRecord {
  return {
    ref: `refs/remotes/${remote}/${branchName}`,
    remote,
    branch: branchName,
    tipOid: "abc123",
    committerDate: null,
    subject: "subject",
  };
}

/**
 * Builds one local tag record.
 *
 * @param name - Tag name.
 * @returns The tag record.
 */
function tag(name: string): TagRecord {
  return { name, objectType: "commit", targetOid: "abc123", subject: "subject" };
}

/**
 * Builds one worktree record.
 *
 * @param path - Absolute worktree path.
 * @param branchName - Checked-out branch name, or null when detached.
 * @param current - Whether this is the session's current worktree.
 * @returns The worktree record.
 */
function worktree(path: string, branchName: string | null, current: boolean): WorktreeRecord {
  return {
    path,
    headOid: "abc123",
    branch: branchName,
    detached: false,
    bare: false,
    locked: false,
    lockReason: null,
    prunable: false,
    pruneReason: null,
    current,
    dirty: false,
  };
}

/**
 * Builds one snapshot with overrides.
 *
 * @param overrides - Snapshot values to override.
 * @returns The snapshot.
 */
function snapshot(overrides: Partial<RepositorySnapshot> = {}): RepositorySnapshot {
  return {
    cwd: "/repo",
    root: "/repo",
    gitDir: "/repo/.git",
    branch: "main",
    headOid: "abc123",
    headSubject: "initial commit",
    shortHash: null,
    detached: false,
    bare: false,
    remotes: [{ name: "origin", fetchUrl: "git@example.com:repo.git", pushUrl: null }],
    upstream: "origin/main",
    ahead: 0,
    behind: 0,
    status: {
      headOid: "abc123",
      branch: "main",
      detached: false,
      upstream: "origin/main",
      ahead: 0,
      behind: 0,
      entries: [],
      conflictedPaths: [],
      stagedCount: 0,
      unstagedCount: 0,
      untrackedCount: 0,
    },
    branches: [],
    remoteBranches: [],
    tags: [],
    stashes: [],
    worktrees: [],
    currentWorktreePath: "/repo",
    identity: { name: "Test User", email: "test@example.com" },
    readAt: 1_000,
    ...overrides,
  };
}

/**
 * Builds a successful read result.
 *
 * @param next - Snapshot the read produced.
 * @param listFailures - Optional lists the read could not load.
 * @param signalOverrides - Signal values to override.
 * @returns The read result.
 */
function successResult(
  next: RepositorySnapshot | null,
  listFailures: RepositoryListFailures = {},
  signalOverrides: Partial<RepositorySignals> = {},
): RepositoryReadResult {
  return {
    ok: true,
    snapshot: next,
    signals: signals(signalOverrides),
    listFailures,
    upstreamStatus: "healthy",
    gitAvailable: true,
    error: null,
    failureKind: null,
  };
}

/**
 * Builds a failed read result.
 *
 * @returns The read result.
 */
function failureResult(): RepositoryReadResult {
  return {
    ok: false,
    snapshot: null,
    signals: signals({ loaded: false }),
    listFailures: {},
    upstreamStatus: "none",
    gitAvailable: true,
    error: "fatal: unable to read index",
    failureKind: "cancelled",
  };
}

/**
 * Builds a store that already applied one successful read.
 *
 * @returns The store.
 */
function loadedStore() {
  return applyReadToStore(
    createInitialStore("/repo", INITIAL_SELECTION, false),
    successResult(
      snapshot({
        branches: [branch("main")],
        remoteBranches: [remoteBranch("origin", "main")],
        stashes: [stash("aaa111")],
        tags: [tag("v1.0.0")],
        currentWorktreePath: "/repo",
      }),
    ),
    false,
  );
}

describe("applyReadToStore", () => {
  it("keeps the previous value of a failed list and applies every successful list", () => {
    const next = applyReadToStore(
      loadedStore(),
      successResult(
        snapshot({
          branches: [branch("feature")],
          tags: [],
          stashes: [],
          status: {
            headOid: "abc123",
            branch: "main",
            detached: false,
            upstream: "origin/main",
            ahead: 0,
            behind: 0,
            entries: [],
            conflictedPaths: [],
            stagedCount: 0,
            unstagedCount: 0,
            untrackedCount: 3,
          },
        }),
        { stashes: "fatal: unable to read logs" },
        { untrackedCount: 3 },
      ),
      false,
    );

    expect(next.snapshot?.branches.map((record) => record.name)).toEqual(["feature"]);
    expect(next.snapshot?.tags).toEqual([]);
    expect(next.snapshot?.stashes.map((record) => record.objectName)).toEqual(["aaa111"]);
    expect(next.snapshot?.status?.untrackedCount).toBe(3);
    expect(next.signals.untrackedCount).toBe(3);
    expect(next.listFailures).toEqual({ stashes: "fatal: unable to read logs" });
    expect(next.lastRefreshError).toBeNull();
  });

  it("keeps the current worktree path together with a kept worktree list", () => {
    const next = applyReadToStore(
      loadedStore(),
      successResult(snapshot({ worktrees: [], currentWorktreePath: null }), {
        worktrees: "fatal: cannot read worktrees",
      }),
      false,
    );

    expect(next.snapshot?.worktrees).toEqual([]);
    expect(next.snapshot?.currentWorktreePath).toBe("/repo");
  });

  it("re-derives branch worktree attribution from retained worktrees when the worktree read fails", () => {
    const retainedWorktrees = [
      worktree("/repo", "main", true),
      worktree("/repo-feature", "feature", false),
    ];
    const before = applyReadToStore(
      createInitialStore("/repo", INITIAL_SELECTION, false),
      successResult(
        snapshot({
          branches: [{ ...branch("feature"), worktreePath: "/repo-feature" }],
          worktrees: retainedWorktrees,
        }),
      ),
      false,
    );
    const next = applyReadToStore(
      before,
      successResult(
        snapshot({ branches: [branch("feature")], worktrees: [], currentWorktreePath: null }),
        { worktrees: "fatal: cannot read worktrees" },
      ),
      false,
    );
    const feature = next.snapshot?.branches.find((record) => record.name === "feature");

    expect(next.listFailures).toEqual({ worktrees: "fatal: cannot read worktrees" });
    expect(next.snapshot?.worktrees).toEqual(retainedWorktrees);
    expect(feature?.worktreePath).toBe("/repo-feature");

    const currentSignals = signals();
    const context: CommandContext = {
      state: detectRepositoryState(currentSignals),
      signals: currentSignals,
      target: { kind: "branch", name: "feature" },
      region: "branches",
      operation: "idle",
      panel: { branches: next.snapshot?.branches ?? [] },
    };

    expect(getAvailability("branch.delete", context)).toEqual({
      available: false,
      reason: "checked-out-in-worktree",
    });
  });

  it("re-derives branch worktree attribution from newly read worktrees when the branch read fails", () => {
    const before = applyReadToStore(
      createInitialStore("/repo", INITIAL_SELECTION, false),
      successResult(
        snapshot({
          branches: [branch("feature"), { ...branch("stale"), worktreePath: "/repo-stale" }],
          worktrees: [worktree("/repo", "main", true)],
        }),
      ),
      false,
    );
    const nextWorktrees = [
      worktree("/repo", "main", true),
      worktree("/repo-feature", "feature", false),
    ];
    const next = applyReadToStore(
      before,
      successResult(snapshot({ branches: [], worktrees: nextWorktrees }), {
        branches: "fatal: cannot read branches",
      }),
      false,
    );
    const feature = next.snapshot?.branches.find((record) => record.name === "feature");
    const stale = next.snapshot?.branches.find((record) => record.name === "stale");

    expect(next.listFailures).toEqual({ branches: "fatal: cannot read branches" });
    expect(next.snapshot?.branches.map((record) => record.name)).toEqual(["feature", "stale"]);
    expect(next.snapshot?.worktrees).toEqual(nextWorktrees);
    expect(feature?.worktreePath).toBe("/repo-feature");
    expect(stale?.worktreePath).toBeNull();

    const currentSignals = signals();
    const context: CommandContext = {
      state: detectRepositoryState(currentSignals),
      signals: currentSignals,
      target: { kind: "branch", name: "feature" },
      region: "branches",
      operation: "idle",
      panel: { branches: next.snapshot?.branches ?? [] },
    };

    expect(getAvailability("branch.delete", context)).toEqual({
      available: false,
      reason: "checked-out-in-worktree",
    });
  });

  it("keeps a failed remote-branch or tag list when the other lists read", () => {
    const next = applyReadToStore(
      loadedStore(),
      successResult(snapshot({ remoteBranches: [], tags: [] }), {
        remoteBranches: "fatal: cannot read remote branches",
        tags: "fatal: cannot read tags",
      }),
      false,
    );

    expect(next.listFailures).toEqual({
      remoteBranches: "fatal: cannot read remote branches",
      tags: "fatal: cannot read tags",
    });
    expect(next.snapshot?.remoteBranches.map((record) => record.ref)).toEqual([
      "refs/remotes/origin/main",
    ]);
    expect(next.snapshot?.tags.map((record) => record.name)).toEqual(["v1.0.0"]);
  });

  it("keeps branch attribution from retained worktrees when both reads fail", () => {
    const retainedWorktrees = [
      worktree("/repo", "main", true),
      worktree("/repo-feature", "feature", false),
    ];
    const before = applyReadToStore(
      createInitialStore("/repo", INITIAL_SELECTION, false),
      successResult(
        snapshot({
          branches: [
            branch("main"),
            { ...branch("feature"), worktreePath: "/repo-feature" },
            { ...branch("stale"), worktreePath: "/repo-stale" },
          ],
          worktrees: retainedWorktrees,
        }),
      ),
      false,
    );
    const next = applyReadToStore(
      before,
      successResult(snapshot({ branches: [], worktrees: [], currentWorktreePath: null }), {
        branches: "fatal: cannot read branches",
        worktrees: "fatal: cannot read worktrees",
      }),
      false,
    );
    const feature = next.snapshot?.branches.find((record) => record.name === "feature");
    const stale = next.snapshot?.branches.find((record) => record.name === "stale");

    expect(next.listFailures).toEqual({
      branches: "fatal: cannot read branches",
      worktrees: "fatal: cannot read worktrees",
    });
    expect(next.snapshot?.branches.map((record) => record.name)).toEqual([
      "main",
      "feature",
      "stale",
    ]);
    expect(next.snapshot?.worktrees).toEqual(retainedWorktrees);
    expect(next.snapshot?.currentWorktreePath).toBe("/repo");
    expect(feature?.worktreePath).toBe("/repo-feature");
    expect(stale?.worktreePath).toBeNull();
  });

  it("clears the failure map after a fully successful read", () => {
    const partial = applyReadToStore(
      loadedStore(),
      successResult(snapshot({ stashes: [] }), { stashes: "fatal: unable to read logs" }),
      false,
    );
    const next = applyReadToStore(partial, successResult(snapshot()), false);

    expect(partial.listFailures).toEqual({ stashes: "fatal: unable to read logs" });
    expect(next.listFailures).toEqual({});
  });

  it("keeps the previous snapshot, lists, and failure map when the whole read fails", () => {
    const partial = applyReadToStore(
      loadedStore(),
      successResult(snapshot({ stashes: [] }), { stashes: "fatal: unable to read logs" }),
      false,
    );
    const next = applyReadToStore(partial, failureResult(), false);

    expect(next.snapshot).toBe(partial.snapshot);
    expect(next.listFailures).toEqual({ stashes: "fatal: unable to read logs" });
    expect(next.lastRefreshError).toBe("fatal: unable to read index");
    expect(next.signals.operationRunning).toBeFalse();
  });
});
