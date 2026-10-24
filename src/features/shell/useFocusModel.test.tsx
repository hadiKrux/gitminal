import { beforeEach, describe, expect, it } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act, type ReactNode, useState } from "react";
import { resetActionRegistry, resolveActionHandler, useAction } from "@/app/hooks/useAction";
import { useFocusRegion } from "@/app/hooks/useFocusRegion";
import { useFocusState } from "@/app/hooks/useFocusState";
import { useHotkeys } from "@/app/hooks/useHotkeys";
import type {
  FocusContextValue,
  FocusModel,
  RegionId,
  ShellLayoutMode,
} from "@/features/shell/focus.types";
import { FOCUS_ACTION_BY_REGION, REGION_IDS, regionFrameId } from "@/features/shell/regions";
import { useFocusModel } from "@/features/shell/useFocusModel";
import { ShellTestProviders } from "@/test/shell.harness";

/** Latest focus context captured by the probe. */
let latestFocus: FocusContextValue | undefined;

/** Latest focus model captured by the harness. */
let latestModel: FocusModel | undefined;

/** Number of times the harness changed the collapsed sidebar selection. */
let selectCalls = 0;

/** Number of region-scoped navigation handlers that ran. */
let navDowns = 0;

/**
 * Renders one focusable region frame.
 *
 * @param props - Region id.
 * @returns The region frame.
 */
function Region(props: { id: RegionId }): ReactNode {
  const region = useFocusRegion(props.id);

  return (
    <box {...region.regionProps} width={20} height={1}>
      <text>{props.id}</text>
    </box>
  );
}

/**
 * Captures the focus state and renders the active region.
 *
 * @returns A status line.
 */
function FocusProbe(): ReactNode {
  latestFocus = useFocusState();

  return <text id="active-region">{latestFocus.state.activeRegion ?? "none"}</text>;
}

/**
 * Mounts the shell focus model with every region frame and the keyboard dispatcher.
 *
 * @param props - Layout mode and initial collapsed panel.
 * @returns The harness layout.
 */
function FocusModelHarness(props: {
  layoutMode: ShellLayoutMode;
  initialPanel: number;
}): ReactNode {
  const [panel, setPanel] = useState(props.initialPanel);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const model = useFocusModel({
    layoutMode: props.layoutMode,
    activeSidebarPanel: panel,
    onSelectSidebarPanel: (index) => {
      selectCalls += 1;
      setPanel(index);
    },
    consoleOpen,
    onOpenConsole: () => setConsoleOpen(true),
  });

  latestModel = model;
  useHotkeys();
  useAction("nav.down", { scope: "tags" }, () => {
    navDowns += 1;
  });

  return (
    <box flexDirection="column" width={40} height={30}>
      {REGION_IDS.map((regionId) => (
        <Region key={regionId} id={regionId} />
      ))}
      <FocusProbe />
      <text id="selected-panel">{String(panel)}</text>
      <text id="console-state">{consoleOpen ? "open" : "closed"}</text>
    </box>
  );
}

/**
 * Renders the focus-model harness.
 *
 * @param layoutMode - Shell layout mode.
 * @param initialPanel - Initial collapsed sidebar panel.
 * @returns The renderer setup.
 */
async function renderModel(
  layoutMode: ShellLayoutMode,
  initialPanel: number = 0,
): Promise<Awaited<ReturnType<typeof testRender>>> {
  latestFocus = undefined;
  latestModel = undefined;
  selectCalls = 0;
  navDowns = 0;

  return testRender(
    <ShellTestProviders>
      <FocusModelHarness layoutMode={layoutMode} initialPanel={initialPanel} />
    </ShellTestProviders>,
    { width: 120, height: 40 },
  );
}

/**
 * Runs one focus model action and renders the result.
 *
 * @param setup - Renderer setup.
 * @param action - Action to run.
 */
async function runModelAction(
  setup: Awaited<ReturnType<typeof testRender>>,
  action: (model: FocusModel) => void,
): Promise<void> {
  await act(async () => {
    if (latestModel) {
      action(latestModel);
    }
  });
  await act(async () => {
    await setup.renderOnce();
  });
}

/**
 * Presses one key and renders the result.
 *
 * @param setup - Renderer setup.
 * @param key - Key to press.
 */
async function pressKey(setup: Awaited<ReturnType<typeof testRender>>, key: string): Promise<void> {
  await act(async () => {
    setup.mockInput.pressKey(key);
  });
  await act(async () => {
    await setup.renderOnce();
  });
}

beforeEach(() => {
  resetActionRegistry();
});

describe("useFocusModel", () => {
  it("moves through the Tab order and wraps in both directions", async () => {
    const setup = await renderModel("full");

    await act(async () => {
      await setup.renderOnce();
    });

    await runModelAction(setup, (model) => model.focusNext());
    expect(latestFocus?.state.activeRegion).toBe("top-bar");

    await runModelAction(setup, (model) => model.focusNext());
    expect(latestFocus?.state.activeRegion).toBe("branches");

    await runModelAction(setup, (model) => model.focusPrevious());
    expect(latestFocus?.state.activeRegion).toBe("top-bar");

    await runModelAction(setup, (model) => model.focusPrevious());
    expect(latestFocus?.state.activeRegion).toBe("diff");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("skips hidden sidebar panels in the collapsed layout", async () => {
    const setup = await renderModel("sidebar-collapsed", 2);

    await act(async () => {
      await setup.renderOnce();
    });

    await runModelAction(setup, (model) => model.focusNext());
    await runModelAction(setup, (model) => model.focusNext());

    expect(latestFocus?.state.activeRegion).toBe("tags");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region-tags");
    expect(setup.captureCharFrame()).toContain("tags");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("selects a collapsed sidebar panel and focuses its frame", async () => {
    const setup = await renderModel("sidebar-collapsed", 0);

    await act(async () => {
      await setup.renderOnce();
    });

    await pressKey(setup, "3");

    expect(selectCalls).toBe(1);
    expect(setup.captureCharFrame()).toContain("2");
    expect(latestFocus?.state.activeRegion).toBe("tags");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region-tags");

    await pressKey(setup, "3");

    expect(selectCalls).toBe(1);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("delivers a region-scoped navigation key after a collapsed digit jump", async () => {
    const setup = await renderModel("sidebar-collapsed", 0);

    await act(async () => {
      await setup.renderOnce();
    });

    await pressKey(setup, "3");
    await pressKey(setup, "j");

    expect(navDowns).toBe(1);
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region-tags");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("opens the console before focusing its region", async () => {
    const setup = await renderModel("full");

    await act(async () => {
      await setup.renderOnce();
    });

    await pressKey(setup, "9");

    expect(setup.captureCharFrame()).toContain("open");
    expect(latestFocus?.state.activeRegion).toBe("console");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("focuses every region from its focus action, including the top bar and console", async () => {
    const setup = await renderModel("full");

    await act(async () => {
      await setup.renderOnce();
    });

    for (const regionId of REGION_IDS) {
      const actionId = FOCUS_ACTION_BY_REGION[regionId];

      await act(async () => {
        resolveActionHandler(actionId, "global")?.();
      });
      await act(async () => {
        await setup.renderOnce();
      });
      await act(async () => {
        await setup.renderOnce();
      });

      expect(latestFocus?.state.activeRegion).toBe(regionId);
      expect(setup.renderer.currentFocusedRenderable?.id).toBe(regionFrameId(regionId));
      expect(setup.captureCharFrame()).toContain(regionId === "console" ? "open" : regionId);
    }

    await act(async () => {
      await setup.dispose();
    });
  });

  it("focuses a region directly without disturbing the already focused one", async () => {
    const setup = await renderModel("full");

    await act(async () => {
      await setup.renderOnce();
    });

    await pressKey(setup, "6");

    expect(latestFocus?.state.activeRegion).toBe("graph");

    await pressKey(setup, "6");

    expect(latestFocus?.state.activeRegion).toBe("graph");
    expect(latestFocus?.state.previousRegion).toBeNull();

    await act(async () => {
      await setup.dispose();
    });
  });
});
