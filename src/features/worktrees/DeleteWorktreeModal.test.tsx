import { beforeEach, describe, expect, it } from "bun:test";
import { MouseEvent } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import { resetCommandOrchestration } from "@/app/hooks/commandRunner.state";
import { resetActionRegistry, resolveActionHandler } from "@/app/hooks/useAction";
import { registerCommandHandler, resetCommandRunner } from "@/domain/commands/commands.runner";
import { executeWorktreeDelete } from "@/domain/commands/commands.worktrees";
import type { GitClient, GitInvocationResult, WorktreeRecord } from "@/domain/git/git.types";
import { buildListWorktreesArgs } from "@/domain/git/git.worktrees";
import { DeleteWorktreeModal } from "@/features/worktrees/DeleteWorktreeModal";
import { DELETE_WORKTREE_FORCE_CHECKBOX_ID } from "@/features/worktrees/DeleteWorktreeModal.constants";
import { AppTestProviders } from "@/test/app.harness";
import { createFakeGitClient, fakeGitResult } from "@/test/git.fake";

const CLEAN_PATH = "/home/user/code/clean";
const DIRTY_PATH = "/home/user/code/dirty";
const LOCKED_PATH = "/home/user/code/locked";
const WORKTREES_KEY = buildListWorktreesArgs().join(" ");

/** Latest close count captured by the harness. */
let closeCount = 0;

/**
 * Builds one worktree record for the modal.
 *
 * @param overrides - Fields to replace.
 * @returns The worktree record.
 */
function buildWorktree(overrides: Partial<WorktreeRecord> = {}): WorktreeRecord {
  return {
    path: CLEAN_PATH,
    headOid: "abc1234567890",
    branch: "clean-branch",
    detached: false,
    bare: false,
    locked: false,
    lockReason: null,
    prunable: false,
    pruneReason: null,
    current: false,
    dirty: false,
    ...overrides,
  };
}

/**
 * Builds a porcelain list containing every test worktree.
 *
 * @returns The recorded worktree output.
 */
function worktreeListOutput(): string {
  return [
    "worktree /repo",
    "HEAD abc123",
    "branch refs/heads/main",
    "",
    `worktree ${CLEAN_PATH}`,
    "HEAD abc123",
    "branch refs/heads/clean-branch",
    "",
    `worktree ${DIRTY_PATH}`,
    "HEAD def456",
    "branch refs/heads/dirty-branch",
    "",
    `worktree ${LOCKED_PATH}`,
    "HEAD fed789",
    "branch refs/heads/locked-branch",
    "locked in use by another process",
    "",
  ].join("\n");
}

/**
 * Builds a fake client that answers the delete flow and records argv keys.
 *
 * @returns The client and recorded invocation keys.
 */
function createClient() {
  const fake = createFakeGitClient();
  const calls: string[] = [];
  const overrides: Record<string, () => GitInvocationResult> = {
    [WORKTREES_KEY]: () => fakeGitResult(worktreeListOutput()),
  };

  for (const path of [CLEAN_PATH, DIRTY_PATH, LOCKED_PATH]) {
    overrides[`worktree remove ${path}`] = () => fakeGitResult("");
    overrides[`worktree remove --force ${path}`] = () => fakeGitResult("");
    overrides[`worktree remove -f -f ${path}`] = () => fakeGitResult("");
  }

  const client: GitClient = {
    gitPath: "git",
    invoke: async (input) => {
      const key = input.args.join(" ");

      calls.push(key);

      const override = overrides[key];

      return override === undefined ? await fake.client.invoke(input) : override();
    },
  };

  return { client, calls };
}

/**
 * Renders the confirmation inside the provider stack.
 *
 * @param worktree - Worktree being deleted.
 * @param client - Git client for the providers.
 * @returns The renderer setup.
 */
async function renderModal(worktree: WorktreeRecord, client: GitClient) {
  closeCount = 0;

  const setup = await testRender(
    <AppTestProviders gitClient={client}>
      <DeleteWorktreeModal
        worktree={worktree}
        onClose={() => {
          closeCount += 1;
        }}
      />
    </AppTestProviders>,
    { width: 100, height: 30 },
  );

  await act(async () => {
    await setup.renderOnce();
  });

  return setup;
}

/**
 * Runs one registered overlay action.
 *
 * @param actionId - Overlay action id.
 */
async function runOverlayAction(actionId: string): Promise<void> {
  await act(async () => {
    resolveActionHandler(actionId, "overlay")?.();
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
  });
}

/**
 * Clicks one renderable by id.
 *
 * @param setup - Renderer setup.
 * @param id - Renderable id to click.
 */
function click(setup: Awaited<ReturnType<typeof testRender>>, id: string): void {
  const box = setup.renderer.root.findDescendantById(id);

  if (box === undefined) {
    throw new Error(`${id} is missing`);
  }

  box.processMouseEvent(
    new MouseEvent(box, {
      type: "down",
      button: 0,
      x: 0,
      y: 0,
      modifiers: { shift: false, alt: false, ctrl: false },
    }),
  );
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

describe("DeleteWorktreeModal", () => {
  it("confirms a clean worktree with Cancel focused and states that the branch is kept", async () => {
    const { client, calls } = createClient();
    const setup = await renderModal(buildWorktree(), client);
    const frame = setup.captureCharFrame();

    expect(frame).toContain("The branch is kept; only the worktree directory is removed.");
    expect(frame).toContain("Delete worktree");
    expect(frame).toContain("Cancel");
    expect(frame).not.toContain("Force remove");

    await runOverlayAction("nav.activate");

    expect(closeCount).toBe(1);
    expect(calls.some((call) => call.startsWith("worktree remove"))).toBe(false);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("requires the force acknowledgement for a dirty worktree and uses one --force", async () => {
    const { client, calls } = createClient();
    const setup = await renderModal(buildWorktree({ path: DIRTY_PATH, dirty: true }), client);

    expect(setup.captureCharFrame()).toContain("Force remove");
    expect(setup.captureCharFrame()).toContain("uncommitted changes");
    expect(setup.captureCharFrame()).toContain("--force");

    await runOverlayAction("nav.right");
    await runOverlayAction("nav.activate");

    expect(calls.some((call) => call.startsWith("worktree remove"))).toBe(false);
    expect(closeCount).toBe(0);

    await act(async () => {
      click(setup, DELETE_WORKTREE_FORCE_CHECKBOX_ID);
      await setup.renderOnce();
    });
    await runOverlayAction("nav.right");
    await runOverlayAction("nav.activate");
    await waitFor(setup, () => calls.includes(`worktree remove --force ${DIRTY_PATH}`));

    expect(calls).toContain(`worktree remove --force ${DIRTY_PATH}`);
    expect(calls).not.toContain(`worktree remove -f -f ${DIRTY_PATH}`);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("requires force for a locked worktree and lets the executor pick -f -f", async () => {
    const { client, calls } = createClient();
    const setup = await renderModal(
      buildWorktree({
        path: LOCKED_PATH,
        locked: true,
        lockReason: "in use by another process",
      }),
      client,
    );
    const frame = setup.captureCharFrame();

    expect(frame).toContain("Force remove");
    expect(frame).toContain("locked (in use by another process)");
    expect(frame).toContain("-f -f");

    await runOverlayAction("nav.right");
    await runOverlayAction("nav.activate");

    expect(calls.some((call) => call.startsWith("worktree remove"))).toBe(false);

    await act(async () => {
      click(setup, DELETE_WORKTREE_FORCE_CHECKBOX_ID);
      await setup.renderOnce();
    });
    await runOverlayAction("nav.right");
    await runOverlayAction("nav.activate");
    await waitFor(setup, () => calls.includes(`worktree remove -f -f ${LOCKED_PATH}`));

    expect(calls).toContain(`worktree remove -f -f ${LOCKED_PATH}`);
    expect(calls).not.toContain(`worktree remove --force ${LOCKED_PATH}`);

    await act(async () => {
      await setup.dispose();
    });
  });
});
