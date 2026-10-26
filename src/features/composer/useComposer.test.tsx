import { beforeEach, describe, expect, it, spyOn } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act, type ReactNode } from "react";
import { resetCommandOrchestration } from "@/app/hooks/commandRunner.state";
import {
  hasRegisteredAction,
  registerAction,
  resetActionRegistry,
  resolveActionHandler,
} from "@/app/hooks/useAction";
import { readActionAvailability } from "@/app/hooks/useActionAvailability";
import { useOverlay } from "@/app/hooks/useOverlay";
import { useRepository } from "@/app/hooks/useRepository";
import { useStatus } from "@/app/hooks/useStatus";
import { executeCommitAmend, executeCommitAmendNoVerify } from "@/domain/commands/commands.commit";
import { registerCommandHandler, resetCommandRunner } from "@/domain/commands/commands.runner";
import type { CommandExecutionOutcome } from "@/domain/commands/commands.types";
import type { GitClient } from "@/domain/git/git.types";
import { CommitOptionsMenu } from "@/features/composer/CommitOptionsMenu";
import { AMEND_READ_FAILED } from "@/features/composer/composer.amend";
import { readComposerCommandState } from "@/features/composer/composer.commands";
import { useComposer } from "@/features/composer/useComposer";
import { AppTestProviders } from "@/test/app.harness";
import { createFakeGitClient, fakeGitResult } from "@/test/git.fake";

/** Status output with one staged file. */
const STAGED_STATUS =
  "# branch.oid abc123\0# branch.head main\0" +
  "1 M. N... 100644 100644 100644 aaaaaaa bbbbbbb staged.txt\0";

/** Status output for a clean working tree with one commit. */
const CLEAN_STATUS = "# branch.oid abc123\0# branch.head main\0";

/** Status output for an unborn branch with one staged file. */
const UNBORN_STAGED_STATUS =
  "# branch.oid (initial)\0# branch.head main\0" +
  "1 A. N... 000000 100644 100644 0000000 bbbbbbb staged.txt\0";

type ComposerHandle = ReturnType<typeof useComposer>;

let handle: ComposerHandle | undefined;
let latestOverlay: ReturnType<typeof useOverlay> | undefined;
let latestRepository: ReturnType<typeof useRepository> | undefined;
let latestStatus: ReturnType<typeof useStatus> | undefined;

/**
 * Renders the composer hook inside its region frame.
 *
 * @returns The harness content.
 */
function Harness(): ReactNode {
  handle = useComposer({
    renderOptionsMenu: (input) => <CommitOptionsMenu {...input} />,
  });
  latestRepository = useRepository();
  latestStatus = useStatus();

  return (
    <box {...handle.regionProps} flexDirection="column" width={100} height={30}>
      <text>{`staged:${handle.stagedCount}`}</text>
    </box>
  );
}

/**
 * Projects the single overlay entry the way the overlay host does.
 *
 * @returns The open modal content, or null.
 */
function OverlayProbe(): ReactNode {
  const overlay = useOverlay();

  latestOverlay = overlay;

  if (overlay.entry === null || overlay.entry.kind !== "modal") {
    return null;
  }

  return <>{overlay.entry.render({ close: overlay.close })}</>;
}

/**
 * Builds a fake client with status, identity, and amend-read overrides.
 *
 * @param input - Status output plus optional missing identity values.
 * @returns The client and its recorded argument keys.
 */
function createClient(
  input: {
    readonly statusOutput?: string;
    readonly missingName?: boolean;
    readonly missingEmail?: boolean;
    readonly commitGate?: Promise<void>;
    readonly headReadGate?: Promise<void>;
  } = {},
) {
  const fake = createFakeGitClient();
  const calls: string[] = [];

  fake.setStatusOutput(input.statusOutput ?? STAGED_STATUS);

  const client: GitClient = {
    ...fake.client,
    invoke: async (options) => {
      const key = options.args.join(" ");

      calls.push(key);

      if (key === "config user.name" && input.missingName === true) {
        return fakeGitResult("", false);
      }

      if (key === "config user.email" && input.missingEmail === true) {
        return fakeGitResult("", false);
      }

      if (key === "log -1 --format=%h HEAD") {
        await input.headReadGate;

        return fakeGitResult("abc123\n");
      }

      if (key === "log -1 --format=%B HEAD") {
        return fakeGitResult("previous subject\n\nbody line\n");
      }

      if (key.startsWith("commit ")) {
        await input.commitGate;

        return fakeGitResult("");
      }

      return await fake.client.invoke(options);
    },
  };

  return { client, calls };
}

/**
 * Renders the harness with the full provider stack.
 *
 * @param client - Injected git client.
 * @returns The renderer setup.
 */
async function renderHarness(client: GitClient): Promise<Awaited<ReturnType<typeof testRender>>> {
  handle = undefined;
  latestOverlay = undefined;
  latestRepository = undefined;
  latestStatus = undefined;

  const setup = await testRender(
    <AppTestProviders gitClient={client}>
      <Harness />
      <OverlayProbe />
    </AppTestProviders>,
    { width: 120, height: 40 },
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

beforeEach(() => {
  resetActionRegistry();
  resetCommandRunner();
  resetCommandOrchestration();
  handle = undefined;
  latestOverlay = undefined;
  latestRepository = undefined;
  latestStatus = undefined;
});

describe("readComposerCommandState", () => {
  const identity = { name: "Test", email: "test@example.com" };
  const base = {
    draft: "fix",
    stagedCount: 1,
    identity,
    headExists: true,
    amend: false,
    committing: false,
  };

  it("allows a normal commit with staged files, a message, and an identity", () => {
    expect(readComposerCommandState(base)).toEqual({ available: true, reason: null });
  });

  it("blocks a normal commit with no staged files", () => {
    expect(readComposerCommandState({ ...base, stagedCount: 0 })).toEqual({
      available: false,
      reason: "nothing-to-commit",
    });
  });

  it("blocks empty and whitespace-only messages", () => {
    expect(readComposerCommandState({ ...base, draft: "" })).toEqual({
      available: false,
      reason: "message-required",
    });
    expect(readComposerCommandState({ ...base, draft: "  \n\t" })).toEqual({
      available: false,
      reason: "message-required",
    });
  });

  it("blocks a missing user name and a missing user email", () => {
    expect(
      readComposerCommandState({ ...base, identity: { name: null, email: "test@example.com" } })
        .reason,
    ).toBe("missing-git-identity");
    expect(
      readComposerCommandState({ ...base, identity: { name: "Test", email: null } }).reason,
    ).toBe("missing-git-identity");
  });

  it("blocks every variant while a commit is running", () => {
    expect(readComposerCommandState({ ...base, committing: true }).reason).toBe(
      "operation-in-progress",
    );
  });

  it("allows amend without staged files and blocks it without HEAD", () => {
    expect(readComposerCommandState({ ...base, amend: true, stagedCount: 0 })).toEqual({
      available: true,
      reason: null,
    });
    expect(readComposerCommandState({ ...base, amend: true, headExists: false }).reason).toBe(
      "no-commits-yet",
    );
  });
});

describe("useComposer registration", () => {
  it("registers only the composer-scoped actions in the right pane", async () => {
    const consoleError = spyOn(console, "error").mockImplementation(() => {});
    const { client } = createClient();
    const setup = await renderHarness(client);

    await waitFor(setup, () => (handle?.stagedCount ?? 0) === 1);

    for (const actionId of [
      "commit.submit",
      "commit.submitNoVerify",
      "commit.amend",
      "commit.amendNoVerify",
      "commit.options",
      "form.submit",
      "nav.left",
      "nav.right",
      "nav.activate",
    ]) {
      expect(hasRegisteredAction(actionId, "right-pane"), actionId).toBe(true);
    }

    expect(hasRegisteredAction("app.quit", "global")).toBe(false);
    expect(hasRegisteredAction("commit.focus", "global")).toBe(false);
    expect(hasRegisteredAction("focus.next", "global")).toBe(false);
    expect(hasRegisteredAction("app.refresh", "global")).toBe(false);
    expect(hasRegisteredAction("commit.submit", "global")).toBe(false);
    expect(consoleError).not.toHaveBeenCalled();

    consoleError.mockRestore();
    await act(async () => {
      await setup.dispose();
    });
  });

  it("rejects a duplicate commit handler instead of competing", async () => {
    const consoleError = spyOn(console, "error").mockImplementation(() => {});
    const { client } = createClient();
    const setup = await renderHarness(client);

    await waitFor(setup, () => (handle?.stagedCount ?? 0) === 1);

    const cleanup = registerAction("commit.submit", { scope: "right-pane" }, () => {});

    expect(consoleError).toHaveBeenCalled();

    cleanup();
    consoleError.mockRestore();
    await act(async () => {
      await setup.dispose();
    });
  });

  it("publishes the same enablement the footer reads", async () => {
    const { client } = createClient();
    const setup = await renderHarness(client);

    await waitFor(setup, () => (handle?.stagedCount ?? 0) === 1);

    expect(readActionAvailability("right-pane", "commit.submit")).toBe(false);
    expect(readActionAvailability("right-pane", "commit.options")).toBe(true);

    await act(async () => {
      handle?.setDraft("fix");
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(readActionAvailability("right-pane", "commit.submit")).toBe(true);
    expect(readActionAvailability("right-pane", "commit.amend")).toBe(true);

    await act(async () => {
      await setup.dispose();
    });
  });
});

describe("useComposer draft and failure preservation", () => {
  it("keeps the draft after a failed commit and does not touch staged state", async () => {
    const { client } = createClient();
    const cleanup = registerCommandHandler({
      commandId: "commit.submit",
      operationLabel: "Commit",
      handler: async (): Promise<CommandExecutionOutcome> => ({
        steps: [
          {
            argv: ["git", "commit", "-m", "fix"],
            exitCode: 1,
            durationMs: 1,
            stdout: "",
            stderr: "fatal: pre-commit hook failed",
          },
        ],
        failed: true,
      }),
    });
    const setup = await renderHarness(client);

    await waitFor(setup, () => (handle?.stagedCount ?? 0) === 1);

    await act(async () => {
      handle?.setDraft("fix the thing");
    });
    await act(async () => {
      resolveActionHandler("commit.submit", "right-pane")?.();
    });
    await waitFor(setup, () => latestOverlay?.errorDetail !== null);

    expect(handle?.draft).toBe("fix the thing");
    expect(handle?.stagedCount).toBe(1);
    expect(latestOverlay?.errorDetail?.details).toContain("--no-verify");

    cleanup();
    await act(async () => {
      await setup.dispose();
    });
  });

  it("clears the draft only after a successful commit", async () => {
    const { client } = createClient();
    const cleanup = registerCommandHandler({
      commandId: "commit.submit",
      operationLabel: "Commit",
      handler: async (): Promise<CommandExecutionOutcome> => ({ steps: [] }),
    });
    const setup = await renderHarness(client);

    await waitFor(setup, () => (handle?.stagedCount ?? 0) === 1);

    await act(async () => {
      handle?.setDraft("fix the thing");
    });
    await act(async () => {
      resolveActionHandler("commit.submit", "right-pane")?.();
    });
    await waitFor(setup, () => handle?.draft === "");

    expect(handle?.draft).toBe("");

    cleanup();
    await act(async () => {
      await setup.dispose();
    });
  });

  it("keeps the draft while the selection changes", async () => {
    const { client } = createClient();
    const setup = await renderHarness(client);

    await waitFor(setup, () => (handle?.stagedCount ?? 0) === 1);

    await act(async () => {
      handle?.setDraft("draft survives");
      latestRepository?.setSelection({ kind: "commit", oid: "abc123" });
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(handle?.draft).toBe("draft survives");
    expect(handle).not.toHaveProperty("mode");
    expect(handle).not.toHaveProperty("subMode");

    await act(async () => {
      await setup.dispose();
    });
  });
});

describe("useComposer amend session", () => {
  it("loads the previous message once into an empty composer and restores the empty draft", async () => {
    const { client, calls } = createClient();
    const setup = await renderHarness(client);

    await waitFor(setup, () => (handle?.stagedCount ?? 0) === 1);

    await act(async () => {
      handle?.openOptions();
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(latestOverlay?.entry?.kind).toBe("modal");

    await act(async () => {
      handle?.highlightVariant("commit.amend");
    });
    await waitFor(setup, () => handle?.draft === "previous subject\n\nbody line");

    expect(handle?.amendShortHash).toBe("abc123");
    expect(calls.filter((key) => key === "log -1 --format=%h HEAD")).toHaveLength(1);

    await act(async () => {
      handle?.highlightVariant("commit.amendNoVerify");
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(calls.filter((key) => key === "log -1 --format=%h HEAD")).toHaveLength(1);

    await act(async () => {
      handle?.dismissMenu();
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(handle?.draft).toBe("");
    expect(handle?.amendShortHash).toBeNull();

    await act(async () => {
      await setup.dispose();
    });
  });

  it("keeps a message the user already typed when amend is selected", async () => {
    const { client } = createClient();
    const setup = await renderHarness(client);

    await waitFor(setup, () => (handle?.stagedCount ?? 0) === 1);

    await act(async () => {
      handle?.setDraft("my own message");
    });
    await act(async () => {
      handle?.openOptions();
      handle?.highlightVariant("commit.amend");
    });
    await waitFor(setup, () => handle?.amendShortHash === "abc123");

    expect(handle?.draft).toBe("my own message");

    await act(async () => {
      handle?.dismissMenu();
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(handle?.draft).toBe("my own message");
    expect(handle?.amendShortHash).toBeNull();

    await act(async () => {
      await setup.dispose();
    });
  });

  it("restores the pre-menu draft when a normal variant is highlighted again", async () => {
    const { client } = createClient();
    const setup = await renderHarness(client);

    await waitFor(setup, () => (handle?.stagedCount ?? 0) === 1);

    await act(async () => {
      handle?.openOptions();
      handle?.highlightVariant("commit.amend");
    });
    await waitFor(setup, () => handle?.draft === "previous subject\n\nbody line");

    await act(async () => {
      handle?.highlightVariant("commit.submit");
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(handle?.draft).toBe("");
    expect(handle?.amendShortHash).toBeNull();

    await act(async () => {
      await setup.dispose();
    });
  });

  it("keeps the amend indicator after the menu closes through Run", async () => {
    const { client } = createClient();
    const cleanup = registerCommandHandler({
      commandId: "commit.amend",
      operationLabel: "Amend commit",
      handler: async (): Promise<CommandExecutionOutcome> => ({
        steps: [
          {
            argv: ["git", "commit", "--amend", "-m", "previous subject"],
            exitCode: 1,
            durationMs: 1,
            stdout: "",
            stderr: "fatal: amend failed",
          },
        ],
        failed: true,
      }),
    });
    const setup = await renderHarness(client);

    await waitFor(setup, () => (handle?.stagedCount ?? 0) === 1);

    await act(async () => {
      handle?.openOptions();
      handle?.highlightVariant("commit.amend");
    });
    await waitFor(setup, () => handle?.amendShortHash === "abc123");

    await act(async () => {
      handle?.runVariant("commit.amend");
      latestOverlay?.close();
    });
    await waitFor(setup, () => latestOverlay?.errorDetail !== null);
    await act(async () => {
      latestOverlay?.dismissError();
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(handle?.amendShortHash).toBe("abc123");
    expect(handle?.draft).toBe("previous subject\n\nbody line");

    cleanup();
    await act(async () => {
      await setup.dispose();
    });
  });

  it("runs amend with no staged files through the captured command id", async () => {
    const { client } = createClient({ statusOutput: CLEAN_STATUS });
    const requests: string[] = [];
    const cleanup = registerCommandHandler({
      commandId: "commit.amend",
      operationLabel: "Amend commit",
      handler: async (context): Promise<CommandExecutionOutcome> => {
        requests.push(context.request.commandId);

        return { steps: [] };
      },
    });
    const setup = await renderHarness(client);

    await waitFor(setup, () => (handle?.stagedCount ?? 0) === 0);

    await act(async () => {
      handle?.setDraft("amended message");
      handle?.runVariant("commit.amend");
    });
    await waitFor(setup, () => requests.length === 1);

    expect(requests).toEqual(["commit.amend"]);
    expect(handle?.draft).toBe("");

    cleanup();
    await act(async () => {
      await setup.dispose();
    });
  });

  it("surfaces the amend reason when the client has no HEAD", async () => {
    const { client } = createClient({ statusOutput: CLEAN_STATUS });
    const setup = await renderHarness(client);

    await waitFor(setup, () => (handle?.stagedCount ?? 0) === 0);

    await act(async () => {
      handle?.setDraft("message");
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(handle?.primaryReason).toBe("nothing-to-commit");

    await act(async () => {
      await setup.dispose();
    });
  });
});

describe("useComposer stale amend load", () => {
  it("stays silent when the menu closes before the previous message read settles", async () => {
    let releaseHeadRead: () => void = () => {};
    const headReadGate = new Promise<void>((resolve) => {
      releaseHeadRead = resolve;
    });
    const { client } = createClient({ headReadGate });
    const setup = await renderHarness(client);

    await waitFor(setup, () => (handle?.stagedCount ?? 0) === 1);

    await act(async () => {
      handle?.openOptions();
      handle?.highlightVariant("commit.amend");
    });
    await act(async () => {
      handle?.dismissMenu();
    });

    await act(async () => {
      releaseHeadRead();
      await setup.renderOnce();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      await setup.renderOnce();
    });

    expect(latestStatus?.status?.message).not.toBe(AMEND_READ_FAILED);
    expect(handle?.amendShortHash).toBeNull();
    expect(handle?.draft).toBe("");

    await act(async () => {
      await setup.dispose();
    });
  });
});

describe("useComposer direct amend", () => {
  it("loads HEAD, shows the indicator before the write, and uses the previous message directly and from the menu", async () => {
    let releaseCommit: () => void = () => {};
    const commitGate = new Promise<void>((resolve) => {
      releaseCommit = resolve;
    });
    const { client, calls } = createClient({ statusOutput: CLEAN_STATUS, commitGate });
    const messages: string[] = [];
    const cleanup = registerCommandHandler({
      commandId: "commit.amend",
      operationLabel: "Amend commit",
      handler: async (context) => {
        messages.push(String(context.request.formValues?.message ?? ""));

        return await executeCommitAmend(context);
      },
    });
    const setup = await renderHarness(client);

    await waitFor(setup, () => (handle?.stagedCount ?? 0) === 0);

    await act(async () => {
      resolveActionHandler("commit.amend", "right-pane")?.();
    });
    await waitFor(setup, () => calls.some((key) => key.startsWith("commit --amend")));

    expect(calls).toContain("log -1 --format=%h HEAD");
    expect(calls).toContain("log -1 --format=%B HEAD");
    expect(handle?.draft).toBe("previous subject\n\nbody line");
    expect(handle?.amendShortHash).toBe("abc123");

    await act(async () => {
      releaseCommit();
      await setup.renderOnce();
    });
    await waitFor(setup, () => handle?.draft === "");

    await act(async () => {
      handle?.openOptions();
      handle?.highlightVariant("commit.amend");
    });
    await waitFor(setup, () => handle?.amendShortHash === "abc123");

    await act(async () => {
      handle?.runVariant("commit.amend");
      latestOverlay?.close();
    });
    await waitFor(setup, () => messages.length === 2);

    expect(messages).toEqual(["previous subject\n\nbody line", "previous subject\n\nbody line"]);
    expect(
      calls.filter((key) => key === "commit --amend -m previous subject\n\nbody line"),
    ).toHaveLength(2);

    cleanup();
    await act(async () => {
      await setup.dispose();
    });
  });

  it("sends --no-verify with the loaded message for a direct amendNoVerify action", async () => {
    const { client, calls } = createClient({ statusOutput: CLEAN_STATUS });
    const cleanup = registerCommandHandler({
      commandId: "commit.amendNoVerify",
      operationLabel: "Amend commit without hooks",
      handler: executeCommitAmendNoVerify,
    });
    const setup = await renderHarness(client);

    await waitFor(setup, () => (handle?.stagedCount ?? 0) === 0);

    await act(async () => {
      resolveActionHandler("commit.amendNoVerify", "right-pane")?.();
    });
    await waitFor(setup, () => calls.some((key) => key.startsWith("commit --amend --no-verify")));

    expect(calls).toContain("commit --amend --no-verify -m previous subject\n\nbody line");

    cleanup();
    await act(async () => {
      await setup.dispose();
    });
  });
});

describe("useComposer empty repository", () => {
  it("allows a first commit with staged files in an unborn branch", async () => {
    const { client } = createClient({ statusOutput: UNBORN_STAGED_STATUS });
    const setup = await renderHarness(client);

    await waitFor(setup, () => (handle?.stagedCount ?? 0) === 1);

    await act(async () => {
      handle?.setDraft("initial commit");
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(handle?.primaryReason).toBeNull();
    expect(handle?.commitLabel).toBe("Commit");

    await act(async () => {
      await setup.dispose();
    });
  });
});
