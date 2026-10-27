import { beforeEach, describe, expect, it } from "bun:test";
import type { BoxRenderable, TextareaRenderable } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import { act, type ReactNode } from "react";
import { resetCommandOrchestration } from "@/app/hooks/commandRunner.state";
import { resetActionRegistry } from "@/app/hooks/useAction";
import { useDraft } from "@/app/hooks/useDraft";
import { useHotkeys } from "@/app/hooks/useHotkeys";
import { useOverlay } from "@/app/hooks/useOverlay";
import { registerCommandHandler, resetCommandRunner } from "@/domain/commands/commands.runner";
import type { CommandExecutionOutcome, CommandRequest } from "@/domain/commands/commands.types";
import type { GitClient } from "@/domain/git/git.types";
import { CommitComposer } from "@/features/composer/CommitComposer";
import {
  COMPOSER_COMMIT_BUTTON_ID,
  COMPOSER_MENU_SELECT_ID,
  COMPOSER_SCROLL_ID,
  COMPOSER_TEXTAREA_ID,
} from "@/features/composer/composer.constants";
import { AppTestProviders } from "@/test/app.harness";
import { createFakeGitClient, fakeGitResult } from "@/test/git.fake";
import { ICONS } from "@/theme/icons";

/** Status output with one staged file. */
const STAGED_STATUS =
  "# branch.oid abc123\0# branch.head main\0" +
  "1 M. N... 100644 100644 100644 aaaaaaa bbbbbbb staged.txt\0";

/** Status output for a clean working tree. */
const CLEAN_STATUS = "# branch.oid abc123\0# branch.head main\0";

/** Status output for an unborn branch with no changes. */
const UNBORN_CLEAN_STATUS = "# branch.oid (initial)\0# branch.head main\0";

let latestDraft: ReturnType<typeof useDraft> | undefined;
let latestOverlay: ReturnType<typeof useOverlay> | undefined;

/**
 * Renders the composer with the shared keyboard dispatcher.
 *
 * @returns The composer.
 */
function Harness(): ReactNode {
  useHotkeys();

  return <CommitComposer />;
}

/**
 * Reads the draft the composer writes.
 *
 * @returns Nothing.
 */
function DraftProbe(): null {
  latestDraft = useDraft();

  return null;
}

/**
 * Projects the open overlay entry the way the overlay host does.
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
 * Builds a fake client with an optional status and identity override.
 *
 * @param input - Status output and identity overrides.
 * @returns The git client.
 */
function createClient(
  input: { readonly statusOutput?: string; readonly missingName?: boolean } = {},
): GitClient {
  const fake = createFakeGitClient();

  fake.setStatusOutput(input.statusOutput ?? STAGED_STATUS);

  return {
    ...fake.client,
    invoke: async (options) => {
      const key = options.args.join(" ");

      if (key === "config user.name" && input.missingName === true) {
        return fakeGitResult("", false);
      }

      if (key === "log -1 --format=%h HEAD") {
        return fakeGitResult("abc123\n");
      }

      if (key === "log -1 --format=%B HEAD") {
        return fakeGitResult("previous message\n");
      }

      return await fake.client.invoke(options);
    },
  };
}

/**
 * Renders the composer harness.
 *
 * @param client - Injected git client.
 * @param size - Terminal size; the right-pane row cap follows it.
 * @returns The renderer setup.
 */
async function renderComposer(
  client: GitClient = createClient(),
  size: { readonly width: number; readonly height: number } = { width: 120, height: 40 },
): Promise<Awaited<ReturnType<typeof testRender>>> {
  latestDraft = undefined;
  latestOverlay = undefined;

  const setup = await testRender(
    <AppTestProviders gitClient={client}>
      <Harness />
      <DraftProbe />
      <OverlayProbe />
    </AppTestProviders>,
    { width: size.width, height: size.height, kittyKeyboard: true },
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
 * Waits for the initial repository read.
 *
 * @param setup - Renderer setup.
 * @param stagedCount - Expected staged count.
 */
async function waitForStaged(
  setup: Awaited<ReturnType<typeof testRender>>,
  stagedCount: number,
): Promise<void> {
  await waitFor(setup, () => setup.captureCharFrame().includes(`${stagedCount} staged`));
}

/**
 * Focuses the composer textarea.
 *
 * @param setup - Renderer setup.
 */
async function focusTextarea(setup: Awaited<ReturnType<typeof testRender>>): Promise<void> {
  await act(async () => {
    readTextarea(setup)?.focus();
  });
  await act(async () => {
    await setup.renderOnce();
  });
}

/**
 * Focuses the right-pane region frame.
 *
 * @param setup - Renderer setup.
 */
async function focusRegion(setup: Awaited<ReturnType<typeof testRender>>): Promise<void> {
  await act(async () => {
    setup.renderer.root.findDescendantById("region-right-pane")?.focus();
  });
  await act(async () => {
    await setup.renderOnce();
  });
}

/**
 * Reads the textarea renderable.
 *
 * @param setup - Renderer setup.
 * @returns The textarea, or undefined when it is missing.
 */
function readTextarea(
  setup: Awaited<ReturnType<typeof testRender>>,
): TextareaRenderable | undefined {
  return setup.renderer.root.findDescendantById(COMPOSER_TEXTAREA_ID) as
    | TextareaRenderable
    | undefined;
}

/**
 * Types text through the terminal input path.
 *
 * @param setup - Renderer setup.
 * @param text - Text to type.
 */
async function typeText(
  setup: Awaited<ReturnType<typeof testRender>>,
  text: string,
): Promise<void> {
  await act(async () => {
    await setup.mockInput.typeText(text, 0);
  });
  await act(async () => {
    await setup.renderOnce();
  });
}

/**
 * Registers one capture handler that returns the supplied outcome.
 *
 * @param commandId - Command to capture.
 * @param requests - Captured requests.
 * @param outcome - Outcome to return.
 * @returns The registration cleanup.
 */
function registerCapture(
  commandId: string,
  requests: CommandRequest[],
  outcome: CommandExecutionOutcome,
): () => void {
  return registerCommandHandler({
    commandId,
    operationLabel: commandId,
    handler: async (context) => {
      requests.push(context.request);

      return outcome;
    },
  });
}

beforeEach(() => {
  resetActionRegistry();
  resetCommandRunner();
  resetCommandOrchestration();
  latestDraft = undefined;
  latestOverlay = undefined;
});

describe("CommitComposer states", () => {
  it("renders the placeholder, identity line, staged count, and state blocks", async () => {
    const setup = await renderComposer();

    await waitForStaged(setup, 1);

    const frame = setup.captureCharFrame();
    const rows = frame.split("\n");
    const textarea = readTextarea(setup);
    const identityRow = rows.findIndex((row) => row.includes("Test User <test@example.com>"));
    const stagedRow = rows.findIndex((row) => row.includes("1 staged"));

    expect(frame).toContain("Commit");
    expect(frame).toContain("Commit message...");
    // The field carries no label row of its own.
    expect(frame).not.toContain("Message");
    // Identity and staged count share one row directly below the message field,
    // identity on the left and the staged count on the right.
    expect(identityRow).toBe(stagedRow);
    expect(identityRow).toBe((textarea?.y ?? -2) + (textarea?.height ?? 0));
    expect(rows[identityRow]?.indexOf("Test User")).toBeLessThan(
      rows[identityRow]?.indexOf("1 staged") ?? -1,
    );

    await act(async () => {
      await setup.dispose();
    });
  });

  it("reads Nothing to commit and disables the textarea with no staged files", async () => {
    const setup = await renderComposer(createClient({ statusOutput: CLEAN_STATUS }));

    await waitForStaged(setup, 0);

    expect(setup.captureCharFrame()).toContain("Nothing to commit");
    expect(readTextarea(setup)?.focusable).toBe(false);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("names the missing identity value", async () => {
    const setup = await renderComposer(createClient({ missingName: true }));

    await waitFor(setup, () => setup.captureCharFrame().includes("0 staged"));

    expect(setup.captureCharFrame()).toContain("Git identity not configured: set user.name");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("shows message required only after a commit attempt with an empty draft", async () => {
    const setup = await renderComposer();

    await waitForStaged(setup, 1);
    await focusTextarea(setup);

    expect(setup.captureCharFrame()).not.toContain("message required");

    await act(async () => {
      setup.mockInput.pressKey("s", { ctrl: true });
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(setup.captureCharFrame()).toContain("message required");

    await typeText(setup, "fix");

    expect(setup.captureCharFrame()).not.toContain("message required");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("shows message required when the Commit button is pressed with an empty draft", async () => {
    const setup = await renderComposer();

    await waitForStaged(setup, 1);

    const button = setup.renderer.root.findDescendantById(COMPOSER_COMMIT_BUTTON_ID) as
      | BoxRenderable
      | undefined;

    expect(button).toBeDefined();

    await act(async () => {
      await setup.mockMouse.click(button?.screenX ?? 0, button?.screenY ?? 0);
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(setup.captureCharFrame()).toContain("message required");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("fills the rows the panel leaves and scrolls when the draft outgrows them", async () => {
    const setup = await renderComposer();

    await waitForStaged(setup, 1);

    await act(async () => {
      latestDraft?.setDraft("one\ntwo\nthree");
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(readTextarea(setup)?.height).toBe(36);
    expect(setup.renderer.root.findDescendantById(COMPOSER_SCROLL_ID)).toBeUndefined();

    await act(async () => {
      latestDraft?.setDraft(Array.from({ length: 40 }, (_, index) => `line ${index}`).join("\n"));
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(readTextarea(setup)?.height).toBe(36);
    expect(setup.renderer.root.findDescendantById(COMPOSER_SCROLL_ID)).toBeDefined();

    await act(async () => {
      await setup.dispose();
    });
  });

  it("fills the message field inside an 11-row right-pane slot", async () => {
    const setup = await renderComposer(createClient({ statusOutput: CLEAN_STATUS }), {
      width: 60,
      height: 11,
    });

    await waitForStaged(setup, 0);

    await act(async () => {
      latestDraft?.setDraft(Array.from({ length: 12 }, (_, index) => `line ${index}`).join("\n"));
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(readTextarea(setup)?.height).toBe(7);
    expect(setup.captureCharFrame()).toContain("Nothing to commit");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("keeps the staged count on the right and truncates the identity on a narrow row", async () => {
    const setup = await renderComposer(createClient(), { width: 34, height: 20 });

    await waitForStaged(setup, 1);

    const frame = setup.captureCharFrame();
    const metaRow = frame.split("\n").find((row) => row.includes("1 staged")) ?? "";

    expect(metaRow).toContain("Test User <test@");
    expect(metaRow).toContain(ICONS.ellipsis);
    expect(metaRow).not.toContain("test@example.com");
    expect(metaRow.indexOf("Test User")).toBeLessThan(metaRow.indexOf("1 staged"));

    await act(async () => {
      await setup.dispose();
    });
  });

  it("re-sizes the message field when the terminal shrinks and grows again", async () => {
    const setup = await renderComposer();

    await waitForStaged(setup, 1);

    await act(async () => {
      latestDraft?.setDraft(Array.from({ length: 12 }, (_, index) => `line ${index}`).join("\n"));
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(readTextarea(setup)?.height).toBe(36);

    await act(async () => {
      setup.resize(120, 11);
      await setup.renderOnce();
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(readTextarea(setup)?.height).toBe(7);
    expect(setup.captureCharFrame()).toContain("1 staged");
    expect(setup.captureCharFrame()).toContain("Commit");

    await act(async () => {
      setup.resize(120, 40);
      await setup.renderOnce();
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(readTextarea(setup)?.height).toBe(36);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("shows the committing spinner while the command runs", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const cleanup = registerCommandHandler({
      commandId: "commit.submit",
      operationLabel: "Commit",
      handler: async (): Promise<CommandExecutionOutcome> => {
        await gate;

        return { steps: [] };
      },
    });
    const setup = await renderComposer();

    await waitForStaged(setup, 1);
    await focusTextarea(setup);
    await act(async () => {
      latestDraft?.setDraft("message");
    });
    await act(async () => {
      await setup.renderOnce();
    });

    await act(async () => {
      setup.mockInput.pressKey("s", { ctrl: true });
    });
    await waitFor(setup, () => setup.captureCharFrame().includes("Committing..."));

    expect(setup.captureCharFrame()).toContain("Committing...");

    await act(async () => {
      release();
      await new Promise((resolve) => setTimeout(resolve, 10));
      await setup.renderOnce();
    });

    cleanup();
    await act(async () => {
      await setup.dispose();
    });
  });
});

describe("CommitComposer keyboard", () => {
  it("inserts a newline on Enter and two spaces on Tab, and outdents on Shift+Tab", async () => {
    const setup = await renderComposer();

    await waitForStaged(setup, 1);
    await focusTextarea(setup);
    await typeText(setup, "subject");

    await act(async () => {
      setup.mockInput.pressEnter();
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(latestDraft?.draft).toBe("subject\n");

    await act(async () => {
      setup.mockInput.pressTab();
    });
    await act(async () => {
      await setup.renderOnce();
    });

    await typeText(setup, "body");

    expect(latestDraft?.draft).toBe("subject\n  body");

    await act(async () => {
      setup.mockInput.pressTab({ shift: true });
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(latestDraft?.draft).toBe("subject\nbody");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("opens the options menu with Alt+. while typing and types a plain period", async () => {
    const setup = await renderComposer();

    await waitForStaged(setup, 1);
    await focusTextarea(setup);
    await typeText(setup, "fix");

    await act(async () => {
      setup.mockInput.pressKey(".", { meta: true });
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(latestOverlay?.entry?.kind).toBe("modal");
    expect(setup.captureCharFrame()).toContain("Commit options");

    await act(async () => {
      latestOverlay?.close();
    });
    await act(async () => {
      await setup.renderOnce();
    });

    await focusTextarea(setup);
    await act(async () => {
      setup.mockInput.pressKey(".");
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(latestDraft?.draft).toBe("fix.");
    expect(latestOverlay?.entry).toBeNull();

    await act(async () => {
      await setup.dispose();
    });
  });

  it("opens the options menu with a plain period only when the region frame is focused", async () => {
    const setup = await renderComposer();

    await waitForStaged(setup, 1);
    await focusRegion(setup);

    await act(async () => {
      setup.mockInput.pressKey(".");
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(latestOverlay?.entry?.kind).toBe("modal");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("dispatches commit.submit on Ctrl+S and Commit", async () => {
    const requests: CommandRequest[] = [];
    const cleanup = registerCapture("commit.submit", requests, { steps: [] });
    const setup = await renderComposer();

    await waitForStaged(setup, 1);
    await focusTextarea(setup);
    await typeText(setup, "fix the parser");

    await act(async () => {
      setup.mockInput.pressKey("s", { ctrl: true });
    });
    await waitFor(setup, () => requests.length === 1);

    expect(requests[0]?.commandId).toBe("commit.submit");
    expect(requests[0]?.target).toEqual({ kind: "none" });
    expect(requests[0]?.formValues?.message).toBe("fix the parser");

    cleanup();
    await act(async () => {
      await setup.dispose();
    });
  });

  it("dispatches form.submit on Ctrl+Enter", async () => {
    const requests: CommandRequest[] = [];
    const cleanup = registerCapture("commit.submit", requests, { steps: [] });
    const setup = await renderComposer();

    await waitForStaged(setup, 1);
    await focusTextarea(setup);
    await typeText(setup, "fix");

    await act(async () => {
      setup.mockInput.pressEnter({ ctrl: true });
    });
    await waitFor(setup, () => requests.length === 1);

    expect(requests[0]?.commandId).toBe("commit.submit");

    cleanup();
    await act(async () => {
      await setup.dispose();
    });
  });

  it("clears the draft after a successful commit", async () => {
    const cleanup = registerCapture("commit.submit", [], { steps: [] });
    const setup = await renderComposer();

    await waitForStaged(setup, 1);
    await focusTextarea(setup);
    await typeText(setup, "fix");

    await act(async () => {
      setup.mockInput.pressKey("s", { ctrl: true });
    });
    await waitFor(setup, () => latestDraft?.draft === "");

    expect(latestDraft?.draft).toBe("");

    cleanup();
    await act(async () => {
      await setup.dispose();
    });
  });

  it("keeps the draft and names the hook bypass in the error overlay", async () => {
    const cleanup = registerCapture("commit.submit", [], {
      steps: [
        {
          argv: ["git", "commit", "-m", "fix"],
          exitCode: 1,
          durationMs: 1,
          stdout: "",
          stderr: "husky - pre-commit hook failed",
        },
      ],
      failed: true,
    });
    const setup = await renderComposer();

    await waitForStaged(setup, 1);
    await focusTextarea(setup);
    await typeText(setup, "fix");

    await act(async () => {
      setup.mockInput.pressKey("s", { ctrl: true });
    });
    await waitFor(setup, () => latestOverlay?.errorDetail !== null);

    expect(latestDraft?.draft).toBe("fix");
    expect(latestOverlay?.errorDetail?.details).toContain("pre-commit");
    expect(latestOverlay?.errorDetail?.details).toContain("--no-verify");

    cleanup();
    await act(async () => {
      await setup.dispose();
    });
  });
});

describe("CommitComposer menu dispatch", () => {
  it("shows no previous commit for amend in an empty repository", async () => {
    const setup = await renderComposer(createClient({ statusOutput: UNBORN_CLEAN_STATUS }));

    await waitForStaged(setup, 0);
    await focusRegion(setup);

    await act(async () => {
      setup.mockInput.pressKey(".");
    });
    await act(async () => {
      await setup.renderOnce();
    });

    const select = setup.renderer.root.findDescendantById(COMPOSER_MENU_SELECT_ID) as
      | { setSelectedIndex: (value: number) => void }
      | undefined;

    await act(async () => {
      select?.setSelectedIndex(2);
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(setup.captureCharFrame()).toContain("no previous commit");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("keeps the Amending indicator after a failed amend", async () => {
    const cleanup = registerCapture("commit.amend", [], {
      steps: [
        {
          argv: ["git", "commit", "--amend", "-m", "previous message"],
          exitCode: 1,
          durationMs: 1,
          stdout: "",
          stderr: "fatal: amend failed",
        },
      ],
      failed: true,
    });
    const setup = await renderComposer();

    await waitForStaged(setup, 1);
    await focusRegion(setup);

    await act(async () => {
      setup.mockInput.pressKey(".");
    });
    await act(async () => {
      await setup.renderOnce();
    });

    const select = setup.renderer.root.findDescendantById(COMPOSER_MENU_SELECT_ID) as
      | { setSelectedIndex: (value: number) => void; selectCurrent: () => void }
      | undefined;

    await act(async () => {
      select?.setSelectedIndex(2);
    });
    await waitFor(setup, () => latestDraft?.draft === "previous message");
    await act(async () => {
      select?.selectCurrent();
    });
    await waitFor(setup, () => latestOverlay?.errorDetail !== null);
    await act(async () => {
      latestOverlay?.dismissError();
    });
    await act(async () => {
      await setup.renderOnce();
    });

    const frame = setup.captureCharFrame();

    expect(frame).toContain("Amending abc123");
    expect(latestDraft?.draft).toBe("previous message");

    cleanup();
    await act(async () => {
      await setup.dispose();
    });
  });

  it("dispatches all four variants through the menu as distinct command ids", async () => {
    const requests: CommandRequest[] = [];
    const cleanups = [
      registerCapture("commit.submit", requests, { steps: [] }),
      registerCapture("commit.submitNoVerify", requests, { steps: [] }),
      registerCapture("commit.amend", requests, { steps: [] }),
      registerCapture("commit.amendNoVerify", requests, { steps: [] }),
    ];
    const setup = await renderComposer();

    await waitForStaged(setup, 1);

    for (const index of [0, 1, 2, 3]) {
      await act(async () => {
        latestDraft?.setDraft("message");
      });
      await act(async () => {
        await setup.renderOnce();
      });
      await focusRegion(setup);
      await act(async () => {
        setup.mockInput.pressKey(".");
      });
      await act(async () => {
        await setup.renderOnce();
      });

      const select = setup.renderer.root.findDescendantById(COMPOSER_MENU_SELECT_ID) as
        | { setSelectedIndex: (value: number) => void; selectCurrent: () => void }
        | undefined;

      await act(async () => {
        select?.setSelectedIndex(index);
        select?.selectCurrent();
      });
      await waitFor(setup, () => requests.length === index + 1);
    }

    expect(requests.map((request) => request.commandId)).toEqual([
      "commit.submit",
      "commit.submitNoVerify",
      "commit.amend",
      "commit.amendNoVerify",
    ]);

    for (const cleanup of cleanups) {
      cleanup();
    }

    await act(async () => {
      await setup.dispose();
    });
  });
});
