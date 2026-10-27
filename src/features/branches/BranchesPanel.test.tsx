import { beforeEach, describe, expect, it } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act, type ReactNode } from "react";
import {
  hasRegisteredAction,
  resetActionRegistry,
  resolveActionHandler,
} from "@/app/hooks/useAction";
import { useFocusRegion } from "@/app/hooks/useFocusRegion";
import { buildListLocalBranchesArgs } from "@/domain/git/git.branches";
import { buildListRemoteBranchesArgs } from "@/domain/git/git.remote-branches";
import type { GitClient, GitInvocationResult } from "@/domain/git/git.types";
import { BranchesPanel } from "@/features/branches/BranchesPanel";
import { truncateText } from "@/lib/text";
import { AppTestProviders } from "@/test/app.harness";
import { createFakeGitClient, fakeGitResult } from "@/test/git.fake";
import { ICONS } from "@/theme/icons";

const STATUS_KEY = "status --porcelain=v2 --branch -z --untracked-files=all";
const BRANCHES_KEY = buildListLocalBranchesArgs().join(" ");
const REMOTE_BRANCHES_KEY = buildListRemoteBranchesArgs().join(" ");

/**
 * Creates a git client that records nothing and answers scripted overrides first.
 *
 * @param overrides - Answers keyed by the joined argument array.
 * @returns The client.
 */
function createClient(
  overrides: Readonly<Record<string, string | GitInvocationResult>> = {},
): GitClient {
  const fake = createFakeGitClient();

  return {
    gitPath: "git",
    invoke: async (options) => {
      const override = overrides[options.args.join(" ")];

      if (override !== undefined) {
        return typeof override === "string" ? fakeGitResult(override) : override;
      }

      return fake.client.invoke(options);
    },
  };
}

function PanelHarness(): ReactNode {
  const region = useFocusRegion("branches");

  return (
    <box {...region.regionProps} flexDirection="column" width={80} height={20}>
      <BranchesPanel />
    </box>
  );
}

async function renderPanel(client: GitClient): Promise<Awaited<ReturnType<typeof testRender>>> {
  const setup = await testRender(
    <AppTestProviders gitClient={client}>
      <PanelHarness />
    </AppTestProviders>,
    { width: 100, height: 24 },
  );

  await act(async () => {
    await setup.renderOnce();
  });

  return setup;
}

/**
 * Renders frames until the predicate holds or the deadline passes.
 *
 * @param setup - Renderer setup.
 * @param predicate - Condition the test waits for.
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
}

async function runAction(
  setup: Awaited<ReturnType<typeof testRender>>,
  actionId: string,
): Promise<void> {
  await act(async () => {
    resolveActionHandler(actionId, "branches")?.();
  });
  await act(async () => {
    await setup.renderOnce();
    await new Promise((resolve) => setTimeout(resolve, 5));
  });
}

beforeEach(() => {
  resetActionRegistry();
});

describe("BranchesPanel", () => {
  it("renders the ordered rows, the counts, and no current-branch delete reason", async () => {
    const setup = await renderPanel(createClient());

    await waitFor(setup, () => setup.captureCharFrame().includes("feature"));

    const frame = setup.captureCharFrame();

    expect(frame).not.toContain("Local branches");
    expect(frame).toContain(ICONS.currentBranch);
    expect(frame).toContain(`${ICONS.push}2`);
    expect(frame).toContain(`${ICONS.pull}1`);
    expect(frame).toContain("no upstream");
    expect(frame).not.toContain("Cannot delete the current branch");
    expect(frame.indexOf("main")).toBeLessThan(frame.indexOf("feature"));

    await act(async () => {
      await setup.dispose();
    });
  });

  it("moves the selection and shows the worktree delete reason", async () => {
    const setup = await renderPanel(createClient());

    await waitFor(setup, () => setup.captureCharFrame().includes("feature"));
    await runAction(setup, "nav.down");

    const frame = setup.captureCharFrame();

    expect(frame).toContain(truncateText("checked out in /repo-feature", 24, ICONS.ellipsis));
    expect(frame).toContain("checked out in another worktree");
    expect(frame).not.toContain("Cannot delete the current branch");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("registers only the two branch actions plus cursor navigation", async () => {
    const setup = await renderPanel(createClient());

    await waitFor(setup, () => setup.captureCharFrame().includes("feature"));

    expect(hasRegisteredAction("branch.create", "branches")).toBe(true);
    expect(hasRegisteredAction("branch.delete", "branches")).toBe(true);
    expect(hasRegisteredAction("app.refresh", "branches")).toBe(false);
    expect(resolveActionHandler("app.refresh", "global")).toBeUndefined();
    expect(resolveActionHandler("branch.delete", "global")).toBeUndefined();

    await act(async () => {
      await setup.dispose();
    });
  });

  it("shows the loading row while the first read is in flight", async () => {
    const pending: GitClient = {
      gitPath: "git",
      invoke: () => new Promise<GitInvocationResult>(() => {}),
    };
    const setup = await renderPanel(pending);

    expect(setup.captureCharFrame()).toContain("loading branches");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("shows the empty state with the New branch hint", async () => {
    const setup = await renderPanel(
      createClient({
        [BRANCHES_KEY]: "",
        [REMOTE_BRANCHES_KEY]: "",
      }),
    );

    await waitFor(setup, () => setup.captureCharFrame().includes("No local branches"));

    const frame = setup.captureCharFrame();

    expect(frame).toContain("No local branches");
    expect(frame).toContain("n New branch");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("shows the error state with Retry while no snapshot is available", async () => {
    const setup = await renderPanel(
      createClient({
        [BRANCHES_KEY]: fakeGitResult("", false, "fatal: cannot read refs"),
      }),
    );

    await waitFor(setup, () => setup.captureCharFrame().includes("Could not read branches"));

    const frame = setup.captureCharFrame();

    expect(frame).toContain("Could not read branches");
    expect(frame).toContain("cannot read refs");
    expect(frame).toContain("Retry");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("keeps the previous rows visible above the error when a later status read fails", async () => {
    const fake = createFakeGitClient();
    let statusCalls = 0;
    const client: GitClient = {
      gitPath: "git",
      invoke: async (options) => {
        if (options.args.join(" ") === STATUS_KEY) {
          statusCalls += 1;

          if (statusCalls > 1) {
            return fakeGitResult("", false, "fatal: status failed");
          }
        }

        return fake.client.invoke(options);
      },
    };
    const setup = await renderPanel(client);

    await waitFor(setup, () => setup.captureCharFrame().includes("feature"));

    await act(async () => {
      setup.renderer.root.findDescendantById("region-branches")?.focus();
    });
    await waitFor(setup, () => setup.captureCharFrame().includes("Could not read branches"));

    const frame = setup.captureCharFrame();

    expect(frame).toContain("Could not read branches");
    expect(frame).toContain("main");
    expect(frame).toContain("feature");

    await act(async () => {
      await setup.dispose();
    });
  });
});
