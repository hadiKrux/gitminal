import { beforeEach, describe, expect, it } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act, type ReactNode } from "react";
import { useOverlay } from "@/app/hooks/useOverlay";
import type { OverlayContextValue } from "@/app/providers/OverlayProvider.types";
import { ShellTestProviders } from "@/test/shell.harness";

/** Latest overlay context captured by the probe. */
let latestOverlay: OverlayContextValue | undefined;

/**
 * Captures the overlay context and exposes a focusable background target.
 *
 * @returns The probe content.
 */
function OverlayProbe(): ReactNode {
  const overlay = useOverlay();
  const entry = overlay.entry;

  latestOverlay = overlay;

  return (
    <>
      <box id="background-target" focusable height={1}>
        <text>background</text>
      </box>
      {entry?.kind === "modal" ? entry.render({ close: overlay.close }) : null}
    </>
  );
}

/**
 * Renders the overlay provider.
 *
 * @returns The renderer setup.
 */
async function renderOverlay(): Promise<Awaited<ReturnType<typeof testRender>>> {
  latestOverlay = undefined;

  return testRender(
    <ShellTestProviders>
      <OverlayProbe />
    </ShellTestProviders>,
    { width: 60, height: 10 },
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

beforeEach(() => {
  latestOverlay = undefined;
});

describe("OverlayProvider", () => {
  it("owns one entry at a time and replaces it when another opens", async () => {
    const setup = await renderOverlay();

    await act(async () => {
      await setup.renderOnce();
    });

    expect(latestOverlay?.isOpen).toBe(false);
    expect(latestOverlay?.entry).toBeNull();
    expect(latestOverlay?.toggleActionId).toBeNull();

    await act(async () => {
      latestOverlay?.open({
        kind: "modal",
        id: "test.modal",
        toggleActionId: "remote.more",
        render: () => <text>first modal</text>,
      });
    });

    expect(latestOverlay?.entry?.id).toBe("test.modal");
    expect(latestOverlay?.isOpen).toBe(true);
    expect(latestOverlay?.toggleActionId).toBe("remote.more");

    await act(async () => {
      latestOverlay?.open({
        kind: "modal",
        id: "test.second",
        render: () => <text>second modal</text>,
      });
    });

    expect(latestOverlay?.entry?.id).toBe("test.second");
    expect(latestOverlay?.toggleActionId).toBeNull();

    await act(async () => {
      await setup.dispose();
    });
  });

  it("restores the focus captured on open when it closes", async () => {
    const setup = await renderOverlay();

    await act(async () => {
      await setup.renderOnce();
    });
    await focusBackground(setup);

    expect(setup.renderer.currentFocusedRenderable?.id).toBe("background-target");

    await act(async () => {
      latestOverlay?.open({
        kind: "modal",
        id: "test.modal",
        initialFocusId: "inside-modal",
        render: () => <text>modal body</text>,
      });
    });

    await act(async () => {
      latestOverlay?.close();
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(latestOverlay?.entry).toBeNull();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("background-target");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("runs a close completion after the captured focus is restored", async () => {
    const setup = await renderOverlay();

    await act(async () => {
      await setup.renderOnce();
    });
    await focusBackground(setup);

    await act(async () => {
      latestOverlay?.open({
        kind: "modal",
        id: "test.modal",
        render: () => <text>modal body</text>,
      });
    });

    const focusAtCompletion: (string | null)[] = [];

    await act(async () => {
      latestOverlay?.close(() => {
        focusAtCompletion.push(setup.renderer.currentFocusedRenderable?.id ?? null);
      });
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(focusAtCompletion).toEqual(["background-target"]);
    expect(latestOverlay?.entry).toBeNull();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("background-target");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("runs a close completion once and keeps the entry it opens", async () => {
    const setup = await renderOverlay();

    await act(async () => {
      await setup.renderOnce();
    });
    await focusBackground(setup);

    await act(async () => {
      latestOverlay?.open({
        kind: "modal",
        id: "test.modal",
        render: () => <text>modal body</text>,
      });
    });

    let completions = 0;

    await act(async () => {
      latestOverlay?.close(() => {
        completions += 1;
        latestOverlay?.open({
          kind: "modal",
          id: "test.follow-up",
          render: () => <text>follow-up modal</text>,
        });
      });
    });
    await act(async () => {
      await setup.renderOnce();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(completions).toBe(1);
    expect(latestOverlay?.entry?.id).toBe("test.follow-up");
    expect(latestOverlay?.isOpen).toBe(true);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("does not run a pending completion when close is called without one", async () => {
    const setup = await renderOverlay();

    await act(async () => {
      await setup.renderOnce();
    });
    await focusBackground(setup);

    await act(async () => {
      latestOverlay?.open({
        kind: "modal",
        id: "test.modal",
        render: () => <text>modal body</text>,
      });
    });

    let completions = 0;

    await act(async () => {
      latestOverlay?.close(() => {
        completions += 1;
      });
      latestOverlay?.close();
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(completions).toBe(0);
    expect(latestOverlay?.entry).toBeNull();

    await act(async () => {
      await setup.dispose();
    });
  });

  it("discards a pending completion instead of running it on a later unrelated surface", async () => {
    const setup = await renderOverlay();

    await act(async () => {
      await setup.renderOnce();
    });
    await focusBackground(setup);

    await act(async () => {
      latestOverlay?.open({
        kind: "modal",
        id: "test.modal",
        render: () => <text>modal body</text>,
      });
    });

    let completions = 0;

    await act(async () => {
      latestOverlay?.close(() => {
        completions += 1;
      });
      latestOverlay?.showError({
        commandId: "remote.fetch",
        operationLabel: "Fetch",
        message: "fatal: unrelated",
        details: "fatal: unrelated",
        consoleEntryId: null,
      });
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(latestOverlay?.errorDetail?.message).toBe("fatal: unrelated");
    expect(completions).toBe(0);

    await act(async () => {
      latestOverlay?.dismissError();
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(latestOverlay?.isOpen).toBe(false);
    expect(completions).toBe(0);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("background-target");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("does not carry a completion into the entry that replaces the closed surface", async () => {
    const setup = await renderOverlay();

    await act(async () => {
      await setup.renderOnce();
    });
    await focusBackground(setup);

    await act(async () => {
      latestOverlay?.open({
        kind: "modal",
        id: "test.modal",
        render: () => <text>modal body</text>,
      });
    });

    let completions = 0;

    await act(async () => {
      latestOverlay?.close(() => {
        completions += 1;
      });
      latestOverlay?.open({
        kind: "modal",
        id: "test.follow-up",
        render: () => <text>follow-up modal</text>,
      });
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(latestOverlay?.entry?.id).toBe("test.follow-up");
    expect(completions).toBe(0);

    await act(async () => {
      latestOverlay?.close();
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(latestOverlay?.entry).toBeNull();
    expect(completions).toBe(0);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("treats a non-function close argument as a plain close that discards a pending completion", async () => {
    const setup = await renderOverlay();

    await act(async () => {
      await setup.renderOnce();
    });
    await focusBackground(setup);

    await act(async () => {
      latestOverlay?.open({
        kind: "modal",
        id: "test.modal",
        render: () => <text>modal body</text>,
      });
    });

    // The native mouse Cancel path passes its event, which must not be stored as a completion.
    await act(async () => {
      latestOverlay?.close({ type: "mouse" } as unknown as () => void);
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(latestOverlay?.entry).toBeNull();
    expect(latestOverlay?.isOpen).toBe(false);

    let completions = 0;

    await act(async () => {
      latestOverlay?.open({
        kind: "modal",
        id: "test.second",
        render: () => <text>second modal</text>,
      });
    });
    await act(async () => {
      latestOverlay?.close(() => {
        completions += 1;
      });
      latestOverlay?.close({ type: "mouse" } as unknown as () => void);
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(completions).toBe(0);
    expect(latestOverlay?.entry).toBeNull();

    await act(async () => {
      await setup.dispose();
    });
  });

  it("keeps the original capture when one entry replaces another", async () => {
    const setup = await renderOverlay();

    await act(async () => {
      await setup.renderOnce();
    });
    await focusBackground(setup);

    await act(async () => {
      latestOverlay?.open({
        kind: "modal",
        id: "test.modal",
        render: () => <text>first modal</text>,
      });
    });
    await act(async () => {
      latestOverlay?.open({
        kind: "confirm",
        id: "test.confirm",
        title: "Delete branch",
        description: "feature/x will be deleted.",
        confirmLabel: "Delete local branch",
        destructive: true,
        onConfirm: () => {},
      });
    });

    const entry = latestOverlay?.entry;

    expect(entry?.kind).toBe("confirm");

    await act(async () => {
      latestOverlay?.close();
    });

    expect(setup.renderer.currentFocusedRenderable?.id).toBe("background-target");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("closes only the requested entry and keeps an unrelated one open", async () => {
    const setup = await renderOverlay();

    await act(async () => {
      await setup.renderOnce();
    });

    await act(async () => {
      latestOverlay?.open({
        kind: "modal",
        id: "test.first",
        render: () => <text>first modal</text>,
      });
    });

    await act(async () => {
      latestOverlay?.closeEntry("test.other");
    });

    expect(latestOverlay?.entry?.id).toBe("test.first");

    await act(async () => {
      latestOverlay?.closeEntry("test.first");
    });

    expect(latestOverlay?.entry).toBeNull();

    await act(async () => {
      await setup.dispose();
    });
  });

  it("warns instead of throwing when a destructive label is not exact", async () => {
    const setup = await renderOverlay();

    await act(async () => {
      await setup.renderOnce();
    });

    await act(async () => {
      latestOverlay?.confirm({
        title: "Delete branch",
        description: "feature/x will be deleted.",
        confirmLabel: "OK",
        destructive: true,
        onConfirm: () => {},
      });
    });

    const entry = latestOverlay?.entry;

    expect(entry?.kind).toBe("confirm");

    if (entry?.kind === "confirm") {
      expect(entry.labelWarning).toContain("F-15");
    }

    await act(async () => {
      await setup.dispose();
    });
  });

  it("blurs the background renderable when a surface opens", async () => {
    const setup = await renderOverlay();

    await act(async () => {
      await setup.renderOnce();
    });
    await focusBackground(setup);

    expect(setup.renderer.currentFocusedRenderable?.id).toBe("background-target");

    await act(async () => {
      latestOverlay?.open({
        kind: "modal",
        id: "test.modal",
        render: () => <text>no focusable content</text>,
      });
    });

    expect(setup.renderer.currentFocusedRenderable?.id).not.toBe("background-target");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("does not blur an open modal when a stale showError callback fires", async () => {
    const setup = await renderOverlay();

    await act(async () => {
      await setup.renderOnce();
    });
    await focusBackground(setup);

    const staleShowError = latestOverlay?.showError;

    await act(async () => {
      latestOverlay?.open({
        kind: "modal",
        id: "test.modal",
        render: () => (
          <>
            <box id="modal-field" focusable height={1}>
              <text>field one</text>
            </box>
            <box id="modal-field-2" focusable height={1}>
              <text>field two</text>
            </box>
          </>
        ),
      });
    });
    await act(async () => {
      await setup.renderOnce();
    });

    await act(async () => {
      setup.renderer.root.findDescendantById("modal-field-2")?.focus();
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(setup.renderer.currentFocusedRenderable?.id).toBe("modal-field-2");

    await act(async () => {
      staleShowError?.({
        commandId: "remote.fetch",
        operationLabel: "Fetch",
        message: "fatal: queued",
        details: "fatal: queued",
        consoleEntryId: null,
      });
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(setup.renderer.currentFocusedRenderable?.id).toBe("modal-field-2");
    expect(latestOverlay?.errorDetail?.message).toBe("fatal: queued");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("keeps the error detail visible when focus moves elsewhere", async () => {
    const setup = await renderOverlay();

    await act(async () => {
      await setup.renderOnce();
    });
    await focusBackground(setup);

    await act(async () => {
      latestOverlay?.showError({
        commandId: "remote.fetch",
        operationLabel: "Fetch",
        message: "fatal: nope",
        details: "fatal: nope",
        consoleEntryId: null,
      });
    });

    expect(setup.renderer.currentFocusedRenderable).toBeNull();

    await focusBackground(setup);

    expect(latestOverlay?.errorDetail?.message).toBe("fatal: nope");
    expect(latestOverlay?.isOpen).toBe(true);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("builds a confirmation entry with a generated id and the supplied shape", async () => {
    const setup = await renderOverlay();

    await act(async () => {
      await setup.renderOnce();
    });

    let confirmations = 0;

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

    const entry = latestOverlay?.entry;

    expect(entry?.kind).toBe("confirm");
    expect(entry?.id.startsWith("overlay-confirm-")).toBe(true);

    if (entry?.kind === "confirm") {
      expect(entry.title).toBe("Force push safely");
      expect(entry.confirmLabel).toBe("Force push safely");
      expect(entry.destructive).toBe(false);
      entry.onConfirm();
    }

    expect(confirmations).toBe(1);
    expect(latestOverlay?.toggleActionId).toBeNull();

    await act(async () => {
      await setup.dispose();
    });
  });

  it("replaces a visible error instead of stacking and dismisses it", async () => {
    const setup = await renderOverlay();

    await act(async () => {
      await setup.renderOnce();
    });

    const first = {
      commandId: "remote.fetch",
      operationLabel: "Fetch",
      message: "fatal: first",
      details: "fatal: first",
      consoleEntryId: "entry-1",
    };
    const second = {
      commandId: "remote.pull",
      operationLabel: "Pull",
      message: "fatal: second",
      details: "fatal: second",
      consoleEntryId: "entry-2",
      retry: () => {},
    };

    await act(async () => {
      latestOverlay?.showError(first);
    });

    expect(latestOverlay?.errorDetail?.message).toBe("fatal: first");
    expect(latestOverlay?.isOpen).toBe(true);

    await act(async () => {
      latestOverlay?.showError(second);
    });

    expect(latestOverlay?.errorDetail?.message).toBe("fatal: second");
    expect(latestOverlay?.errorDetail?.retry).toBeFunction();
    expect(latestOverlay?.entry).toBeNull();

    await act(async () => {
      latestOverlay?.dismissError();
    });

    expect(latestOverlay?.errorDetail).toBeNull();
    expect(latestOverlay?.isOpen).toBe(false);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("captures focus when an error opens and restores it when dismissed", async () => {
    const setup = await renderOverlay();

    await act(async () => {
      await setup.renderOnce();
    });
    await focusBackground(setup);

    expect(setup.renderer.currentFocusedRenderable?.id).toBe("background-target");

    await act(async () => {
      latestOverlay?.showError({
        commandId: "remote.fetch",
        operationLabel: "Fetch",
        message: "fatal: nope",
        details: "fatal: nope",
        consoleEntryId: null,
      });
    });

    await act(async () => {
      latestOverlay?.dismissError();
    });

    expect(setup.renderer.currentFocusedRenderable?.id).toBe("background-target");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("closes an error through close when no modal entry is open", async () => {
    const setup = await renderOverlay();

    await act(async () => {
      await setup.renderOnce();
    });

    await act(async () => {
      latestOverlay?.showError({
        commandId: "remote.fetch",
        operationLabel: "Fetch",
        message: "fatal: nope",
        details: "fatal: nope",
        consoleEntryId: null,
      });
    });

    await act(async () => {
      latestOverlay?.close();
    });

    expect(latestOverlay?.errorDetail).toBeNull();
    expect(latestOverlay?.isOpen).toBe(false);

    await act(async () => {
      await setup.dispose();
    });
  });
});
