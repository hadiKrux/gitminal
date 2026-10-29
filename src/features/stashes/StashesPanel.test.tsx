import { beforeEach, describe, expect, it, spyOn } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act, type ReactNode } from "react";
import { resetCommandOrchestration } from "@/app/hooks/commandRunner.state";
import {
  getActionRegistryVersion,
  hasRegisteredAction,
  registerAction,
  resetActionRegistry,
} from "@/app/hooks/useAction";
import { useFocusRegion } from "@/app/hooks/useFocusRegion";
import { useHotkeys } from "@/app/hooks/useHotkeys";
import { useOverlay } from "@/app/hooks/useOverlay";
import { useStatus } from "@/app/hooks/useStatus";
import { registerCommandHandler, resetCommandRunner } from "@/domain/commands/commands.runner";
import { executeStashPop } from "@/domain/commands/commands.stashes";
import { buildListStashesArgs } from "@/domain/git/git.stashes";
import type { GitClient } from "@/domain/git/git.types";
import { StashesPanel } from "@/features/stashes/StashesPanel";
import { AppTestProviders } from "@/test/app.harness";
import { createFakeGitClient, fakeGitResult } from "@/test/git.fake";

/** Joined argv of the stash list read. */
const STASH_LIST_KEY = buildListStashesArgs().join(" ");

/** Canonical status output with one staged, one unstaged, and one untracked change. */
const NORMAL_STATUS =
  "# branch.oid abc123\u0000# branch.head main\u0000" +
  "1 M. N... 100644 100644 100644 aaaaaaa bbbbbbb staged.txt\u0000" +
  "1 .M N... 100644 100644 100644 aaaaaaa bbbbbbb unstaged.txt\u0000" +
  "? untracked.txt\u0000";

/** Status output for a clean working tree. */
const CLEAN_STATUS = "# branch.oid abc123\u0000# branch.head main\u0000";

/** Status output whose only change is an untracked file. */
const UNTRACKED_ONLY_STATUS = "# branch.oid abc123\u0000# branch.head main\u0000? new.txt\u0000";

let latestOverlay: ReturnType<typeof useOverlay> | undefined;
let latestStatus: ReturnType<typeof useStatus> | undefined;

/**
 * Builds one NUL-separated stash line.
 *
 * @param index - Display index.
 * @param objectName - Immutable object name.
 * @param subject - Recorded message.
 * @param committedAt - Commit timestamp in seconds.
 * @returns The recorded line.
 */
function stashLine(
  index: number,
  objectName: string,
  subject: string,
  committedAt: number = 1_700_000_000,
): string {
  return [`stash@{${index}}`, objectName, subject, String(committedAt)].join("\u0000");
}

/**
 * Builds a stash list.
 *
 * @param lines - Recorded lines.
 * @returns The stash list output.
 */
function stashList(lines: readonly string[]): string {
  return lines.join("\n");
}

/**
 * Renders the panel body inside a focusable stashes region frame.
 *
 * @returns The harness content.
 */
function PanelHarness(): ReactNode {
  const region = useFocusRegion("stashes");

  latestOverlay = useOverlay();
  latestStatus = useStatus();
  useHotkeys();

  return (
    <box {...region.regionProps} flexDirection="column" width={60} height={20}>
      <StashesPanel />
    </box>
  );
}

/**
 * Creates a client that answers the stash read from a mutable list.
 *
 * @param initialStashes - Initial stash list output.
 * @param initialStatus - Initial canonical status output.
 * @returns The client, its fake, and the mutable stash setter.
 */
function createRecordingClient(initialStashes: string, initialStatus: string = NORMAL_STATUS) {
  const fake = createFakeGitClient();
  const calls: string[] = [];
  let stashes = initialStashes;

  fake.setStatusOutput(initialStatus);

  const client: GitClient = {
    ...fake.client,
    invoke: async (options) => {
      const key = options.args.join(" ");

      calls.push(key);

      if (key === STASH_LIST_KEY) {
        return fakeGitResult(stashes);
      }

      return await fake.client.invoke(options);
    },
  };

  return {
    client,
    calls,
    fake,
    setStashes(next: string): void {
      stashes = next;
    },
  };
}

/**
 * Renders the panel with the provider stack.
 *
 * @param client - Injected git client.
 * @returns The renderer setup.
 */
async function renderPanel(gitClient: GitClient): Promise<Awaited<ReturnType<typeof testRender>>> {
  latestOverlay = undefined;
  latestStatus = undefined;

  const setup = await testRender(
    <AppTestProviders gitClient={gitClient}>
      <PanelHarness />
    </AppTestProviders>,
    { width: 100, height: 30, kittyKeyboard: true },
  );

  await act(async () => {
    await setup.renderOnce();
  });

  return setup;
}

/**
 * Renders until a predicate holds, or the deadline passes.
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
 * Focuses the stashes region frame.
 *
 * @param setup - Renderer setup.
 */
async function focusStashes(setup: Awaited<ReturnType<typeof testRender>>): Promise<void> {
  await act(async () => {
    setup.renderer.root.findDescendantById("region-stashes")?.focus();
  });
  await act(async () => {
    await setup.renderOnce();
  });
}

/**
 * Presses one key and renders once.
 *
 * @param setup - Renderer setup.
 * @param key - Key to press.
 */
async function pressKey(setup: Awaited<ReturnType<typeof testRender>>, key: string): Promise<void> {
  await act(async () => {
    setup.mockInput.pressKey(key);
  });
  await act(async () => {
    await setup.renderOnce();
  });
}

beforeEach(() => {
  resetActionRegistry();
  resetCommandRunner();
  resetCommandOrchestration();
  latestOverlay = undefined;
  latestStatus = undefined;
});

describe("StashesPanel registration", () => {
  it("registers exactly the stash actions plus cursor navigation, and no global action", async () => {
    const consoleError = spyOn(console, "error").mockImplementation(() => {});
    const versionBefore = getActionRegistryVersion();
    const { client } = createRecordingClient(stashList([stashLine(0, "aaa111", "old work")]));
    const setup = await renderPanel(client);

    await waitFor(setup, () => setup.captureCharFrame().includes("old work"));

    const expected = [
      "nav.up",
      "nav.down",
      "nav.activate",
      "stash.create",
      "stash.apply",
      "stash.pop",
      "stash.delete",
      "list.filter",
    ];

    for (const actionId of expected) {
      expect(hasRegisteredAction(actionId, "stashes"), actionId).toBe(true);
    }

    expect(hasRegisteredAction("nav.first", "stashes")).toBe(false);
    expect(hasRegisteredAction("nav.last", "stashes")).toBe(false);
    expect(hasRegisteredAction("app.refresh", "stashes")).toBe(false);
    expect(hasRegisteredAction("app.refresh", "global")).toBe(false);
    expect(hasRegisteredAction("remote.pull", "stashes")).toBe(false);
    expect(getActionRegistryVersion() - versionBefore).toBe(expected.length);
    expect(consoleError).not.toHaveBeenCalled();

    consoleError.mockRestore();
    await act(async () => {
      await setup.dispose();
    });
  });

  it("resolves p to stash.pop while focused and never to remote.pull", async () => {
    let remotePullCalls = 0;
    const cleanup = registerAction("remote.pull", { scope: "global", owner: "top-bar" }, () => {
      remotePullCalls += 1;
    });
    const { client } = createRecordingClient(stashList([stashLine(0, "aaa111", "old work")]));
    const setup = await renderPanel(client);

    await waitFor(setup, () => setup.captureCharFrame().includes("old work"));
    await focusStashes(setup);
    await pressKey(setup, "p");

    expect(remotePullCalls).toBe(0);
    expect(latestOverlay?.entry?.kind).toBe("confirm");
    expect(latestOverlay?.entry?.kind === "confirm" ? latestOverlay.entry.title : null).toBe(
      "Pop stash",
    );
    expect(latestOverlay?.entry?.kind === "confirm" ? latestOverlay.entry.confirmLabel : null).toBe(
      "Drop stash",
    );
    expect(latestOverlay?.entry?.kind === "confirm" ? latestOverlay.entry.destructive : null).toBe(
      true,
    );

    cleanup();
    await act(async () => {
      await setup.dispose();
    });
  });

  it("opens the create modal even when the default checkbox state would block creation", async () => {
    const clean = await renderPanel(
      createRecordingClient(stashList([stashLine(0, "aaa111", "old work")]), CLEAN_STATUS).client,
    );

    await waitFor(clean, () => clean.captureCharFrame().includes("old work"));
    await focusStashes(clean);
    await pressKey(clean, "s");

    expect(latestOverlay?.entry?.kind).toBe("modal");

    await act(async () => {
      await clean.dispose();
    });

    const untracked = await renderPanel(
      createRecordingClient(stashList([stashLine(0, "aaa111", "old work")]), UNTRACKED_ONLY_STATUS)
        .client,
    );

    await waitFor(untracked, () => untracked.captureCharFrame().includes("old work"));
    await focusStashes(untracked);
    await pressKey(untracked, "s");

    expect(latestOverlay?.entry?.kind).toBe("modal");

    await act(async () => {
      await untracked.dispose();
    });
  });
});

describe("StashesPanel states", () => {
  it("shows the empty state with the stash hint", async () => {
    const setup = await renderPanel(createRecordingClient(stashList([]), CLEAN_STATUS).client);

    await waitFor(setup, () => setup.captureCharFrame().includes("No stashes"));

    const frame = setup.captureCharFrame();

    expect(frame).toContain("No stashes");
    expect(frame).toContain("s Stash changes");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("shows the read error with a Retry action", async () => {
    const fake = createFakeGitClient();
    const client: GitClient = {
      ...fake.client,
      invoke: async (options) => {
        if (options.args.join(" ") === STASH_LIST_KEY) {
          return fakeGitResult("", false, "fatal: cannot read logs");
        }

        return await fake.client.invoke(options);
      },
    };
    const setup = await renderPanel(client);

    await waitFor(setup, () => setup.captureCharFrame().includes("Could not read stashes"));

    const frame = setup.captureCharFrame();

    expect(frame).toContain("Could not read stashes");
    expect(frame).toContain("Retry");

    await act(async () => {
      await setup.dispose();
    });
  });
});

describe("StashesPanel commands", () => {
  it("keeps the row when a pop fails", async () => {
    const cleanup = registerCommandHandler({
      commandId: "stash.pop",
      operationLabel: "Pop stash",
      handler: executeStashPop,
    });
    const { client } = createRecordingClient(stashList([stashLine(0, "aaa111", "old work")]));
    const setup = await renderPanel(client);

    await waitFor(setup, () => setup.captureCharFrame().includes("old work"));
    await focusStashes(setup);
    await pressKey(setup, "p");

    const entry = latestOverlay?.entry;

    expect(entry?.kind).toBe("confirm");

    await act(async () => {
      if (entry?.kind === "confirm") {
        entry.onConfirm();
      }
    });
    await waitFor(setup, () => latestOverlay?.errorDetail !== null);

    expect(latestOverlay?.errorDetail?.message.length).toBeGreaterThan(0);
    expect(setup.captureCharFrame()).toContain("old work");

    cleanup();
    await act(async () => {
      await setup.dispose();
    });
  });

  it("aborts a stale pop, refreshes the list, and never drops another stash", async () => {
    const cleanup = registerCommandHandler({
      commandId: "stash.pop",
      operationLabel: "Pop stash",
      handler: executeStashPop,
    });
    const { client, calls, setStashes } = createRecordingClient(
      stashList([stashLine(0, "aaa111", "old work")]),
    );
    const setup = await renderPanel(client);

    await waitFor(setup, () => setup.captureCharFrame().includes("old work"));
    await focusStashes(setup);

    setStashes(stashList([stashLine(0, "bbb222", "new work")]));

    const readsBefore = calls.filter((key) => key === STASH_LIST_KEY).length;

    await pressKey(setup, "p");

    const entry = latestOverlay?.entry;

    expect(entry?.kind).toBe("confirm");

    await act(async () => {
      if (entry?.kind === "confirm") {
        entry.onConfirm();
      }
    });
    await waitFor(
      setup,
      () => latestStatus?.status?.message === "stash changed externally; list refreshed",
    );
    await waitFor(setup, () => calls.filter((key) => key === STASH_LIST_KEY).length > readsBefore);

    expect(latestStatus?.status?.message).toBe("stash changed externally; list refreshed");
    expect(calls.some((key) => key.startsWith("stash pop"))).toBe(false);
    await waitFor(setup, () => setup.captureCharFrame().includes("new work"));

    expect(setup.captureCharFrame()).toContain("new work");

    cleanup();
    await act(async () => {
      await setup.dispose();
    });
  });
});
