import { describe, expect, it } from "bun:test";
import type {
  GitWatchHandle,
  GitWatchSeam,
  GitWatchStatus,
  GitWatchTarget,
} from "@/domain/git/git.types";
import { createGitWatcher } from "@/domain/git/git.watcher";

/**
 * Waits for a short window so debounce timers can run.
 *
 * @param milliseconds - Delay in milliseconds.
 * @returns A promise resolved after the delay.
 */
function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Creates a fake watch seam that records targets and exposes its listeners.
 *
 * @param rejectRecursive - True to simulate a platform without recursive watching.
 * @returns The seam plus accessors for the recorded state.
 */
function createFakeWatch(rejectRecursive: boolean = false): {
  seam: GitWatchSeam;
  targets: GitWatchTarget[];
  emit: (filename?: string | null) => void;
  emitError: (error: unknown) => void;
  closes: () => number;
} {
  const targets: GitWatchTarget[] = [];
  let listener: ((filename: string | null) => void) | null = null;
  let errorListener: ((error: unknown) => void) | null = null;
  let closes = 0;

  const seam: GitWatchSeam = (target, onChange, onError) => {
    targets.push(target);

    if (target.recursive && rejectRecursive) {
      throw new Error("recursive watch unsupported");
    }

    listener = onChange;
    errorListener = onError;

    return {
      close(): void {
        closes += 1;
      },
    } satisfies GitWatchHandle;
  };

  return {
    seam,
    targets,
    emit: (filename: string | null = null) => listener?.(filename),
    emitError: (error: unknown) => errorListener?.(error),
    closes: () => closes,
  };
}

describe("createGitWatcher", () => {
  it("coalesces a burst of git-directory events into one refresh", async () => {
    const fake = createFakeWatch();
    let refreshes = 0;
    const watcher = createGitWatcher({
      gitDir: "/repo/.git",
      debounceMs: 5,
      watch: fake.seam,
      onRefresh: () => {
        refreshes += 1;
      },
    });

    watcher.start();
    watcher.start();

    expect(fake.targets).toEqual([{ path: "/repo/.git", recursive: true }]);

    fake.emit("HEAD");
    fake.emit("HEAD");
    fake.emit("HEAD");

    await wait(25);

    expect(refreshes).toBe(1);
    expect(watcher.status).toEqual({
      watching: true,
      mode: "git-dir",
      path: "/repo/.git",
      recursive: true,
      limitation: null,
    });
  });

  it("reports the worktree directory in the opt-in mode", () => {
    const fake = createFakeWatch();
    const watcher = createGitWatcher({
      gitDir: "/repo/.git",
      mode: "worktree",
      worktreePath: "/repo",
      debounceMs: 5,
      watch: fake.seam,
      onRefresh: () => {},
    });

    watcher.start();

    expect(fake.targets).toEqual([{ path: "/repo", recursive: true }]);
    expect(watcher.status.mode).toBe("worktree");
  });

  it("stays inactive when the opt-in worktree path is missing", () => {
    const fake = createFakeWatch();
    const watcher = createGitWatcher({
      gitDir: "/repo/.git",
      mode: "worktree",
      worktreePath: null,
      watch: fake.seam,
      onRefresh: () => {},
    });

    watcher.start();

    expect(fake.targets).toEqual([]);
    expect(watcher.status.watching).toBe(false);
    expect(watcher.status.limitation).toContain("worktree watch off");
  });

  it("watches the git-dir root and ref directories when recursion is unavailable", () => {
    const fake = createFakeWatch(true);
    const watcher = createGitWatcher({
      gitDir: "/repo/.git",
      watch: fake.seam,
      onRefresh: () => {},
    });

    watcher.start();

    expect(fake.targets).toEqual([
      { path: "/repo/.git", recursive: true },
      { path: "/repo/.git", recursive: false },
      { path: "/repo/.git/refs/heads", recursive: false },
      { path: "/repo/.git/refs/tags", recursive: false },
      { path: "/repo/.git/refs/remotes", recursive: false },
    ]);
    expect(watcher.status.watching).toBe(true);
    expect(watcher.status.recursive).toBe(false);
    expect(watcher.status.limitation).toContain("non-recursive watch");
  });

  it("ignores worktree build output and git index churn", async () => {
    const fake = createFakeWatch();
    let refreshes = 0;
    const watcher = createGitWatcher({
      gitDir: "/repo/.git",
      mode: "worktree",
      worktreePath: "/repo",
      debounceMs: 5,
      watch: fake.seam,
      onRefresh: () => {
        refreshes += 1;
      },
    });

    watcher.start();
    fake.emit("node_modules/pkg/index.js");
    fake.emit("dist/bundle.js");
    fake.emit(".git/index.lock");
    await wait(20);

    expect(refreshes).toBe(0);

    fake.emit("src/app.ts");
    await wait(20);

    expect(refreshes).toBe(1);
  });

  it("ignores index.lock churn in git-dir mode", async () => {
    const fake = createFakeWatch();
    let refreshes = 0;
    const watcher = createGitWatcher({
      gitDir: "/repo/.git",
      debounceMs: 5,
      watch: fake.seam,
      onRefresh: () => {
        refreshes += 1;
      },
    });

    watcher.start();
    fake.emit("index.lock");
    await wait(20);

    expect(refreshes).toBe(0);

    fake.emit("refs/heads/main");
    await wait(20);

    expect(refreshes).toBe(1);
  });

  it("closes the watch and publishes an inactive status after a watch error", () => {
    const fake = createFakeWatch();
    const statuses: GitWatchStatus[] = [];
    const watcher = createGitWatcher({
      gitDir: "/repo/.git",
      watch: fake.seam,
      onRefresh: () => {},
      onStatus: (status) => statuses.push(status),
    });

    watcher.start();
    fake.emitError(new Error("ENOENT"));

    expect(watcher.status.watching).toBe(false);
    expect(fake.closes()).toBe(1);
    expect(statuses.at(-1)?.watching).toBe(false);
  });

  it("cancels a pending refresh and closes the watch on stop", async () => {
    const fake = createFakeWatch();
    let refreshes = 0;
    const watcher = createGitWatcher({
      gitDir: "/repo/.git",
      debounceMs: 10,
      watch: fake.seam,
      onRefresh: () => {
        refreshes += 1;
      },
    });

    watcher.start();
    fake.emit("HEAD");
    watcher.stop();

    await wait(25);

    expect(refreshes).toBe(0);
    expect(fake.closes()).toBe(1);
    expect(watcher.status.watching).toBe(false);
  });

  it("degrades to inactive when the platform rejects the watch", () => {
    const watcher = createGitWatcher({
      gitDir: "/missing/.git",
      watch: () => {
        throw new Error("ENOENT");
      },
      onRefresh: () => {},
    });

    watcher.start();

    expect(watcher.status.watching).toBe(false);
  });
});
