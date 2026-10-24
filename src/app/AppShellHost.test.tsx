import { beforeEach, describe, expect, it, spyOn } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act, type ReactNode } from "react";
import { AppShellHost } from "@/app/AppShellHost";
import {
  getActionRegistryVersion,
  hasRegisteredAction,
  resetActionRegistry,
} from "@/app/hooks/useAction";
import { useFocusState } from "@/app/hooks/useFocusState";
import { useStatus } from "@/app/hooks/useStatus";
import { ConfigProvider } from "@/app/providers/ConfigProvider";
import { ConsoleProvider } from "@/app/providers/ConsoleProvider";
import { FocusProvider } from "@/app/providers/FocusProvider";
import { KeymapProvider } from "@/app/providers/KeymapProvider";
import { RepositoryProvider } from "@/app/providers/RepositoryProvider";
import { StatusProvider } from "@/app/providers/StatusProvider";
import type { StatusContextValue } from "@/app/providers/StatusProvider.types";
import { ThemeProvider } from "@/app/providers/ThemeProvider";
import { resetCommandRunner } from "@/domain/commands/commands.runner";
import type { GitClient, GitInvocationResult, GitWatcherFactory } from "@/domain/git/git.types";
import type { FocusContextValue } from "@/features/shell/focus.types";
import { FOCUS_ACTION_BY_REGION } from "@/features/shell/regions";
import { createFakeGitClient } from "@/test/git.fake";

/** Inert git client so provider reads never spawn a process. */
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

/** Latest focus context captured by the probe. */
let latestFocus: FocusContextValue | undefined;

/** Latest status context captured by the probe. */
let latestStatus: StatusContextValue | undefined;

/**
 * Creates a watcher factory for a healthy recursive git-dir watch.
 *
 * The default production configuration watches only the git directory, so this fake publishes a
 * status with no watcher limitation. The working-tree hint must still appear from the mode alone.
 *
 * @returns The watcher factory.
 */
function createGitDirWatcher(): GitWatcherFactory {
  return (options) => {
    const status = {
      watching: true,
      mode: options.mode ?? "git-dir",
      path: options.gitDir,
      recursive: true,
      limitation: null,
    } as const;

    return {
      start(): void {
        options.onStatus?.(status);
      },
      stop(): void {},
      status,
    };
  };
}

/**
 * Captures the active region below the shell.
 *
 * @returns A status line.
 */
function FocusProbe(): ReactNode {
  latestFocus = useFocusState();

  return <text id="active-region">{latestFocus.state.activeRegion ?? "none"}</text>;
}

/**
 * Captures the status context below the shell.
 *
 * @returns A status line.
 */
function StatusProbe(): ReactNode {
  latestStatus = useStatus();

  return <text id="status-message">{latestStatus.status?.message ?? "none"}</text>;
}

/**
 * Optional provider seams for one host render.
 *
 * `worktreeWatch` is omitted by default so the default production mode (git-dir only) is what the
 * tests exercise unless they opt in.
 */
interface RenderHostOptions {
  readonly worktreeWatch?: boolean;
  readonly enableWatcher?: boolean;
  readonly createWatcher?: GitWatcherFactory;
}

/**
 * Renders the composition root with the required providers.
 *
 * @param client - Git client used by the repository provider.
 * @param options - Watch mode, watcher enablement, and watcher factory seams.
 * @returns The renderer setup.
 */
async function renderHost(
  client: GitClient = INERT_CLIENT,
  options: RenderHostOptions = {},
): Promise<Awaited<ReturnType<typeof testRender>>> {
  latestFocus = undefined;
  latestStatus = undefined;

  return testRender(
    <ConfigProvider>
      <ThemeProvider>
        <KeymapProvider platform="linux">
          <RepositoryProvider
            cwd="/repo"
            gitClient={client}
            createWatcher={options.createWatcher}
            enableWatcher={options.enableWatcher ?? false}
            worktreeWatch={options.worktreeWatch}
            now={() => 0}
          >
            <FocusProvider>
              <StatusProvider>
                <ConsoleProvider>
                  <box flexDirection="column" flexGrow={1} width={120} height={40}>
                    <AppShellHost />
                    <FocusProbe />
                    <StatusProbe />
                  </box>
                </ConsoleProvider>
              </StatusProvider>
            </FocusProvider>
          </RepositoryProvider>
        </KeymapProvider>
      </ThemeProvider>
    </ConfigProvider>,
    { width: 120, height: 40, exitOnCtrlC: false, kittyKeyboard: true },
  );
}

beforeEach(() => {
  resetActionRegistry();
  resetCommandRunner();
});

describe("AppShellHost", () => {
  it("composes every placeholder surface inside the shell", async () => {
    const setup = await renderHost();

    await act(async () => {
      await setup.renderOnce();
    });

    const frame = setup.captureCharFrame();

    expect(frame).toContain("Gitminal");
    expect(frame).toContain("Branches");
    expect(frame).toContain("Commit graph");
    expect(frame).toContain("Commit composer");
    expect(frame).toContain("Diffs");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("registers every global action exactly once", async () => {
    const consoleError = spyOn(console, "error").mockImplementation(() => {});
    const versionBefore = getActionRegistryVersion();
    const expected = [
      ...Object.values(FOCUS_ACTION_BY_REGION),
      "focus.next",
      "focus.previous",
      "app.quit",
      "overlay.close",
      "app.console",
      "app.refresh",
      "remote.fetch",
    ];
    const setup = await renderHost();

    await act(async () => {
      await setup.renderOnce();
    });

    for (const actionId of expected) {
      expect(hasRegisteredAction(actionId, "global")).toBe(true);
    }

    expect(getActionRegistryVersion() - versionBefore).toBe(expected.length);
    expect(consoleError).not.toHaveBeenCalled();

    consoleError.mockRestore();
    await act(async () => {
      await setup.dispose();
    });
  });

  it("quits on q through the app.quit handler", async () => {
    const setup = await renderHost();
    const destroy = spyOn(setup.renderer, "destroy").mockImplementation(() => {});

    await act(async () => {
      await setup.renderOnce();
    });
    await act(async () => {
      setup.mockInput.pressKey("q");
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(destroy).toHaveBeenCalledTimes(1);

    destroy.mockRestore();
    await act(async () => {
      await setup.dispose();
    });
  });

  it("clears a transient status and restores the previous region in one Esc press", async () => {
    const setup = await renderHost();

    await act(async () => {
      await setup.renderOnce();
    });
    await act(async () => {
      latestStatus?.setStatus({ kind: "info", message: "saved" }, 60_000);
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(latestStatus?.status?.message).toBe("saved");

    await act(async () => {
      setup.mockInput.pressKey("6");
    });
    await act(async () => {
      await setup.renderOnce();
    });
    await act(async () => {
      setup.mockInput.pressKey("7");
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(latestFocus?.state.activeRegion).toBe("right-pane");
    expect(latestFocus?.state.previousRegion).toBe("graph");

    await act(async () => {
      setup.mockInput.pressEscape();
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(latestStatus?.status).toBeNull();
    expect(latestFocus?.state.activeRegion).toBe("graph");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region-graph");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("toggles the console drawer with the console action", async () => {
    const setup = await renderHost();

    await act(async () => {
      await setup.renderOnce();
    });

    expect(setup.captureCharFrame()).not.toContain("No commands yet.");

    await act(async () => {
      setup.mockInput.pressKey("`", { ctrl: true });
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(setup.captureCharFrame()).toContain("No commands yet.");

    await act(async () => {
      setup.mockInput.pressKey("`", { ctrl: true });
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(setup.captureCharFrame()).not.toContain("No commands yet.");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("renders branch, upstream, ahead and behind, pending counts, and state", async () => {
    const fake = createFakeGitClient();
    const setup = await renderHost(fake.client);

    await waitForFrame(setup, "normal");

    const frame = setup.captureCharFrame();

    expect(frame).toContain("main");
    expect(frame).toContain("origin/main");
    expect(frame).toContain("ahead 2 behind 1");
    expect(frame).toContain("1 staged 1 unstaged 1 untracked");
    expect(frame).toContain("normal");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("omits counts and the watch hint when there is no readable work tree", async () => {
    const setup = await renderHost();

    await waitForFrame(setup, "not a git repository");

    const frame = setup.captureCharFrame();

    expect(frame).not.toContain("ahead 0 behind 0");
    expect(frame).not.toContain("0 staged 0 unstaged 0 untracked");
    expect(frame).not.toContain("unwatched tree");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("renders a text hint when the opt-in worktree watch is off", async () => {
    const setup = await renderHost(createFakeGitClient().client, {
      worktreeWatch: true,
      enableWatcher: false,
    });

    await waitForFrame(setup, "worktree watch off");

    expect(setup.captureCharFrame()).toContain("worktree watch off");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("renders the working-tree hint for the default git-dir watch", async () => {
    const setup = await renderHost(createFakeGitClient().client, {
      enableWatcher: true,
      createWatcher: createGitDirWatcher(),
    });

    await waitForFrame(setup, "unwatched tree");

    expect(setup.captureCharFrame()).toContain("unwatched tree; press r");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("opens and focuses the console from digit 9", async () => {
    const setup = await renderHost();

    await act(async () => {
      await setup.renderOnce();
    });
    await act(async () => {
      setup.mockInput.pressKey("9");
    });
    await act(async () => {
      await setup.renderOnce();
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(setup.captureCharFrame()).toContain("No commands yet.");
    expect(latestFocus?.state.activeRegion).toBe("console");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("restores the previous region when Esc closes the console", async () => {
    const setup = await renderHost();

    await act(async () => {
      await setup.renderOnce();
    });
    await act(async () => {
      setup.mockInput.pressKey("1");
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(latestFocus?.state.activeRegion).toBe("branches");

    await act(async () => {
      setup.mockInput.pressKey("9");
    });
    await act(async () => {
      await setup.renderOnce();
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(setup.captureCharFrame()).toContain("No commands yet.");
    expect(latestFocus?.state.activeRegion).toBe("console");
    expect(latestFocus?.state.previousRegion).toBe("branches");

    await act(async () => {
      setup.mockInput.pressEscape();
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(setup.captureCharFrame()).not.toContain("No commands yet.");
    expect(latestFocus?.state.activeRegion).toBe("branches");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region-branches");

    await act(async () => {
      await setup.dispose();
    });
  });
});

/**
 * Renders until the captured frame contains one expected marker.
 *
 * @param setup - Renderer setup.
 * @param marker - Text that appears after the initial read settles.
 */
async function waitForFrame(
  setup: Awaited<ReturnType<typeof testRender>>,
  marker: string,
): Promise<void> {
  const deadline = Date.now() + 2_000;

  while (!setup.captureCharFrame().includes(marker) && Date.now() < deadline) {
    await act(async () => {
      await setup.renderOnce();
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }
}
