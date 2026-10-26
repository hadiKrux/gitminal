import { describe, expect, it } from "bun:test";
import type {
  BranchRecord,
  RemoteBranchRecord,
  StashRecord,
  WorktreeRecord,
} from "@/domain/git/git.types";
import {
  REMOTE_STALE_AFTER_MS,
  selectAheadBehind,
  selectBranchDisplay,
  selectBranchRows,
  selectPendingCounts,
  selectRemoteBranchGroups,
  selectRemoteFreshness,
  selectRepositoryPath,
  selectRepositoryView,
  selectStashRows,
  selectStateDisplay,
  selectSyncState,
  selectTagRows,
  selectUpstreamDisplay,
  selectWorktreeBranchMap,
  selectWorktreeRows,
} from "@/domain/repository/repository.selectors";
import {
  createRepositorySignals,
  detectRepositoryState,
} from "@/domain/repository/repository.states";
import type {
  RemoteCheckRecord,
  RemoteTagChecks,
  RepositorySnapshot,
} from "@/domain/repository/repository.types";

/**
 * Builds a snapshot with the values the selectors read.
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
    headSubject: null,
    shortHash: null,
    detached: false,
    bare: false,
    remotes: [{ name: "origin", fetchUrl: "git@example.com:repo.git", pushUrl: null }],
    upstream: "origin/main",
    ahead: 2,
    behind: 1,
    status: {
      headOid: "abc123",
      branch: "main",
      detached: false,
      upstream: "origin/main",
      ahead: 2,
      behind: 1,
      entries: [],
      conflictedPaths: [],
      stagedCount: 3,
      unstagedCount: 4,
      untrackedCount: 2,
    },
    branches: [],
    remoteBranches: [],
    tags: [],
    stashes: [],
    worktrees: [],
    currentWorktreePath: null,
    identity: { name: "Test User", email: "test@example.com" },
    readAt: 1,
    ...overrides,
  };
}

describe("repository selectors", () => {
  it("derives ahead and behind from the last fetched refs", () => {
    expect(selectAheadBehind(snapshot())).toEqual({ ahead: 2, behind: 1 });
    expect(selectAheadBehind(null)).toEqual({ ahead: 0, behind: 0 });
  });

  it("shows the pending total as working-tree changes plus untracked files", () => {
    expect(selectPendingCounts(snapshot())).toEqual({
      staged: 3,
      unstaged: 4,
      untracked: 2,
      total: 6,
    });
  });

  it("shows the work-tree root, bare git directory, or launch directory as the repository path", () => {
    expect(selectRepositoryPath(snapshot(), createRepositorySignals({ cwd: "/repo/src" }))).toBe(
      "/repo",
    );
    expect(
      selectRepositoryPath(
        null,
        createRepositorySignals({ cwd: "/bare", bare: true, gitDir: "/bare" }),
      ),
    ).toBe("/bare");
    expect(selectRepositoryPath(null, createRepositorySignals({ cwd: "/plain" }))).toBe("/plain");
  });

  it("labels a branch and a detached HEAD", () => {
    expect(selectBranchDisplay(snapshot()).label).toBe("main");
    expect(
      selectBranchDisplay(snapshot({ branch: null, detached: true, shortHash: "abc1234" })),
    ).toEqual({ label: "abc1234", detached: true, shortHash: "abc1234" });
    expect(selectBranchDisplay(null).label).toBe("loading");
  });

  it("uses words for every upstream state", () => {
    expect(selectUpstreamDisplay(snapshot(), "none")).toEqual({
      status: "none",
      label: "no upstream",
      indicatesMissing: false,
    });
    expect(selectUpstreamDisplay(snapshot(), "healthy").label).toBe("origin/main");
    expect(selectUpstreamDisplay(snapshot(), "gone").label).toBe("upstream not found");
    expect(selectUpstreamDisplay(snapshot(), "deleted-after-prune").label).toBe(
      "remote branch deleted",
    );
    expect(selectUpstreamDisplay(snapshot(), "unknown").label).toBe("upstream unknown");
  });

  it("labels gating and layered repository states", () => {
    const notARepo = detectRepositoryState(
      createRepositorySignals({ loaded: true, notARepository: true }),
    );
    const conflicted = detectRepositoryState(
      createRepositorySignals({
        loaded: true,
        insideWorkTree: true,
        headExists: true,
        remotes: ["origin"],
        upstream: "origin/main",
        upstreamExists: true,
        upstreamCheck: "checked",
        conflictedPaths: ["a.txt"],
        mergeInProgress: true,
        identity: { name: "A", email: "a@b.c" },
      }),
    );

    expect(selectStateDisplay(notARepo).label).toBe("not a git repository");
    expect(selectStateDisplay(conflicted).label).toBe("normal: merge in progress, conflicts");
  });

  it("derives remote freshness only from successful interactions", () => {
    const record: RemoteCheckRecord = {
      lastSuccessfulCheckAt: 1_000,
      lastSuccessfulFetchAt: null,
    };

    expect(selectRemoteFreshness(undefined, 2_000)).toBe("unknown");
    expect(
      selectRemoteFreshness({ lastSuccessfulCheckAt: null, lastSuccessfulFetchAt: null }, 2_000),
    ).toBe("unknown");
    expect(selectRemoteFreshness(record, 2_000)).toBe("fresh");
    expect(selectRemoteFreshness(record, 1_000 + REMOTE_STALE_AFTER_MS + 1)).toBe("stale");
  });

  it("derives all six sync states", () => {
    const withCounts = (ahead: number, behind: number): RepositorySnapshot => {
      const base = snapshot();

      return snapshot({
        ahead,
        behind,
        status: base.status === null ? null : { ...base.status, ahead, behind },
      });
    };

    expect(selectSyncState(snapshot(), "none")).toBe("no-upstream");
    expect(selectSyncState(snapshot(), "gone")).toBe("upstream-gone");
    expect(selectSyncState(snapshot(), "deleted-after-prune")).toBe("upstream-gone");
    expect(selectSyncState(snapshot(), "unknown")).toBe("upstream-gone");
    expect(selectSyncState(withCounts(0, 0), "healthy")).toBe("up-to-date");
    expect(selectSyncState(withCounts(2, 0), "healthy")).toBe("ahead");
    expect(selectSyncState(withCounts(0, 1), "healthy")).toBe("behind");
    expect(selectSyncState(withCounts(2, 1), "healthy")).toBe("diverged");
  });

  it("builds the view once for the top bar", () => {
    const state = detectRepositoryState(
      createRepositorySignals({
        loaded: true,
        insideWorkTree: true,
        repositoryRoot: "/repo",
        cwd: "/repo",
        headExists: true,
        branch: "main",
        remotes: ["origin"],
        upstream: "origin/main",
        upstreamExists: true,
        upstreamCheck: "checked",
        identity: { name: "Test User", email: "test@example.com" },
      }),
    );
    const view = selectRepositoryView(snapshot(), state, "healthy");

    expect(view.loading).toBe(false);
    expect(view.branch.label).toBe("main");
    expect(view.upstream.label).toBe("origin/main");
    expect(view.ahead).toBe(2);
    expect(view.behind).toBe(1);
    expect(view.sync).toBe("diverged");
    expect(view.pending.total).toBe(6);
    expect(view.state.primary).toBe("normal");
  });
});

/**
 * Builds one local branch record.
 *
 * @param overrides - Branch values to override.
 * @returns The branch record.
 */
function branch(overrides: Partial<BranchRecord> = {}): BranchRecord {
  return {
    name: "main",
    head: false,
    tipOid: "abc123",
    committerDate: "2026-01-02T00:00:00+00:00",
    upstream: null,
    upstreamRemote: null,
    upstreamBranch: null,
    ahead: 0,
    behind: 0,
    worktreePath: null,
    upstreamStatus: "none",
    ...overrides,
  };
}

/**
 * Builds one remote-tracking branch record.
 *
 * @param remote - Remote name.
 * @param name - Branch name inside that remote.
 * @returns The remote branch record.
 */
function remoteBranch(remote: string, name: string): RemoteBranchRecord {
  return {
    ref: `refs/remotes/${remote}/${name}`,
    remote,
    branch: name,
    tipOid: "abc123",
    committerDate: "2026-01-02T00:00:00+00:00",
    subject: "subject",
  };
}

/**
 * Builds one stash record.
 *
 * @param index - Display selector position.
 * @returns The stash record.
 */
function stash(index: number): StashRecord {
  return {
    index: `stash@{${index}}`,
    objectName: `object-${index}`,
    subject: `WIP on main: ${index}`,
    sourceBranch: "main",
    committedAt: 1_700_000_000 + index,
  };
}

/**
 * Builds one worktree record.
 *
 * @param path - Absolute worktree path.
 * @param overrides - Worktree values to override.
 * @returns The worktree record.
 */
function worktree(path: string, overrides: Partial<WorktreeRecord> = {}): WorktreeRecord {
  return {
    path,
    headOid: "abc123",
    branch: "main",
    detached: false,
    bare: false,
    locked: false,
    lockReason: null,
    prunable: false,
    pruneReason: null,
    current: false,
    dirty: false,
    ...overrides,
  };
}

describe("panel selectors", () => {
  it("orders branches current first, then newest commit, then name", () => {
    const rows = selectBranchRows(
      snapshot({
        branches: [
          branch({ name: "old", committerDate: "2026-01-01T00:00:00+00:00" }),
          branch({ name: "new", committerDate: "2026-01-03T00:00:00+00:00" }),
          branch({
            name: "current",
            head: true,
            committerDate: "2025-12-01T00:00:00+00:00",
          }),
          branch({ name: "same-b", committerDate: "2026-01-02T00:00:00+00:00" }),
          branch({ name: "same-a", committerDate: "2026-01-02T00:00:00+00:00" }),
          branch({ name: "undated", committerDate: null }),
        ],
      }),
    );

    expect(rows.map((record) => record.name)).toEqual([
      "current",
      "new",
      "same-a",
      "same-b",
      "old",
      "undated",
    ]);
  });

  it("keeps the branch order stable for the same snapshot", () => {
    const base = snapshot({
      branches: [
        branch({ name: "b", committerDate: "2026-01-01T00:00:00+00:00" }),
        branch({ name: "a", committerDate: "2026-01-01T00:00:00+00:00" }),
      ],
    });

    expect(selectBranchRows(base).map((record) => record.name)).toEqual(
      selectBranchRows(base).map((record) => record.name),
    );
    expect(selectBranchRows(base).map((record) => record.name)).toEqual(["a", "b"]);
  });

  it("groups remote branches by remote and then by branch", () => {
    const groups = selectRemoteBranchGroups(
      snapshot({
        remoteBranches: [
          remoteBranch("upstream", "main"),
          remoteBranch("origin", "topic"),
          remoteBranch("origin", "main"),
        ],
      }),
    );

    expect(groups.map((group) => group.remote)).toEqual(["origin", "upstream"]);
    expect(groups[0]?.branches.map((record) => record.branch)).toEqual(["main", "topic"]);
  });

  it("merges tag scope and orders tags by version descending", () => {
    const remoteTagChecks: RemoteTagChecks = {
      origin: { names: ["v1.2.9", "remote-only"], checkedAt: 5, status: "known" },
    };
    const rows = selectTagRows(
      snapshot({
        tags: [
          { name: "v1.2.10", objectType: "commit", targetOid: "a", subject: "a" },
          { name: "v1.2.9", objectType: "commit", targetOid: "b", subject: "b" },
          { name: "v1.2.2", objectType: "tag", targetOid: "c", subject: "c" },
        ],
      }),
      remoteTagChecks,
    );

    expect(rows.map((row) => row.name)).toEqual(["v1.2.10", "v1.2.9", "v1.2.2", "remote-only"]);
    expect(rows.map((row) => row.state)).toEqual(["unpushed", "both", "unpushed", "remote"]);
  });

  it("keeps a failed remote check unknown instead of unpushed", () => {
    const rows = selectTagRows(
      snapshot({
        tags: [{ name: "v1", objectType: "commit", targetOid: "a", subject: "a" }],
      }),
      { origin: { names: [], checkedAt: null, status: "failed" } },
    );

    expect(rows[0]?.state).toBe("unknown");
  });

  it("orders stashes newest first and preserves the object name", () => {
    const rows = selectStashRows(snapshot({ stashes: [stash(1), stash(3), stash(2)] }));

    expect(rows.map((record) => record.index)).toEqual(["stash@{1}", "stash@{2}", "stash@{3}"]);
    expect(rows[0]?.objectName).toBe("object-1");
  });

  it("orders worktrees current first and maps branches to worktrees", () => {
    const current = worktree("/repo", { current: true });
    const feature = worktree("/repo-feature", { branch: "feature" });
    const detached = worktree("/repo-detached", { branch: null, detached: true });
    const panelSnapshot = snapshot({ worktrees: [feature, detached, current] });

    expect(selectWorktreeRows(panelSnapshot).map((record) => record.path)).toEqual([
      "/repo",
      "/repo-detached",
      "/repo-feature",
    ]);

    const map = selectWorktreeBranchMap(panelSnapshot);

    expect(map.get("feature")?.path).toBe("/repo-feature");
    expect(map.get("main")?.path).toBe("/repo");
    expect(map.size).toBe(2);
  });

  it("returns empty panel projections before the first read", () => {
    expect(selectBranchRows(null)).toEqual([]);
    expect(selectRemoteBranchGroups(null)).toEqual([]);
    expect(selectTagRows(null, {})).toEqual([]);
    expect(selectStashRows(null)).toEqual([]);
    expect(selectWorktreeRows(null)).toEqual([]);
    expect(selectWorktreeBranchMap(null).size).toBe(0);
  });
});
