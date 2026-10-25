import { beforeEach, describe, expect, it } from "bun:test";
import { RGBA } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import { resetActionRegistry } from "@/app/hooks/useAction";
import { CONFIRM_LABELS } from "@/domain/commands/confirm.labels";
import { DEFAULT_THEME_NAME, THEME_FLAVORS } from "@/domain/theme/theme.catppuccin";
import { ConfirmModal } from "@/features/overlays/ConfirmModal";
import { ShellTestProviders } from "@/test/shell.harness";

/**
 * Renders one confirmation modal.
 *
 * @param label - Primary action label.
 * @param destructive - Whether Cancel starts focused.
 * @returns The renderer setup.
 */
async function renderConfirm(
  label: string,
  destructive: boolean,
): Promise<Awaited<ReturnType<typeof testRender>>> {
  return testRender(
    <ShellTestProviders>
      <ConfirmModal
        title="Confirm action"
        description="feature/x -> origin/feature/x. Remote commits can be lost."
        confirmLabel={label}
        destructive={destructive}
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    </ShellTestProviders>,
    { width: 80, height: 20 },
  );
}

/**
 * Asserts a footer action's focus state through its background token.
 *
 * @param setup - Renderer setup.
 * @param text - Action label.
 * @param focused - Whether the action should render the focused background.
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

beforeEach(() => {
  resetActionRegistry();
});

/** Explicit destructiveness of every F-15 label, so the table cannot infer it from a key name. */
const LABEL_DESTRUCTIVENESS: readonly (readonly [string, boolean])[] = Object.freeze([
  [CONFIRM_LABELS.discardChanges, true],
  [CONFIRM_LABELS.deleteLocalBranch, true],
  [CONFIRM_LABELS.deleteLocalAndRemoteBranch, true],
  [CONFIRM_LABELS.dropStash, true],
  [CONFIRM_LABELS.deleteTag, true],
  [CONFIRM_LABELS.deleteWorktree, true],
  [CONFIRM_LABELS.forcePushSafely, false],
  [CONFIRM_LABELS.overwriteRemote, true],
]);

describe("ConfirmModal", () => {
  it("renders each documented confirm label with Cancel and the scope text", async () => {
    for (const [label, destructive] of LABEL_DESTRUCTIVENESS) {
      const setup = await renderConfirm(label, destructive);

      await act(async () => {
        await setup.renderOnce();
      });

      const frame = setup.captureCharFrame();

      expect(frame, label).toContain(label);
      expect(frame, label).toContain("Cancel");
      expect(frame, label).toContain("feature/x -> origin/feature/x");
      expect(frame, label).not.toContain("OK");
      expect(frame, label).not.toContain("Yes");

      await act(async () => {
        await setup.dispose();
      });
    }
  });

  it("defaults every destructive label to Cancel and a safe label to the primary action", async () => {
    for (const [label, destructive] of LABEL_DESTRUCTIVENESS) {
      const setup = await renderConfirm(label, destructive);

      await act(async () => {
        await setup.renderOnce();
      });

      expectActionFocused(setup, "Cancel", destructive);
      expectActionFocused(setup, label, !destructive);

      await act(async () => {
        await setup.dispose();
      });
    }
  });

  it("renders a visible warning and disables the primary action for an unrecognized destructive label", async () => {
    const setup = await renderConfirm("OK", true);

    await act(async () => {
      await setup.renderOnce();
    });

    const frame = setup.captureCharFrame();

    expect(frame).toContain("OK");
    expect(frame).toContain("F-15");
    expect(frame).toContain("exact F-15 label required");
    expect(frame).toContain("Cancel");

    await act(async () => {
      await setup.dispose();
    });
  });
});
