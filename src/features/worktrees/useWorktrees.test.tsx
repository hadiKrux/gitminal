import { beforeEach, describe, expect, it } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act, type ReactNode } from "react";
import {
  hasRegisteredAction,
  resetActionRegistry,
  resolveActionHandler,
} from "@/app/hooks/useAction";
import { readActionAvailability, resetActionAvailability } from "@/app/hooks/useActionAvailability";
import { useFocusRegion } from "@/app/hooks/useFocusRegion";
import { useRepository } from "@/app/hooks/useRepository";
import { useStatus } from "@/app/hooks/useStatus";
import type { GitClient, WorktreeRecord } from "@/domain/git/git.types";
import { buildListWorktreesArgs } from "@/domain/git/git.worktrees";
import type { RepositorySelection } from "@/domain/repository/repository.types";
import { useWorktrees } from "@/features/worktrees/useWorktrees";
import { AppTestProviders } from "@/test/app.harness";
import { createFakeGitClient, fakeGitResult } from "@/test/git.fake";

const WORKTREES_KEY = buildListWorktreesArgs().join(" ");

/** Recorded worktrees: the current main worktree and a linked feature worktree. */
const WORKTREES_OUTPUT = [
  "worktree /repo",
  "HEAD abc1234567890",
  "branch refs/heads/main",
  "",
  "worktree /home/user/code/feature-branch",
  "HEAD def4567890",
  "branch refs/heads/feature-branch",
  "",
].join("\n");

/** Latest hook handle captured by the probe. */
let handle: ReturnType<typeof useWorktrees> | undefined;

/** Latest right-pane selection captured by the probe. */
let latestSelection: RepositorySelection | undefined;

/** Latest repository context captured by the probe. */
let latestRepository: ReturnType<typeof useRepository> | undefined;

/** Latest transient status captured by the probe. */
let latestStatus: ReturnType<typeof useStatus> | undefined;

/** Latest worktree passed to the delete-modal opener. */
let openedDelete: WorktreeRecord | undefined;

/** Create-modal open count captured by the probe. */
let createOpenCount = 0;

/**
 * Mounts the worktrees hook inside its focusable region frame.
 *
 * @returns The probe frame.
 */
function Harness(): ReactNode {
  const repository = useRepository();
  const region = useFocusRegion("worktrees");

  latestStatus = useStatus();
  latestSelection = repository.selection;
  latestRepository = repository;
  handle = useWorktrees({
    openCreateWorktree: () => {
      createOpenCount += 1;
    },
    openDeleteWorktree: (worktree) => {
      openedDelete = worktree;
    },
  });

  return (
    <box {...region.regionProps} flexDirection="column" width={60} height={10}>
      <text>{handle.rows.map((row) => row.path).join(",")}</text>
    </box>
  );
}

/**
 * Builds a fake client with the recorded worktree list.
 *
 * @param options - Empty repository, or a failed worktree read.
 * @returns The git client.
 */
function createClient(
  options: { readonly emptyRepository?: boolean; readonly failWorktrees?: boolean } = {},
): { readonly client: GitClient; readonly setWorktrees: (next: string) => void } {
  const base = createFakeGitClient().client;
  let worktrees = options.emptyRepository === true ? "" : WORKTREES_OUTPUT;

  const client: GitClient = {
    ...base,
    invoke: async (input) => {
      const key = input.args.join(" ");

      if (key === WORKTREES_KEY) {
        if (options.failWorktrees === true) {
          return fakeGitResult("", false, "fatal: cannot list worktrees");
        }

        return fakeGitResult(worktrees);
      }

      if (options.emptyRepository === true) {
        if (key === "rev-parse --verify HEAD") {
          return fakeGitResult("", false);
        }

        if (key === "status --porcelain=v2 --branch -z --untracked-files=all") {
          return fakeGitResult("# branch.head main\0");
        }

        if (key.startsWith("for-each-ref")) {
          return fakeGitResult("");
        }
      }

      return await base.invoke(input);
    },
  };

  return {
    client,
    setWorktrees(next: string): void {
      worktrees = next;
    },
  };
}

/**
 * Renders the probe with the full provider stack.
 *
 * @param client - Git client.
 * @returns The renderer setup.
 */
async function renderHarness(client: GitClient): Promise<Awaited<ReturnType<typeof testRender>>> {
  handle = undefined;
  latestSelection = undefined;
  latestStatus = undefined;
  latestRepository = undefined;
  openedDelete = undefined;
  createOpenCount = 0;

  const setup = await testRender(
    <AppTestProviders gitClient={client}>
      <Harness />
    </AppTestProviders>,
    { width: 100, height: 30 },
  );

  await waitFor(setup, () => (handle?.rows.length ?? 0) > 0);

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
 * Runs one registered action in the worktrees scope.
 *
 * @param actionId - Action id.
 */
async function runAction(actionId: string): Promise<void> {
  await act(async () => {
    resolveActionHandler(actionId, "worktrees")?.();
  });
  await act(async () => {
    await setupDelay();
  });
}

/** Settles one short asynchronous effect. */
async function setupDelay(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 5));
}

beforeEach(() => {
  resetActionRegistry();
  resetActionAvailability();
});

describe("useWorktrees registration", () => {
  it("registers exactly create, delete, filter, and the cursor navigation", async () => {
    const setup = await renderHarness(createClient().client);

    for (const actionId of [
      "nav.up",
      "nav.down",
      "nav.activate",
      "worktree.create",
      "worktree.delete",
      "list.filter",
    ]) {
      expect(hasRegisteredAction(actionId, "worktrees"), actionId).toBe(true);
    }

    expect(hasRegisteredAction("nav.first", "worktrees")).toBe(false);
    expect(hasRegisteredAction("nav.last", "worktrees")).toBe(false);
    expect(hasRegisteredAction("app.refresh", "worktrees")).toBe(false);
    expect(hasRegisteredAction("focus.region.worktrees", "worktrees")).toBe(false);

    await act(async () => {
      await setup.dispose();
    });
  });
});

describe("useWorktrees state", () => {
  it("reports no commits yet for create in an empty repository", async () => {
    const setup = await renderHarness(createClient({ emptyRepository: true }).client);

    expect(handle?.totalCount).toBe(0);
    expect(handle?.createReason).toBe("no commits yet");

    await runAction("worktree.create");

    expect(createOpenCount).toBe(1);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("refuses delete for the current worktree without opening the modal", async () => {
    const setup = await renderHarness(createClient().client);

    expect(handle?.activeRow?.current).toBe(true);

    await runAction("worktree.delete");

    expect(openedDelete).toBeUndefined();
    expect(latestStatus?.status?.message).toBe("current worktree");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("opens delete for another worktree with no blocking reason", async () => {
    const setup = await renderHarness(createClient().client);

    await runAction("nav.down");
    await runAction("worktree.delete");

    expect(openedDelete?.path).toBe("/home/user/code/feature-branch");
    expect(handle?.selectedDeleteReason).toBeNull();

    await act(async () => {
      await setup.dispose();
    });
  });

  it("selects the active worktree without switching the repository", async () => {
    const setup = await renderHarness(createClient().client);

    await runAction("nav.activate");

    expect(latestSelection).toEqual({ kind: "worktree", path: "/repo" });
    expect(latestRepository?.signals.cwd).toBe("/repo");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("shows the read error when the worktree list cannot be read", async () => {
    const setup = await renderHarness(createClient({ failWorktrees: true }).client);

    expect(handle?.error).toContain("cannot list worktrees");
    expect(handle?.loading).toBe(false);
    expect(handle?.empty).toBe(false);

    await act(async () => {
      await setup.dispose();
    });
  });
});

describe("useWorktrees selection and publication", () => {
  it("activates the double-clicked row, not the previous cursor row", async () => {
    const setup = await renderHarness(createClient().client);

    await act(async () => {
      handle?.handleRowClick(1);
      handle?.handleRowClick(1);
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(latestSelection).toEqual({
      kind: "worktree",
      path: "/home/user/code/feature-branch",
    });

    await act(async () => {
      await setup.dispose();
    });
  });

  it("repairs the selection to the nearest surviving worktree or pending changes", async () => {
    const recording = createClient();
    const setup = await renderHarness(recording.client);

    await runAction("nav.down");
    await runAction("nav.activate");

    expect(latestSelection).toEqual({
      kind: "worktree",
      path: "/home/user/code/feature-branch",
    });

    recording.setWorktrees(
      ["worktree /repo", "HEAD abc1234567890", "branch refs/heads/main", ""].join("\n"),
    );

    await act(async () => {
      await latestRepository?.refreshStatus();
    });
    await waitFor(
      setup,
      () => latestSelection?.kind === "worktree" && latestSelection.path === "/repo",
    );

    expect(latestSelection).toEqual({ kind: "worktree", path: "/repo" });

    recording.setWorktrees("");

    await act(async () => {
      await latestRepository?.refreshStatus();
    });
    await waitFor(setup, () => latestSelection?.kind === "pending");

    expect(latestSelection).toEqual({ kind: "pending" });

    await act(async () => {
      await setup.dispose();
    });
  });

  it("publishes delete availability for the selected worktree and clears it on unmount", async () => {
    const setup = await renderHarness(createClient().client);

    await act(async () => {
      await setup.renderOnce();
    });

    expect(readActionAvailability("worktrees", "worktree.create")).toBe(true);
    expect(readActionAvailability("worktrees", "worktree.delete")).toBe(false);

    await runAction("nav.down");

    expect(readActionAvailability("worktrees", "worktree.delete")).toBe(true);

    await act(async () => {
      await setup.dispose();
    });

    expect(readActionAvailability("worktrees", "worktree.delete")).toBeUndefined();
  });
});
