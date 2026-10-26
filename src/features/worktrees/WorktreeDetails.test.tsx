import { beforeEach, describe, expect, it } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act, type ReactNode, useEffect } from "react";
import { resetActionRegistry } from "@/app/hooks/useAction";
import { useRepository } from "@/app/hooks/useRepository";
import type { GitClient } from "@/domain/git/git.types";
import { buildListWorktreesArgs } from "@/domain/git/git.worktrees";
import type { RepositorySelection } from "@/domain/repository/repository.types";
import { WorktreeDetails } from "@/features/worktrees/WorktreeDetails";
import { AppTestProviders } from "@/test/app.harness";
import { createFakeGitClient, fakeGitResult } from "@/test/git.fake";

/** Long worktree path that must be shortened in the summary. */
const LONG_WORKTREE_PATH =
  "/Users/example/projects/gitminal/worktrees/locked-feature-with-a-very-long-name-for-truncation";

/** Recorded worktree list: the current main worktree plus a locked and prunable linked worktree. */
const WORKTREES_OUTPUT = [
  "worktree /repo",
  "HEAD abc1234567890",
  "branch refs/heads/main",
  "",
  `worktree ${LONG_WORKTREE_PATH}`,
  "HEAD def4567890abc",
  "branch refs/heads/locked-feature",
  "locked in use by another process",
  "prunable directory is missing",
  "",
].join("\n");

/** Latest right-pane selection captured by the test probe. */
let latestSelection: RepositorySelection | undefined;

/**
 * Builds a fake client whose worktree read returns the recorded fixtures.
 *
 * @returns The git client.
 */
function createClient(): GitClient {
  const base = createFakeGitClient().client;
  const worktreesKey = buildListWorktreesArgs().join(" ");

  return {
    ...base,
    invoke: async (input) => {
      if (input.args.join(" ") === worktreesKey) {
        return fakeGitResult(WORKTREES_OUTPUT);
      }

      return await base.invoke(input);
    },
  };
}

/**
 * Selects a worktree path and renders the right-pane summary.
 *
 * @param props - Worktree path to select, or null to leave the default selection.
 * @returns The summary.
 */
function DetailsHarness(props: { readonly path: string | null }): ReactNode {
  const repository = useRepository();
  const { setSelection } = repository;

  latestSelection = repository.selection;

  useEffect(() => {
    if (props.path !== null) {
      setSelection({ kind: "worktree", path: props.path });
    }
  }, [props.path, setSelection]);

  return (
    <box flexDirection="column" width={120} height={20}>
      <WorktreeDetails />
    </box>
  );
}

/**
 * Renders the details surface until the first repository read settles.
 *
 * @param path - Worktree path to select, or null for the default selection.
 * @returns The renderer setup.
 */
async function renderDetails(path: string | null) {
  latestSelection = undefined;

  const setup = await testRender(
    <AppTestProviders gitClient={createClient()}>
      <DetailsHarness path={path} />
    </AppTestProviders>,
    { width: 140, height: 30 },
  );

  const deadline = Date.now() + 2_000;

  while (Date.now() < deadline) {
    await act(async () => {
      await setup.renderOnce();
      await new Promise((resolve) => setTimeout(resolve, 5));
    });

    if (setup.captureCharFrame().includes("Worktree:")) {
      break;
    }
  }

  await act(async () => {
    await setup.renderOnce();
  });

  return setup;
}

beforeEach(() => {
  resetActionRegistry();
});

describe("WorktreeDetails", () => {
  it("renders nothing when the right-pane selection is not a worktree", async () => {
    const setup = await renderDetails(null);
    const frame = setup.captureCharFrame();

    expect(frame).not.toContain("Read-only. This panel never switches the active repository.");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("shows the branch, both paths, HEAD, state reasons, and the read-only notice", async () => {
    const setup = await renderDetails(LONG_WORKTREE_PATH);
    const frame = setup.captureCharFrame();

    expect(frame).toContain("Worktree: locked-feature");
    expect(frame).toContain(`Path: ${LONG_WORKTREE_PATH}`);
    expect(frame).toContain("Short path: ...");
    expect(frame).toContain("HEAD: def4567");
    expect(frame).toContain("locked (in use by another process)");
    expect(frame).toContain("prunable (directory is missing)");
    expect(frame).toContain("Read-only. This panel never switches the active repository.");
    expect(frame).not.toContain("current worktree");
    expect(latestSelection).toEqual({ kind: "worktree", path: LONG_WORKTREE_PATH });

    await act(async () => {
      await setup.dispose();
    });
  });

  it("marks the current worktree and keeps the selection unchanged", async () => {
    const setup = await renderDetails("/repo");
    const frame = setup.captureCharFrame();

    expect(frame).toContain("Worktree: main");
    expect(frame).toContain("current worktree");
    expect(latestSelection).toEqual({ kind: "worktree", path: "/repo" });

    await act(async () => {
      await setup.dispose();
    });
  });

  it("explains a missing selected worktree without switching the repository", async () => {
    const setup = await renderDetails("/repo/gone");
    const frame = setup.captureCharFrame();

    expect(frame).toContain("Worktree no longer exists");
    expect(frame).toContain("Read-only. This panel never switches the active repository.");
    expect(frame).not.toContain("Worktree: main");

    await act(async () => {
      await setup.dispose();
    });
  });
});
