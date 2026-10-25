import { beforeEach, describe, expect, it } from "bun:test";
import { type CapturedFrame, type CapturedSpan, RGBA } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import { act, type ReactNode } from "react";
import { resetActionRegistry, useAction } from "@/app/hooks/useAction";
import { useHotkeys } from "@/app/hooks/useHotkeys";
import { useOverlay } from "@/app/hooks/useOverlay";
import { useStatus } from "@/app/hooks/useStatus";
import { DEFAULT_THEME_NAME, THEME_FLAVORS } from "@/domain/theme/theme.catppuccin";
import { OverlayHost } from "@/features/overlays/OverlayHost";
import { ShellTestProviders } from "@/test/shell.harness";
import { ModalActions } from "@/ui/ModalActions";
import { ModalFrame } from "@/ui/ModalFrame";

/** Latest overlay context captured by the harness. */
let latestOverlay: ReturnType<typeof useOverlay> | undefined;

/** Latest status context captured by the harness. */
let latestStatus: ReturnType<typeof useStatus> | undefined;

/**
 * Renders the overlay host with the keyboard dispatcher and the global close handler.
 *
 * @returns The harness layout.
 */
function HostHarness(): ReactNode {
  const overlay = useOverlay();

  latestOverlay = overlay;
  latestStatus = useStatus();
  useHotkeys();
  useAction("overlay.close", { scope: "global", owner: "app" }, overlay.close);

  return (
    <box flexDirection="column" width={100} height={30}>
      <box id="background-target" focusable height={1}>
        <text>background</text>
      </box>
      <OverlayHost />
    </box>
  );
}

/**
 * Renders one modal-like content node.
 *
 * @param props - Close handler and whether the content has a focusable field.
 * @returns The modal content.
 */
function TestModal(props: { readonly close: () => void; readonly withField?: boolean }): ReactNode {
  return (
    <ModalFrame title="Test modal" width={40} height={9}>
      <text>modal body</text>
      {props.withField === true ? (
        <box id="modal-field" focusable height={1}>
          <text>field</text>
        </box>
      ) : null}
      <ModalActions actions={[{ id: "modal-close", label: "Close", onPress: props.close }]} />
    </ModalFrame>
  );
}

/**
 * Renders the overlay host harness.
 *
 * @returns The renderer setup.
 */
async function renderHost(): Promise<Awaited<ReturnType<typeof testRender>>> {
  latestOverlay = undefined;
  latestStatus = undefined;

  return testRender(
    <ShellTestProviders>
      <HostHarness />
    </ShellTestProviders>,
    { width: 100, height: 30, kittyKeyboard: true },
  );
}

/**
 * Focuses the background target and flushes the focus event.
 *
 * @param setup - Renderer setup.
 */
async function focusBackground(setup: Awaited<ReturnType<typeof testRender>>): Promise<void> {
  await act(async () => {
    setup.renderer.root.findDescendantById("background-target")?.focus();
  });
  await act(async () => {
    await setup.renderOnce();
  });
}

/**
 * Renders once inside `act`.
 *
 * @param setup - Renderer setup.
 */
async function renderOnce(setup: Awaited<ReturnType<typeof testRender>>): Promise<void> {
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
async function pressKey(
  setup: Awaited<ReturnType<typeof testRender>>,
  key: "enter" | "escape" | "left" | "right",
): Promise<void> {
  await act(async () => {
    if (key === "enter") {
      setup.mockInput.pressEnter();
      return;
    }

    if (key === "escape") {
      setup.mockInput.pressEscape();
      return;
    }

    setup.mockInput.pressArrow(key);
  });
  await renderOnce(setup);
}

/**
 * Finds the last captured span whose text contains the given text.
 *
 * The footer action is rendered after the modal title, and both may use the same label, so the
 * last match is the button.
 *
 * @param frame - Captured frame with colored spans.
 * @param text - Text the span must contain.
 * @returns The matching span.
 * @throws When no span matches.
 */
function findSpanContaining(frame: CapturedFrame, text: string): CapturedSpan {
  let found: CapturedSpan | undefined;

  for (const line of frame.lines) {
    for (const span of line.spans) {
      if (span.text.includes(text)) {
        found = span;
      }
    }
  }

  if (found === undefined) {
    throw new Error(`No captured span contains ${text}`);
  }

  return found;
}

/**
 * Asserts a modal action's focus state through its background token.
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
  const span = findSpanContaining(setup.captureSpans(), text);

  expect(span.bg.equals(RGBA.fromHex(expected))).toBe(true);
}

beforeEach(() => {
  resetActionRegistry();
});

describe("OverlayHost", () => {
  it("renders a modal, switches the footer hint mode, and applies initial focus", async () => {
    const setup = await renderHost();

    await renderOnce(setup);
    await focusBackground(setup);

    expect(latestStatus?.hintMode).toBe("context");

    await act(async () => {
      latestOverlay?.open({
        kind: "modal",
        id: "test.modal",
        initialFocusId: "modal-field",
        render: ({ close }) => <TestModal close={close} withField />,
      });
    });
    await renderOnce(setup);

    const frame = setup.captureCharFrame();

    expect(frame).toContain("Test modal");
    expect(frame).toContain("modal body");
    expect(latestStatus?.hintMode).toBe("modal");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("modal-field");

    await act(async () => {
      latestOverlay?.close();
    });
    await renderOnce(setup);

    expect(setup.captureCharFrame()).not.toContain("modal body");
    expect(latestStatus?.hintMode).toBe("context");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("background-target");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("closes the overlay on Esc and restores focus", async () => {
    const setup = await renderHost();

    await renderOnce(setup);
    await focusBackground(setup);

    await act(async () => {
      latestOverlay?.open({
        kind: "modal",
        id: "test.modal",
        render: ({ close }) => <TestModal close={close} />,
      });
    });
    await renderOnce(setup);

    expect(setup.captureCharFrame()).toContain("Test modal");

    await pressKey(setup, "escape");

    expect(latestOverlay?.entry).toBeNull();
    expect(setup.captureCharFrame()).not.toContain("Test modal");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("background-target");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("defaults a destructive confirmation to Cancel and never runs the primary action", async () => {
    const setup = await renderHost();
    let confirmations = 0;

    await renderOnce(setup);
    await focusBackground(setup);

    await act(async () => {
      latestOverlay?.confirm({
        title: "Overwrite remote",
        description: "main -> origin/main. Remote commits can be lost.",
        confirmLabel: "Overwrite remote",
        destructive: true,
        onConfirm: () => {
          confirmations += 1;
        },
      });
    });
    await renderOnce(setup);

    const frame = setup.captureCharFrame();

    expect(frame).toContain("Overwrite remote");
    expect(frame).toContain("main -> origin/main");
    expectActionFocused(setup, "Cancel", true);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("confirm-modal");

    await pressKey(setup, "enter");

    expect(confirmations).toBe(0);
    expect(latestOverlay?.entry).toBeNull();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("background-target");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("focuses the primary action for a non-destructive confirmation and moves with nav keys", async () => {
    const setup = await renderHost();
    let confirmations = 0;

    await renderOnce(setup);
    await focusBackground(setup);

    await act(async () => {
      latestOverlay?.confirm({
        title: "Force push safely",
        description: "main -> origin/main.",
        confirmLabel: "Force push safely",
        destructive: false,
        onConfirm: () => {
          confirmations += 1;
        },
      });
    });
    await renderOnce(setup);

    expectActionFocused(setup, "Force push safely", true);

    await pressKey(setup, "left");
    expectActionFocused(setup, "Cancel", true);

    await pressKey(setup, "enter");
    expect(confirmations).toBe(0);
    expect(latestOverlay?.entry).toBeNull();

    await act(async () => {
      latestOverlay?.confirm({
        title: "Force push safely",
        description: "main -> origin/main.",
        confirmLabel: "Force push safely",
        destructive: false,
        onConfirm: () => {
          confirmations += 1;
        },
      });
    });
    await renderOnce(setup);

    await pressKey(setup, "enter");

    expect(confirmations).toBe(1);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("resets confirmation focus when one confirm replaces another of opposite destructiveness", async () => {
    const setup = await renderHost();

    await renderOnce(setup);
    await focusBackground(setup);

    await act(async () => {
      latestOverlay?.confirm({
        title: "Overwrite remote",
        description: "main -> origin/main.",
        confirmLabel: "Overwrite remote",
        destructive: true,
        onConfirm: () => {},
      });
    });
    await renderOnce(setup);

    expectActionFocused(setup, "Cancel", true);

    await act(async () => {
      latestOverlay?.confirm({
        title: "Force push safely",
        description: "main -> origin/main.",
        confirmLabel: "Force push safely",
        destructive: false,
        onConfirm: () => {},
      });
    });
    await renderOnce(setup);

    expectActionFocused(setup, "Cancel", false);
    expectActionFocused(setup, "Force push safely", true);

    await act(async () => {
      latestOverlay?.confirm({
        title: "Overwrite remote",
        description: "main -> origin/main.",
        confirmLabel: "Overwrite remote",
        destructive: true,
        onConfirm: () => {},
      });
    });
    await renderOnce(setup);

    expectActionFocused(setup, "Cancel", true);

    await act(async () => {
      await setup.dispose();
    });
  });
});
