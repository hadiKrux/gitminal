import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import { resetActionRegistry } from "@/app/hooks/useAction";
import { buildListRemoteBranchesArgs } from "@/domain/git/git.remote-branches";
import type { GitClient } from "@/domain/git/git.types";
import { RemotesPanel } from "@/features/remotes/RemotesPanel";
import { AppTestProviders } from "@/test/app.harness";
import { createFakeGitClient, fakeGitResult } from "@/test/git.fake";
import { ICONS } from "@/theme/icons";

/** Committer date shared by the remote-branch fixture. */
const FIXTURE_DATE = "2026-01-02T03:04:05+00:00";

/** Two remote branches across one remote. */
const REMOTE_BRANCHES_OUTPUT = [
  `refs/remotes/origin/Feature/Login\0aaa111\0${FIXTURE_DATE}\0Add login\0`,
  `refs/remotes/origin/main\0bbb222\0${FIXTURE_DATE}\0Initial commit\0`,
].join("\n");

/**
 * Renders the panel inside the app provider stack.
 *
 * @param client - Git client the provider reads through.
 * @returns The renderer setup.
 */
async function renderPanel(client: GitClient): Promise<Awaited<ReturnType<typeof testRender>>> {
  const setup = await testRender(
    <AppTestProviders gitClient={client}>
      <box flexDirection="column" width={70} height={24}>
        <RemotesPanel />
      </box>
    </AppTestProviders>,
    { width: 80, height: 24 },
  );

  await act(async () => {
    await setup.renderOnce();
  });

  return setup;
}

/**
 * Waits until the captured frame contains an expected text.
 *
 * @param setup - Renderer setup.
 * @param text - Text to wait for.
 */
async function waitForText(
  setup: Awaited<ReturnType<typeof testRender>>,
  text: string,
): Promise<void> {
  const deadline = Date.now() + 2_000;

  while (Date.now() < deadline) {
    await act(async () => {
      await setup.renderOnce();
      await new Promise((resolve) => setTimeout(resolve, 5));
    });

    if (setup.captureCharFrame().includes(text)) {
      return;
    }
  }

  throw new Error(`frame never contained: ${text}`);
}

/**
 * Wraps the shared fake client with a custom remote-branch answer.
 *
 * @param output - Output for the remote-branch read, or null to fail the read.
 * @returns The client used by the provider.
 */
function createPanelClient(
  output: string | null,
  remotes: readonly string[] = ["origin"],
): GitClient {
  const fake = createFakeGitClient();
  const branchReadKey = buildListRemoteBranchesArgs().join(" ");

  return {
    gitPath: fake.client.gitPath,
    invoke: async (options) => {
      if (options.args.join(" ") === "remote -v") {
        return fakeGitResult(
          remotes
            .map(
              (remote) =>
                `${remote}\tgit@example.com:${remote}.git (fetch)\n${remote}\tgit@example.com:${remote}.git (push)`,
            )
            .join("\n"),
        );
      }
      if (options.args.join(" ") === branchReadKey) {
        return output === null
          ? fakeGitResult("", false, "fatal: cannot read remote refs")
          : fakeGitResult(output);
      }

      return fake.client.invoke(options);
    },
  };
}

/**
 * Wraps the shared fake client so `git remote -v` reports no remote.
 *
 * @returns The client used by the provider.
 */
function createNoRemotesClient(): GitClient {
  const fake = createFakeGitClient();

  return {
    gitPath: fake.client.gitPath,
    invoke: async (options) => {
      if (options.args.join(" ") === "remote -v") {
        return fakeGitResult("");
      }

      if (options.args.join(" ") === buildListRemoteBranchesArgs().join(" ")) {
        return fakeGitResult("");
      }

      return fake.client.invoke(options);
    },
  };
}

beforeEach(() => {
  resetActionRegistry();
});

afterEach(() => {
  resetActionRegistry();
});

describe("RemotesPanel", () => {
  it("renders the remote header and unqualified branch labels without a second title", async () => {
    const setup = await renderPanel(createPanelClient(REMOTE_BRANCHES_OUTPUT));

    await waitForText(setup, "Feature/Login");

    const frame = setup.captureCharFrame();

    expect(frame).not.toContain("Remotes (");
    expect(frame).toContain("origin (2)");
    expect(frame).toContain("Feature/Login");
    expect(frame).toContain("main");
    expect(frame).not.toContain("origin/main");
    expect(frame).not.toContain("origin/Feature/Login");
    expect(setup.renderer.root.findDescendantById("remote-row-origin-main")).toBeDefined();

    await act(async () => {
      await setup.dispose();
    });
  });

  it("keeps identical branch labels under distinct remote headers with qualified row identities", async () => {
    const output = [
      `refs/remotes/origin/main\0aaa111\0${FIXTURE_DATE}\0origin commit\0`,
      `refs/remotes/upstream/main\0bbb222\0${FIXTURE_DATE}\0upstream commit\0`,
    ].join("\n");
    const setup = await renderPanel(createPanelClient(output, ["origin", "upstream"]));
    try {
      await waitForText(setup, "upstream (1)");
      const frame = setup.captureCharFrame();
      expect(frame).toContain("origin (1)");
      expect(frame).not.toContain("origin/main");
      expect(frame).not.toContain("upstream/main");
      expect(frame.match(/ main/g)).toHaveLength(2);
      expect(frame).toContain(`${ICONS.remoteLocalTracker} main`);
      expect(frame.split(ICONS.remoteLocalTracker)).toHaveLength(2);
      expect(setup.renderer.root.findDescendantById("remote-row-origin-main")).toBeDefined();
      expect(setup.renderer.root.findDescendantById("remote-row-upstream-main")).toBeDefined();
    } finally {
      await act(async () => {
        await setup.dispose();
      });
    }
  });

  it("shows the read error with Retry when the remote-branch read fails", async () => {
    const setup = await renderPanel(createPanelClient(null));

    await waitForText(setup, "Could not read remote branches");

    const frame = setup.captureCharFrame();

    expect(frame).toContain("Could not read remote branches");
    expect(frame).toContain("Retry");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("shows the no-remotes empty state", async () => {
    const setup = await renderPanel(createNoRemotesClient());

    await waitForText(setup, "No remotes configured");

    expect(setup.captureCharFrame()).toContain("No remotes configured");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("caps the rendered rows and names the hidden count", async () => {
    const rows = Array.from(
      { length: 5001 },
      (_, index) => `refs/remotes/origin/branch-${index}\0abc${index}\0${FIXTURE_DATE}\0commit\0`,
    ).join("\n");
    const setup = await renderPanel(createPanelClient(rows));

    await waitForText(setup, "showing first 5000 of 5001 remote branches (1 hidden)");

    expect(setup.captureCharFrame()).toContain(
      "showing first 5000 of 5001 remote branches (1 hidden)",
    );

    await act(async () => {
      await setup.dispose();
    });
  });
});
