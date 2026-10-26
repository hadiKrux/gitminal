import { beforeEach, describe, expect, it } from "bun:test";
import type { ScrollBoxRenderable } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import { act, type ReactNode } from "react";
import { resetInputModes } from "@/app/hooks/inputMode.registry";
import { resetActionRegistry, resolveActionHandler, useAction } from "@/app/hooks/useAction";
import { useHelpAction } from "@/app/hooks/useHelpAction";
import { resolveHotkeyAction, useHotkeys } from "@/app/hooks/useHotkeys";
import { resetInputEscapeClear } from "@/app/hooks/useInputEscapeClear";
import { useKeymap } from "@/app/hooks/useKeymap";
import { useOverlay } from "@/app/hooks/useOverlay";
import { useRepository } from "@/app/hooks/useRepository";
import { useShellActions } from "@/app/hooks/useShellActions";
import type { KeyEventLike, ResolvedKeymap } from "@/domain/keymap/keymap.types";
import {
  HELP_BODY_ID,
  HELP_MODAL_ID,
  HELP_OVERLAY_ID,
  HELP_SEARCH_INPUT_ID,
} from "@/features/help/HelpModal.constants";
import { HELP_SECTION_ID_PREFIX, HELP_SECTIONS } from "@/features/help/useHelp.constants";
import { AppTestProviders, TestOverlayHost } from "@/test/app.harness";
import { createFakeGitClient } from "@/test/git.fake";

/** Latest overlay context captured by the harness. */
let latestOverlay: ReturnType<typeof useOverlay> | undefined;

/** Latest resolved keymap captured by the harness. */
let latestKeymap: ResolvedKeymap | undefined;

/** Latest repository context captured by the harness. */
let latestRepository: ReturnType<typeof useRepository> | undefined;

/** Number of times the unrelated global pull action ran. */
let pullCount = 0;

/**
 * Mounts the keyboard dispatcher, the app shell actions, the help action, and the overlay host.
 *
 * The harness registers an unrelated global action so the test can prove that no other global
 * action resolves while help owns the keyboard.
 *
 * @returns The harness content.
 */
function HelpModalHarness(): ReactNode {
  latestOverlay = useOverlay();
  latestKeymap = useKeymap();
  latestRepository = useRepository();
  useHotkeys();
  useShellActions();
  useHelpAction();
  useAction("remote.pull", { scope: "global", owner: "top-bar" }, () => {
    pullCount += 1;
  });

  return (
    <box flexDirection="column" width={100} height={30}>
      <box id="region-graph" focusable height={1}>
        <text>graph</text>
      </box>
      <TestOverlayHost />
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
 * Renders the harness and focuses the background region.
 *
 * @param height - Terminal height used for the modal.
 * @returns The renderer setup.
 */
async function renderHelpModal(
  height: number = 30,
): Promise<Awaited<ReturnType<typeof testRender>>> {
  latestOverlay = undefined;
  latestKeymap = undefined;
  latestRepository = undefined;
  pullCount = 0;

  const setup = await testRender(
    <AppTestProviders gitClient={createFakeGitClient().client}>
      <HelpModalHarness />
    </AppTestProviders>,
    { width: 100, height },
  );

  await act(async () => {
    setup.renderer.root.findDescendantById("region-graph")?.focus();
    await setup.renderOnce();
  });
  await waitFor(setup, hasRepositorySnapshot);

  return setup;
}

/**
 * Presses one key and renders until the frame settles.
 *
 * @param setup - Renderer setup.
 * @param key - Character key to press.
 */
async function pressKey(setup: Awaited<ReturnType<typeof testRender>>, key: string): Promise<void> {
  await act(async () => {
    setup.mockInput.pressKey(key);
    await setup.renderOnce();
  });
  await act(async () => {
    await setup.renderOnce();
  });
}

/**
 * Opens help with its default binding.
 *
 * @param setup - Renderer setup.
 */
async function openHelp(setup: Awaited<ReturnType<typeof testRender>>): Promise<void> {
  await pressKey(setup, "?");

  expect(latestOverlay?.entry?.id).toBe(HELP_OVERLAY_ID);
}

/**
 * Builds a physical key event for dispatcher assertions.
 *
 * @param name - Base key name.
 * @param ctrl - Whether Control is held.
 * @returns The key event.
 */
function keyEvent(name: string, ctrl: boolean = false): KeyEventLike {
  return { name, ctrl, meta: false, shift: false, option: false, sequence: name };
}

beforeEach(() => {
  resetActionRegistry();
  resetInputModes();
  resetInputEscapeClear();
  latestOverlay = undefined;
  latestKeymap = undefined;
  latestRepository = undefined;
  pullCount = 0;
});

describe("HelpModal", () => {
  it("focuses the search field when help.search runs", async () => {
    const setup = await renderHelpModal();

    await openHelp(setup);

    const frame = setup.captureCharFrame();

    expect(frame).toContain("Help");
    expect(frame).toContain("Focus branches");
    expect(frame).toContain("Clear/Close");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe(HELP_MODAL_ID);

    await pressKey(setup, "/");

    expect(setup.renderer.currentFocusedRenderable?.id).toBe(HELP_SEARCH_INPUT_ID);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("closes help when app.help runs again", async () => {
    const setup = await renderHelpModal();

    await openHelp(setup);
    expect(setup.captureCharFrame()).toContain("Focus branches");

    await pressKey(setup, "?");

    expect(latestOverlay?.entry).toBeNull();
    expect(setup.captureCharFrame()).not.toContain("Focus branches");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("resolves no other global action while help is open", async () => {
    const setup = await renderHelpModal();

    await openHelp(setup);
    await pressKey(setup, "p");

    const keymap = latestKeymap as ResolvedKeymap;

    expect(pullCount).toBe(0);
    expect(
      resolveHotkeyAction({
        keymap,
        key: keyEvent("p"),
        activeRegion: "graph",
        textInputFocused: false,
        nativeListFocused: false,
        overlayOpen: true,
        overlayToggleActionId: "app.help",
      }),
    ).toBeNull();
    expect(
      resolveHotkeyAction({
        keymap,
        key: keyEvent("p", true),
        activeRegion: "graph",
        textInputFocused: false,
        nativeListFocused: false,
        overlayOpen: true,
        overlayToggleActionId: "app.help",
      }),
    ).toBeNull();
    expect(latestOverlay?.entry?.id).toBe(HELP_OVERLAY_ID);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("keeps every section header when all sections are collapsed and expands one again", async () => {
    const setup = await renderHelpModal(40);

    await openHelp(setup);

    for (let press = 0; press < HELP_SECTIONS.length; press += 1) {
      await pressKey(setup, "h");
    }

    const collapsedFrame = setup.captureCharFrame();

    for (const section of HELP_SECTIONS) {
      expect(collapsedFrame, section.id).toContain(section.title);
    }

    expect(collapsedFrame).not.toContain("No actions match");

    const header = setup.renderer.root.findDescendantById(`${HELP_SECTION_ID_PREFIX}graph`);

    expect(header).toBeDefined();

    await act(async () => {
      await setup.mockMouse.click((header?.screenX ?? 0) + 1, header?.screenY ?? 0);
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(setup.captureCharFrame()).toContain("Search commits");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("restores the sections immediately when a no-match query is cleared", async () => {
    const setup = await renderHelpModal();

    await openHelp(setup);
    await pressKey(setup, "/");

    await act(async () => {
      await setup.mockInput.typeText("zzz");
    });
    await waitFor(setup, () => setup.captureCharFrame().includes("No actions match"));

    expect(setup.captureCharFrame()).not.toContain("Focus branches");

    await act(async () => {
      resolveActionHandler("overlay.close", "overlay")?.();
      await setup.renderOnce();
    });

    await act(async () => {
      await setup.renderOnce();
    });

    expect(setup.captureCharFrame()).toContain("Focus branches");
    expect(setup.captureCharFrame()).not.toContain("No actions match");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("scrolls the body as the row cursor moves", async () => {
    const setup = await renderHelpModal(20);

    await openHelp(setup);

    const body = setup.renderer.root.findDescendantById(HELP_BODY_ID) as
      | ScrollBoxRenderable
      | undefined;

    expect(body?.scrollTop).toBe(0);

    for (let step = 0; step < 16; step += 1) {
      await pressKey(setup, "j");
    }

    expect(body?.scrollTop ?? 0).toBeGreaterThan(0);

    await act(async () => {
      await setup.dispose();
    });
  });
});
