import { beforeEach, describe, expect, it } from "bun:test";
import { RGBA } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import { resetActionRegistry, resolveActionHandler } from "@/app/hooks/useAction";
import type { StashRecord } from "@/domain/git/git.types";
import { DEFAULT_THEME_NAME, THEME_FLAVORS } from "@/domain/theme/theme.catppuccin";
import { DeleteStashModal } from "@/features/stashes/DeleteStashModal";
import { ShellTestProviders } from "@/test/shell.harness";

/** Stash shown by the delete modal. */
const STASH: StashRecord = {
  index: "stash@{3}",
  objectName: "abc123def456",
  subject: "work in progress",
  sourceBranch: "main",
  committedAt: 1_700_000_000,
};

/** Object name captured from the drop callback. */
let droppedObjectName: string | undefined;

/** Number of times the modal requested a close. */
let closedCount = 0;

/**
 * Renders the delete confirmation.
 *
 * @returns The renderer setup.
 */
async function renderModal(): Promise<Awaited<ReturnType<typeof testRender>>> {
  droppedObjectName = undefined;
  closedCount = 0;

  const setup = await testRender(
    <ShellTestProviders>
      <DeleteStashModal
        stash={STASH}
        onClose={() => {
          closedCount += 1;
        }}
        onDrop={(objectName) => {
          droppedObjectName = objectName;
        }}
      />
    </ShellTestProviders>,
    { width: 100, height: 24 },
  );

  await act(async () => {
    await setup.renderOnce();
  });

  return setup;
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
 * Runs one overlay action and flushes a render.
 *
 * @param setup - Renderer setup.
 * @param actionId - Overlay-scope action id.
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

beforeEach(() => {
  resetActionRegistry();
  droppedObjectName = undefined;
  closedCount = 0;
});

describe("DeleteStashModal", () => {
  it("names the index and message and starts with Cancel focused", async () => {
    const setup = await renderModal();
    const frame = setup.captureCharFrame();

    expect(frame).toContain("Stash: stash@{3}");
    expect(frame).toContain("Message: work in progress");
    expect(frame).toContain("This drops the stash and keeps no copy.");
    expect(frame).toContain("Drop stash");
    expectActionFocused(setup, "Cancel", true);
    expectActionFocused(setup, "Drop stash", false);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("cancels by default and drops the immutable object name only when confirmed", async () => {
    const setup = await renderModal();

    await runOverlayAction(setup, "nav.activate");

    expect(droppedObjectName).toBeUndefined();
    expect(closedCount).toBe(1);

    await runOverlayAction(setup, "nav.left");
    await runOverlayAction(setup, "nav.activate");

    expect(droppedObjectName).toBe(STASH.objectName);
    expect(droppedObjectName).not.toBe(STASH.index);
    expect(closedCount).toBe(2);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("moves between the drop and cancel actions with Up and Down", async () => {
    const setup = await renderModal();

    await runOverlayAction(setup, "nav.up");

    expectActionFocused(setup, "Drop stash", true);
    expectActionFocused(setup, "Cancel", false);

    await runOverlayAction(setup, "nav.down");

    expectActionFocused(setup, "Drop stash", false);
    expectActionFocused(setup, "Cancel", true);

    await runOverlayAction(setup, "nav.up");
    await runOverlayAction(setup, "nav.activate");

    expect(droppedObjectName).toBe(STASH.objectName);

    await act(async () => {
      await setup.dispose();
    });
  });
});
