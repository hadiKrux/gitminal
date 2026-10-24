import { describe, expect, it } from "bun:test";
import {
  REMOTE_STALE_AFTER_MS,
  selectAheadBehind,
  selectBranchDisplay,
  selectPendingCounts,
  selectRemoteFreshness,
  selectRepositoryView,
  selectStateDisplay,
  selectSyncState,
  selectUpstreamDisplay,
} from "@/domain/repository/repository.selectors";
import {
  createRepositorySignals,
  detectRepositoryState,
} from "@/domain/repository/repository.states";
import type { RemoteCheckRecord, RepositorySnapshot } from "@/domain/repository/repository.types";

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
