import { beforeEach, describe, expect, it } from "bun:test";
import { type CapturedFrame, type CapturedSpan, RGBA } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import { act, type ReactNode } from "react";
import { resetActionRegistry, useAction } from "@/app/hooks/useAction";
import { useConsoleLog } from "@/app/hooks/useConsoleLog";
import { useFocusState } from "@/app/hooks/useFocusState";
import { useHotkeys } from "@/app/hooks/useHotkeys";
import { useOverlay } from "@/app/hooks/useOverlay";
import { useStatus } from "@/app/hooks/useStatus";
import { DEFAULT_THEME_NAME, THEME_FLAVORS } from "@/domain/theme/theme.catppuccin";
import { OverlayHost } from "@/features/overlays/OverlayHost";
import { ShellTestProviders } from "@/test/shell.harness";
import { ModalActions } from "@/ui/ModalActions";
import { ModalFrame } from "@/ui/ModalFrame";

/** Console context value read from the hook, without importing an app provider type. */
type ConsoleLogValue = ReturnType<typeof useConsoleLog>;

/** Focus context value read from the hook, without importing a shell type. */
type FocusValue = ReturnType<typeof useFocusState>;

/** Latest overlay context captured by the harness. */
let latestOverlay: ReturnType<typeof useOverlay> | undefined;

/** Latest status context captured by the harness. */
let latestStatus: ReturnType<typeof useStatus> | undefined;

/** Latest console context captured by the harness. */
let latestConsole: ConsoleLogValue | undefined;

/** Latest focus projection captured by the harness. */
let latestFocus: FocusValue | undefined;

/**
 * Renders the overlay host with the keyboard dispatcher and the global close handler.
 *
 * @returns The harness layout.
 */
function HostHarness(): ReactNode {
  const overlay = useOverlay();

  latestOverlay = overlay;
  latestStatus = useStatus();
  latestConsole = useConsoleLog();
  latestFocus = useFocusState();
  useHotkeys();
  useAction("overlay.close", { scope: "global", owner: "app" }, overlay.close);

  return (
    <box flexDirection="column" width={100} height={30}>
      <box id="background-target" focusable height={1}>
        <text>background</text>
      </box>
      <box id="region-console" focusable height={1}>
        <text>console</text>
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
        <>
          <box id="modal-field" focusable height={1}>
            <text>field</text>
          </box>
          <box id="modal-field-2" focusable height={1}>
            <text>second field</text>
          </box>
        </>
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
  latestConsole = undefined;
  latestFocus = undefined;

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
  key: "enter" | "escape" | "left" | "right" | "tab",
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

    if (key === "tab") {
      setup.mockInput.pressTab();
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
  latestFocus = undefined;
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

  it("runs onConfirm from Enter when an exact destructive label is enabled", async () => {
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
          latestOverlay?.close();
        },
      });
    });
    await renderOnce(setup);

    expect(setup.captureCharFrame()).not.toContain("exact F-15 label required");

    await pressKey(setup, "right");
    expectActionFocused(setup, "Overwrite remote", true);

    await pressKey(setup, "enter");

    expect(confirmations).toBe(1);
    expect(latestOverlay?.entry).toBeNull();

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

  it("keeps Tab inside the modal and shows the modal footer keys", async () => {
    const setup = await renderHost();

    await renderOnce(setup);
    await focusBackground(setup);

    await act(async () => {
      latestOverlay?.open({
        kind: "modal",
        id: "test.modal",
        initialFocusId: "modal-field",
        render: ({ close }) => <TestModal close={close} withField />,
      });
    });
    await renderOnce(setup);

    const focusedBefore = setup.renderer.currentFocusedRenderable?.id;

    expect(focusedBefore).toBe("modal-field");

    await pressKey(setup, "tab");

    expect(setup.renderer.currentFocusedRenderable?.id).toBe("modal-field");
    expect(setup.renderer.currentFocusedRenderable?.id).not.toBe("modal-field-2");
    expect(setup.renderer.currentFocusedRenderable?.id).not.toBe("background-target");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("renders an error, dismisses it on Esc, and opens the linked console entry", async () => {
    const setup = await renderHost();

    await renderOnce(setup);
    await focusBackground(setup);

    await act(async () => {
      latestOverlay?.showError({
        commandId: "remote.fetch",
        operationLabel: "Fetch",
        message: "fatal: Authentication failed",
        details: "fatal: Authentication failed",
        consoleEntryId: "entry-1",
      });
    });
    await renderOnce(setup);

    const frame = setup.captureCharFrame();

    expect(frame).toContain("Fetch failed");
    expect(frame).toContain("fatal: Authentication failed");
    expect(frame).toContain("Dismiss");
    expect(frame).toContain("Open console entry");
    expect(latestStatus?.hintMode).toBe("modal");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("error-overlay");

    await pressKey(setup, "escape");

    expect(latestOverlay?.errorDetail).toBeNull();
    expect(latestStatus?.hintMode).toBe("context");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("background-target");

    await act(async () => {
      latestOverlay?.showError({
        commandId: "remote.fetch",
        operationLabel: "Fetch",
        message: "fatal: Authentication failed",
        details: "fatal: Authentication failed",
        consoleEntryId: "entry-1",
      });
    });
    await renderOnce(setup);

    await pressKey(setup, "right");
    expectActionFocused(setup, "Open console entry", true);

    await pressKey(setup, "enter");

    expect(latestOverlay?.errorDetail).toBeNull();
    expect(latestConsole?.isOpen).toBe(true);
    expect(latestConsole?.pendingSelectionEntryId).toBe("entry-1");

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      await setup.renderOnce();
    });

    expect(latestFocus?.state.activeRegion).toBe("console");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("dismisses the error and re-runs the command from Retry", async () => {
    const setup = await renderHost();
    let retries = 0;

    await renderOnce(setup);
    await focusBackground(setup);

    await act(async () => {
      latestOverlay?.showError({
        commandId: "remote.fetch",
        operationLabel: "Fetch",
        message: "fatal: network down",
        details: "fatal: network down",
        consoleEntryId: "entry-1",
        retry: () => {
          retries += 1;
        },
      });
    });
    await renderOnce(setup);

    await pressKey(setup, "right");
    await pressKey(setup, "right");

    expectActionFocused(setup, "Retry", true);

    await pressKey(setup, "enter");

    expect(retries).toBe(1);
    expect(latestOverlay?.errorDetail).toBeNull();

    await act(async () => {
      await setup.dispose();
    });
  });

  it("cannot confirm a destructive entry whose label is not exact", async () => {
    const setup = await renderHost();
    let confirmations = 0;

    await renderOnce(setup);
    await focusBackground(setup);

    await act(async () => {
      latestOverlay?.confirm({
        title: "Delete branch",
        description: "feature/x will be deleted.",
        confirmLabel: "OK",
        destructive: true,
        onConfirm: () => {
          confirmations += 1;
        },
      });
    });
    await renderOnce(setup);

    const frame = setup.captureCharFrame();

    expect(frame).toContain("F-15");
    expect(frame).toContain("exact F-15 label required");

    await pressKey(setup, "right");

    expectActionFocused(setup, "OK", true);

    await pressKey(setup, "enter");

    expect(confirmations).toBe(0);
    expect(latestOverlay?.entry).not.toBeNull();

    await act(async () => {
      await setup.dispose();
    });
  });

  it("does not pull focus back to the initial field when a queued error arrives", async () => {
    const setup = await renderHost();

    await renderOnce(setup);
    await focusBackground(setup);

    await act(async () => {
      latestOverlay?.open({
        kind: "modal",
        id: "test.modal",
        initialFocusId: "modal-field",
        render: ({ close }) => <TestModal close={close} withField />,
      });
    });
    await renderOnce(setup);

    await act(async () => {
      setup.renderer.root.findDescendantById("modal-field-2")?.focus();
    });
    await renderOnce(setup);

    expect(setup.renderer.currentFocusedRenderable?.id).toBe("modal-field-2");

    await act(async () => {
      latestOverlay?.showError({
        commandId: "remote.pull",
        operationLabel: "Pull",
        message: "fatal: queued",
        details: "fatal: queued",
        consoleEntryId: "entry-1",
      });
    });
    await renderOnce(setup);

    expect(setup.renderer.currentFocusedRenderable?.id).toBe("modal-field-2");
    expect(latestOverlay?.errorDetail?.message).toBe("fatal: queued");

    await act(async () => {
      latestOverlay?.close();
    });
    await renderOnce(setup);

    expect(setup.captureCharFrame()).toContain("Pull failed");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("replaces the visible error details when a new failure arrives", async () => {
    const setup = await renderHost();

    await renderOnce(setup);
    await focusBackground(setup);

    await act(async () => {
      latestOverlay?.showError({
        commandId: "remote.fetch",
        operationLabel: "Fetch",
        message: "fatal: first",
        details: "fatal: first",
        consoleEntryId: null,
      });
    });
    await renderOnce(setup);

    expect(setup.captureCharFrame()).toContain("fatal: first");

    await act(async () => {
      latestOverlay?.showError({
        commandId: "remote.pull",
        operationLabel: "Pull",
        message: "fatal: second",
        details: "fatal: second",
        consoleEntryId: null,
      });
    });
    await renderOnce(setup);

    const frame = setup.captureCharFrame();

    expect(frame).toContain("Pull failed");
    expect(frame).toContain("fatal: second");
    expect(frame).not.toContain("fatal: first");

    await act(async () => {
      await setup.dispose();
    });
  });
});
