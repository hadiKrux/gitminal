import { beforeEach, describe, expect, it } from "bun:test";
import type { InputRenderable, SelectRenderable } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import { resetCommandOrchestration } from "@/app/hooks/commandRunner.state";
import { resetActionRegistry, resolveActionHandler } from "@/app/hooks/useAction";
import { registerCommandHandler, resetCommandRunner } from "@/domain/commands/commands.runner";
import { executeWorktreeCreate } from "@/domain/commands/commands.worktrees";
import { buildListLocalBranchesArgs } from "@/domain/git/git.branches";
import type { GitClient, GitInvocationResult } from "@/domain/git/git.types";
import { buildListWorktreesArgs } from "@/domain/git/git.worktrees";
import { NewWorktreeModal } from "@/features/worktrees/NewWorktreeModal";
import {
  NEW_WORKTREE_BRANCH_INPUT_ID,
  NEW_WORKTREE_EXISTING_SELECT_ID,
  NEW_WORKTREE_MODE_SELECT_ID,
  NEW_WORKTREE_PATH_INPUT_ID,
} from "@/features/worktrees/NewWorktreeModal.constants";
import { deriveWorktreePath } from "@/features/worktrees/worktree.path";
import { AppTestProviders } from "@/test/app.harness";
import { createFakeGitClient, fakeGitResult } from "@/test/git.fake";
import { MODAL_FRAME_ID } from "@/ui/ModalFrame.constants";

const CWD = "/home/user/code/repo";
const TOPLEVEL_KEY = "rev-parse --show-toplevel";
const BRANCHES_KEY = buildListLocalBranchesArgs().join(" ");
const WORKTREES_KEY = buildListWorktreesArgs().join(" ");
const FIXTURE_DATE = "2026-01-02T03:04:05+00:00";

/** Recorded local branches: main is checked out, feature is checked out in a linked worktree. */
const BRANCHES_OUTPUT = [
  `main\0abc123\0*\0${FIXTURE_DATE}\0origin\0refs/heads/main\0`,
  `feature\0def456\0 \0${FIXTURE_DATE}\0\0\0`,
  `available\0aaa111\0 \0${FIXTURE_DATE}\0\0\0`,
].join("\n");

/** Default recorded worktree list: the current main worktree and a linked feature worktree. */
const WORKTREES_OUTPUT = [
  `worktree ${CWD}`,
  "HEAD abc1234567890",
  "branch refs/heads/main",
  "",
  `worktree ${CWD}-feature`,
  "HEAD def4567890",
  "branch refs/heads/feature",
  "",
].join("\n");

/** Latest close count captured by the test harness. */
let closeCount = 0;

/**
 * Builds a fake client that answers the create flow and records argv keys.
 *
 * @param options - Extra worktree at the derived default path, or an empty repository.
 * @returns The client and the recorded invocation keys.
 */
function createClient(
  options: { readonly worktreeAtDefaultPath?: boolean; readonly emptyRepository?: boolean } = {},
) {
  const fake = createFakeGitClient();
  const calls: string[] = [];
  const overrides: Record<string, () => GitInvocationResult> = {
    [TOPLEVEL_KEY]: () => fakeGitResult(`${CWD}\n`),
    [BRANCHES_KEY]: () => fakeGitResult(BRANCHES_OUTPUT),
    [WORKTREES_KEY]: () => fakeGitResult(WORKTREES_OUTPUT),
  };

  if (options.worktreeAtDefaultPath === true) {
    overrides[WORKTREES_KEY] = () =>
      fakeGitResult(
        [
          WORKTREES_OUTPUT,
          "",
          `worktree ${deriveWorktreePath(CWD, "another")}`,
          "HEAD bbb222",
          "branch refs/heads/scratch",
          "",
        ].join("\n"),
      );
  }

  if (options.emptyRepository === true) {
    overrides[TOPLEVEL_KEY] = () => fakeGitResult(`${CWD}\n`);
    overrides["rev-parse --verify HEAD"] = () => fakeGitResult("", false);
    overrides["status --porcelain=v2 --branch -z --untracked-files=all"] = () =>
      fakeGitResult("# branch.head main\0");
    overrides["symbolic-ref -q --short HEAD"] = () => fakeGitResult("main\n");
    overrides[BRANCHES_KEY] = () => fakeGitResult("");
    overrides[WORKTREES_KEY] = () => fakeGitResult("");
  }

  const client: GitClient = {
    gitPath: "git",
    invoke: async (input) => {
      const key = input.args.join(" ");

      calls.push(key);

      for (const command of [
        "worktree add -b feature/login /home/user/code/feature-login HEAD",
        "worktree add /home/user/code/available available",
      ]) {
        if (key === command) {
          return fakeGitResult("");
        }
      }

      const override = overrides[key];

      return override === undefined ? await fake.client.invoke(input) : override();
    },
  };

  return { client, calls };
}

/**
 * Renders the modal inside the provider stack and waits for its prefilled path.
 *
 * @param client - Git client for the provider.
 * @param expectedPath - Path value the modal must prefill.
 * @returns The renderer setup.
 */
async function renderModal(client: GitClient, expectedPath: string) {
  closeCount = 0;

  const setup = await testRender(
    <AppTestProviders gitClient={client} cwd={CWD}>
      <NewWorktreeModal
        onClose={() => {
          closeCount += 1;
        }}
      />
    </AppTestProviders>,
    { width: 100, height: 30 },
  );

  const deadline = Date.now() + 2_000;

  while (Date.now() < deadline) {
    await act(async () => {
      await setup.renderOnce();
      await new Promise((resolve) => setTimeout(resolve, 5));
    });

    if (readInput(setup, NEW_WORKTREE_PATH_INPUT_ID).value === expectedPath) {
      break;
    }
  }

  await act(async () => {
    await setup.renderOnce();
  });

  return setup;
}

/**
 * Reads one input by its stable renderable id.
 *
 * @param setup - Renderer setup.
 * @param id - Renderable id.
 * @returns The input renderable.
 */
function readInput(setup: Awaited<ReturnType<typeof testRender>>, id: string): InputRenderable {
  const input = setup.renderer.root.findDescendantById(id) as InputRenderable | undefined;

  if (input === undefined) {
    throw new Error(`${id} is missing`);
  }

  return input;
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
 * Focuses the modal frame and renders once.
 *
 * @param setup - Renderer setup.
 */
async function focusFrame(setup: Awaited<ReturnType<typeof testRender>>): Promise<void> {
  await act(async () => {
    setup.renderer.root.findDescendantById(MODAL_FRAME_ID)?.focus();
  });
  await act(async () => {
    await setup.renderOnce();
  });
}

/**
 * Runs one overlay action and settles the render.
 *
 * @param setup - Renderer setup.
 * @param actionId - Action id.
 */
async function runOverlayAction(
  setup: Awaited<ReturnType<typeof testRender>>,
  actionId: string,
): Promise<void> {
  await act(async () => {
    resolveActionHandler(actionId, "overlay")?.();
  });
  await act(async () => {
    await setup.renderOnce();
  });
}

beforeEach(() => {
  resetActionRegistry();
  resetCommandOrchestration();
  resetCommandRunner();
  registerCommandHandler({
    commandId: "worktree.create",
    operationLabel: "Create worktree",
    handler: executeWorktreeCreate,
  });
});

describe("NewWorktreeModal", () => {
  it("prefills a sibling path, sanitizes the branch, and submits the documented form keys", async () => {
    const { client, calls } = createClient();
    const setup = await renderModal(client, "/home/user/code/worktree");
    const branchInput = readInput(setup, NEW_WORKTREE_BRANCH_INPUT_ID);

    await act(async () => {
      branchInput.focus();
      branchInput.insertText("feature/login");
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(readInput(setup, NEW_WORKTREE_PATH_INPUT_ID).value).toBe(
      "/home/user/code/feature-login",
    );

    await act(async () => {
      branchInput.submit();
    });
    await waitFor(setup, () =>
      calls.includes("worktree add -b feature/login /home/user/code/feature-login HEAD"),
    );

    expect(calls).toContain("worktree add -b feature/login /home/user/code/feature-login HEAD");
    expect(closeCount).toBe(1);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("offers only branches not checked out elsewhere and submits an existing-branch worktree", async () => {
    const { client, calls } = createClient();
    const setup = await renderModal(client, "/home/user/code/worktree");
    const modeSelect = setup.renderer.root.findDescendantById(NEW_WORKTREE_MODE_SELECT_ID) as
      | SelectRenderable
      | undefined;

    await act(async () => {
      modeSelect?.moveDown();
      modeSelect?.selectCurrent();
      await setup.renderOnce();
    });

    const existingSelect = setup.renderer.root.findDescendantById(
      NEW_WORKTREE_EXISTING_SELECT_ID,
    ) as SelectRenderable | undefined;

    expect(existingSelect?.options.map((option) => option.name)).toEqual(["available"]);
    expect(readInput(setup, NEW_WORKTREE_PATH_INPUT_ID).value).toBe("/home/user/code/available");
    expect(setup.captureCharFrame()).toContain("Existing branch");

    await act(async () => {
      readInput(setup, NEW_WORKTREE_PATH_INPUT_ID).submit();
    });
    await waitFor(setup, () => calls.includes("worktree add /home/user/code/available available"));

    expect(calls).toContain("worktree add /home/user/code/available available");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("reports inline branch errors without dispatching a command", async () => {
    const { client, calls } = createClient();
    const setup = await renderModal(client, "/home/user/code/worktree");

    await act(async () => {
      readInput(setup, NEW_WORKTREE_PATH_INPUT_ID).submit();
    });
    await waitFor(setup, () => setup.captureCharFrame().includes("invalid branch name"));

    expect(setup.captureCharFrame()).toContain("invalid branch name");

    const branchInput = readInput(setup, NEW_WORKTREE_BRANCH_INPUT_ID);

    await act(async () => {
      branchInput.focus();
      branchInput.insertText("main");
    });
    await act(async () => {
      branchInput.submit();
    });
    await waitFor(setup, () => setup.captureCharFrame().includes("branch already exists"));

    expect(setup.captureCharFrame()).toContain("branch already exists");
    expect(calls.some((call) => call.startsWith("worktree add"))).toBe(false);
    expect(closeCount).toBe(0);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("rejects a path that the snapshot already reports as a worktree", async () => {
    const { client, calls } = createClient({ worktreeAtDefaultPath: true });
    const setup = await renderModal(client, "/home/user/code/worktree");
    const branchInput = readInput(setup, NEW_WORKTREE_BRANCH_INPUT_ID);

    await act(async () => {
      branchInput.focus();
      branchInput.insertText("another");
    });
    await act(async () => {
      branchInput.submit();
    });
    await waitFor(setup, () => setup.captureCharFrame().includes("path already exists"));

    expect(setup.captureCharFrame()).toContain("path already exists");
    expect(calls.some((call) => call.startsWith("worktree add"))).toBe(false);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("keeps the no-commits-yet reason visible and disables create in an empty repository", async () => {
    const { client, calls } = createClient({ emptyRepository: true });
    const setup = await renderModal(client, "/home/user/code/worktree");
    const frame = setup.captureCharFrame();

    expect(frame).toContain("no commits yet");
    expect(frame).toContain("Create worktree");

    await act(async () => {
      readInput(setup, NEW_WORKTREE_PATH_INPUT_ID).submit();
    });

    expect(calls.some((call) => call.startsWith("worktree add"))).toBe(false);
    expect(closeCount).toBe(0);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("cycles the keyboard focus through the fields, mode select, and footer actions", async () => {
    const { client } = createClient();
    const setup = await renderModal(client, "/home/user/code/worktree");

    await focusFrame(setup);
    await runOverlayAction(setup, "nav.down");
    await runOverlayAction(setup, "nav.activate");

    expect(setup.renderer.currentFocusedRenderable?.id).toBe(NEW_WORKTREE_MODE_SELECT_ID);

    await focusFrame(setup);
    await runOverlayAction(setup, "nav.down");
    await runOverlayAction(setup, "nav.activate");

    expect(setup.renderer.currentFocusedRenderable?.id).toBe(NEW_WORKTREE_BRANCH_INPUT_ID);

    await focusFrame(setup);
    await runOverlayAction(setup, "nav.left");

    expect(setup.captureCharFrame()).toContain("Cancel");

    await runOverlayAction(setup, "nav.right");

    expect(closeCount).toBe(0);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("keeps native focus on the mode select while native navigation changes the mode", async () => {
    const { client } = createClient();
    const setup = await renderModal(client, "/home/user/code/worktree");
    const modeSelect = setup.renderer.root.findDescendantById(NEW_WORKTREE_MODE_SELECT_ID) as
      | SelectRenderable
      | undefined;

    await act(async () => {
      modeSelect?.focus();
    });
    await act(async () => {
      modeSelect?.moveDown();
      await setup.renderOnce();
    });

    expect(setup.renderer.currentFocusedRenderable?.id).toBe(NEW_WORKTREE_MODE_SELECT_ID);
    expect(modeSelect?.getSelectedIndex()).toBe(1);
    expect(setup.captureCharFrame()).toContain("Existing branch");

    await act(async () => {
      modeSelect?.selectCurrent();
      await setup.renderOnce();
    });

    expect(setup.renderer.currentFocusedRenderable?.id).toBe(NEW_WORKTREE_EXISTING_SELECT_ID);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("rejects branch names that only the full git ref rules catch", async () => {
    for (const name of [".lock", "@{", "feature."]) {
      const { client, calls } = createClient();
      const setup = await renderModal(client, "/home/user/code/worktree");
      const branchInput = readInput(setup, NEW_WORKTREE_BRANCH_INPUT_ID);

      await act(async () => {
        branchInput.focus();
        branchInput.insertText(name);
      });
      await act(async () => {
        branchInput.submit();
      });
      await waitFor(setup, () => setup.captureCharFrame().includes("invalid branch name"));

      expect(setup.captureCharFrame()).toContain("invalid branch name");
      expect(calls.some((call) => call.startsWith("worktree add"))).toBe(false);
      expect(closeCount).toBe(0);

      await act(async () => {
        await setup.dispose();
      });
    }
  });
});
