import { describe, expect, it } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import type { StatusKind } from "@/app/hooks/useStatus";
import { selectRepositoryView } from "@/domain/repository/repository.selectors";
import {
  createRepositorySignals,
  detectRepositoryState,
} from "@/domain/repository/repository.states";
import type { RepositorySnapshot, RepositoryView } from "@/domain/repository/repository.types";
import { TopBarStatus } from "@/features/top-bar/TopBarStatus";
import { TOP_BAR_PROGRESS_ID } from "@/features/top-bar/TopBarStatus.constants";
import { readTopBarStatusMode } from "@/features/top-bar/topBar.status";
import type { TopBarStatusMode } from "@/features/top-bar/useTopBar.types";
import { ShellTestProviders } from "@/test/shell.harness";
import { ICONS } from "@/theme/icons";

/**
 * Builds a loaded repository snapshot.
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
    ahead: 1,
    behind: 2,
    status: {
      headOid: "abc123",
      branch: "main",
      detached: false,
      upstream: "origin/main",
      ahead: 1,
      behind: 2,
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
    currentWorktreePath: null,
    identity: { name: "Test User", email: "test@example.com" },
    readAt: 1,
    ...overrides,
  };
}

/**
 * Builds the derived view for a readable repository.
 *
 * @returns The repository view.
 */
function loadedView(): RepositoryView {
  const signals = createRepositorySignals({
    loaded: true,
    insideWorkTree: true,
    headExists: true,
    branch: "main",
    upstream: "origin/main",
    upstreamExists: true,
    upstreamCheck: "checked",
    remotes: ["origin"],
    hasUpstreamBranches: true,
  });

  return selectRepositoryView(
    snapshot({ ahead: 1, behind: 2 }),
    detectRepositoryState(signals),
    "healthy",
  );
}

/**
 * Builds the derived view for the first read.
 *
 * @returns The loading repository view.
 */
function loadingView(): RepositoryView {
  return selectRepositoryView(null, detectRepositoryState(createRepositorySignals()), "none");
}

/**
 * Builds the derived view for a configured upstream whose ref is confirmed gone.
 *
 * @returns The upstream-gone repository view.
 */
function upstreamGoneView(): RepositoryView {
  const signals = createRepositorySignals({
    loaded: true,
    insideWorkTree: true,
    headExists: true,
    branch: "main",
    upstream: "origin/main",
    upstreamExists: false,
    upstreamCheck: "checked",
    remotes: ["origin"],
    hasUpstreamBranches: true,
  });

  return selectRepositoryView(
    snapshot({ ahead: 0, behind: 0 }),
    detectRepositoryState(signals),
    "gone",
  );
}

/**
 * Renders one status strip mode.
 *
 * @param mode - Status mode.
 * @param width - Available columns.
 * @returns The renderer setup.
 */
async function renderStatus(
  mode: TopBarStatusMode,
  width: number = 60,
): Promise<Awaited<ReturnType<typeof testRender>>> {
  return testRender(
    <ShellTestProviders>
      <box flexDirection="row" width={width} height={1}>
        <TopBarStatus mode={mode} width={width} />
      </box>
    </ShellTestProviders>,
    { width, height: 3 },
  );
}

/**
 * Renders a strip and returns its captured frame.
 *
 * @param mode - Status mode.
 * @param width - Available columns.
 * @returns The captured frame.
 */
async function captureStatus(mode: TopBarStatusMode, width: number = 60): Promise<string> {
  const setup = await renderStatus(mode, width);

  await act(async () => {
    await setup.renderOnce();
  });

  const frame = setup.captureCharFrame();

  await act(async () => {
    await setup.dispose();
  });

  return frame;
}

describe("readTopBarStatusMode", () => {
  it("prefers the running operation over a status message and idle info", () => {
    const mode = readTopBarStatusMode({
      operation: { label: "Fetch", phase: "receiving objects", percent: 42 },
      status: { kind: "warning", message: "no remote" },
      view: loadedView(),
      lastRefreshError: null,
    });

    expect(mode).toEqual({
      kind: "operation",
      label: "Fetch",
      phase: "receiving objects",
      percent: 42,
    });
  });

  it("prefers a status message over idle info", () => {
    const mode = readTopBarStatusMode({
      operation: null,
      status: { kind: "error", message: "push failed" },
      view: loadedView(),
      lastRefreshError: null,
    });

    expect(mode).toEqual({ kind: "status", statusKind: "error", message: "push failed" });
  });

  it("falls back to idle branch information", () => {
    const mode = readTopBarStatusMode({
      operation: null,
      status: null,
      view: loadedView(),
      lastRefreshError: null,
    });

    expect(mode.kind).toBe("idle");
  });

  it("reports a failed first read only while no snapshot exists", () => {
    const loading = readTopBarStatusMode({
      operation: null,
      status: null,
      view: loadingView(),
      lastRefreshError: "git remote -v output was truncated",
    });
    const loaded = readTopBarStatusMode({
      operation: null,
      status: null,
      view: loadedView(),
      lastRefreshError: "git remote -v output was truncated",
    });

    expect(loading).toMatchObject({
      kind: "idle",
      loading: true,
      initialError: "git remote -v output was truncated",
    });
    expect(loaded).toMatchObject({ kind: "idle", loading: false, initialError: null });
  });
});

describe("TopBarStatus", () => {
  it("renders the operation label alone before the first git phase arrives", async () => {
    const frame = await captureStatus({
      kind: "operation",
      label: "Fetch",
      phase: "Fetch",
      percent: null,
    });

    expect(frame).toContain("Fetch");
    expect(frame).not.toContain("Fetch: Fetch");
  });

  it("shows a spinner and phase without a percentage and renders no progress bar", async () => {
    const setup = await renderStatus({
      kind: "operation",
      label: "Fetch",
      phase: "receiving objects",
      percent: null,
    });

    await act(async () => {
      await setup.renderOnce();
    });

    const frame = setup.captureCharFrame();

    expect(frame).toMatch(/[|/\\-] Fetch: receiving objects/);
    expect(frame).not.toContain("%");
    expect(setup.renderer.root.findDescendantById(TOP_BAR_PROGRESS_ID)).toBeUndefined();

    await act(async () => {
      await setup.dispose();
    });
  });

  it("shows the phase and percentage when a percentage is known", async () => {
    const setup = await renderStatus({
      kind: "operation",
      label: "Push",
      phase: "writing objects",
      percent: 42,
    });

    await act(async () => {
      await setup.renderOnce();
    });

    const frame = setup.captureCharFrame();

    expect(frame).toContain("Push: writing objects");
    expect(frame).toContain("42%");
    expect(setup.renderer.root.findDescendantById(TOP_BAR_PROGRESS_ID)).toBeDefined();

    await act(async () => {
      await setup.dispose();
    });
  });

  it("renders a marker and the message for each status kind", async () => {
    const expected: Readonly<Record<StatusKind, string>> = {
      success: `${ICONS.success} saved`,
      warning: `${ICONS.warning} no remote`,
      error: `${ICONS.error} push failed`,
      info: `${ICONS.info} creating upstream`,
    };

    for (const [statusKind, text] of Object.entries(expected) as readonly [StatusKind, string][]) {
      const frame = await captureStatus({ kind: "status", statusKind, message: text.slice(2) });

      expect(frame, statusKind).toContain(text);
    }
  });

  it("renders branch, upstream, counts, and the sync badge when idle", async () => {
    const frame = await captureStatus(
      readTopBarStatusMode({
        operation: null,
        status: null,
        view: loadedView(),
        lastRefreshError: null,
      }),
    );

    expect(frame).toContain("main  origin/main");
    expect(frame).toContain("origin/main");
    expect(frame).toContain("ahead 1 behind 2");
    expect(frame).toContain("! diverged");
  });

  it("shows loading repository without counts or a clean sync badge", async () => {
    const frame = await captureStatus(
      readTopBarStatusMode({
        operation: null,
        status: null,
        view: loadingView(),
        lastRefreshError: null,
      }),
    );

    expect(frame).toContain("loading repository");
    expect(frame).not.toContain("up to date");
    expect(frame).not.toContain("ahead 0");
    expect(frame).not.toContain("no upstream");
  });

  it("shows the failed initial read instead of loading forever", async () => {
    const frame = await captureStatus(
      readTopBarStatusMode({
        operation: null,
        status: null,
        view: loadingView(),
        lastRefreshError: "git remote -v output was truncated",
      }),
    );

    expect(frame).toContain("x git remote -v output was truncated");
    expect(frame).not.toContain("loading repository");
  });

  it("marks a gone upstream and hides the unknown ahead and behind counts", async () => {
    const frame = await captureStatus(
      readTopBarStatusMode({
        operation: null,
        status: null,
        view: upstreamGoneView(),
        lastRefreshError: null,
      }),
    );

    expect(frame).toContain("[?] upstream not found");
    expect(frame).toContain("[?] upstream gone");
    expect(frame).not.toContain("ahead 0");
  });

  it("renders only the state label in a terminal repository state", async () => {
    const signals = createRepositorySignals({
      loaded: true,
      notARepository: true,
    });
    const view = selectRepositoryView(null, detectRepositoryState(signals), "none");
    const frame = await captureStatus(
      readTopBarStatusMode({ operation: null, status: null, view, lastRefreshError: null }),
    );

    expect(frame).toContain("not a git repository");
    expect(frame).not.toContain("loading");
    expect(frame).not.toContain("up to date");
    expect(frame).not.toContain("no upstream");
  });

  it("keeps the percentage text when the bar does not fit", async () => {
    const frame = await captureStatus(
      { kind: "operation", label: "Fetch", phase: "objects", percent: 80 },
      18,
    );

    expect(frame).toContain("80%");
  });
});
