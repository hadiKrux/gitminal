import { beforeEach, describe, expect, it } from "bun:test";
import type { SelectRenderable } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import { act, type ReactNode } from "react";
import { resetActionRegistry, resolveActionHandler } from "@/app/hooks/useAction";
import { useFocusRegion } from "@/app/hooks/useFocusRegion";
import { useHelpAction } from "@/app/hooks/useHelpAction";
import { useKeymap } from "@/app/hooks/useKeymap";
import { useOverlay } from "@/app/hooks/useOverlay";
import { usePaletteAction } from "@/app/hooks/usePaletteAction";
import { useRepository } from "@/app/hooks/useRepository";
import type { OverlayContextValue } from "@/app/providers/OverlayProvider.types";
import { formatBinding } from "@/domain/keymap/keymap.describe";
import type { ResolvedKeymap } from "@/domain/keymap/keymap.types";
import {
  HELP_MODAL_ID,
  HELP_OVERLAY_ID,
  HELP_TOGGLE_ACTION_ID,
} from "@/features/help/HelpModal.constants";
import { OverlayHost } from "@/features/overlays/OverlayHost";
import { PALETTE_SELECT_ID } from "@/features/palette/CommandPalette.constants";
import { AppTestProviders } from "@/test/app.harness";
import { createFakeGitClient } from "@/test/git.fake";

/** Latest overlay context captured by the harness. */
let latestOverlay: OverlayContextValue | undefined;

/** Latest resolved keymap captured by the harness. */
let latestKeymap: ResolvedKeymap | undefined;

/** Latest repository context captured by the harness. */
let latestRepository: ReturnType<typeof useRepository> | undefined;

/**
 * Mounts both discovery surfaces with a focusable branches region.
 *
 * Help and the palette are overlays, so the harness focuses a region first: help orders its sections
 * by the region that owned focus, and the palette captures its targets from that region's cursors.
 *
 * @returns The harness content.
 */
function DiscoveryHarness(): ReactNode {
  const branches = useFocusRegion("branches");

  latestOverlay = useOverlay();
  latestKeymap = useKeymap();
  latestRepository = useRepository();
  usePaletteAction();
  useHelpAction();

  return (
    <box flexDirection="column" width={100} height={30}>
      <box {...branches.regionProps} height={1}>
        <text>branches</text>
      </box>
      <OverlayHost />
    </box>
  );
}

/**
 * Renders until a predicate holds or the deadline passes.
 *
 * @param setup - Renderer setup.
 * @param predicate - Condition to wait for.
 */
async function waitFor(
  setup: Awaited<ReturnType<typeof testRender>>,
  predicate: () => boolean,
): Promise<void> {
  const deadline = Date.now() + 3_000;

  while (!predicate() && Date.now() < deadline) {
    await act(async () => {
      await setup.renderOnce();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }
}

/**
 * Reports whether the first repository read has settled.
 *
 * @returns True once the provider holds a snapshot.
 */
function hasRepositorySnapshot(): boolean {
  return latestRepository !== undefined && latestRepository.snapshot !== null;
}

/**
 * Renders the harness and focuses the branches region.
 *
 * @returns The renderer setup.
 */
async function renderDiscovery(): Promise<Awaited<ReturnType<typeof testRender>>> {
  latestOverlay = undefined;
  latestKeymap = undefined;
  latestRepository = undefined;

  const setup = await testRender(
    <AppTestProviders gitClient={createFakeGitClient().client}>
      <DiscoveryHarness />
    </AppTestProviders>,
    { width: 100, height: 30 },
  );

  await act(async () => {
    setup.renderer.root.findDescendantById("region-branches")?.focus();
    await setup.renderOnce();
  });
  await waitFor(setup, hasRepositorySnapshot);

  return setup;
}

/**
 * Renders twice so the overlay content and its settled frame are both captured.
 *
 * @param setup - Renderer setup.
 */
async function settle(setup: Awaited<ReturnType<typeof testRender>>): Promise<void> {
  await act(async () => {
    await setup.renderOnce();
  });
  await act(async () => {
    await setup.renderOnce();
  });
}

/**
 * Runs one global action and renders until the overlay settles.
 *
 * @param setup - Renderer setup.
 * @param actionId - Global action to run.
 */
async function runGlobalAction(
  setup: Awaited<ReturnType<typeof testRender>>,
  actionId: string,
): Promise<void> {
  await act(async () => {
    resolveActionHandler(actionId, "global")?.();
    await setup.renderOnce();
  });
  await settle(setup);
}

/**
 * Runs the palette's overlay close handler and renders until the overlay closes.
 *
 * @param setup - Renderer setup.
 */
async function closePalette(setup: Awaited<ReturnType<typeof testRender>>): Promise<void> {
  await act(async () => {
    resolveActionHandler("overlay.close", "overlay")?.();
    await setup.renderOnce();
  });
  await settle(setup);
}

/**
 * Reads the palette option for one command.
 *
 * @param setup - Renderer setup.
 * @param label - Command label the option name must contain.
 * @returns The rendered option, or undefined when the palette does not render it.
 */
function readOption(
  setup: Awaited<ReturnType<typeof testRender>>,
  label: string,
): { readonly name: string; readonly description: string } | undefined {
  const select = setup.renderer.root.findDescendantById(PALETTE_SELECT_ID) as
    | SelectRenderable
    | undefined;

  return select?.options.find((option) => option.name.includes(label));
}

beforeEach(() => {
  resetActionRegistry();
  latestOverlay = undefined;
  latestKeymap = undefined;
  latestRepository = undefined;
});

describe("useHelpAction", () => {
  it("opens help as a toggleable overlay modal entry", async () => {
    const setup = await renderDiscovery();

    await runGlobalAction(setup, HELP_TOGGLE_ACTION_ID);

    expect(latestOverlay?.entry?.id).toBe(HELP_OVERLAY_ID);
    expect(latestOverlay?.entry?.kind).toBe("modal");
    expect(latestOverlay?.toggleActionId).toBe(HELP_TOGGLE_ACTION_ID);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe(HELP_MODAL_ID);
    expect(resolveActionHandler(HELP_TOGGLE_ACTION_ID, "overlay")).toBeUndefined();

    await act(async () => {
      await setup.dispose();
    });
  });

  it("toggles help closed when the action runs again", async () => {
    const setup = await renderDiscovery();

    await runGlobalAction(setup, HELP_TOGGLE_ACTION_ID);
    expect(latestOverlay?.entry?.id).toBe(HELP_OVERLAY_ID);

    await runGlobalAction(setup, HELP_TOGGLE_ACTION_ID);

    expect(latestOverlay?.entry).toBeNull();

    await act(async () => {
      await setup.dispose();
    });
  });

  it("agrees with the palette on one action's effective keys and reason", async () => {
    const setup = await renderDiscovery();

    await runGlobalAction(setup, "app.palette");

    const option = readOption(setup, "Delete branch");
    const keymap = latestKeymap as ResolvedKeymap;
    const binding = keymap.bindings.get("branch.delete")?.[0];
    const keys = binding === undefined ? [] : [formatBinding(binding)];

    expect(option).toBeDefined();
    expect(option?.description).toBe("Select an item first");
    expect(option?.name).toContain(`(${keys[0]})`);

    await closePalette(setup);
    expect(latestOverlay?.entry).toBeNull();

    await runGlobalAction(setup, HELP_TOGGLE_ACTION_ID);

    const rowLine = setup
      .captureCharFrame()
      .split("\n")
      .find((line) => line.includes("Delete branch"));

    expect(rowLine).toContain(keys[0]);
    expect(rowLine).toContain("Select an item first");

    await act(async () => {
      await setup.dispose();
    });
  });
});
