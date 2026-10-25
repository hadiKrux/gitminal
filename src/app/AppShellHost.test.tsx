import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import type { SelectRenderable } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import { act, type ReactNode } from "react";
import { AppShellHost } from "@/app/AppShellHost";
import { resetCommandOrchestration } from "@/app/hooks/commandRunner.state";
import {
  getActionRegistryVersion,
  hasRegisteredAction,
  resetActionRegistry,
} from "@/app/hooks/useAction";
import type { ActionScope } from "@/app/hooks/useAction.types";
import { useFocusState } from "@/app/hooks/useFocusState";
import { useStatus } from "@/app/hooks/useStatus";
import { ConfigProvider } from "@/app/providers/ConfigProvider";
import { ConsoleProvider } from "@/app/providers/ConsoleProvider";
import { FocusProvider } from "@/app/providers/FocusProvider";
import { KeymapProvider } from "@/app/providers/KeymapProvider";
import { OverlayProvider } from "@/app/providers/OverlayProvider";
import { RepositoryProvider } from "@/app/providers/RepositoryProvider";
import { StatusProvider } from "@/app/providers/StatusProvider";
import type { StatusContextValue } from "@/app/providers/StatusProvider.types";
import { ThemeProvider } from "@/app/providers/ThemeProvider";
import { resetCommandRunner } from "@/domain/commands/commands.runner";
import type { GitClient, GitInvocationResult } from "@/domain/git/git.types";
import type { FocusContextValue } from "@/features/shell/focus.types";
import { FOCUS_ACTION_BY_REGION } from "@/features/shell/regions";
import { MORE_MENU_SELECT_ID } from "@/features/top-bar/MoreMenu.constants";
import { createFakeGitClient, fakeGitResult } from "@/test/git.fake";

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
 * Renders the composition root with the required providers.
 *
 * @param client - Git client used by the repository provider.
 * @returns The renderer setup.
 */
async function renderHost(
  client: GitClient = INERT_CLIENT,
): Promise<Awaited<ReturnType<typeof testRender>>> {
  latestFocus = undefined;
  latestStatus = undefined;

  return testRender(
    <ConfigProvider>
      <ThemeProvider>
        <KeymapProvider platform="linux">
          <RepositoryProvider cwd="/repo" gitClient={client} enableWatcher={false} now={() => 0}>
            <FocusProvider>
              <OverlayProvider>
                <StatusProvider>
                  <ConsoleProvider>
                    <box flexDirection="column" flexGrow={1} width={120} height={40}>
                      <AppShellHost />
                      <FocusProbe />
                      <StatusProbe />
                    </box>
                  </ConsoleProvider>
                </StatusProvider>
              </OverlayProvider>
            </FocusProvider>
          </RepositoryProvider>
        </KeymapProvider>
      </ThemeProvider>
    </ConfigProvider>,
    { width: 120, height: 40, exitOnCtrlC: false, kittyKeyboard: true },
  );
}

/**
 * Renders only the composition root so the footer occupies the true bottom row.
 *
 * @param client - Git client used by the repository provider.
 * @returns The renderer setup.
 */
async function renderBareHost(client: GitClient): Promise<Awaited<ReturnType<typeof testRender>>> {
  return testRender(
    <ConfigProvider>
      <ThemeProvider>
        <KeymapProvider platform="linux">
          <RepositoryProvider cwd="/repo" gitClient={client} enableWatcher={false} now={() => 0}>
            <FocusProvider>
              <OverlayProvider>
                <StatusProvider>
                  <ConsoleProvider>
                    <box flexDirection="column" flexGrow={1} width={120} height={30}>
                      <AppShellHost />
                    </box>
                  </ConsoleProvider>
                </StatusProvider>
              </OverlayProvider>
            </FocusProvider>
          </RepositoryProvider>
        </KeymapProvider>
      </ThemeProvider>
    </ConfigProvider>,
    { width: 120, height: 30, exitOnCtrlC: false, kittyKeyboard: true },
  );
}

beforeEach(() => {
  resetActionRegistry();
  resetCommandRunner();
  resetCommandOrchestration();
});

afterEach(() => {
  resetCommandRunner();
  resetCommandOrchestration();
});

describe("AppShellHost", () => {
  it("composes every placeholder surface inside the shell", async () => {
    const setup = await renderHost();

    await act(async () => {
      await setup.renderOnce();
    });

    const frame = setup.captureCharFrame();

    expect(frame).toContain("/repo");
    expect(frame).toContain("Branches");
    expect(frame).toContain("Commit graph");
    expect(frame).toContain("Commit composer");
    expect(frame).toContain("Diffs");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("registers every global and top-bar action exactly once", async () => {
    const consoleError = spyOn(console, "error").mockImplementation(() => {});
    const versionBefore = getActionRegistryVersion();
    const expected: readonly (readonly [string, ActionScope])[] = [
      ...Object.values(FOCUS_ACTION_BY_REGION).map((actionId) => [actionId, "global"] as const),
      ["focus.next", "global"],
      ["focus.previous", "global"],
      ["app.quit", "global"],
      ["overlay.close", "global"],
      ["app.console", "global"],
      ["app.refresh", "global"],
      ["remote.pull", "global"],
      ["remote.push", "global"],
      ["remote.fetch", "global"],
      ["remote.fetchPrune", "global"],
      ["remote.pushForceSafe", "global"],
      ["remote.pushForceOverwrite", "global"],
      ["remote.pushNoVerify", "global"],
      ["remote.more", "global"],
      ["nav.left", "top-bar"],
      ["nav.right", "top-bar"],
      ["nav.activate", "top-bar"],
    ];
    const setup = await renderHost();

    await act(async () => {
      await setup.renderOnce();
    });

    for (const [actionId, scope] of expected) {
      expect(hasRegisteredAction(actionId, scope), `${actionId} in ${scope}`).toBe(true);
    }

    expect(hasRegisteredAction("remote.fetch", "global")).toBe(true);
    expect(getActionRegistryVersion() - versionBefore).toBe(expected.length);
    expect(consoleError).not.toHaveBeenCalled();

    consoleError.mockRestore();
    await act(async () => {
      await setup.dispose();
    });
  });

  it("opens the More menu with the more action and closes it with Esc", async () => {
    const setup = await renderHost(createFakeGitClient().client);

    await waitForFrame(setup, "origin/main");

    await act(async () => {
      setup.mockInput.pressKey(".");
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(setup.renderer.root.findDescendantById(MORE_MENU_SELECT_ID)).toBeDefined();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("more-menu-select");

    await act(async () => {
      setup.mockInput.pressEscape();
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(setup.renderer.root.findDescendantById(MORE_MENU_SELECT_ID)).toBeUndefined();
    expect(latestFocus?.state.activeRegion).toBe("top-bar");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("opens a force confirmation from the More menu, runs nothing, and restores focus on cancel", async () => {
    const fake = createFakeGitClient();
    const setup = await renderHost(fake.client);

    await waitForFrame(setup, "origin/main");

    await act(async () => {
      setup.mockInput.pressKey(".");
    });
    await act(async () => {
      await setup.renderOnce();
    });

    const select = setup.renderer.root.findDescendantById(MORE_MENU_SELECT_ID) as
      | SelectRenderable
      | undefined;

    await act(async () => {
      select?.setSelectedIndex(3);
      select?.selectCurrent();
    });
    await act(async () => {
      await setup.renderOnce();
    });

    const frame = setup.captureCharFrame();

    expect(frame).toContain("Overwrite remote");
    expect(frame).toContain("main -> origin/main");
    expect([...fake.counts.keys()].some((key) => key.startsWith("push "))).toBeFalse();

    await act(async () => {
      setup.mockInput.pressEscape();
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(setup.captureCharFrame()).not.toContain("main -> origin/main");
    expect(latestFocus?.state.activeRegion).toBe("top-bar");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region-top-bar");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("advertises Enter and Up/Down for the open More menu", async () => {
    const setup = await renderBareHost(createFakeGitClient().client);

    await waitForFrame(setup, "origin/main");

    await act(async () => {
      setup.mockInput.pressKey(".");
    });
    await act(async () => {
      await setup.renderOnce();
    });

    const frame = setup.captureCharFrame();

    expect(frame).toContain("More remote actions");
    expect(frame).toContain("Enter Activate");
    expect(frame).toContain("Up Move up");
    expect(frame).toContain("Down Move down");
    expect(frame).toContain("Esc Close or cancel");

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

  it("renders branch, upstream, ahead and behind, and the sync badge", async () => {
    const fake = createFakeGitClient();
    const setup = await renderHost(fake.client);

    await waitForFrame(setup, "diverged");

    const frame = setup.captureCharFrame();

    expect(frame).toContain("main");
    expect(frame).toContain("origin/main");
    expect(frame).toContain("ahead 2 behind 1");
    expect(frame).toContain("! diverged");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("omits counts when there is no readable work tree", async () => {
    const setup = await renderHost();

    await waitForFrame(setup, "not a git repository");

    const frame = setup.captureCharFrame();

    expect(frame).not.toContain("ahead 0 behind 0");
    expect(frame).not.toContain("0 staged 0 unstaged 0 untracked");

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

  it("keeps the console open when focus moves to another region", async () => {
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

    expect(latestFocus?.state.activeRegion).toBe("console");

    await act(async () => {
      setup.mockInput.pressKey("6");
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(latestFocus?.state.activeRegion).toBe("graph");
    expect(setup.captureCharFrame()).toContain("No commands yet.");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("lets focus leave the console with Tab while the drawer stays open", async () => {
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

    expect(latestFocus?.state.activeRegion).toBe("console");

    await act(async () => {
      setup.mockInput.pressTab();
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(latestFocus?.state.activeRegion).toBe("top-bar");
    expect(setup.captureCharFrame()).toContain("No commands yet.");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("enters the console with Tab from the diff region while the drawer is open", async () => {
    const setup = await renderHost();

    await act(async () => {
      await setup.renderOnce();
    });
    await act(async () => {
      setup.mockInput.pressKey("`", { ctrl: true });
    });
    await act(async () => {
      await setup.renderOnce();
    });

    await act(async () => {
      setup.mockInput.pressKey("8");
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(latestFocus?.state.activeRegion).toBe("diff");

    await act(async () => {
      setup.mockInput.pressTab();
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(latestFocus?.state.activeRegion).toBe("console");
    expect(setup.captureCharFrame()).toContain("No commands yet.");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("skips the console on Tab from the diff region while the drawer is closed", async () => {
    const setup = await renderHost();

    await act(async () => {
      await setup.renderOnce();
    });
    await act(async () => {
      setup.mockInput.pressKey("8");
    });
    await act(async () => {
      await setup.renderOnce();
    });

    await act(async () => {
      setup.mockInput.pressTab();
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(latestFocus?.state.activeRegion).toBe("top-bar");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("restores the previous region when the console toggle closes a focused drawer", async () => {
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
    await act(async () => {
      setup.mockInput.pressKey("9");
    });
    await act(async () => {
      await setup.renderOnce();
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(latestFocus?.state.activeRegion).toBe("console");
    expect(latestFocus?.state.previousRegion).toBe("branches");

    await act(async () => {
      setup.mockInput.pressKey("`", { ctrl: true });
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

  it("closes the console with Esc from another focused region", async () => {
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
    await act(async () => {
      setup.mockInput.pressTab();
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(latestFocus?.state.activeRegion).toBe("top-bar");
    expect(setup.captureCharFrame()).toContain("No commands yet.");

    await act(async () => {
      setup.mockInput.pressEscape();
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(setup.captureCharFrame()).not.toContain("No commands yet.");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("clears the console from the keyboard through the confirmation", async () => {
    const fake = createFakeGitClient();
    const setup = await renderHost(fake.client);

    await waitForFrame(setup, "origin/main");

    await act(async () => {
      setup.mockInput.pressKey("f");
    });
    await waitForFrame(setup, "Fetch completed");

    await act(async () => {
      setup.mockInput.pressKey("9");
    });
    await waitForFrame(setup, "1 entry");

    await act(async () => {
      setup.mockInput.pressKey("c");
    });
    await waitForFrame(setup, "Cancel");

    await act(async () => {
      setup.mockInput.pressEnter();
    });
    await waitForFrame(setup, "No commands yet.");

    expect(setup.captureCharFrame()).not.toContain("Cancel");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("keeps the clear-console confirmation focused when an in-flight fetch fails", async () => {
    const base = createFakeGitClient();
    let fetchCalls = 0;
    let releaseFetch: () => void = () => {};
    const fetchGate = new Promise<void>((resolve) => {
      releaseFetch = resolve;
    });
    const client: GitClient = {
      gitPath: base.client.gitPath,
      invoke: async (options) => {
        if (options.args[0] === "fetch") {
          fetchCalls += 1;

          if (fetchCalls >= 2) {
            await fetchGate;

            return fakeGitResult("", false, "fatal: gated failure");
          }
        }

        return await base.client.invoke(options);
      },
    };
    const setup = await renderHost(client);

    await waitForFrame(setup, "origin/main");

    await act(async () => {
      setup.mockInput.pressKey("f");
    });
    await waitForFrame(setup, "Fetch completed");

    await act(async () => {
      setup.mockInput.pressKey("f");
    });
    await waitForCondition(setup, () => fetchCalls >= 2);

    await act(async () => {
      setup.mockInput.pressKey("9");
    });
    await waitForFrame(setup, "1 entry");

    await act(async () => {
      setup.mockInput.pressKey("c");
    });
    await waitForFrame(setup, "Cancel");

    expect(setup.renderer.currentFocusedRenderable?.id).toBe("confirm-modal");

    await act(async () => {
      releaseFetch();
    });
    await waitForCondition(setup, () => latestStatus?.operation === null);

    expect(setup.captureCharFrame()).toContain("Clear console");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("confirm-modal");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("opens and focuses the console when Open console entry opens a closed drawer", async () => {
    const fake = createFakeGitClient();

    fake.setFetchResult(fakeGitResult("", false, "fatal: could not resolve host: example.com"));
    const setup = await renderHost(fake.client);

    await waitForFrame(setup, "origin/main");

    await act(async () => {
      setup.mockInput.pressKey("f");
    });
    await waitForFrame(setup, "Fetch failed");

    await act(async () => {
      setup.mockInput.pressArrow("right");
    });
    await act(async () => {
      await setup.renderOnce();
    });
    await act(async () => {
      setup.mockInput.pressEnter();
    });
    await waitForCondition(
      setup,
      () => setup.renderer.currentFocusedRenderable?.id === "region-console",
    );

    expect(setup.captureCharFrame()).toContain("entries");
    expect(latestFocus?.state.activeRegion).toBe("console");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("opens the persistent error overlay for a failed fetch and dismisses it on Esc", async () => {
    const fake = createFakeGitClient();

    fake.setFetchResult(fakeGitResult("", false, "fatal: could not resolve host: example.com"));
    const setup = await renderHost(fake.client);

    await waitForFrame(setup, "origin/main");

    await act(async () => {
      setup.mockInput.pressKey("f");
    });
    await waitForFrame(setup, "Fetch failed");

    const frame = setup.captureCharFrame();

    expect(frame).toContain("fatal: could not resolve host: example.com");
    expect(frame).toContain("Dismiss");
    expect(frame).toContain("Open console entry");
    expect(frame).toContain("Retry");

    await act(async () => {
      setup.mockInput.pressEscape();
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(setup.captureCharFrame()).not.toContain("Fetch failed");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region-top-bar");

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
  await waitForCondition(setup, () => setup.captureCharFrame().includes(marker));
}

/**
 * Renders until a condition is true.
 *
 * @param setup - Renderer setup.
 * @param condition - Predicate that observes the settled state.
 */
async function waitForCondition(
  setup: Awaited<ReturnType<typeof testRender>>,
  condition: () => boolean,
): Promise<void> {
  const deadline = Date.now() + 2_000;

  while (!condition() && Date.now() < deadline) {
    await act(async () => {
      await setup.renderOnce();
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }
}
