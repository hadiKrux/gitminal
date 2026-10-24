import { beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act, type ReactNode, useEffect } from "react";
import { App } from "@/app/App";
import { APP_VERSION } from "@/app/app.constants";
import { resetCommandOrchestration } from "@/app/hooks/commandRunner.state";
import { resetActionRegistry } from "@/app/hooks/useAction";
import { useConsoleLog } from "@/app/hooks/useConsoleLog";
import { useRepository } from "@/app/hooks/useRepository";
import { useStatus } from "@/app/hooks/useStatus";
import type { ConsoleContextValue } from "@/app/providers/ConsoleProvider.types";
import type { RepositoryContextValue } from "@/app/providers/RepositoryProvider.types";
import type { StatusContextValue } from "@/app/providers/StatusProvider.types";
import { resetCommandRunner } from "@/domain/commands/commands.runner";
import type { GitClient, GitInvocationResult } from "@/domain/git/git.types";
import type { UpdateCheckResult } from "@/domain/update/update.types";
import { createFakeGitClient, fakeGitResult } from "@/test/git.fake";

/** A check that never settles, proving the splash does not wait for the network. */
const pendingCheck = new Promise<UpdateCheckResult>(() => {});

/** Injected update check used instead of the real registry request. */
const checkForUpdateMock = mock((): Promise<UpdateCheckResult> => pendingCheck);

/** Inert git client so the dismissed splash never spawns a process. */
const INERT_CLIENT: GitClient = {
  gitPath: "git",
  invoke: async (): Promise<GitInvocationResult> => ({
    argv: ["git"],
    cwd: "/repo",
    exitCode: 128,
    terminationSignal: null,
    stdout: "",
    stderr: "fatal: not a git repository",
    durationMs: 0,
    cancelled: false,
    timedOut: false,
    timedOutAfterMs: null,
    spawnError: null,
    ok: false,
  }),
};

/** Keypress listeners the renderer registers itself, independent of mounted React subscribers. */
const RENDERER_BUILT_IN_KEYPRESS_LISTENERS = 1;

/** Latest console context captured by the app-level probe. */
let latestConsole: ConsoleContextValue | undefined;

/** Latest status context captured by the app-level probe. */
let latestStatus: StatusContextValue | undefined;

/** Latest repository context captured by the app-level probe. */
let latestRepository: RepositoryContextValue | undefined;

/** Status messages observed while the app-level probe was mounted. */
let statusMessages: string[] = [];

/**
 * Captures provider state below the app's providers.
 *
 * @returns A non-focusable marker.
 */
function AppProbe(): ReactNode {
  const consoleLog = useConsoleLog();
  const status = useStatus();
  const repository = useRepository();
  const message = status.status?.message ?? null;

  latestConsole = consoleLog;
  latestStatus = status;
  latestRepository = repository;
  useRepository();

  useEffect(() => {
    if (message !== null) {
      statusMessages.push(message);
    }
  }, [message]);

  return <text id="app-probe">{`${consoleLog.entries.length}:${message ?? "none"}`}</text>;
}

/**
 * Waits for one predicate while rendering the app.
 *
 * @param setup - Renderer setup.
 * @param predicate - Condition to reach.
 */
async function waitFor(
  setup: Awaited<ReturnType<typeof testRender>>,
  predicate: () => boolean,
): Promise<void> {
  const deadline = Date.now() + 2_000;

  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error("condition was not met in time");
    }

    await act(async () => {
      await setup.renderOnce();
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }
}

/**
 * Counts the keyboard subscriptions owned by the mounted app.
 *
 * The renderer always keeps one built-in `keypress` listener for its `exitOnCtrlC` handling, so the
 * app-owned subscriber count is the raw listener count minus that baseline.
 *
 * @param setup - The renderer setup returned by `testRender`.
 * @returns The number of app-owned `keypress` subscribers.
 */
function countKeyboardSubscribers(setup: Awaited<ReturnType<typeof testRender>>): number {
  return setup.renderer.keyInput.listenerCount("keypress") - RENDERER_BUILT_IN_KEYPRESS_LISTENERS;
}

beforeEach(() => {
  checkForUpdateMock.mockClear();
  resetActionRegistry();
  resetCommandRunner();
  resetCommandOrchestration();
  latestConsole = undefined;
  latestStatus = undefined;
  latestRepository = undefined;
  statusMessages = [];
});

describe("App splash gate", () => {
  it("dismisses on any key, mounts the workspace, and keeps exactly one keyboard subscriber", async () => {
    const setup = await testRender(
      <App
        checkForUpdate={checkForUpdateMock}
        gitClient={INERT_CLIENT}
        repositoryCwd="/repo"
        enableWatcher={false}
      />,
      {
        width: 80,
        height: 24,
        exitOnCtrlC: false,
      },
    );

    await act(async () => {
      await setup.renderOnce();
    });

    const initialFrame = setup.captureCharFrame();

    expect(initialFrame).toContain("Press any key to continue");
    expect(initialFrame).toContain(`version ${APP_VERSION}`);
    expect(setup.renderer.root.findDescendantById("splash-wordmark")).toBeDefined();
    expect(checkForUpdateMock).toHaveBeenCalledTimes(1);
    expect(countKeyboardSubscribers(setup)).toBe(1);

    await act(async () => {
      setup.mockInput.pressKey("x");
    });
    await act(async () => {
      await setup.renderOnce();
    });

    const dismissedFrame = setup.captureCharFrame();

    expect(dismissedFrame).toContain("Gitminal");
    expect(dismissedFrame).toContain("Branches");
    expect(dismissedFrame).toContain("Commits");
    expect(dismissedFrame).toContain("Diffs");
    expect(dismissedFrame).not.toContain("Press any key to continue");
    expect(countKeyboardSubscribers(setup)).toBe(1);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("quits through renderer.destroy on Ctrl+C instead of dismissing", async () => {
    const setup = await testRender(
      <App
        checkForUpdate={checkForUpdateMock}
        gitClient={INERT_CLIENT}
        repositoryCwd="/repo"
        enableWatcher={false}
      />,
      {
        width: 80,
        height: 24,
        exitOnCtrlC: false,
      },
    );
    const destroySpy = spyOn(setup.renderer, "destroy").mockImplementation(() => {});

    await act(async () => {
      await setup.renderOnce();
    });

    await act(async () => {
      setup.mockInput.pressCtrlC();
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(destroySpy).toHaveBeenCalledTimes(1);
    expect(setup.captureCharFrame()).toContain("Press any key to continue");
    expect(setup.captureCharFrame()).not.toContain("Gitminal");

    destroySpy.mockRestore();
    await act(async () => {
      await setup.dispose();
    });
  });

  it("quits on Ctrl+C after the splash is dismissed", async () => {
    const setup = await testRender(
      <App
        checkForUpdate={checkForUpdateMock}
        gitClient={INERT_CLIENT}
        repositoryCwd="/repo"
        enableWatcher={false}
      />,
      {
        width: 80,
        height: 24,
        exitOnCtrlC: false,
      },
    );
    const destroySpy = spyOn(setup.renderer, "destroy").mockImplementation(() => {});

    await act(async () => {
      await setup.renderOnce();
    });
    await act(async () => {
      setup.mockInput.pressKey("x");
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(setup.captureCharFrame()).toContain("Gitminal");
    expect(destroySpy).not.toHaveBeenCalled();

    await act(async () => {
      setup.mockInput.pressCtrlC();
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(destroySpy).toHaveBeenCalledTimes(1);

    destroySpy.mockRestore();
    await act(async () => {
      await setup.dispose();
    });
  });

  it("does not quit on a plain c key before or after dismissal", async () => {
    const setup = await testRender(
      <App
        checkForUpdate={checkForUpdateMock}
        gitClient={INERT_CLIENT}
        repositoryCwd="/repo"
        enableWatcher={false}
      />,
      {
        width: 80,
        height: 24,
        exitOnCtrlC: false,
      },
    );
    const destroySpy = spyOn(setup.renderer, "destroy").mockImplementation(() => {});

    await act(async () => {
      await setup.renderOnce();
    });
    await act(async () => {
      setup.mockInput.pressKey("c");
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(destroySpy).not.toHaveBeenCalled();
    expect(setup.captureCharFrame()).toContain("Gitminal");

    await act(async () => {
      setup.mockInput.pressKey("c");
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(destroySpy).not.toHaveBeenCalled();
    expect(setup.captureCharFrame()).toContain("Gitminal");

    destroySpy.mockRestore();
    await act(async () => {
      await setup.dispose();
    });
  });

  it("does not wait for an in-flight update check before rendering or quitting", async () => {
    const setup = await testRender(
      <App
        checkForUpdate={checkForUpdateMock}
        gitClient={INERT_CLIENT}
        repositoryCwd="/repo"
        enableWatcher={false}
      />,
      {
        width: 80,
        height: 24,
        exitOnCtrlC: false,
      },
    );
    const destroySpy = spyOn(setup.renderer, "destroy").mockImplementation(() => {});

    await act(async () => {
      await setup.renderOnce();
    });

    expect(setup.captureCharFrame()).toContain("Checking for updates...");
    expect(checkForUpdateMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      setup.mockInput.pressCtrlC();
    });

    expect(destroySpy).toHaveBeenCalledTimes(1);

    destroySpy.mockRestore();
    await act(async () => {
      await setup.dispose();
    });
  });

  it("renders a normal repository after splash dismissal", async () => {
    const fake = createFakeGitClient();
    const setup = await testRender(
      <App
        checkForUpdate={checkForUpdateMock}
        gitClient={fake.client}
        repositoryCwd="/repo"
        enableWatcher={false}
      />,
      {
        width: 120,
        height: 30,
        exitOnCtrlC: false,
      },
    );

    await act(async () => {
      await setup.renderOnce();
    });
    await act(async () => {
      setup.mockInput.pressKey("x");
    });
    await waitFor(
      setup,
      () => (fake.counts.get("status --porcelain=v2 --branch -z --untracked-files=all") ?? 0) > 0,
    );
    await act(async () => {
      await setup.renderOnce();
    });

    const frame = setup.captureCharFrame();

    expect(frame).toContain("main");
    expect(frame).toContain("origin/main");
    expect(frame).toContain("ahead 2 behind 1");
    expect(frame).toContain("diverged");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("applies exactly one console entry, one status, and one refresh for a dispatched fetch", async () => {
    const fake = createFakeGitClient();

    const setup = await testRender(
      <App
        checkForUpdate={checkForUpdateMock}
        gitClient={fake.client}
        repositoryCwd="/repo"
        enableWatcher={false}
        probe={<AppProbe />}
      />,
      {
        width: 120,
        height: 30,
        exitOnCtrlC: false,
      },
    );

    await act(async () => {
      await setup.renderOnce();
    });
    await act(async () => {
      setup.mockInput.pressKey("x");
    });
    await waitFor(setup, () => latestConsole?.entries.length === 0 && latestStatus !== undefined);

    const statusBefore =
      fake.counts.get("status --porcelain=v2 --branch -z --untracked-files=all") ?? 0;

    await act(async () => {
      setup.mockInput.pressKey("f");
    });
    await waitFor(setup, () => latestConsole?.entries.length === 1);
    await waitFor(
      setup,
      () => (latestRepository?.remoteChecks.origin?.lastSuccessfulFetchAt ?? null) !== null,
    );
    await act(async () => {
      await setup.renderOnce();
    });

    expect(latestConsole?.entries).toHaveLength(1);
    expect(latestConsole?.entries[0]?.commandId).toBe("remote.fetch");
    expect(latestStatus?.status).toEqual({ kind: "success", message: "Fetch completed" });
    expect(statusMessages).toEqual(["Fetch completed"]);
    expect(
      (fake.counts.get("status --porcelain=v2 --branch -z --untracked-files=all") ?? 0) -
        statusBefore,
    ).toBe(1);
    expect(latestRepository?.remoteChecks.origin?.lastSuccessfulFetchAt).not.toBeNull();

    await act(async () => {
      await setup.dispose();
    });
  });

  it("does not advance a remote's fetch timestamp when the fetch fails", async () => {
    const fake = createFakeGitClient();

    fake.setFetchResult(fakeGitResult("", false, "fatal: could not resolve host: example.com"));

    const setup = await testRender(
      <App
        checkForUpdate={checkForUpdateMock}
        gitClient={fake.client}
        repositoryCwd="/repo"
        enableWatcher={false}
        probe={<AppProbe />}
      />,
      {
        width: 120,
        height: 30,
        exitOnCtrlC: false,
      },
    );

    await act(async () => {
      await setup.renderOnce();
    });
    await act(async () => {
      setup.mockInput.pressKey("x");
    });
    await waitFor(setup, () => latestConsole?.entries.length === 0 && latestStatus !== undefined);

    await act(async () => {
      setup.mockInput.pressKey("f");
    });
    await waitFor(setup, () => latestConsole?.entries.length === 1);
    await act(async () => {
      await setup.renderOnce();
    });

    expect(latestConsole?.entries).toHaveLength(1);
    expect(latestStatus?.status?.kind).toBe("error");
    expect(latestRepository?.remoteChecks.origin?.lastSuccessfulFetchAt).toBeNull();

    await act(async () => {
      await setup.dispose();
    });
  });
});
