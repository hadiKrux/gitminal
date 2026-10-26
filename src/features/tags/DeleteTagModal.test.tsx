import { beforeEach, describe, expect, it } from "bun:test";
import type { SelectRenderable } from "@opentui/core";
import { RGBA } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import { resetActionRegistry, resolveActionHandler } from "@/app/hooks/useAction";
import { registerCommandHandler, resetCommandRunner } from "@/domain/commands/commands.runner";
import type { CommandRequest } from "@/domain/commands/commands.types";
import type { TagRowRecord } from "@/domain/git/git.types";
import { DEFAULT_THEME_NAME, THEME_FLAVORS } from "@/domain/theme/theme.catppuccin";
import { DeleteTagModal } from "@/features/tags/DeleteTagModal";
import {
  DELETE_TAG_REMOTE_SELECT_ID,
  DELETE_TAG_SCOPE_SELECT_ID,
} from "@/features/tags/DeleteTagModal.constants";
import { AppTestProviders } from "@/test/app.harness";
import { createFakeGitClient } from "@/test/git.fake";
import { MODAL_FRAME_ID } from "@/ui/ModalFrame.constants";

/** Requests captured by the registered tag.delete handler. */
let capturedRequests: CommandRequest[] = [];

/**
 * Builds one merged tag row for a delete-modal test.
 *
 * @param overrides - Row fields to override.
 * @returns The merged row.
 */
function tagRow(overrides: Partial<TagRowRecord> = {}): TagRowRecord {
  return {
    name: "v1.0.0",
    objectType: "commit",
    targetOid: "abc123",
    subject: "initial commit",
    local: true,
    remotes: ["origin", "upstream"],
    state: "both",
    ...overrides,
  };
}

/**
 * Renders the delete modal for one row.
 *
 * @param row - Row to delete.
 * @returns The renderer setup.
 */
async function renderDelete(row: TagRowRecord): Promise<Awaited<ReturnType<typeof testRender>>> {
  const setup = await testRender(
    <AppTestProviders gitClient={createFakeGitClient().client}>
      <DeleteTagModal row={row} onClose={() => {}} />
    </AppTestProviders>,
    { width: 100, height: 26 },
  );

  await act(async () => {
    await setup.renderOnce();
  });

  return setup;
}

/**
 * Changes a native select to one option index.
 *
 * @param setup - Renderer setup.
 * @param id - Select renderable id.
 * @param index - Option index to select.
 */
async function selectOption(
  setup: Awaited<ReturnType<typeof testRender>>,
  id: string,
  index: number,
): Promise<void> {
  await act(async () => {
    const select = setup.renderer.root.findDescendantById(id) as SelectRenderable | null;

    select?.setSelectedIndex(index);
  });
  await act(async () => {
    await setup.renderOnce();
  });
}

/**
 * Asserts a footer action's focus state through its background token.
 *
 * @param setup - Renderer setup.
 * @param text - Button label text.
 * @param focused - Whether the button should render the focused background.
 */
function expectActionFocused(
  setup: Awaited<ReturnType<typeof testRender>>,
  text: string,
  focused: boolean,
): void {
  const tokens = THEME_FLAVORS[DEFAULT_THEME_NAME].tokens;
  const expected = focused ? tokens.selection : tokens.border;
  const frame = setup.captureSpans();
  let found: { bg: RGBA } | undefined;

  for (const line of frame.lines) {
    for (const span of line.spans) {
      if (span.text.includes(text)) {
        found = span;
      }
    }
  }

  expect(found?.bg.equals(RGBA.fromHex(expected))).toBe(true);
}

/**
 * Focuses the modal frame and renders once.
 *
 * @param setup - Renderer setup.
 */
async function focusFrame(setup: Awaited<ReturnType<typeof testRender>>): Promise<void> {
  await act(async () => {
    setup.renderer.root.findDescendantById(MODAL_FRAME_ID)?.focus();
  });
  await act(async () => {
    await setup.renderOnce();
  });
}

/**
 * Runs one overlay action and renders the result.
 *
 * @param setup - Renderer setup.
 * @param actionId - Action id.
 */
async function runOverlayAction(
  setup: Awaited<ReturnType<typeof testRender>>,
  actionId: string,
): Promise<void> {
  await act(async () => {
    resolveActionHandler(actionId, "overlay")?.();
  });
  await act(async () => {
    await setup.renderOnce();
  });
}

/**
 * Registers a capture-only tag.delete handler. *
 * @returns The registration cleanup.
 */
function registerCapture(): () => void {
  return registerCommandHandler({
    commandId: "tag.delete",
    operationLabel: "Delete tag",
    handler: async (context) => {
      capturedRequests.push(context.request);

      return { steps: [] };
    },
  });
}

beforeEach(() => {
  resetActionRegistry();
  resetCommandRunner();
  capturedRequests = [];
});

describe("DeleteTagModal", () => {
  it("offers local and local-and-remote scopes with Cancel focused by default", async () => {
    const setup = await renderDelete(tagRow());
    const frame = setup.captureCharFrame();

    expect(frame).toContain("Delete locally");
    expect(frame).toContain("Delete locally and from a remote");
    expect(frame).not.toContain("Delete from remote only");
    expect(setup.renderer.root.findDescendantById(DELETE_TAG_REMOTE_SELECT_ID)).toBeUndefined();

    expectActionFocused(setup, "Cancel", true);
    expectActionFocused(setup, "Delete tag", false);

    await selectOption(setup, DELETE_TAG_SCOPE_SELECT_ID, 1);

    expect(setup.renderer.root.findDescendantById(DELETE_TAG_REMOTE_SELECT_ID)).toBeDefined();

    await act(async () => {
      await setup.dispose();
    });
  });

  it("offers remote-only deletion only when the tag is absent locally", async () => {
    const setup = await renderDelete(
      tagRow({ local: false, remotes: ["origin"], state: "remote" }),
    );
    const frame = setup.captureCharFrame();

    expect(frame).toContain("Delete from remote only");
    expect(frame).not.toContain("Delete locally");
    expect(frame).toContain("Remote: origin");
    expect(setup.renderer.root.findDescendantById(DELETE_TAG_REMOTE_SELECT_ID)).toBeUndefined();

    await act(async () => {
      await setup.dispose();
    });
  });

  it("explains an unavailable remote scope with not on any remote", async () => {
    const setup = await renderDelete(tagRow({ remotes: [], state: "local-only" }));

    expect(setup.captureCharFrame()).toContain("not on any remote");

    await selectOption(setup, DELETE_TAG_SCOPE_SELECT_ID, 1);

    const frame = setup.captureCharFrame();

    expect(frame).toContain("not on any remote");
    expect(frame).toContain("Cancel");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("names the selected remote in the consequence text", async () => {
    const setup = await renderDelete(tagRow());

    await selectOption(setup, DELETE_TAG_SCOPE_SELECT_ID, 1);
    await selectOption(setup, DELETE_TAG_REMOTE_SELECT_ID, 1);

    const frame = setup.captureCharFrame();

    expect(frame).toContain("locally and from upstream");
    expect(frame).toContain("points to is kept.");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("submits the local scope with an empty remote form value", async () => {
    const cleanup = registerCapture();
    const setup = await renderDelete(tagRow());
    const activate = resolveActionHandler("nav.activate", "overlay");
    const focusDelete = resolveActionHandler("nav.left", "overlay");

    await act(async () => {
      focusDelete?.();
    });
    await act(async () => {
      activate?.();
    });

    expect(capturedRequests[0]).toEqual({
      commandId: "tag.delete",
      target: { kind: "tag", name: "v1.0.0" },
      formValues: { scope: "local", remote: "" },
    });

    cleanup();
    await act(async () => {
      await setup.dispose();
    });
  });

  it("submits the proposed remote for a local-and-remote scope", async () => {
    const cleanup = registerCapture();
    const setup = await renderDelete(tagRow());

    await selectOption(setup, DELETE_TAG_SCOPE_SELECT_ID, 1);
    await selectOption(setup, DELETE_TAG_REMOTE_SELECT_ID, 1);

    const focusDelete = resolveActionHandler("nav.left", "overlay");
    const activate = resolveActionHandler("nav.activate", "overlay");

    await act(async () => {
      focusDelete?.();
    });
    await act(async () => {
      activate?.();
    });

    expect(capturedRequests[0]?.formValues).toEqual({
      scope: "local-remote",
      remote: "upstream",
    });

    cleanup();
    await act(async () => {
      await setup.dispose();
    });
  });

  it("cycles the keyboard focus through the scope, remote, and footer controls", async () => {
    const setup = await renderDelete(tagRow());

    await selectOption(setup, DELETE_TAG_SCOPE_SELECT_ID, 1);
    await focusFrame(setup);

    await runOverlayAction(setup, "nav.up");

    expect(setup.renderer.currentFocusedRenderable?.id).toBe(MODAL_FRAME_ID);

    await runOverlayAction(setup, "nav.activate");

    expect(setup.renderer.currentFocusedRenderable?.id).toBe(DELETE_TAG_REMOTE_SELECT_ID);

    await focusFrame(setup);
    await runOverlayAction(setup, "nav.up");
    await runOverlayAction(setup, "nav.activate");

    expect(setup.renderer.currentFocusedRenderable?.id).toBe(DELETE_TAG_SCOPE_SELECT_ID);

    await focusFrame(setup);
    await runOverlayAction(setup, "nav.down");
    await runOverlayAction(setup, "nav.down");
    await runOverlayAction(setup, "nav.down");

    expectActionFocused(setup, "Delete tag", true);
    expectActionFocused(setup, "Cancel", false);

    await runOverlayAction(setup, "nav.right");

    expectActionFocused(setup, "Delete tag", false);
    expectActionFocused(setup, "Cancel", true);

    await runOverlayAction(setup, "nav.left");

    expectActionFocused(setup, "Delete tag", true);
    expectActionFocused(setup, "Cancel", false);

    await act(async () => {
      await setup.dispose();
    });
  });
});
