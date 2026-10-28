import { beforeEach, describe, expect, it } from "bun:test";
import type { InputRenderable } from "@opentui/core";
import { MouseEvent } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import { resetActionRegistry, resolveActionHandler } from "@/app/hooks/useAction";
import { useRepository } from "@/app/hooks/useRepository";
import { DEFAULT_CONFIG } from "@/domain/config/config.defaults";
import type { GitClient } from "@/domain/git/git.types";
import type { RepositorySnapshot } from "@/domain/repository/repository.types";
import { CreateStashModal } from "@/features/stashes/CreateStashModal";
import { CREATE_STASH_INCLUDE_CHECKBOX_ID } from "@/features/stashes/CreateStashModal.constants";
import { AppTestProviders } from "@/test/app.harness";
import { createFakeGitClient } from "@/test/git.fake";
import { ICONS } from "@/theme/icons";

/** Stable message field id used by the modal test. */
const MESSAGE_FIELD_ID = "test-stash-message";

/** Status output with one staged change. */
const TRACKED_STATUS =
  "# branch.oid abc123\u0000# branch.head main\u0000" +
  "1 M. N... 100644 100644 100644 aaaaaaa bbbbbbb staged.txt\u0000";

/** Status output whose only change is an untracked file. */
const UNTRACKED_ONLY_STATUS = "# branch.oid abc123\u0000# branch.head main\u0000? new.txt\u0000";

/** Status output for a clean working tree. */
const CLEAN_STATUS = "# branch.oid abc123\u0000# branch.head main\u0000";

/** Status output for an unborn branch. */
const UNBORN_STATUS = "# branch.oid (initial)\u0000# branch.head main\u0000";

/** Latest snapshot observed through the probe. */
let latestSnapshot: RepositorySnapshot | null = null;

/** Values captured from a valid submit. */
let submitted: { readonly message: string; readonly includeUntracked: boolean } | undefined;

/** Number of times the modal requested a close. */
let closedCount = 0;

/**
 * Captures the current snapshot so a test can wait for the first read.
 *
 * @returns Nothing.
 */
function RepositoryProbe(): null {
  latestSnapshot = useRepository().snapshot;

  return null;
}

/**
 * Builds a fake client with a scripted status answer.
 *
 * @param statusOutput - Canonical status output.
 * @returns The git client.
 */
function createClient(statusOutput: string): GitClient {
  const fake = createFakeGitClient();

  fake.setStatusOutput(statusOutput);

  return fake.client;
}

/**
 * Renders the create modal with the provider stack.
 *
 * @param options - Client, prefill, checkbox default, and callback overrides.
 * @returns The renderer setup.
 */
async function renderModal(options: {
  readonly statusOutput?: string;
  readonly initialMessage?: string;
  readonly includeUntrackedByDefault?: boolean;
}): Promise<Awaited<ReturnType<typeof testRender>>> {
  latestSnapshot = null;
  submitted = undefined;
  closedCount = 0;

  const setup = await testRender(
    <AppTestProviders gitClient={createClient(options.statusOutput ?? TRACKED_STATUS)}>
      <RepositoryProbe />
      <CreateStashModal
        messageFieldId={MESSAGE_FIELD_ID}
        initialMessage={options.initialMessage ?? "WIP on main: abc123 initial commit"}
        includeUntrackedByDefault={
          options.includeUntrackedByDefault ?? DEFAULT_CONFIG.stash.includeUntrackedByDefault
        }
        onClose={() => {
          closedCount += 1;
        }}
        onCreate={(values) => {
          submitted = values;
        }}
      />
    </AppTestProviders>,
    { width: 100, height: 26 },
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
 * Runs the focused footer action through the overlay registry.
 */
async function activatePrimary(): Promise<void> {
  await act(async () => {
    resolveActionHandler("nav.activate", "overlay")?.();
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
  });
}

/**
 * Types into the message field.
 *
 * @param setup - Renderer setup.
 * @param value - Text to insert.
 */
async function typeMessage(
  setup: Awaited<ReturnType<typeof testRender>>,
  value: string,
): Promise<void> {
  await act(async () => {
    const input = setup.renderer.root.findDescendantById(
      MESSAGE_FIELD_ID,
    ) as InputRenderable | null;

    input?.focus();
    input?.insertText(value);
  });
  await act(async () => {
    await setup.renderOnce();
  });
}

/**
 * Clicks a control by id.
 *
 * @param setup - Renderer setup.
 * @param id - Renderable id.
 */
async function click(setup: Awaited<ReturnType<typeof testRender>>, id: string): Promise<void> {
  await act(async () => {
    const box = setup.renderer.root.findDescendantById(id);

    if (box === undefined) {
      throw new Error(`${id} is missing`);
    }

    box.processMouseEvent(
      new MouseEvent(box, {
        type: "down",
        button: 0,
        x: 0,
        y: 0,
        modifiers: { shift: false, alt: false, ctrl: false },
      }),
    );
  });
  await act(async () => {
    await setup.renderOnce();
  });
}

beforeEach(() => {
  resetActionRegistry();
  latestSnapshot = null;
  submitted = undefined;
  closedCount = 0;
});

describe("CreateStashModal", () => {
  it("starts the include-untracked checkbox from the configured default", async () => {
    const checkedSetup = await renderModal({});

    await waitFor(checkedSetup, () => latestSnapshot !== null);

    expect(checkedSetup.captureCharFrame()).toContain(
      `${ICONS.checkboxOn} Include untracked files`,
    );

    await act(async () => {
      await checkedSetup.dispose();
    });

    const uncheckedSetup = await renderModal({ includeUntrackedByDefault: false });

    await waitFor(uncheckedSetup, () => latestSnapshot !== null);

    expect(uncheckedSetup.captureCharFrame()).toContain(
      `${ICONS.checkboxOff} Include untracked files`,
    );

    await act(async () => {
      await uncheckedSetup.dispose();
    });
  });

  it("shows the supplied stash message prefill", async () => {
    const setup = await renderModal({ initialMessage: "WIP on main: abc123 initial commit" });

    await waitFor(setup, () => latestSnapshot !== null);

    expect(setup.captureCharFrame()).toContain("WIP on main: abc123 initial commit");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("requires a message and closes only after a valid submit", async () => {
    const setup = await renderModal({ initialMessage: "" });

    await waitFor(setup, () => latestSnapshot !== null);
    await activatePrimary();

    expect(setup.captureCharFrame()).toContain("Enter a stash message");
    expect(submitted).toBeUndefined();
    expect(closedCount).toBe(0);

    await typeMessage(setup, "work in progress");
    await activatePrimary();

    expect(submitted).toEqual({ message: "work in progress", includeUntracked: true });
    expect(closedCount).toBe(1);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("blocks only-untracked changes until the checkbox is turned on", async () => {
    const setup = await renderModal({
      statusOutput: UNTRACKED_ONLY_STATUS,
      includeUntrackedByDefault: false,
    });

    await waitFor(setup, () => latestSnapshot !== null);

    expect(setup.captureCharFrame()).toContain(
      "only untracked changes; include untracked files to stash",
    );

    await activatePrimary();

    expect(submitted).toBeUndefined();

    await click(setup, CREATE_STASH_INCLUDE_CHECKBOX_ID);

    expect(setup.captureCharFrame()).not.toContain(
      "only untracked changes; include untracked files to stash",
    );
    expect(setup.captureCharFrame()).toContain(`${ICONS.checkboxOn} Include untracked files`);

    await activatePrimary();

    expect(submitted).toEqual({
      message: "WIP on main: abc123 initial commit",
      includeUntracked: true,
    });
    expect(closedCount).toBe(1);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("blocks a clean working tree with nothing to stash", async () => {
    const setup = await renderModal({
      statusOutput: CLEAN_STATUS,
      includeUntrackedByDefault: true,
    });

    await waitFor(setup, () => latestSnapshot !== null);

    expect(setup.captureCharFrame()).toContain("nothing to stash");

    await activatePrimary();

    expect(submitted).toBeUndefined();

    await act(async () => {
      await setup.dispose();
    });
  });

  it("blocks an empty repository with no commits yet", async () => {
    const setup = await renderModal({ statusOutput: UNBORN_STATUS });

    await waitFor(setup, () => latestSnapshot !== null);

    expect(setup.captureCharFrame()).toContain("no commits yet");

    await activatePrimary();

    expect(submitted).toBeUndefined();

    await act(async () => {
      await setup.dispose();
    });
  });
});
