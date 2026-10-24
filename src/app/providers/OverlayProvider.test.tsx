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
  latestOverlay = useOverlay();

  return (
    <box id="background-target" focusable height={1}>
      <text>background</text>
    </box>
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
});
