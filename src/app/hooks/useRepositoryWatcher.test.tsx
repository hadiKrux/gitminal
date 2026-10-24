import { beforeEach, describe, expect, it } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act, type ReactNode, useState } from "react";
import { useRepositoryWatcher } from "@/app/hooks/useRepositoryWatcher";
import type {
  GitWatcher,
  GitWatcherFactory,
  GitWatcherOptions,
  GitWatchStatus,
} from "@/domain/git/git.types";

/** Latest status published by the hook. */
let latestStatus: GitWatchStatus | undefined;

/** Updates the git directory rendered by the harness. */
let setGitDir: (gitDir: string) => void = () => {};

/** Starts recorded by the fake factory. */
let starts = 0;

/** Stops recorded by the fake factory. */
let stops = 0;

/**
 * Creates a fake watcher factory.
 *
 * @returns The factory.
 */
function createFactory(): GitWatcherFactory {
  return (options: GitWatcherOptions): GitWatcher => ({
    start(): void {
      starts += 1;
      options.onStatus?.({
        watching: true,
        mode: options.mode ?? "git-dir",
        path: options.gitDir,
        recursive: true,
        limitation: null,
      });
    },
    stop(): void {
      stops += 1;
    },
    status: {
      watching: true,
      mode: options.mode ?? "git-dir",
      path: options.gitDir,
      recursive: true,
      limitation: null,
    },
  });
}

/** Renders one watcher for the harness git directory. */
function WatcherProbe(props: { gitDir: string }): ReactNode {
  useRepositoryWatcher({
    gitDir: props.gitDir,
    root: "/repo",
    cwd: "/repo",
    enableWatcher: true,
    worktreeWatch: false,
    debounceMs: 5,
    factory: createFactory(),
    onRefresh: () => {},
    onStatus: (status) => {
      latestStatus = status;
    },
  });

  return <text id="watcher-probe">{props.gitDir}</text>;
}

/** Renders a watcher whose git directory can change. */
function Harness(): ReactNode {
  const [gitDir, updateGitDir] = useState("/repo/.git");

  setGitDir = updateGitDir;

  return <WatcherProbe gitDir={gitDir} />;
}

describe("useRepositoryWatcher", () => {
  beforeEach(() => {
    starts = 0;
    stops = 0;
    latestStatus = undefined;
  });

  it("publishes status, restarts on a gitDir change, and stops on unmount", async () => {
    const setup = await testRender(<Harness />, { width: 40, height: 10 });

    await act(async () => {
      await setup.renderOnce();
    });

    expect(starts).toBe(1);
    expect(latestStatus?.watching).toBeTrue();
    expect(latestStatus?.path).toBe("/repo/.git");

    await act(async () => {
      setGitDir("/repo-other/.git");
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(stops).toBe(1);
    expect(starts).toBe(2);
    expect(latestStatus?.path).toBe("/repo-other/.git");

    await act(async () => {
      await setup.dispose();
    });

    expect(stops).toBe(2);
    expect(latestStatus?.watching).toBe(false);
  });
});
