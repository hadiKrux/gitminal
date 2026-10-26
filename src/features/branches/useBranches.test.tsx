import { beforeEach, describe, expect, it } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act, type ReactNode } from "react";
import { resetCommandOrchestration } from "@/app/hooks/commandRunner.state";
import {
  hasRegisteredAction,
  resetActionRegistry,
  resolveActionHandler,
} from "@/app/hooks/useAction";
import { readActionAvailability, resetActionAvailability } from "@/app/hooks/useActionAvailability";
import { useFocusRegion } from "@/app/hooks/useFocusRegion";
import { useOverlay } from "@/app/hooks/useOverlay";
import { useRepository } from "@/app/hooks/useRepository";
import {
  executeBranchCheckout,
  executeBranchCreate,
  executeBranchDelete,
} from "@/domain/commands/commands.branches";
import { registerCommandHandler, resetCommandRunner } from "@/domain/commands/commands.runner";
import { buildListLocalBranchesArgs } from "@/domain/git/git.branches";
import { buildListRemoteBranchesArgs } from "@/domain/git/git.remote-branches";
import type { GitClient, GitInvocationResult } from "@/domain/git/git.types";
import { useBranches } from "@/features/branches/useBranches";
import { AppTestProviders } from "@/test/app.harness";
import { createFakeGitClient, fakeGitResult } from "@/test/git.fake";

const STATUS_KEY = "status --porcelain=v2 --branch -z --untracked-files=all";
const BRANCHES_KEY = buildListLocalBranchesArgs().join(" ");
const REMOTE_BRANCHES_KEY = buildListRemoteBranchesArgs().join(" ");
const FIXTURE_DATE = "2026-01-02T03:04:05+00:00";

type BranchesHook = ReturnType<typeof useBranches>;
type NewBranchInput = Parameters<Parameters<typeof useBranches>[0]["renderNewBranchModal"]>[0];
type DeleteBranchInput = Parameters<
  Parameters<typeof useBranches>[0]["renderDeleteBranchModal"]
>[0];

let handle: BranchesHook | undefined;
let newBranchInput: NewBranchInput | undefined;
let deleteBranchInput: DeleteBranchInput | undefined;
let latestOverlay: ReturnType<typeof useOverlay> | undefined;
let latestRepository: ReturnType<typeof useRepository> | undefined;

function OverlayProbe(): null {
  latestOverlay = useOverlay();
  latestRepository = useRepository();

  return null;
}

function Harness(): ReactNode {
  const region = useFocusRegion("branches");

  handle = useBranches({
    renderNewBranchModal: (input) => {
      newBranchInput = input;

      return null;
    },
    renderDeleteBranchModal: (input) => {
      deleteBranchInput = input;

      return null;
    },
  });

  return (
    <box {...region.regionProps} flexDirection="column" width={40} height={10}>
      <OverlayProbe />
      <text>{handle.items.map((item) => item.id).join(",")}</text>
    </box>
  );
}

/**
 * Invokes the render function of the open overlay entry.
 *
 * The overlay host is shell UI the branches feature cannot import, so the test calls the entry's
 * renderer itself. That is the same call the host makes when it projects the entry.
 */
function renderOpenModal(): void {
  const entry = latestOverlay?.entry;

  if (entry === null || entry === undefined || entry.kind !== "modal") {
    throw new Error("no modal entry is open");
  }

  entry.render({ close: () => {} });
}

/**
 * Creates a git client that records every invocation and answers scripted overrides.
 *
 * Overrides are checked first, then the shared repository fake answers the rest of the read path,
 * so a command test can script one argv and still let the post-command refresh succeed.
 *
 * @param overrides - Answers keyed by the joined argument array.
 * @returns The client and the recorded invocation keys.
 */
function createRecordingClient(
  overrides: Readonly<Record<string, string | GitInvocationResult>> = {},
) {
  const fake = createFakeGitClient();
  const calls: string[] = [];

  const client: GitClient = {
    gitPath: "git",
    invoke: async (options) => {
      const key = options.args.join(" ");

      calls.push(key);

      const override = overrides[key];

      if (override !== undefined) {
        return typeof override === "string" ? fakeGitResult(override) : override;
      }

      return fake.client.invoke(options);
    },
  };

  return { client, calls, fake };
}

async function renderHarness(client: GitClient): Promise<Awaited<ReturnType<typeof testRender>>> {
  const setup = await testRender(
    <AppTestProviders gitClient={client}>
      <Harness />
    </AppTestProviders>,
    { width: 60, height: 20 },
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

async function runAction(actionId: string): Promise<void> {
  await act(async () => {
    resolveActionHandler(actionId, "branches")?.();
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
  });
}

function readBranchRows(
  names: readonly string[],
  upstreams: Readonly<Record<string, { remote: string; branch: string }>> = {},
): string {
  return names
    .map((name, index) => {
      const upstream = upstreams[name];
      const head = index === 0 ? "*" : " ";

      if (upstream === undefined) {
        return `${name}\0abc12${index}\0${head}\0${FIXTURE_DATE}\0\0\0`;
      }

      return `${name}\0abc12${index}\0${head}\0${FIXTURE_DATE}\0${upstream.remote}\0refs/heads/${upstream.branch}\0`;
    })
    .join("\n");
}

beforeEach(() => {
  resetActionRegistry();
  resetActionAvailability();
  resetCommandOrchestration();
  resetCommandRunner();
  registerCommandHandler({
    commandId: "branch.create",
    operationLabel: "Create branch",
    handler: executeBranchCreate,
  });
  registerCommandHandler({
    commandId: "branch.checkout",
    operationLabel: "Checkout branch",
    handler: executeBranchCheckout,
  });
  registerCommandHandler({
    commandId: "branch.delete",
    operationLabel: "Delete branch",
    handler: executeBranchDelete,
  });
  handle = undefined;
  newBranchInput = undefined;
  deleteBranchInput = undefined;
  latestOverlay = undefined;
  latestRepository = undefined;
});

describe("useBranches registration", () => {
  it("registers branch.create and branch.delete in the branches scope and no global action", async () => {
    const { client } = createRecordingClient();
    const setup = await renderHarness(client);

    await waitFor(setup, () => (handle?.items.length ?? 0) > 0);

    expect(hasRegisteredAction("branch.create", "branches")).toBe(true);
    expect(hasRegisteredAction("branch.delete", "branches")).toBe(true);

    for (const actionId of ["nav.up", "nav.down", "nav.activate", "nav.first", "nav.last"]) {
      expect(hasRegisteredAction(actionId, "branches")).toBe(true);
    }

    expect(hasRegisteredAction("app.refresh", "branches")).toBe(false);
    expect(resolveActionHandler("app.refresh", "global")).toBeUndefined();

    await act(async () => {
      await setup.dispose();
    });
  });
});

describe("useBranches rows and availability", () => {
  it("orders the current branch first and reports the delete reasons from availability", async () => {
    const { client } = createRecordingClient();
    const setup = await renderHarness(client);

    await waitFor(setup, () => (handle?.items.length ?? 0) === 2);

    expect(handle?.items.map((item) => item.id)).toEqual(["main", "feature"]);
    expect(handle?.selectedDeleteReason).toBe("Cannot delete the current branch");

    await runAction("nav.down");

    expect(handle?.selected?.name).toBe("feature");
    expect(handle?.selectedDeleteReason).toBe("checked out in another worktree");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("reports an empty repository hint when no branch exists yet", async () => {
    const { client } = createRecordingClient({
      "rev-parse --verify HEAD": fakeGitResult("", false),
      [STATUS_KEY]: fakeGitResult("# branch.head main\0"),
      [BRANCHES_KEY]: "",
      [REMOTE_BRANCHES_KEY]: "",
    });
    const setup = await renderHarness(client);

    await waitFor(setup, () => handle?.empty === true);

    expect(handle?.empty).toBe(true);
    expect(handle?.loading).toBe(false);
    expect(handle?.createReason).toBe("no commits yet");
    expect(handle?.emptyHint).toBe("n New branch - no commits yet; a commit is required first");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("reports a read failure as an error without an empty state", async () => {
    const { client } = createRecordingClient({
      [BRANCHES_KEY]: fakeGitResult("", false, "fatal: cannot read refs"),
    });
    const setup = await renderHarness(client);

    await waitFor(setup, () => handle?.error !== null);

    expect(handle?.error).toContain("cannot read refs");
    expect(handle?.empty).toBe(false);

    await act(async () => {
      await setup.dispose();
    });
  });
});

describe("useBranches focus refresh", () => {
  it("refreshes status when the region gains focus", async () => {
    const { client, fake } = createRecordingClient();
    const setup = await renderHarness(client);

    await waitFor(setup, () => (handle?.items.length ?? 0) === 2);

    const before = fake.counts.get(STATUS_KEY) ?? 0;

    await act(async () => {
      setup.renderer.root.findDescendantById("region-branches")?.focus();
    });

    await waitFor(setup, () => (fake.counts.get(STATUS_KEY) ?? 0) > before);

    expect(fake.counts.get(STATUS_KEY) ?? 0).toBeGreaterThan(before);

    await act(async () => {
      await setup.dispose();
    });
  });
});

describe("useBranches commands", () => {
  it("submits branch.create with name, checkout, and start point", async () => {
    const { client, calls } = createRecordingClient({ "switch -c next HEAD": "" });
    const setup = await renderHarness(client);

    await waitFor(setup, () => (handle?.items.length ?? 0) === 2);
    await runAction("branch.create");
    renderOpenModal();

    expect(newBranchInput?.startPointLabel).toBe("HEAD (current tip)");
    expect(newBranchInput?.blockedReason).toBeNull();

    await act(async () => {
      newBranchInput?.onCreate({ name: "next", checkout: true });
    });

    await waitFor(setup, () => calls.includes("switch -c next HEAD"));

    expect(calls).toContain("switch -c next HEAD");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("uses the selected commit as the start point", async () => {
    const oid = "abcdef1234567890";
    const { client, calls } = createRecordingClient({ [`branch from-commit ${oid}`]: "" });
    const setup = await renderHarness(client);

    await waitFor(setup, () => (handle?.items.length ?? 0) === 2);

    await act(async () => {
      latestRepository?.setSelection({ kind: "commit", oid });
    });
    await runAction("branch.create");
    renderOpenModal();

    expect(newBranchInput?.startPointLabel).toBe("commit abcdef1");

    await act(async () => {
      newBranchInput?.onCreate({ name: "from-commit", checkout: false });
    });

    await waitFor(setup, () => calls.includes(`branch from-commit ${oid}`));

    expect(calls).toContain(`branch from-commit ${oid}`);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("checks out the selected branch on nav.activate", async () => {
    const { client, calls } = createRecordingClient({
      [BRANCHES_KEY]: readBranchRows(["main", "topic"]),
      [REMOTE_BRANCHES_KEY]: "",
      "checkout topic": "",
    });
    const setup = await renderHarness(client);

    await waitFor(setup, () => (handle?.items.length ?? 0) === 2);
    await runAction("nav.down");
    await runAction("nav.activate");

    await waitFor(setup, () => calls.includes("checkout topic"));

    expect(calls).toContain("checkout topic");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("checks out the clicked row when both double-click events land before a render", async () => {
    const { client, calls } = createRecordingClient({
      [BRANCHES_KEY]: readBranchRows(["main", "topic"]),
      [REMOTE_BRANCHES_KEY]: "",
      "checkout topic": "",
    });
    const setup = await renderHarness(client);

    await waitFor(setup, () => (handle?.items.length ?? 0) === 2);
    await runAction("nav.down");
    await runAction("nav.first");

    await act(async () => {
      handle?.handleRowClick(1);
      handle?.handleRowClick(1);
    });

    await waitFor(setup, () => calls.includes("checkout topic"));

    expect(calls).toContain("checkout topic");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("submits branch.delete local-first with the resolved remote and force values", async () => {
    const { client, calls } = createRecordingClient({
      [BRANCHES_KEY]: readBranchRows(["main", "topic"], {
        main: { remote: "origin", branch: "main" },
        topic: { remote: "origin", branch: "topic" },
      }),
      [REMOTE_BRANCHES_KEY]: [
        `refs/remotes/origin/main\0abc123\0${FIXTURE_DATE}\0initial commit\0`,
        `refs/remotes/origin/topic\0def456\0${FIXTURE_DATE}\0topic commit\0`,
        "",
      ].join("\n"),
      "branch -D topic": "",
      "push --progress --delete -- origin topic": "",
    });
    const setup = await renderHarness(client);

    await waitFor(setup, () => (handle?.items.length ?? 0) === 2);
    await runAction("nav.down");
    await runAction("branch.delete");
    renderOpenModal();

    expect(deleteBranchInput?.branch.name).toBe("topic");
    expect(deleteBranchInput?.blockedReason).toBeNull();
    expect(deleteBranchInput?.remote).toEqual({ remote: "origin", branch: "topic" });
    expect(deleteBranchInput?.remoteReason).toBeNull();

    await act(async () => {
      deleteBranchInput?.onDelete({ scope: "local-remote", force: true });
    });

    await waitFor(setup, () => calls.includes("push --progress --delete -- origin topic"));

    const localIndex = calls.indexOf("branch -D topic");
    const remoteIndex = calls.indexOf("push --progress --delete -- origin topic");

    expect(localIndex).toBeGreaterThanOrEqual(0);
    expect(remoteIndex).toBeGreaterThan(localIndex);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("marks the remote half unavailable when nothing resolves", async () => {
    const { client } = createRecordingClient();
    const setup = await renderHarness(client);

    await waitFor(setup, () => (handle?.items.length ?? 0) === 2);
    await runAction("nav.down");
    await runAction("branch.delete");
    renderOpenModal();

    expect(deleteBranchInput?.branch.name).toBe("feature");
    expect(deleteBranchInput?.remote).toBeNull();
    expect(deleteBranchInput?.remoteReason).toBe("no matching remote branch");
    expect(deleteBranchInput?.blockedReason).toBe("checked out in another worktree");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("disables the remote scope when the configured upstream is confirmed absent", async () => {
    const { client } = createRecordingClient({
      [BRANCHES_KEY]: readBranchRows(["main", "topic"], {
        topic: { remote: "origin", branch: "topic" },
      }),
      [REMOTE_BRANCHES_KEY]: "",
    });
    const setup = await renderHarness(client);

    await waitFor(setup, () => (handle?.items.length ?? 0) === 2);
    await runAction("nav.down");
    await runAction("branch.delete");
    renderOpenModal();

    expect(deleteBranchInput?.remote).toBeNull();
    expect(deleteBranchInput?.remoteReason).toBe("no matching remote branch");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("disables the remote scope when the configured remote is missing", async () => {
    const { client } = createRecordingClient({
      [BRANCHES_KEY]: readBranchRows(["main", "topic"], {
        topic: { remote: "legacy", branch: "topic" },
      }),
      [REMOTE_BRANCHES_KEY]: "",
    });
    const setup = await renderHarness(client);

    await waitFor(setup, () => (handle?.items.length ?? 0) === 2);
    await runAction("nav.down");
    await runAction("branch.delete");
    renderOpenModal();

    expect(deleteBranchInput?.remote).toBeNull();
    expect(deleteBranchInput?.remoteReason).toBe("remote missing");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("selects the created branch after a successful create and refresh", async () => {
    const fake = createFakeGitClient();
    let created = false;
    const calls: string[] = [];
    const client: GitClient = {
      gitPath: "git",
      invoke: async (options) => {
        const key = options.args.join(" ");

        calls.push(key);

        if (key === "switch -c next HEAD") {
          created = true;

          return fakeGitResult("");
        }

        if (key === BRANCHES_KEY && created) {
          return fakeGitResult(readBranchRows(["next", "main", "feature"]));
        }

        return fake.client.invoke(options);
      },
    };
    const setup = await renderHarness(client);

    await waitFor(setup, () => (handle?.items.length ?? 0) === 2);
    await runAction("branch.create");
    renderOpenModal();

    await act(async () => {
      newBranchInput?.onCreate({ name: "next", checkout: true });
    });

    await waitFor(setup, () => handle?.selected?.name === "next" && handle.selectedIndex === 0);

    expect(handle?.selected?.name).toBe("next");
    expect(handle?.items.map((item) => item.id)).toEqual(["next", "feature", "main"]);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("publishes delete availability for the selected branch", async () => {
    const { client } = createRecordingClient({
      [BRANCHES_KEY]: readBranchRows(["main", "topic"]),
      [REMOTE_BRANCHES_KEY]: "",
    });
    const setup = await renderHarness(client);

    await waitFor(setup, () => (handle?.items.length ?? 0) === 2);

    expect(readActionAvailability("branches", "branch.create")).toBe(true);
    expect(readActionAvailability("branches", "branch.delete")).toBe(false);

    await runAction("nav.down");

    expect(readActionAvailability("branches", "branch.delete")).toBe(true);

    await act(async () => {
      await setup.dispose();
    });
  });
});
