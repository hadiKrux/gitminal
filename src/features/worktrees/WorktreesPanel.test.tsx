import { beforeEach, describe, expect, it, spyOn } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act, type ReactNode } from "react";
import { resetCommandOrchestration } from "@/app/hooks/commandRunner.state";
import {
  getActionRegistryVersion,
  hasRegisteredAction,
  resetActionRegistry,
  resolveActionHandler,
} from "@/app/hooks/useAction";
import { useFocusRegion } from "@/app/hooks/useFocusRegion";
import { useHotkeys } from "@/app/hooks/useHotkeys";
import { useOverlay } from "@/app/hooks/useOverlay";
import { useRepository } from "@/app/hooks/useRepository";
import { useStatus } from "@/app/hooks/useStatus";
import { registerCommandHandler, resetCommandRunner } from "@/domain/commands/commands.runner";
import { executeWorktreeDelete } from "@/domain/commands/commands.worktrees";
import { buildListLocalBranchesArgs } from "@/domain/git/git.branches";
import type { GitClient, GitInvocationResult } from "@/domain/git/git.types";
import { buildListWorktreesArgs } from "@/domain/git/git.worktrees";
import type { RepositorySelection } from "@/domain/repository/repository.types";
import { WorktreesPanel } from "@/features/worktrees/WorktreesPanel";
import { AppTestProviders } from "@/test/app.harness";
import { createFakeGitClient, fakeGitResult } from "@/test/git.fake";
import { ICONS } from "@/theme/icons";

const WORKTREES_KEY = buildListWorktreesArgs().join(" ");
const BRANCHES_KEY = buildListLocalBranchesArgs().join(" ");
const FIXTURE_DATE = "2026-01-02T03:04:05+00:00";
const FEATURE_PATH = "/home/user/code/feature-branch";
const DETACHED_PATH = "/home/user/code/detached-worktree";
const LOCKED_PATH = "/home/user/code/locked-worktree";

/** Recorded worktrees: current, detached, linked, and locked plus prunable. */
const WORKTREES_OUTPUT = [
  "worktree /repo",
  "HEAD abc1234567890",
  "branch refs/heads/main",
  "",
  `worktree ${DETACHED_PATH}`,
  "HEAD 1234567890abcdef",
  "detached",
  "",
  `worktree ${FEATURE_PATH}`,
  "HEAD def4567890",
  "branch refs/heads/feature-branch",
  "",
  `worktree ${LOCKED_PATH}`,
  "HEAD fed4567890",
  "branch refs/heads/locked-branch",
  "locked in use by another process",
  "prunable directory is gone",
  "",
].join("\n");

/** Recorded local branches needed by the repository read. */
const BRANCHES_OUTPUT = [
  `main\0abc123\0*\0${FIXTURE_DATE}\0origin\0refs/heads/main\0`,
  `feature-branch\0def456\0 \0${FIXTURE_DATE}\0\0\0`,
  `locked-branch\0fed456\0 \0${FIXTURE_DATE}\0\0\0`,
].join("\n");

/** Latest overlay context captured by the probe. */
let latestOverlay: ReturnType<typeof useOverlay> | undefined;

/** Latest status context captured by the probe. */
let latestStatus: ReturnType<typeof useStatus> | undefined;

/** Latest right-pane selection captured by the probe. */
let latestSelection: RepositorySelection | undefined;

/** Latest repository context captured by the probe. */
let latestRepository: ReturnType<typeof useRepository> | undefined;

/**
 * Renders the worktrees panel, its overlay modals, and the keyboard dispatcher.
 *
 * @returns The panel frame.
 */
function PanelHarness(): ReactNode {
  const region = useFocusRegion("worktrees");
  const repository = useRepository();

  latestOverlay = useOverlay();
  latestStatus = useStatus();
  latestSelection = repository.selection;
  latestRepository = repository;
  useHotkeys();

  return (
    <box {...region.regionProps} flexDirection="column" width={60} height={20}>
      <WorktreesPanel />
      <OverlayEntryProbe />
    </box>
  );
}

/**
 * Mounts the single open overlay entry in the same tree as the panel.
 *
 * The real overlay host is shell UI this feature cannot import, so the test renders the entry the
 * same way the host does.
 *
 * @returns The open overlay entry, or null.
 */
function OverlayEntryProbe(): ReactNode {
  const overlay = useOverlay();

  if (overlay.entry?.kind !== "modal") {
    return null;
  }

  return <>{overlay.entry.render({ close: overlay.close })}</>;
}

/**
 * Builds a recording fake client with the recorded worktree and branch reads.
 *
 * @param options - Empty repository, failed worktree read, or failed remove.
 * @returns The client and recorded invocation keys.
 */
function createClient(
  options: {
    readonly emptyRepository?: boolean;
    readonly failWorktrees?: boolean;
    readonly failRemove?: boolean;
  } = {},
) {
  const fake = createFakeGitClient();
  const calls: string[] = [];
  const overrides: Record<string, () => GitInvocationResult> = {
    [WORKTREES_KEY]: () => fakeGitResult(options.failWorktrees === true ? "" : WORKTREES_OUTPUT),
    [BRANCHES_KEY]: () => fakeGitResult(BRANCHES_OUTPUT),
  };

  if (options.failWorktrees === true) {
    overrides[WORKTREES_KEY] = () => fakeGitResult("", false, "fatal: cannot list worktrees");
  }

  if (options.emptyRepository === true) {
    overrides[WORKTREES_KEY] = () => fakeGitResult("");
    overrides[BRANCHES_KEY] = () => fakeGitResult("");
  }

  if (options.failRemove === true) {
    overrides[`worktree remove ${FEATURE_PATH}`] = () =>
      fakeGitResult("", false, "fatal: permission denied");
  } else {
    overrides[`worktree remove ${FEATURE_PATH}`] = () => fakeGitResult("");
  }

  const client: GitClient = {
    gitPath: "git",
    invoke: async (input) => {
      const key = input.args.join(" ");

      calls.push(key);

      const override = overrides[key];

      if (override !== undefined) {
        return override();
      }

      if (options.emptyRepository === true) {
        if (key === "rev-parse --verify HEAD") {
          return fakeGitResult("", false);
        }

        if (key === "status --porcelain=v2 --branch -z --untracked-files=all") {
          return fakeGitResult("# branch.head main\0");
        }
      }

      return await fake.client.invoke(input);
    },
  };

  return { client, calls };
}

/**
 * Renders the panel and waits for a predicate.
 *
 * @param client - Git client.
 * @param predicate - Condition the test waits for.
 * @returns The renderer setup.
 */
async function renderPanel(
  client: GitClient,
  predicate: (frame: string) => boolean,
): Promise<Awaited<ReturnType<typeof testRender>>> {
  latestOverlay = undefined;
  latestStatus = undefined;
  latestSelection = undefined;
  latestRepository = undefined;

  const setup = await testRender(
    <AppTestProviders gitClient={client}>
      <PanelHarness />
    </AppTestProviders>,
    { width: 100, height: 30, kittyKeyboard: true },
  );

  await waitFor(setup, () => predicate(setup.captureCharFrame()));

  return setup;
}

/**
 * Waits for a predicate while rendering frames.
 *
 * @param setup - Renderer setup.
 * @param predicate - Condition to wait for.
 */
async function waitFor(
  setup: Awaited<ReturnType<typeof testRender>>,
  predicate: () => boolean,
): Promise<void> {
  const deadline = Date.now() + 2_000;

  while (!predicate() && Date.now() < deadline) {
    await act(async () => {
      await setup.renderOnce();
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }

  await act(async () => {
    await setup.renderOnce();
  });
}

/**
 * Focuses the worktrees region frame.
 *
 * @param setup - Renderer setup.
 */
async function focusWorktrees(setup: Awaited<ReturnType<typeof testRender>>): Promise<void> {
  await act(async () => {
    setup.renderer.root.findDescendantById("region-worktrees")?.focus();
  });
  await act(async () => {
    await setup.renderOnce();
  });
}

/**
 * Presses one arrow key.
 *
 * @param setup - Renderer setup.
 * @param direction - Arrow direction.
 */
async function pressArrow(
  setup: Awaited<ReturnType<typeof testRender>>,
  direction: "up" | "down",
): Promise<void> {
  await act(async () => {
    setup.mockInput.pressArrow(direction);
  });
  await act(async () => {
    await setup.renderOnce();
  });
}

/**
 * Presses Enter and renders once.
 *
 * @param setup - Renderer setup.
 */
async function pressEnter(setup: Awaited<ReturnType<typeof testRender>>): Promise<void> {
  await act(async () => {
    setup.mockInput.pressEnter();
  });
  await act(async () => {
    await setup.renderOnce();
  });
}

/**
 * Runs one action in a scope.
 *
 * @param actionId - Action id.
 * @param scope - Scope that owns the handler.
 */
async function runAction(actionId: string, scope: "worktrees" | "overlay"): Promise<void> {
  await act(async () => {
    resolveActionHandler(actionId, scope)?.();
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
  });
}

beforeEach(() => {
  resetActionRegistry();
  resetCommandOrchestration();
  resetCommandRunner();
  registerCommandHandler({
    commandId: "worktree.delete",
    operationLabel: "Delete worktree",
    handler: executeWorktreeDelete,
  });
});

describe("WorktreesPanel registrations", () => {
  it("registers exactly the worktree actions plus cursor navigation and no global action", async () => {
    const consoleError = spyOn(console, "error").mockImplementation(() => {});
    const versionBefore = getActionRegistryVersion();
    const { client } = createClient();
    const setup = await renderPanel(client, (frame) => frame.includes("feature-branch"));
    const expected = [
      "nav.up",
      "nav.down",
      "nav.activate",
      "worktree.create",
      "worktree.delete",
      "list.filter",
    ];

    for (const actionId of expected) {
      expect(hasRegisteredAction(actionId, "worktrees"), actionId).toBe(true);
    }

    expect(hasRegisteredAction("nav.first", "worktrees")).toBe(false);
    expect(hasRegisteredAction("nav.last", "worktrees")).toBe(false);
    expect(hasRegisteredAction("app.refresh", "worktrees")).toBe(false);
    expect(hasRegisteredAction("app.refresh", "global")).toBe(false);
    expect(getActionRegistryVersion() - versionBefore).toBe(expected.length);
    expect(consoleError).not.toHaveBeenCalled();

    consoleError.mockRestore();
    await act(async () => {
      await setup.dispose();
    });
  });
});

describe("WorktreesPanel rows", () => {
  it("shows the current, locked, prunable, dirty, and detached markers with shortened paths", async () => {
    const { client } = createClient();
    const setup = await renderPanel(client, (frame) => frame.includes("feature-branch"));

    await focusWorktrees(setup);

    let frame = setup.captureCharFrame();

    expect(frame).not.toContain("Worktrees (");
    expect(frame).toContain("current worktree");
    expect(frame).toContain(`${ICONS.detached} 1234567`);
    expect(frame).toContain(ICONS.ellipsis);
    expect(frame).toContain("feature-branch");
    expect(frame).not.toContain(FEATURE_PATH);

    await pressArrow(setup, "down");
    await pressArrow(setup, "down");
    await pressArrow(setup, "down");

    frame = setup.captureCharFrame();

    expect(frame).toContain("locked: in use by another process");
    expect(frame).toContain("prunable: directory");
    expect(frame).toContain("is gone");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("shows the empty state with the create hint when there are no worktrees", async () => {
    const { client } = createClient({ emptyRepository: true });
    const setup = await renderPanel(client, (frame) => frame.includes("No worktrees"));
    const frame = setup.captureCharFrame();

    expect(frame).toContain("No worktrees");
    expect(frame).toContain("n New worktree");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("shows the read error with a Retry action", async () => {
    const { client } = createClient({ failWorktrees: true });
    const setup = await renderPanel(client, (frame) => frame.includes("Could not read worktrees"));
    const frame = setup.captureCharFrame();

    expect(frame).toContain("Could not read worktrees");
    expect(frame).toContain("Retry");

    await act(async () => {
      await setup.dispose();
    });
  });
});

describe("WorktreesPanel actions", () => {
  it("refuses delete for the current worktree with the exact reason and no modal", async () => {
    const { client } = createClient();
    const setup = await renderPanel(client, (frame) => frame.includes("feature-branch"));

    await focusWorktrees(setup);
    await runAction("worktree.delete", "worktrees");

    expect(latestOverlay?.entry).toBeNull();
    expect(latestStatus?.status?.message).toBe("current worktree");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("selects the worktree in the right pane and never switches the repository", async () => {
    const { client } = createClient();
    const setup = await renderPanel(client, (frame) => frame.includes("feature-branch"));

    await focusWorktrees(setup);
    await pressEnter(setup);

    expect(latestSelection).toEqual({ kind: "worktree", path: "/repo" });
    expect(latestRepository?.signals.cwd).toBe("/repo");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("refreshes the worktree read when the region gains focus", async () => {
    const { client, calls } = createClient();
    const setup = await renderPanel(client, (frame) => frame.includes("feature-branch"));
    const before = calls.filter((call) => call === WORKTREES_KEY).length;

    await focusWorktrees(setup);
    await waitFor(setup, () => calls.filter((call) => call === WORKTREES_KEY).length > before);

    expect(calls.filter((call) => call === WORKTREES_KEY).length).toBeGreaterThan(before);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("shows the read-only line while another mutation owns the write slot", async () => {
    const { client } = createClient();
    const setup = await renderPanel(client, (frame) => frame.includes("feature-branch"));

    await act(async () => {
      latestStatus?.beginOperation("Delete worktree");
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(setup.captureCharFrame()).toContain("operation in progress - read only");

    await act(async () => {
      latestStatus?.endOperation();
      await setup.dispose();
    });
  });

  it("keeps the row and surfaces the error when delete fails", async () => {
    const { client } = createClient({ failRemove: true });
    const setup = await renderPanel(client, (frame) => frame.includes("feature-branch"));

    await focusWorktrees(setup);
    await pressArrow(setup, "down");
    await pressArrow(setup, "down");
    await runAction("worktree.delete", "worktrees");

    expect(latestOverlay?.entry?.kind).toBe("modal");

    await runAction("nav.right", "overlay");
    await runAction("nav.activate", "overlay");
    await waitFor(setup, () => latestOverlay?.errorDetail != null);

    expect(latestOverlay?.errorDetail?.message).toContain("permission denied");
    expect(latestRepository?.snapshot?.worktrees.some((row) => row.path === FEATURE_PATH)).toBe(
      true,
    );
    expect(setup.captureCharFrame()).toContain("feature-branch");

    await act(async () => {
      await setup.dispose();
    });
  });
});
