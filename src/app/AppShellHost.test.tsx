import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import type { BoxRenderable, SelectRenderable, TabSelectRenderable } from "@opentui/core";
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
import { registerInputEscapeClear, resetInputEscapeClear } from "@/app/hooks/useInputEscapeClear";
import { useRepository } from "@/app/hooks/useRepository";
import { useStatus } from "@/app/hooks/useStatus";
import { ConfigProvider } from "@/app/providers/ConfigProvider";
import { ConsoleProvider } from "@/app/providers/ConsoleProvider";
import { DraftProvider } from "@/app/providers/DraftProvider";
import { FocusProvider } from "@/app/providers/FocusProvider";
import { KeymapProvider } from "@/app/providers/KeymapProvider";
import { OverlayProvider } from "@/app/providers/OverlayProvider";
import { RepositoryProvider } from "@/app/providers/RepositoryProvider";
import { StatusProvider } from "@/app/providers/StatusProvider";
import type { StatusContextValue } from "@/app/providers/StatusProvider.types";
import { ThemeProvider } from "@/app/providers/ThemeProvider";
import { resetCommandRunner } from "@/domain/commands/commands.runner";
import { buildListLocalTagsArgs, buildLsRemoteTagsArgs } from "@/domain/git/git.tags";
import type { GitClient, GitInvocationResult } from "@/domain/git/git.types";
import { COMMIT_DETAILS_RETRY_ID } from "@/features/commit-details/useCommitDetails";
import {
  COMPOSER_COMMIT_BUTTON_ID,
  COMPOSER_MORE_BUTTON_ID,
  COMPOSER_TEXTAREA_ID,
} from "@/features/composer/composer.constants";
import { REMOTES_FILTER_INPUT_ID } from "@/features/remotes/RemoteFilter.constants";
import type { FocusContextValue } from "@/features/shell/focus.types";
import { FOCUS_ACTION_BY_REGION, SIDEBAR_SWITCHER_ID } from "@/features/shell/regions";
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

/** Status output for a clean working tree, so the Commit button reads "Nothing to commit". */
const CLEAN_STATUS = "# branch.oid abc123\0# branch.head main\0";

/** Latest focus context captured by the probe. */
let latestFocus: FocusContextValue | undefined;

/** Latest status context captured by the probe. */
let latestStatus: StatusContextValue | undefined;

/** Latest repository context captured by the probe. */
let latestRepository: ReturnType<typeof useRepository> | undefined;

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
 * Captures the repository context below the shell.
 *
 * @returns Nothing.
 */
function RepositoryProbe(): ReactNode {
  latestRepository = useRepository();

  return null;
}

/**
 * Builds a client that advertises one remote-only tag.
 *
 * @param fake - Fake git client to wrap.
 * @param noLocalTags - Whether the local tag list is empty.
 * @param remoteTag - Remote tag name to advertise.
 * @returns The git client.
 */
function createRemoteTagClient(
  fake: ReturnType<typeof createFakeGitClient>,
  noLocalTags: boolean,
  remoteTag: string = "v2.0.0",
): GitClient {
  const lsRemoteKey = buildLsRemoteTagsArgs("origin")?.join(" ") ?? "";
  const localTagsKey = buildListLocalTagsArgs().join(" ");

  return {
    ...fake.client,
    invoke: async (options) => {
      const key = options.args.join(" ");

      if (key === lsRemoteKey) {
        return fakeGitResult(`abc123\trefs/tags/${remoteTag}\n`);
      }

      if (noLocalTags && key === localTagsKey) {
        return fakeGitResult("");
      }

      return await fake.client.invoke(options);
    },
  };
}

/**
 * Renders the composition root with the required providers.
 *
 * @param client - Git client used by the repository provider.
 * @param width - Terminal width, which also selects the responsive layout mode.
 * @param height - Terminal height.
 * @returns The renderer setup.
 */
async function renderHost(
  client: GitClient = INERT_CLIENT,
  width: number = 120,
  height: number = 40,
): Promise<Awaited<ReturnType<typeof testRender>>> {
  latestFocus = undefined;
  latestStatus = undefined;
  latestRepository = undefined;

  return testRender(
    <ConfigProvider>
      <ThemeProvider>
        <KeymapProvider platform="linux">
          <RepositoryProvider cwd="/repo" gitClient={client} enableWatcher={false} now={() => 0}>
            <DraftProvider>
              <FocusProvider>
                <OverlayProvider>
                  <StatusProvider>
                    <ConsoleProvider>
                      <box flexDirection="column" flexGrow={1} width={width} height={height}>
                        <AppShellHost />
                        <FocusProbe />
                        <StatusProbe />
                        <RepositoryProbe />
                      </box>
                    </ConsoleProvider>
                  </StatusProvider>
                </OverlayProvider>
              </FocusProvider>
            </DraftProvider>
          </RepositoryProvider>
        </KeymapProvider>
      </ThemeProvider>
    </ConfigProvider>,
    { width, height, exitOnCtrlC: false, kittyKeyboard: true },
  );
}

/**
 * Renders only the composition root so the footer occupies the true bottom row.
 *
 * @param client - Git client used by the repository provider.
 * @param width - Terminal width.
 * @param height - Terminal height.
 * @returns The renderer setup.
 */
async function renderBareHost(
  client: GitClient,
  width: number = 120,
  height: number = 30,
): Promise<Awaited<ReturnType<typeof testRender>>> {
  return testRender(
    <ConfigProvider>
      <ThemeProvider>
        <KeymapProvider platform="linux">
          <RepositoryProvider cwd="/repo" gitClient={client} enableWatcher={false} now={() => 0}>
            <DraftProvider>
              <FocusProvider>
                <OverlayProvider>
                  <StatusProvider>
                    <ConsoleProvider>
                      <box flexDirection="column" flexGrow={1} width={width} height={height}>
                        <AppShellHost />
                      </box>
                    </ConsoleProvider>
                  </StatusProvider>
                </OverlayProvider>
              </FocusProvider>
            </DraftProvider>
          </RepositoryProvider>
        </KeymapProvider>
      </ThemeProvider>
    </ConfigProvider>,
    { width, height, exitOnCtrlC: false, kittyKeyboard: true },
  );
}

beforeEach(() => {
  resetActionRegistry();
  resetCommandRunner();
  resetCommandOrchestration();
  resetInputEscapeClear();
});

afterEach(() => {
  resetCommandRunner();
  resetCommandOrchestration();
});

describe("AppShellHost", () => {
  it("composes every feature surface inside the shell", async () => {
    const setup = await renderHost();

    await act(async () => {
      await setup.renderOnce();
    });

    const frame = setup.captureCharFrame();

    expect(frame).toContain("/repo");
    expect(frame).toContain("Branches (0)");
    expect(frame).toContain("Remotes (0)");
    expect(frame).toContain("Tags (0)");
    expect(frame).toContain("Stashes (0)");
    expect(frame).toContain("Worktrees (0)");
    expect(frame).toContain("Commits");
    expect(frame).toContain("0 staged");
    expect(frame).toContain("Diffs");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("derives the right pane from the selection and keeps the graph and diff mounted", async () => {
    const consoleError = spyOn(console, "error").mockImplementation(() => {});
    const setup = await renderHost();

    await act(async () => {
      await setup.renderOnce();
    });

    expect(setup.renderer.root.findDescendantById("region-graph")).toBeDefined();
    expect(setup.renderer.root.findDescendantById("region-diff")).toBeDefined();
    expect(setup.renderer.root.findDescendantById("region-right-pane")).toBeDefined();
    expect(setup.renderer.root.findDescendantById(COMPOSER_TEXTAREA_ID)).toBeDefined();

    await act(async () => {
      latestRepository?.setSelection({ kind: "commit", oid: "abc123" });
    });
    await waitForCondition(
      setup,
      () => setup.renderer.root.findDescendantById(COMMIT_DETAILS_RETRY_ID) !== undefined,
    );

    expect(setup.renderer.root.findDescendantById(COMPOSER_TEXTAREA_ID)).toBeUndefined();
    expect(setup.renderer.root.findDescendantById("region-graph")).toBeDefined();
    expect(setup.renderer.root.findDescendantById("region-diff")).toBeDefined();

    await act(async () => {
      latestRepository?.setSelection({ kind: "pending" });
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(setup.renderer.root.findDescendantById(COMPOSER_TEXTAREA_ID)).toBeDefined();
    expect(
      consoleError.mock.calls.some((call) => String(call[0]).includes("Duplicate action handler")),
    ).toBe(false);

    consoleError.mockRestore();
    await act(async () => {
      await setup.dispose();
    });
  });

  it("focuses the composer with commit.focus only while the composer is mounted", async () => {
    const setup = await renderHost(createFakeGitClient().client);

    await waitForFrame(setup, "origin/main");

    await act(async () => {
      await setup.renderOnce();
    });

    await act(async () => {
      setup.mockInput.pressKey("c");
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(setup.renderer.currentFocusedRenderable?.id).toBe(COMPOSER_TEXTAREA_ID);

    await act(async () => {
      setup.mockInput.pressEscape();
    });
    await act(async () => {
      await setup.renderOnce();
    });
    await act(async () => {
      setup.mockInput.pressKey("6");
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region-graph");

    await act(async () => {
      latestRepository?.setSelection({ kind: "commit", oid: "abc123" });
    });
    await act(async () => {
      await setup.renderOnce();
    });
    await act(async () => {
      setup.mockInput.pressKey("c");
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region-graph");

    await act(async () => {
      latestRepository?.setSelection({ kind: "pending" });
    });
    await act(async () => {
      await setup.renderOnce();
    });
    await act(async () => {
      setup.mockInput.pressKey("c");
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(setup.renderer.currentFocusedRenderable?.id).toBe(COMPOSER_TEXTAREA_ID);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("keeps the collapsed switcher tabs free of the border-title count", async () => {
    const setup = await renderHost(INERT_CLIENT, 85, 30);

    await act(async () => {
      await setup.renderOnce();
    });

    const switcher = setup.renderer.root.findDescendantById(SIDEBAR_SWITCHER_ID) as
      | TabSelectRenderable
      | undefined;

    expect(switcher?.options.map((option) => option.name)).toEqual([
      "Branches",
      "Remotes",
      "Tags",
      "Stashes",
      "Worktrees",
    ]);
    expect(setup.captureCharFrame()).toContain("Branches (0)");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("counts a local tag plus a remote-only tag in the Tags border title", async () => {
    const fake = createFakeGitClient();
    const setup = await renderHost(createRemoteTagClient(fake, false));

    await waitForFrame(setup, "Tags (1)");

    await act(async () => {
      await latestRepository?.refreshRemoteTags();
    });
    await waitForFrame(setup, "Tags (2)");

    expect(setup.captureCharFrame()).toContain("Tags (2)");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("counts a remote-only tag when the repository has no local tag", async () => {
    const fake = createFakeGitClient();
    const setup = await renderHost(createRemoteTagClient(fake, true, "v2.0.0"));

    await waitForFrame(setup, "Tags (0)");

    await act(async () => {
      await latestRepository?.refreshRemoteTags();
    });
    await waitForFrame(setup, "Tags (1)");

    expect(setup.captureCharFrame()).toContain("Tags (1)");

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
      ["commit.focus", "global"],
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
      ["branch.create", "branches"],
      ["branch.delete", "branches"],
      ["nav.up", "branches"],
      ["nav.down", "branches"],
      ["nav.activate", "branches"],
      ["nav.first", "branches"],
      ["nav.last", "branches"],
      ["remote.createLocal", "remotes"],
      ["list.filter", "remotes"],
      ["nav.up", "remotes"],
      ["nav.down", "remotes"],
      ["nav.activate", "remotes"],
      ["nav.first", "remotes"],
      ["nav.last", "remotes"],
      ["tag.create", "tags"],
      ["tag.delete", "tags"],
      ["tag.push", "tags"],
      ["list.filter", "tags"],
      ["nav.up", "tags"],
      ["nav.down", "tags"],
      ["nav.activate", "tags"],
      ["stash.create", "stashes"],
      ["stash.apply", "stashes"],
      ["stash.pop", "stashes"],
      ["stash.delete", "stashes"],
      ["nav.up", "stashes"],
      ["nav.down", "stashes"],
      ["nav.activate", "stashes"],
      ["worktree.create", "worktrees"],
      ["worktree.delete", "worktrees"],
      ["list.filter", "worktrees"],
      ["nav.up", "worktrees"],
      ["nav.down", "worktrees"],
      ["nav.activate", "worktrees"],
      ["nav.up", "graph"],
      ["nav.down", "graph"],
      ["nav.activate", "graph"],
      ["nav.first", "graph"],
      ["nav.last", "graph"],
      ["nav.pageUp", "graph"],
      ["nav.pageDown", "graph"],
      ["graph.search", "graph"],
      ["nav.up", "diff"],
      ["nav.down", "diff"],
      ["nav.activate", "diff"],
      ["nav.expand", "diff"],
      ["nav.collapse", "diff"],
      ["diff.toggle", "diff"],
      ["diff.stage", "diff"],
      ["diff.unstage", "diff"],
      ["diff.discard", "diff"],
      ["diff.deleteUntracked", "diff"],
      ["diff.stageAll", "diff"],
      ["diff.unstageAll", "diff"],
      ["diff.discardAll", "diff"],
      ["diff.deleteAllUntracked", "diff"],
      ["nav.left", "right-pane"],
      ["nav.right", "right-pane"],
      ["nav.activate", "right-pane"],
      ["commit.submit", "right-pane"],
      ["commit.submitNoVerify", "right-pane"],
      ["commit.amend", "right-pane"],
      ["commit.amendNoVerify", "right-pane"],
      ["commit.options", "right-pane"],
      ["form.submit", "right-pane"],
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

  it("clears a focused filter on the first Esc and leaves the field on the next", async () => {
    const setup = await renderHost();

    await act(async () => {
      await setup.renderOnce();
    });

    let clears = 0;
    let unregister = (): void => {};
    unregister = registerInputEscapeClear(REMOTES_FILTER_INPUT_ID, () => {
      clears += 1;
      unregister();
    });

    await act(async () => {
      latestFocus?.focusRenderable(REMOTES_FILTER_INPUT_ID);
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(setup.renderer.currentFocusedRenderable?.id).toBe(REMOTES_FILTER_INPUT_ID);

    await act(async () => {
      setup.mockInput.pressEscape();
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(clears).toBe(1);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe(REMOTES_FILTER_INPUT_ID);
    expect(latestFocus?.state.activeRegion).toBe("remotes");

    await act(async () => {
      setup.mockInput.pressEscape();
    });
    await waitForCondition(
      setup,
      () => setup.renderer.currentFocusedRenderable?.id === "region-remotes",
    );

    expect(clears).toBe(1);
    expect(latestFocus?.state.activeRegion).toBe("remotes");

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

    await waitForFrame(setup, "Branches (2)");

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
    await act(async () => {
      await setup.renderOnce();
    });

    expect(setup.captureCharFrame()).toContain("1 entry");
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

  it("keeps the composer controls and the Diffs title at the enforced 80x24 minimum", async () => {
    await expectComposerLayout(80, 24);
  });

  it("keeps the composer controls and the Diffs title at the target 100x30 size", async () => {
    await expectComposerLayout(100, 30);
  });

  for (const height of [24, 25, 26]) {
    it(`keeps the composer inside the clamped slot while the console is open at 80x${height}`, async () => {
      await expectComposerLayout(80, height, { consoleOpen: true });
    });
  }
});

/**
 * Renders the real composer and diff at one terminal size and asserts the right-column geometry.
 *
 * The composer is the default right-pane mode, so the frame is captured with the real surfaces
 * mounted. The Commit label proves the primary action is drawn rather than clipped, the panel
 * geometry proves the composer does not overlap the diff, and the graph gutter proves the graph
 * keeps its border and the documented one-cell gap at 80 columns. With the console open the right
 * column clamps the right-pane slot, so the same geometry asserts that the composer fills the
 * clamped slot instead of overdrawing the diff or the gutter.
 *
 * @param width - Terminal width.
 * @param height - Terminal height.
 * @param options - Layout state to arrange before the geometry is read.
 */
async function expectComposerLayout(
  width: number,
  height: number,
  options: { readonly consoleOpen?: boolean } = {},
): Promise<void> {
  const fake = createFakeGitClient();

  fake.setStatusOutput(CLEAN_STATUS);

  const setup = await renderBareHost(fake.client, width, height);

  await waitForFrame(setup, "0 staged");

  if (options.consoleOpen === true) {
    await act(async () => {
      setup.mockInput.pressKey("`", { ctrl: true });
    });
    await waitForFrame(setup, "No commands yet.");
  }

  await act(async () => {
    await setup.renderOnce();
  });
  await act(async () => {
    await setup.renderOnce();
  });

  const frame = setup.captureCharFrame();

  expect(frame).toContain("Nothing to commit");
  expect(frame).toContain("Message");

  if (options.consoleOpen === true) {
    expect(frame).toContain("No commands yet.");
  }

  const graph = readBox(setup, "region-graph");
  const rightPane = readBox(setup, "region-right-pane");
  const diff = readBox(setup, "region-diff");
  const more = readBox(setup, COMPOSER_MORE_BUTTON_ID);
  const commit = readBox(setup, COMPOSER_COMMIT_BUTTON_ID);

  expect(rightPane.y + rightPane.height).toBeLessThanOrEqual(diff.y);
  expect(diff.y - (rightPane.y + rightPane.height)).toBeGreaterThanOrEqual(1);
  expect(rightPane.x - (graph.x + graph.width)).toBeGreaterThanOrEqual(1);
  expect(more.y).toBeGreaterThanOrEqual(rightPane.y);
  expect(more.y + more.height).toBeLessThanOrEqual(rightPane.y + rightPane.height);
  expect(commit.y).toBeGreaterThanOrEqual(rightPane.y);
  expect(commit.y + commit.height).toBeLessThanOrEqual(rightPane.y + rightPane.height);

  const titleRow = frame.split("\n")[diff.y] ?? "";

  expect(titleRow).toContain("Diffs");
  expect(titleRow).not.toContain("staged");
  expect(titleRow).not.toContain("Message");
  expect(titleRow).not.toContain("Commit");

  await act(async () => {
    await setup.dispose();
  });
}

/**
 * Reads one box renderable by id and fails when the surface is missing.
 *
 * @param setup - Renderer setup.
 * @param id - Stable renderable id.
 * @returns The found box.
 */
function readBox(setup: Awaited<ReturnType<typeof testRender>>, id: string): BoxRenderable {
  const box = setup.renderer.root.findDescendantById(id) as BoxRenderable | undefined;

  if (box === undefined) {
    throw new Error(`missing renderable '${id}'`);
  }

  return box;
}

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
  await waitForCondition(setup, () => readFrame(setup)?.includes(marker) === true);
}

/**
 * Reads the current character frame, tolerating a frame that is mid-render.
 *
 * The real surfaces mount animated loading rows, so the renderer can be inside an animation frame
 * when a test polls. `captureCharFrame` throws `OutputBusy` while the frame buffer is leased; that is
 * a transient test-renderer race, not a rendering defect, so the wait helpers retry on the next pass
 * instead of failing.
 *
 * @param setup - Renderer setup.
 * @returns The frame text, or null while a frame is being rendered.
 */
function readFrame(setup: Awaited<ReturnType<typeof testRender>>): string | null {
  try {
    return setup.captureCharFrame();
  } catch (error) {
    if (error instanceof Error && error.message.includes("OutputBusy")) {
      return null;
    }

    throw error;
  }
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
