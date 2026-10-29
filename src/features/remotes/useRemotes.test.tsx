import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { MouseEvent } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import { act, type ReactNode } from "react";
import { resetCommandOrchestration } from "@/app/hooks/commandRunner.state";
import {
  hasRegisteredAction,
  resetActionRegistry,
  resolveActionHandler,
} from "@/app/hooks/useAction";
import { resetActionAvailability } from "@/app/hooks/useActionAvailability";
import { resetInputEscapeClear } from "@/app/hooks/useInputEscapeClear";
import { useOverlay } from "@/app/hooks/useOverlay";
import { useStatus } from "@/app/hooks/useStatus";
import { registerCommandHandler, resetCommandRunner } from "@/domain/commands/commands.runner";
import type { CommandRequest } from "@/domain/commands/commands.types";
import { buildListRemoteBranchesArgs } from "@/domain/git/git.remote-branches";
import type { GitClient } from "@/domain/git/git.types";
import {
  CREATE_LOCAL_CHECKOUT_ID,
  CREATE_LOCAL_NAME_INPUT_ID,
  CREATE_LOCAL_OVERLAY_ID_PREFIX,
  CREATE_LOCAL_SUBMIT_ID,
} from "@/features/remotes/CreateLocalBranchModal.constants";
import { useRemotes } from "@/features/remotes/useRemotes";
import { AppTestProviders } from "@/test/app.harness";
import { createFakeGitClient, fakeGitResult } from "@/test/git.fake";

/** Latest remotes hook value captured by the probe. */
let latest: ReturnType<typeof useRemotes> | undefined;

/** Latest overlay context captured by the probe. */
let latestOverlay: ReturnType<typeof useOverlay> | undefined;

/** Latest status context captured by the probe. */
let latestStatus: ReturnType<typeof useStatus> | undefined;

/** Committer date shared by the remote-branch fixture. */
const FIXTURE_DATE = "2026-01-02T03:04:05+00:00";

/** Status key the repository read uses. */
const STATUS_KEY = "status --porcelain=v2 --branch -z --untracked-files=all";

/** Three remote branches whose full names exercise case-insensitive filtering. */
const REMOTE_BRANCHES_OUTPUT = [
  `refs/remotes/origin/Feature/Login\0aaa111\0${FIXTURE_DATE}\0Add login\0`,
  `refs/remotes/origin/main\0bbb222\0${FIXTURE_DATE}\0Initial commit\0`,
  `refs/remotes/origin/release-1.0\0ccc333\0${FIXTURE_DATE}\0Release\0`,
].join("\n");

/** Requests captured by a registered `remote.createLocal` handler. */
let commandRequests: CommandRequest[] = [];

/**
 * Renders the hook and any open modal entry.
 *
 * @returns The probe content.
 */
function RemotesProbe(): ReactNode {
  const remotes = useRemotes();
  const overlay = useOverlay();
  const status = useStatus();

  latest = remotes;
  latestOverlay = overlay;
  latestStatus = status;

  return (
    <box flexDirection="column" width={70} height={20}>
      {overlay.entry?.kind === "modal"
        ? overlay.entry.render({ close: () => overlay.close() })
        : null}
    </box>
  );
}

/**
 * Wraps the shared fake client so the remote-branch read returns the fixture rows.
 *
 * @param output - Remote-branch output, or null to fall back to the shared fake.
 * @returns The client used by the provider.
 */
function createRemotesClient(output: string = REMOTE_BRANCHES_OUTPUT): GitClient {
  const fake = createFakeGitClient();
  const branchReadKey = buildListRemoteBranchesArgs().join(" ");

  return {
    gitPath: fake.client.gitPath,
    invoke: async (options) => {
      if (options.args.join(" ") === branchReadKey) {
        return fakeGitResult(output);
      }

      return fake.client.invoke(options);
    },
  };
}

/**
 * Creates a client for an empty repository that still has remote-tracking refs.
 *
 * @returns The client used by the provider.
 */
function createEmptyRepositoryClient(): GitClient {
  const fake = createFakeGitClient();
  const branchReadKey = buildListRemoteBranchesArgs().join(" ");

  return {
    gitPath: fake.client.gitPath,
    invoke: async (options) => {
      const key = options.args.join(" ");

      if (key === "rev-parse --verify HEAD") {
        return fakeGitResult("", false, "fatal: Needed a single revision");
      }

      if (key === STATUS_KEY) {
        return fakeGitResult("# branch.head main\0");
      }

      if (key === branchReadKey) {
        return fakeGitResult(REMOTE_BRANCHES_OUTPUT);
      }

      return fake.client.invoke(options);
    },
  };
}

/**
 * Renders the hook inside the full provider stack and waits for the first read.
 *
 * @param client - Git client used by the repository provider.
 * @returns The renderer setup.
 */
async function renderRemotes(
  client: GitClient = createRemotesClient(),
): Promise<Awaited<ReturnType<typeof testRender>>> {
  latest = undefined;
  latestOverlay = undefined;
  latestStatus = undefined;
  commandRequests = [];

  const setup = await testRender(
    <AppTestProviders gitClient={client}>
      <RemotesProbe />
    </AppTestProviders>,
    { width: 80, height: 24 },
  );
  const deadline = Date.now() + 2_000;

  while (!isLoaded() && Date.now() < deadline) {
    await act(async () => {
      await setup.renderOnce();
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }

  return setup;
}

/**
 * Reports whether the probe has produced a settled hook value.
 *
 * @returns True once the first repository read settled.
 */
function isLoaded(): boolean {
  return latest !== undefined && !latest.loading;
}

/**
 * Runs one region action and flushes the resulting render.
 *
 * @param setup - Renderer setup.
 * @param actionId - Action to resolve in the `remotes` scope.
 */
async function runAction(
  setup: Awaited<ReturnType<typeof testRender>>,
  actionId: string,
): Promise<void> {
  await act(async () => {
    resolveActionHandler(actionId, "remotes")?.();
    await setup.renderOnce();
  });
}

/**
 * Clicks a renderable by id.
 *
 * @param setup - Renderer setup.
 * @param id - Renderable id.
 */
function clickById(setup: Awaited<ReturnType<typeof testRender>>, id: string): void {
  const target = setup.renderer.root.findDescendantById(id);

  if (target === undefined) {
    throw new Error(`renderable ${id} is missing`);
  }

  target.processMouseEvent(
    new MouseEvent(target, {
      type: "down",
      button: 0,
      x: 1,
      y: 0,
      modifiers: { shift: false, alt: false, ctrl: false },
    }),
  );
}

/**
 * Reads the modal name input value.
 *
 * @param setup - Renderer setup.
 * @returns The current input value.
 */
function readNameValue(setup: Awaited<ReturnType<typeof testRender>>): string {
  const input = setup.renderer.root.findDescendantById(CREATE_LOCAL_NAME_INPUT_ID) as
    | { value?: string }
    | undefined;

  if (input === undefined) {
    throw new Error("create-local name input is missing");
  }

  return input.value ?? "";
}

beforeEach(() => {
  resetActionRegistry();
  resetActionAvailability();
  resetInputEscapeClear();
  resetCommandRunner();
  resetCommandOrchestration();
});

afterEach(() => {
  resetActionRegistry();
  resetActionAvailability();
  resetInputEscapeClear();
  resetCommandRunner();
  resetCommandOrchestration();
});

describe("useRemotes registration", () => {
  it("registers only its two handlers in the remotes scope", async () => {
    const setup = await renderRemotes();

    expect(hasRegisteredAction("remote.createLocal", "remotes")).toBe(true);
    expect(hasRegisteredAction("list.filter", "remotes")).toBe(true);

    for (const actionId of ["branch.create", "tag.create", "stash.create", "worktree.create"]) {
      expect(hasRegisteredAction(actionId, "remotes")).toBe(false);
    }

    expect(hasRegisteredAction("app.refresh", "global")).toBe(false);
    expect(hasRegisteredAction("focus.next", "global")).toBe(false);
    expect(hasRegisteredAction("remote.createLocal", "global")).toBe(false);
    expect(hasRegisteredAction("list.filter", "branches")).toBe(false);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("lets useListCursor own the navigation registrations", async () => {
    const setup = await renderRemotes();

    for (const actionId of ["nav.up", "nav.down", "nav.activate", "nav.first", "nav.last"]) {
      expect(hasRegisteredAction(actionId, "remotes")).toBe(true);
    }

    await act(async () => {
      await setup.dispose();
    });
  });

  it("keeps nav.activate a no-op in v1", async () => {
    const setup = await renderRemotes();
    const before = latest?.cursor.activeId;

    await runAction(setup, "nav.activate");

    expect(latest?.cursor.activeId).toBe(before);
    expect(latestOverlay?.entry ?? null).toBeNull();

    await act(async () => {
      await setup.dispose();
    });
  });

  it("rejects a duplicate registration instead of replacing a remotes handler", async () => {
    const fake = createFakeGitClient();
    const consoleError = spyOn(console, "error").mockImplementation(() => {});
    const setup = await testRender(
      <AppTestProviders gitClient={fake.client}>
        <box flexDirection="column">
          <RemotesProbe />
          <RemotesProbe />
        </box>
      </AppTestProviders>,
      { width: 80, height: 24 },
    );

    await act(async () => {
      await setup.renderOnce();
    });

    expect(hasRegisteredAction("remote.createLocal", "remotes")).toBe(true);
    expect(consoleError).toHaveBeenCalled();
    expect(
      consoleError.mock.calls.some((call) => String(call[0]).includes("Duplicate action handler")),
    ).toBe(true);

    consoleError.mockRestore();
    await act(async () => {
      await setup.dispose();
    });
  });
});

describe("useRemotes filtering", () => {
  it("caps the rendered rows and keeps the filtered count", async () => {
    const rows = Array.from(
      { length: 5001 },
      (_, index) => `refs/remotes/origin/branch-${index}\0abc${index}\0${FIXTURE_DATE}\0commit\0`,
    ).join("\n");
    const setup = await renderRemotes(createRemotesClient(rows));

    expect(latest?.filteredCount).toBe(5001);
    expect(latest?.branchCount).toBe(5000);
    expect(latest?.hiddenCount).toBe(1);

    await act(async () => {
      await setup.dispose();
    });
  });
});

describe("useRemotes create local branch", () => {
  it("reports the no-selection reason instead of opening a modal", async () => {
    const setup = await renderRemotes(createRemotesClient(""));

    await runAction(setup, "remote.createLocal");

    expect(latest?.selectedBranch).toBeNull();
    expect(latestOverlay?.entry ?? null).toBeNull();
    expect(latestStatus?.status?.message).toBe("Select an item first");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("keeps create-local available in an empty repository with remote-tracking refs", async () => {
    const setup = await renderRemotes(createEmptyRepositoryClient());

    expect(latest?.emptyRepository).toBe(true);
    expect(latest?.selectedBranch).toEqual({ remote: "origin", branch: "Feature/Login" });

    await runAction(setup, "remote.createLocal");

    expect(latestOverlay?.entry?.kind).toBe("modal");
    expect(latestOverlay?.entry?.id).toBe(`${CREATE_LOCAL_OVERLAY_ID_PREFIX}origin/Feature/Login`);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("opens the modal with the branch part prefilled on Space", async () => {
    const setup = await renderRemotes();

    expect(latest?.selectedBranch).toEqual({ remote: "origin", branch: "Feature/Login" });

    await runAction(setup, "remote.createLocal");

    expect(latestOverlay?.entry?.kind).toBe("modal");
    expect(latestOverlay?.entry?.id).toBe(`${CREATE_LOCAL_OVERLAY_ID_PREFIX}origin/Feature/Login`);
    expect(latestOverlay?.entry?.initialFocusId).toBe(CREATE_LOCAL_NAME_INPUT_ID);
    expect(readNameValue(setup)).toBe("Feature/Login");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("opens the modal for the double-clicked row, not the previous cursor row", async () => {
    const setup = await renderRemotes();

    await act(async () => {
      latest?.selectRow(1);
      latest?.selectRow(1);
      await setup.renderOnce();
    });

    expect(latestOverlay?.entry?.kind).toBe("modal");
    expect(latestOverlay?.entry?.id).toBe(`${CREATE_LOCAL_OVERLAY_ID_PREFIX}origin/main`);
    expect(readNameValue(setup)).toBe("main");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("dispatches the validated name and the default checkout value", async () => {
    const cleanup = registerCommandHandler({
      commandId: "remote.createLocal",
      operationLabel: "Create local branch",
      handler: async (context) => {
        commandRequests.push(context.request);

        return { steps: [] };
      },
    });
    const setup = await renderRemotes();

    await act(async () => {
      latest?.selectRow(1);
      latest?.selectRow(1);
      await setup.renderOnce();
    });

    const input = setup.renderer.root.findDescendantById(CREATE_LOCAL_NAME_INPUT_ID) as
      | { insertText?: (text: string) => void }
      | undefined;

    await act(async () => {
      input?.insertText?.("-local");
      await setup.renderOnce();
    });

    expect(readNameValue(setup)).toBe("main-local");

    await act(async () => {
      clickById(setup, CREATE_LOCAL_SUBMIT_ID);
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(commandRequests).toHaveLength(1);
    expect(commandRequests[0]?.commandId).toBe("remote.createLocal");
    expect(commandRequests[0]?.target).toEqual({
      kind: "remoteBranch",
      remote: "origin",
      branch: "main",
    });
    expect(commandRequests[0]?.formValues).toEqual({ name: "main-local", checkout: "true" });

    cleanup();
    await act(async () => {
      await setup.dispose();
    });
  });

  it("reports checkout false when the checkbox is cleared", async () => {
    const cleanup = registerCommandHandler({
      commandId: "remote.createLocal",
      operationLabel: "Create local branch",
      handler: async (context) => {
        commandRequests.push(context.request);

        return { steps: [] };
      },
    });
    const setup = await renderRemotes();

    await act(async () => {
      latest?.selectRow(1);
      latest?.selectRow(1);
      await setup.renderOnce();
    });

    await act(async () => {
      const input = setup.renderer.root.findDescendantById(CREATE_LOCAL_NAME_INPUT_ID) as
        | { insertText?: (text: string) => void }
        | undefined;

      input?.insertText?.("-topic");
      clickById(setup, CREATE_LOCAL_CHECKOUT_ID);
      await setup.renderOnce();
    });

    await act(async () => {
      clickById(setup, CREATE_LOCAL_SUBMIT_ID);
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(commandRequests[0]?.formValues).toEqual({ name: "main-topic", checkout: "false" });

    cleanup();
    await act(async () => {
      await setup.dispose();
    });
  });

  it("keeps the modal open with an inline error for a duplicate local branch", async () => {
    const cleanup = registerCommandHandler({
      commandId: "remote.createLocal",
      operationLabel: "Create local branch",
      handler: async (context) => {
        commandRequests.push(context.request);

        return { steps: [] };
      },
    });
    const setup = await renderRemotes();

    await act(async () => {
      latest?.selectRow(1);
      latest?.selectRow(1);
      await setup.renderOnce();
    });

    await act(async () => {
      clickById(setup, CREATE_LOCAL_SUBMIT_ID);
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(commandRequests).toHaveLength(0);
    expect(setup.captureCharFrame()).toContain("Local branch already exists: main");
    expect(latestOverlay?.entry?.kind).toBe("modal");

    cleanup();
    await act(async () => {
      await setup.dispose();
    });
  });
});
