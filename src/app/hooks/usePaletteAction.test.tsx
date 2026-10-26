import { beforeEach, describe, expect, it } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act, type ReactNode } from "react";
import { resetActionRegistry, resolveActionHandler } from "@/app/hooks/useAction";
import { useOverlay } from "@/app/hooks/useOverlay";
import { usePaletteAction } from "@/app/hooks/usePaletteAction";
import type { OverlayContextValue } from "@/app/providers/OverlayProvider.types";
import { OverlayHost } from "@/features/overlays/OverlayHost";
import { PALETTE_OVERLAY_ID } from "@/features/palette/CommandPalette.constants";
import { AppTestProviders } from "@/test/app.harness";
import { createFakeGitClient } from "@/test/git.fake";

/** Latest overlay context captured by the probe. */
let latestOverlay: OverlayContextValue | undefined;

/**
 * Mounts the palette action, the overlay host, and an overlay probe.
 *
 * @returns The harness content.
 */
function PaletteActionHarness(): ReactNode {
  usePaletteAction();
  latestOverlay = useOverlay();

  return <OverlayHost />;
}

/**
 * Runs the global palette action and flushes the render.
 *
 * @param setup - Renderer setup.
 */
async function runPaletteAction(setup: Awaited<ReturnType<typeof testRender>>): Promise<void> {
  await act(async () => {
    await setup.renderOnce();
  });

  await act(async () => {
    resolveActionHandler("app.palette", "global")?.();
    await setup.renderOnce();
  });
}

beforeEach(() => {
  resetActionRegistry();
  latestOverlay = undefined;
});

describe("usePaletteAction", () => {
  it("opens the palette as a toggleable overlay modal entry", async () => {
    const setup = await testRender(
      <AppTestProviders gitClient={createFakeGitClient().client}>
        <PaletteActionHarness />
      </AppTestProviders>,
      { width: 100, height: 30 },
    );

    await runPaletteAction(setup);

    expect(latestOverlay?.entry?.id).toBe(PALETTE_OVERLAY_ID);
    expect(latestOverlay?.entry?.kind).toBe("modal");
    expect(latestOverlay?.toggleActionId).toBe("app.palette");
    expect(resolveActionHandler("app.palette", "global")).toBeDefined();
    expect(resolveActionHandler("app.palette", "overlay")).toBeUndefined();

    await act(async () => {
      await setup.dispose();
    });
  });

  it("toggles the palette closed when the palette action runs again", async () => {
    const setup = await testRender(
      <AppTestProviders gitClient={createFakeGitClient().client}>
        <PaletteActionHarness />
      </AppTestProviders>,
      { width: 100, height: 30 },
    );

    await runPaletteAction(setup);
    expect(latestOverlay?.entry?.id).toBe(PALETTE_OVERLAY_ID);

    await runPaletteAction(setup);

    expect(latestOverlay?.entry).toBeNull();

    await act(async () => {
      await setup.dispose();
    });
  });
});
