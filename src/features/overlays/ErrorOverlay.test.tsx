import { beforeEach, describe, expect, it } from "bun:test";
import { RGBA } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import { resetActionRegistry } from "@/app/hooks/useAction";
import { DEFAULT_THEME_NAME, THEME_FLAVORS } from "@/domain/theme/theme.catppuccin";
import { ErrorOverlay } from "@/features/overlays/ErrorOverlay";
import type { ErrorOverlayProps } from "@/features/overlays/ErrorOverlay.types";
import { ShellTestProviders } from "@/test/shell.harness";

/**
 * Renders the error overlay with sensible defaults.
 *
 * @param overrides - Props to override.
 * @returns The renderer setup.
 */
async function renderError(
  overrides: Partial<ErrorOverlayProps> = {},
): Promise<Awaited<ReturnType<typeof testRender>>> {
  return testRender(
    <ShellTestProviders>
      <ErrorOverlay
        title="Fetch failed"
        message="fatal: Authentication failed"
        details="fatal: Authentication failed"
        consoleEntryId="entry-1"
        canRetry
        onDismiss={() => {}}
        onOpenConsole={() => {}}
        onRetry={() => {}}
        {...overrides}
      />
    </ShellTestProviders>,
    { width: 100, height: 24 },
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

describe("ErrorOverlay", () => {
  it("renders the failure, its details, and Dismiss focused by default", async () => {
    const setup = await renderError();

    await act(async () => {
      await setup.renderOnce();
    });

    const frame = setup.captureCharFrame();

    expect(frame).toContain("Fetch failed");
    expect(frame).toContain("fatal: Authentication failed");
    expect(frame).toContain("Details");
    expect(frame).toContain("Dismiss");
    expect(frame).toContain("Open console entry");
    expect(frame).toContain("Retry");
    expectActionFocused(setup, "Dismiss", true);
    expectActionFocused(setup, "Retry", false);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("omits Retry when re-running the command is not meaningful", async () => {
    const setup = await renderError({ canRetry: false });

    await act(async () => {
      await setup.renderOnce();
    });

    const frame = setup.captureCharFrame();

    expect(frame).toContain("Dismiss");
    expect(frame).not.toContain("Retry");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("disables Open console entry when no entry is linked", async () => {
    const setup = await renderError({ consoleEntryId: null });

    await act(async () => {
      await setup.renderOnce();
    });

    const frame = setup.captureCharFrame();

    expect(frame).toContain("no console entry");

    await act(async () => {
      await setup.dispose();
    });
  });
});
