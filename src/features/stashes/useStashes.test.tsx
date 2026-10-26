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
import { useStatus } from "@/app/hooks/useStatus";
import { registerCommandHandler, resetCommandRunner } from "@/domain/commands/commands.runner";
import type { CommandRequest } from "@/domain/commands/commands.types";
import { buildListStashesArgs } from "@/domain/git/git.stashes";
import type { GitClient } from "@/domain/git/git.types";
import type { RepositorySelection } from "@/domain/repository/repository.types";
import { CREATE_STASH_MESSAGE_FIELD_ID } from "@/features/stashes/CreateStashModal.constants";
import { useStashes } from "@/features/stashes/useStashes";
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

/** Status output whose only change is an untracked file. */
const UNTRACKED_ONLY_STATUS = "# branch.oid abc123\u0000# branch.head main\u0000? new.txt\u0000";

/** Status output for an unborn branch. */
const UNBORN_STATUS = "# branch.oid (initial)\u0000# branch.head main\u0000";

type StashesHook = ReturnType<typeof useStashes>;
type CreateInput = Parameters<Parameters<typeof useStashes>[0]["renderCreateStashModal"]>[0];
type DeleteInput = Parameters<Parameters<typeof useStashes>[0]["renderDeleteStashModal"]>[0];

let handle: StashesHook | undefined;
let createInput: CreateInput | undefined;
let deleteInput: DeleteInput | undefined;
let latestOverlay: ReturnType<typeof useOverlay> | undefined;
let latestRepository: ReturnType<typeof useRepository> | undefined;
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
 * Renders the hook inside a focusable stashes region frame.
 *
 * @returns The harness content.
 */
function Harness(): ReactNode {
  const region = useFocusRegion("stashes");

  handle = useStashes({
    renderCreateStashModal: (input) => {
      createInput = input;

      return null;
    },
    renderDeleteStashModal: (input) => {
      deleteInput = input;

      return null;
    },
  });
  latestOverlay = useOverlay();
  latestRepository = useRepository();
  latestStatus = useStatus();

  return (
    <box {...region.regionProps} flexDirection="column" width={60} height={10}>
      <text>{handle.rows.map((row) => row.objectName).join(",")}</text>
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
  let holdNextStashRead = false;
  let releaseStashRead: (() => void) | null = null;

  fake.setStatusOutput(initialStatus);

  const client: GitClient = {
    ...fake.client,
    invoke: async (options) => {
      const key = options.args.join(" ");
      const stashesAtInvocation = stashes;

      calls.push(key);

      if (key === STASH_LIST_KEY && holdNextStashRead) {
        holdNextStashRead = false;
        await new Promise<void>((resolve) => {
          releaseStashRead = resolve;
        });
      }

      if (key === STASH_LIST_KEY) {
        return fakeGitResult(stashesAtInvocation);
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
    /** Holds the next stash-list read until `releaseStashRead` is called. */
    holdNextStashRead(): void {
      holdNextStashRead = true;
    },
    /** Reports whether a held stash-list read is waiting. */
    isStashReadHeld(): boolean {
      return releaseStashRead !== null;
    },
    /** Releases the held stash-list read so the read finishes with its captured output. */
    releaseStashRead(): void {
      const release = releaseStashRead;

      releaseStashRead = null;
      release?.();
    },
  };
}

/**
 * Renders the harness with the provider stack.
 *
 * @param client - Injected git client.
 * @returns The renderer setup.
 */
async function renderHarness(client: GitClient): Promise<Awaited<ReturnType<typeof testRender>>> {
  const setup = await testRender(
    <AppTestProviders gitClient={client}>
      <Harness />
    </AppTestProviders>,
    { width: 80, height: 20, kittyKeyboard: true },
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
 * Runs one stashes-scope action.
 *
 * @param actionId - Action id.
 */
async function runAction(actionId: string): Promise<void> {
  await act(async () => {
    resolveActionHandler(actionId, "stashes")?.();
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
  });
}

/**
 * Invokes the render function of the open modal entry.
 *
 * The overlay host is shell UI the stashes feature cannot import, so the test calls the entry's
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
 * Registers a capture-only command handler.
 *
 * @param commandId - Command to capture.
 * @param requests - Captured request list.
 * @returns The registration cleanup.
 */
function registerCapture(commandId: string, requests: CommandRequest[]): () => void {
  return registerCommandHandler({
    commandId,
    operationLabel: commandId,
    handler: async (context) => {
      requests.push(context.request);

      return { steps: [] };
    },
  });
}

beforeEach(() => {
  resetActionRegistry();
  resetActionAvailability();
  resetCommandRunner();
  resetCommandOrchestration();
  handle = undefined;
  createInput = undefined;
  deleteInput = undefined;
  latestOverlay = undefined;
  latestRepository = undefined;
  latestStatus = undefined;
});

describe("useStashes registration and navigation", () => {
  it("registers exactly the stash actions plus cursor navigation, and no global action", async () => {
    const { client } = createRecordingClient(
      stashList([stashLine(0, "aaa111", "WIP on main: abc123 work")]),
    );
    const setup = await renderHarness(client);

    await waitFor(setup, () => (handle?.rows.length ?? 0) === 1);

    for (const actionId of [
      "nav.up",
      "nav.down",
      "nav.activate",
      "stash.create",
      "stash.apply",
      "stash.pop",
      "stash.delete",
    ]) {
      expect(hasRegisteredAction(actionId, "stashes"), actionId).toBe(true);
    }

    expect(hasRegisteredAction("nav.first", "stashes")).toBe(false);
    expect(hasRegisteredAction("nav.last", "stashes")).toBe(false);
    expect(hasRegisteredAction("app.refresh", "stashes")).toBe(false);
    expect(hasRegisteredAction("remote.pull", "stashes")).toBe(false);
    expect(hasRegisteredAction("remote.pull", "global")).toBe(false);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("selects the immutable object name on activation without a git mutation", async () => {
    const { client } = createRecordingClient(
      stashList([stashLine(0, "aaa111", "WIP on main: abc123 work")]),
    );
    const setup = await renderHarness(client);

    await waitFor(setup, () => (handle?.rows.length ?? 0) === 1);
    await focusStashes(setup);
    await runAction("nav.activate");

    const expected: RepositorySelection = { kind: "stash", objectName: "aaa111" };

    expect(latestRepository?.selection).toEqual(expected);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("keeps the cursor on the same object name when the display index shifts", async () => {
    const { client, setStashes } = createRecordingClient(
      stashList([
        stashLine(1, "aaa111", "WIP on main: abc123 first"),
        stashLine(0, "bbb222", "WIP on main: abc123 second"),
      ]),
    );
    const setup = await renderHarness(client);

    await waitFor(setup, () => (handle?.rows.length ?? 0) === 2);
    await focusStashes(setup);
    await runAction("nav.down");

    expect(handle?.selected?.objectName).toBe("aaa111");
    expect(handle?.selectedIndex).toBe(1);

    setStashes(
      stashList([
        stashLine(1, "bbb222", "WIP on main: abc123 second"),
        stashLine(0, "aaa111", "WIP on main: abc123 first"),
      ]),
    );

    await act(async () => {
      await latestRepository?.refreshStatus();
    });
    await waitFor(setup, () => handle?.rows[0]?.objectName === "aaa111");

    expect(handle?.selected?.objectName).toBe("aaa111");
    expect(handle?.selectedIndex).toBe(0);

    await act(async () => {
      await setup.dispose();
    });
  });
});

describe("useStashes selection and publication", () => {
  it("activates the double-clicked row, not the previous cursor row", async () => {
    const { client } = createRecordingClient(
      stashList([
        stashLine(0, "bbb222", "WIP on main: abc123 second"),
        stashLine(1, "aaa111", "WIP on main: abc123 first"),
      ]),
    );
    const setup = await renderHarness(client);

    await waitFor(setup, () => (handle?.rows.length ?? 0) === 2);

    await act(async () => {
      handle?.handleRowClick(1);
      handle?.handleRowClick(1);
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(latestRepository?.selection).toEqual({ kind: "stash", objectName: "aaa111" });

    await act(async () => {
      await setup.dispose();
    });
  });

  it("repairs the selection to the nearest surviving stash or pending changes", async () => {
    const { client, setStashes } = createRecordingClient(
      stashList([
        stashLine(0, "bbb222", "WIP on main: abc123 second"),
        stashLine(1, "aaa111", "WIP on main: abc123 first"),
      ]),
    );
    const setup = await renderHarness(client);

    await waitFor(setup, () => (handle?.rows.length ?? 0) === 2);
    await focusStashes(setup);
    await runAction("nav.down");
    await runAction("nav.activate");

    expect(latestRepository?.selection).toEqual({ kind: "stash", objectName: "aaa111" });

    setStashes(stashList([stashLine(0, "bbb222", "WIP on main: abc123 second")]));

    await act(async () => {
      await latestRepository?.refreshStatus();
    });
    await waitFor(
      setup,
      () =>
        latestRepository?.selection.kind === "stash" &&
        latestRepository.selection.objectName === "bbb222",
    );

    expect(latestRepository?.selection).toEqual({ kind: "stash", objectName: "bbb222" });

    setStashes(stashList([]));

    await act(async () => {
      await latestRepository?.refreshStatus();
    });
    await waitFor(setup, () => latestRepository?.selection.kind === "pending");

    expect(latestRepository?.selection).toEqual({ kind: "pending" });

    await act(async () => {
      await setup.dispose();
    });
  });

  it("publishes the selected stash availability and clears it on unmount", async () => {
    const { client } = createRecordingClient(
      stashList([stashLine(0, "aaa111", "WIP on main: abc123 work")]),
    );
    const setup = await renderHarness(client);

    await waitFor(setup, () => (handle?.rows.length ?? 0) === 1);
    await act(async () => {
      await setup.renderOnce();
    });

    expect(readActionAvailability("stashes", "stash.create")).toBe(true);
    expect(readActionAvailability("stashes", "stash.apply")).toBe(true);
    expect(readActionAvailability("stashes", "stash.pop")).toBe(true);
    expect(readActionAvailability("stashes", "stash.delete")).toBe(true);

    await act(async () => {
      await setup.dispose();
    });

    expect(readActionAvailability("stashes", "stash.apply")).toBeUndefined();
  });
});

describe("useStashes availability and modal inputs", () => {
  it("passes the deterministic prefill and config default to the create modal", async () => {
    const { client } = createRecordingClient(
      stashList([stashLine(0, "aaa111", "WIP on main: abc123 work")]),
    );
    const setup = await renderHarness(client);

    await waitFor(setup, () => (handle?.rows.length ?? 0) === 1);
    await runAction("stash.create");
    renderOpenModal();

    expect(createInput?.initialMessage).toBe("WIP on main: abc123 initial commit");
    expect(createInput?.messageFieldId).toBe(CREATE_STASH_MESSAGE_FIELD_ID);
    expect(createInput?.includeUntrackedByDefault).toBe(false);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("opens the create modal when the default checkbox state would block the command", async () => {
    const { client } = createRecordingClient(
      stashList([stashLine(0, "aaa111", "WIP on main: abc123 work")]),
      UNTRACKED_ONLY_STATUS,
    );
    const setup = await renderHarness(client);

    await waitFor(
      setup,
      () => handle?.createReason === "only untracked changes; include untracked files to stash",
    );

    await runAction("stash.create");

    expect(latestOverlay?.entry?.kind).toBe("modal");
    renderOpenModal();

    expect(createInput).toBeDefined();

    await act(async () => {
      await setup.dispose();
    });
  });

  it("reports no commits yet and still opens the create modal", async () => {
    const { client } = createRecordingClient(stashList([]), UNBORN_STATUS);
    const setup = await renderHarness(client);

    await waitFor(setup, () => handle?.createReason === "no commits yet");
    await runAction("stash.create");
    renderOpenModal();

    expect(createInput).toBeDefined();

    await act(async () => {
      await setup.dispose();
    });
  });

  it("reports no stash selected for apply, pop, and delete on an empty list", async () => {
    const { client } = createRecordingClient(stashList([]));
    const setup = await renderHarness(client);

    await waitFor(setup, () => handle?.totalCount === 0);

    await runAction("stash.apply");

    expect(latestStatus?.status?.message).toBe("no stash selected");

    await runAction("stash.pop");

    expect(latestStatus?.status?.message).toBe("no stash selected");
    expect(latestOverlay?.entry).toBeNull();

    await runAction("stash.delete");

    expect(latestStatus?.status?.message).toBe("no stash selected");
    expect(deleteInput).toBeUndefined();

    await act(async () => {
      await setup.dispose();
    });
  });
});

describe("useStashes commands", () => {
  it("submits stash.create with the message and include-untracked form keys", async () => {
    const requests: CommandRequest[] = [];
    const cleanup = registerCapture("stash.create", requests);
    const { client } = createRecordingClient(
      stashList([stashLine(0, "aaa111", "WIP on main: abc123 work")]),
    );
    const setup = await renderHarness(client);

    await waitFor(setup, () => (handle?.rows.length ?? 0) === 1);
    await runAction("stash.create");
    renderOpenModal();

    await act(async () => {
      createInput?.onCreate({ message: "work in progress", includeUntracked: true });
    });
    await waitFor(setup, () => requests.length === 1);

    expect(requests[0]).toEqual({
      commandId: "stash.create",
      target: { kind: "none" },
      formValues: { message: "work in progress", includeUntracked: "true" },
    });

    cleanup();
    await act(async () => {
      await setup.dispose();
    });
  });

  it("applies the selected stash immediately without a confirmation", async () => {
    const requests: CommandRequest[] = [];
    const cleanup = registerCapture("stash.apply", requests);
    const { client } = createRecordingClient(
      stashList([stashLine(0, "aaa111", "WIP on main: abc123 work")]),
    );
    const setup = await renderHarness(client);

    await waitFor(setup, () => (handle?.rows.length ?? 0) === 1);
    await focusStashes(setup);
    await runAction("stash.apply");
    await waitFor(setup, () => requests.length === 1);

    expect(latestOverlay?.entry).toBeNull();
    expect(requests[0]?.target).toEqual({ kind: "stash", objectName: "aaa111" });

    cleanup();
    await act(async () => {
      await setup.dispose();
    });
  });

  it("selects the created stash and moves the cursor to it after the refresh", async () => {
    const { client, setStashes } = createRecordingClient(
      stashList([stashLine(0, "aaa111", "WIP on main: abc123 old work")]),
    );
    const cleanup = registerCommandHandler({
      commandId: "stash.create",
      operationLabel: "Create stash",
      handler: async () => {
        setStashes(
          stashList([
            stashLine(0, "bbb222", "WIP on main: ccc333 new work"),
            stashLine(1, "aaa111", "WIP on main: abc123 old work"),
          ]),
        );

        return { steps: [] };
      },
    });
    const setup = await renderHarness(client);

    await waitFor(setup, () => (handle?.rows.length ?? 0) === 1);
    await runAction("stash.create");
    renderOpenModal();

    await act(async () => {
      createInput?.onCreate({ message: "new work", includeUntracked: false });
    });
    await waitFor(
      setup,
      () => handle?.selected?.objectName === "bbb222" && handle?.selectedIndex === 0,
    );

    expect(handle?.selectedIndex).toBe(0);
    expect(latestRepository?.selection).toEqual({ kind: "stash", objectName: "bbb222" });

    cleanup();
    await act(async () => {
      await setup.dispose();
    });
  });

  it("selects the created stash when the command refresh follows up on a pre-command read", async () => {
    const recording = createRecordingClient(
      stashList([stashLine(0, "aaa111", "WIP on main: abc123 old work")]),
    );
    let handlerRan = false;
    const cleanup = registerCommandHandler({
      commandId: "stash.create",
      operationLabel: "Create stash",
      handler: async () => {
        recording.setStashes(
          stashList([
            stashLine(0, "bbb222", "WIP on main: ccc333 new work"),
            stashLine(1, "aaa111", "WIP on main: abc123 old work"),
          ]),
        );
        handlerRan = true;

        return { steps: [] };
      },
    });
    const setup = await renderHarness(recording.client);

    await waitFor(setup, () => (handle?.rows.length ?? 0) === 1);

    recording.holdNextStashRead();
    let preCommandRead: Promise<unknown> | undefined;

    await act(async () => {
      preCommandRead = latestRepository?.refreshStatus();
    });

    await waitFor(setup, () => recording.isStashReadHeld());

    await runAction("stash.create");
    renderOpenModal();

    await act(async () => {
      createInput?.onCreate({ message: "new work", includeUntracked: false });
    });
    await waitFor(setup, () => handlerRan);
    await waitFor(setup, () => latestRepository?.isRefreshing === true);

    await act(async () => {
      recording.releaseStashRead();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    await waitFor(
      setup,
      () => handle?.selected?.objectName === "bbb222" && handle?.selectedIndex === 0,
    );
    await act(async () => {
      await preCommandRead;
    });

    expect(handle?.selectedIndex).toBe(0);
    expect(latestRepository?.selection).toEqual({ kind: "stash", objectName: "bbb222" });

    cleanup();
    await act(async () => {
      await setup.dispose();
    });
  });

  it("confirms pop with the drop label and a destructive description", async () => {
    const requests: CommandRequest[] = [];
    const cleanup = registerCapture("stash.pop", requests);
    const { client } = createRecordingClient(
      stashList([stashLine(0, "aaa111", "WIP on main: abc123 work")]),
    );
    const setup = await renderHarness(client);

    await waitFor(setup, () => (handle?.rows.length ?? 0) === 1);
    await focusStashes(setup);
    await runAction("stash.pop");

    const entry = latestOverlay?.entry;

    if (entry?.kind !== "confirm") {
      throw new Error("pop confirmation is not open");
    }

    expect(entry.title).toBe("Pop stash");
    expect(entry.confirmLabel).toBe("Drop stash");
    expect(entry.destructive).toBe(true);
    expect(entry.description).toContain("stash@{0}");
    expect(entry.description).toContain("WIP on main");
    expect(requests).toHaveLength(0);

    cleanup();
    await act(async () => {
      await setup.dispose();
    });
  });

  it("targets the object name after confirming pop", async () => {
    const requests: CommandRequest[] = [];
    const cleanup = registerCapture("stash.pop", requests);
    const { client } = createRecordingClient(
      stashList([stashLine(0, "aaa111", "WIP on main: abc123 work")]),
    );
    const setup = await renderHarness(client);

    await waitFor(setup, () => (handle?.rows.length ?? 0) === 1);
    await focusStashes(setup);
    await runAction("stash.pop");

    const entry = latestOverlay?.entry;

    await act(async () => {
      if (entry?.kind === "confirm") {
        entry.onConfirm();
      }
    });
    await waitFor(setup, () => requests.length === 1);

    expect(requests[0]?.target).toEqual({ kind: "stash", objectName: "aaa111" });

    cleanup();
    await act(async () => {
      await setup.dispose();
    });
  });

  it("opens the delete modal and drops the object name, not the index", async () => {
    const requests: CommandRequest[] = [];
    const cleanup = registerCapture("stash.delete", requests);
    const { client } = createRecordingClient(
      stashList([stashLine(2, "aaa111", "WIP on main: abc123 work")]),
    );
    const setup = await renderHarness(client);

    await waitFor(setup, () => (handle?.rows.length ?? 0) === 1);
    await focusStashes(setup);
    await runAction("stash.delete");
    renderOpenModal();

    expect(deleteInput?.stash.objectName).toBe("aaa111");

    await act(async () => {
      deleteInput?.onDrop("aaa111");
    });
    await waitFor(setup, () => requests.length === 1);

    expect(requests[0]?.target).toEqual({ kind: "stash", objectName: "aaa111" });

    cleanup();
    await act(async () => {
      await setup.dispose();
    });
  });
});

describe("useStashes focus refresh", () => {
  it("refreshes the stash list when the region gains focus", async () => {
    const { client, calls } = createRecordingClient(
      stashList([stashLine(0, "aaa111", "WIP on main: abc123 work")]),
    );
    const setup = await renderHarness(client);

    await waitFor(setup, () => (handle?.rows.length ?? 0) === 1);

    const before = calls.filter((key) => key === STASH_LIST_KEY).length;

    await focusStashes(setup);
    await waitFor(setup, () => calls.filter((key) => key === STASH_LIST_KEY).length > before);

    expect(calls.filter((key) => key === STASH_LIST_KEY).length).toBeGreaterThan(before);

    await act(async () => {
      await setup.dispose();
    });
  });
});
