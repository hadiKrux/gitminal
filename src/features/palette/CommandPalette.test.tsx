import { beforeEach, describe, expect, it, type Mock, mock } from "bun:test";
import type { SelectRenderable } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import { act, type ReactNode, useEffect, useRef, useState } from "react";
import { resetActionRegistry, resolveActionHandler, useAction } from "@/app/hooks/useAction";
import { useFocusRegion } from "@/app/hooks/useFocusRegion";
import { useFocusState } from "@/app/hooks/useFocusState";
import { useRepository } from "@/app/hooks/useRepository";
import { useStatus } from "@/app/hooks/useStatus";
import { CommandPalette } from "@/features/palette/CommandPalette";
import {
  PALETTE_SEARCH_INPUT_ID,
  PALETTE_SELECT_ID,
} from "@/features/palette/CommandPalette.constants";
import { decodePaletteValue } from "@/features/palette/CommandRow";
import { resetRecentCommands } from "@/features/palette/palette.search";
import { PALETTE_HIDDEN_SURFACE_MESSAGE } from "@/features/palette/palette.targets.constants";
import { AppTestProviders } from "@/test/app.harness";
import { createFakeGitClient } from "@/test/git.fake";

/** Latest focus context captured by the probe. */
let latestFocus: ReturnType<typeof useFocusState> | undefined;

/** Latest transient status captured by the probe. */
let latestStatus: ReturnType<typeof useStatus>["status"] = null;

/** Inputs the palette harness accepts. */
interface PaletteHarnessProps {
  /** Closes the palette and runs its post-restore completion. */
  readonly onClose: (afterRestore?: () => void) => void;
  /** Branches cursor seeded before the palette captures. */
  readonly seedBranch?: string;
  /** Refresh handler registered so the harness has one runnable command. */
  readonly onRefresh?: () => void;
}

/**
 * Renders the palette inside a focusable branches frame with one runnable global command.
 *
 * The harness deliberately registers no branch action handler. A palette entry for a branch action
 * therefore only dispatches when the production owning surface registers that handler, which keeps
 * this suite from masking a missing registration.
 *
 * @param props - Close callback, cursor seed, and refresh handler.
 * @returns The harness content.
 */
function PaletteHarness(props: PaletteHarnessProps): ReactNode {
  const repository = useRepository();
  const status = useStatus();
  const focus = useFocusState();
  const region = useFocusRegion("branches");
  const seeded = useRef(false);

  latestFocus = focus;
  latestStatus = status.status;

  if (!seeded.current) {
    seeded.current = true;

    if (props.seedBranch !== undefined) {
      focus.setCursor("branches", props.seedBranch);
    }
  }

  useAction("app.refresh", { scope: "global", owner: "app" }, () => {
    props.onRefresh?.();
  });

  return (
    <box {...region.regionProps} flexDirection="column" width={100} height={30}>
      {repository.snapshot === null ? (
        <text>loading</text>
      ) : (
        <CommandPalette onClose={props.onClose} />
      )}
    </box>
  );
}

/**
 * Renders the palette inside a focusable branches frame without owning handlers.
 *
 * @param props - Close callback and cursor seed.
 * @returns The harness content.
 */
function BarePaletteHarness(props: {
  readonly onClose: (afterRestore?: () => void) => void;
  readonly seedBranch?: string;
}): ReactNode {
  const repository = useRepository();
  const status = useStatus();
  const focus = useFocusState();
  const region = useFocusRegion("branches");
  const seeded = useRef(false);

  latestFocus = focus;
  latestStatus = status.status;

  if (!seeded.current) {
    seeded.current = true;

    if (props.seedBranch !== undefined) {
      focus.setCursor("branches", props.seedBranch);
    }
  }

  return (
    <box {...region.regionProps} flexDirection="column" width={100} height={30}>
      {repository.snapshot === null ? (
        <text>loading</text>
      ) : (
        <CommandPalette onClose={props.onClose} />
      )}
    </box>
  );
}

/**
 * Renders the palette beside a graph region and closes it the way the overlay provider does.
 *
 * The harness models the provider's post-restore contract: `onClose` stores the completion the
 * palette supplied, hides the palette, and runs the completion from a later effect, once the
 * palette has unmounted and the background focus is back on the graph frame. The palette entry for
 * `branch.checkout` resolves to the branches scope while native focus starts on the graph frame, so
 * only that completion can move focus to `branches`.
 *
 * @param props - Close callback that accepts the post-restore completion.
 * @returns The harness content.
 */
function RefusalCloseHarness(props: {
  readonly onClose: (afterRestore?: () => void) => void;
}): ReactNode {
  const repository = useRepository();
  const status = useStatus();
  const focus = useFocusState();
  const branches = useFocusRegion("branches");
  const graph = useFocusRegion("graph");
  const [visible, setVisible] = useState(true);
  const pendingCompletion = useRef<(() => void) | null>(null);
  const seeded = useRef(false);

  latestFocus = focus;
  latestStatus = status.status;

  if (!seeded.current) {
    seeded.current = true;
    focus.setCursor("branches", "feature");
  }

  useEffect(() => {
    if (visible) {
      return;
    }

    const completion = pendingCompletion.current;

    pendingCompletion.current = null;
    completion?.();
  }, [visible]);

  /**
   * Closes the palette and keeps the supplied completion for the post-unmount effect.
   *
   * @param afterRestore - Work the palette wants to run after the overlay restores focus.
   */
  const closePalette = (afterRestore?: () => void): void => {
    pendingCompletion.current = afterRestore ?? null;
    props.onClose(afterRestore);
    setVisible(false);
  };

  return (
    <box flexDirection="column" width={100} height={30}>
      <box {...branches.regionProps} height={1}>
        <text>branches</text>
      </box>
      <box {...graph.regionProps} height={1}>
        <text>graph</text>
      </box>
      {repository.snapshot === null ? (
        <text>loading</text>
      ) : visible ? (
        <CommandPalette onClose={closePalette} />
      ) : (
        <text>palette closed</text>
      )}
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
  const deadline = Date.now() + 2_000;

  while (!predicate() && Date.now() < deadline) {
    await act(async () => {
      await setup.renderOnce();
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }
}

/**
 * Renders the palette harness and waits for its first option list.
 *
 * @param useHandlers - True to register the runnable refresh handler.
 * @param seedBranch - Branches cursor to seed.
 * @returns The renderer setup, the close mock, and the refresh mock.
 */
async function renderPalette(
  useHandlers: boolean,
  seedBranch?: string,
): Promise<{
  readonly setup: Awaited<ReturnType<typeof testRender>>;
  readonly onClose: Mock<(afterRestore?: () => void) => void>;
  readonly onRefresh: Mock<() => void>;
}> {
  const onClose = mock((_afterRestore?: () => void) => {});
  const onRefresh = mock(() => {});

  /**
   * Models the overlay provider close: the completion it receives runs after the close.
   *
   * The real causal ordering is covered on the real provider stack in `AppShellHost.test.tsx`, so
   * this harness only needs the close and completion to both happen.
   *
   * @param afterRestore - Work the palette wants to run after the overlay restores focus.
   */
  const closePalette = (afterRestore?: () => void): void => {
    onClose(afterRestore);
    afterRestore?.();
  };
  const content = useHandlers ? (
    <PaletteHarness onClose={closePalette} seedBranch={seedBranch} onRefresh={onRefresh} />
  ) : (
    <BarePaletteHarness onClose={closePalette} seedBranch={seedBranch} />
  );
  const setup = await testRender(
    <AppTestProviders gitClient={createFakeGitClient().client}>{content}</AppTestProviders>,
    { width: 100, height: 30 },
  );

  await waitFor(setup, () => findSelect(setup) !== undefined);
  await act(async () => {
    setup.renderer.root.findDescendantById("region-branches")?.focus();
    await setup.renderOnce();
  });

  return { setup, onClose, onRefresh };
}

/**
 * Finds the palette result select.
 *
 * @param setup - Renderer setup.
 * @returns The native select, or undefined before the palette mounts.
 */
function findSelect(setup: Awaited<ReturnType<typeof testRender>>): SelectRenderable | undefined {
  return setup.renderer.root.findDescendantById(PALETTE_SELECT_ID) as SelectRenderable | undefined;
}

/**
 * Selects one option by its name fragment and flushes the render.
 *
 * @param setup - Renderer setup.
 * @param fragment - Name fragment of the option to activate.
 */
async function selectOption(
  setup: Awaited<ReturnType<typeof testRender>>,
  fragment: string,
): Promise<void> {
  await act(async () => {
    const select = findSelect(setup);
    const index = select?.options.findIndex((option) => option.name.includes(fragment)) ?? -1;

    if (select !== undefined && index >= 0) {
      select.setSelectedIndex(index);
      select.selectCurrent();
    }

    await setup.renderOnce();
  });
}

/**
 * Renders frames until the expected text appears or the attempt bound is reached.
 *
 * @param setup - Renderer setup under test.
 * @param expected - Text the frame must contain.
 */
async function waitForFrame(
  setup: Awaited<ReturnType<typeof testRender>>,
  expected: string,
): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await act(async () => {
      await setup.renderOnce();
    });

    if (setup.captureCharFrame().includes(expected)) {
      return;
    }
  }
}

beforeEach(() => {
  resetActionRegistry();
  resetRecentCommands();
  latestStatus = null;
  latestFocus = undefined;
});

describe("CommandPalette rendering", () => {
  it("renders the search field, grouped results, and the key hints", async () => {
    const { setup } = await renderPalette(true);
    const frame = setup.captureCharFrame();

    expect(frame).toContain("Command palette");
    expect(frame).toContain("Search commands");
    expect(frame).toContain("-- App --");
    expect(frame).toContain("Run");
    expect(frame).toContain("Close");
    expect(frame).toContain("Next field");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("shows the no-match row with the query", async () => {
    const { setup } = await renderPalette(true);
    const input = setup.renderer.root.findDescendantById(PALETTE_SEARCH_INPUT_ID) as
      | { focus: () => void }
      | undefined;

    await act(async () => {
      input?.focus();
      await setup.mockInput.typeText("zz");
    });
    await waitForFrame(setup, `[?] No matching commands "zz"`);

    expect(setup.captureCharFrame()).toContain(`[?] No matching commands "zz"`);

    await act(async () => {
      await setup.dispose();
    });
  });
});

describe("CommandPalette dispatch", () => {
  it("dispatches an available command once and closes", async () => {
    const { setup, onClose, onRefresh } = await renderPalette(true);

    await selectOption(setup, "Refresh");
    await waitFor(setup, () => onRefresh.mock.calls.length === 1);

    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(latestStatus).toBeNull();

    await act(async () => {
      await setup.dispose();
    });
  });

  it("keeps a captured-unavailable command inert and the palette open", async () => {
    const { setup, onClose, onRefresh } = await renderPalette(true);

    await selectOption(setup, "Delete branch");

    expect(onClose).not.toHaveBeenCalled();
    expect(onRefresh).not.toHaveBeenCalled();
    expect(latestStatus).toBeNull();
    expect(setup.captureCharFrame()).toContain("Command palette");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("closes without dispatching on overlay.close", async () => {
    const { setup, onClose, onRefresh } = await renderPalette(true, "feature");

    await act(async () => {
      resolveActionHandler("overlay.close", "overlay")?.();
      await setup.renderOnce();
    });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onRefresh).not.toHaveBeenCalled();

    await act(async () => {
      await setup.dispose();
    });
  });

  // These two cases use an injected close that runs the completion synchronously, so they prove the
  // refusal builds the right close request and status. The post-restore ordering is covered by the
  // real-stack case in AppShellHost.test.tsx, not here.
  it("requests owning-region focus in the close completion when the target goes stale", async () => {
    const { setup, onClose } = await renderPalette(true, "feature");

    await act(async () => {
      latestFocus?.setCursor("branches", "main");
    });
    await selectOption(setup, "Checkout branch");
    await waitFor(setup, () => setup.renderer.currentFocusedRenderable?.id === "region-branches");

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(latestStatus?.message).toBe("The selected target is no longer valid");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region-branches");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("requests owning-region focus in the close completion when the owning handler is missing", async () => {
    const { setup, onClose } = await renderPalette(false, "feature");

    await selectOption(setup, "Checkout branch");
    await waitFor(setup, () => setup.renderer.currentFocusedRenderable?.id === "region-branches");

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(latestStatus?.message).toBe(PALETTE_HIDDEN_SURFACE_MESSAGE);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region-branches");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("focuses the owning region after the refused palette has closed", async () => {
    const onClose = mock((_afterRestore?: () => void) => {});

    latestFocus = undefined;

    const setup = await testRender(
      <AppTestProviders gitClient={createFakeGitClient().client}>
        <RefusalCloseHarness onClose={onClose} />
      </AppTestProviders>,
      { width: 100, height: 30 },
    );

    await waitFor(setup, () => findSelect(setup) !== undefined);
    await act(async () => {
      setup.renderer.root.findDescendantById("region-graph")?.focus();
      await setup.renderOnce();
    });

    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region-graph");

    await selectOption(setup, "Checkout branch");
    await waitFor(setup, () => setup.renderer.currentFocusedRenderable?.id === "region-branches");

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onClose.mock.calls[0]?.[0]).toBeFunction();
    expect(latestStatus?.message).toBe(PALETTE_HIDDEN_SURFACE_MESSAGE);
    expect(findSelect(setup)).toBeUndefined();
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region-branches");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("moves to the first and last result through nav.first and nav.last", async () => {
    const { setup } = await renderPalette(true);
    const select = findSelect(setup);
    const commandIndexes = (select?.options ?? []).flatMap((option, index) =>
      decodePaletteValue(option.value)?.kind === "command" ? [index] : [],
    );
    const first = commandIndexes[0];
    const last = commandIndexes.at(-1);

    await act(async () => {
      resolveActionHandler("nav.last", "overlay")?.();
      await setup.renderOnce();
    });

    expect(findSelect(setup)?.getSelectedIndex()).toBe(last);

    await act(async () => {
      resolveActionHandler("nav.first", "overlay")?.();
      await setup.renderOnce();
    });

    expect(findSelect(setup)?.getSelectedIndex()).toBe(first);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("registers only overlay-scoped handlers", async () => {
    const { setup } = await renderPalette(true);

    for (const actionId of [
      "nav.up",
      "nav.down",
      "nav.pageUp",
      "nav.pageDown",
      "nav.first",
      "nav.last",
      "nav.activate",
      "overlay.close",
      "focus.next",
      "focus.previous",
    ]) {
      expect(resolveActionHandler(actionId, "overlay"), actionId).toBeDefined();
    }

    expect(resolveActionHandler("app.palette", "overlay")).toBeUndefined();
    expect(resolveActionHandler("app.palette", "global")).toBeUndefined();

    await act(async () => {
      await setup.dispose();
    });

    expect(resolveActionHandler("nav.activate", "overlay")).toBeUndefined();
  });
});
