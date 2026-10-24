import { beforeEach, describe, expect, it } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act, type ReactNode, useState } from "react";
import { useFocusRegion } from "@/app/hooks/useFocusRegion";
import { useFocusState } from "@/app/hooks/useFocusState";
import { ConfigProvider } from "@/app/providers/ConfigProvider";
import { FocusProvider } from "@/app/providers/FocusProvider";
import { ThemeProvider } from "@/app/providers/ThemeProvider";
import type { FocusContextValue, RegionId } from "@/features/shell/focus.types";

/** Latest focus context captured by the probe. */
let latest: FocusContextValue | undefined;

/** Renames the harness region so a test can change its frame identity. */
let renameRegion: ((regionId: RegionId) => void) | undefined;

/**
 * Captures the focus context and renders the active region text.
 *
 * @returns A non-focusable status line.
 */
function FocusProbe(): ReactNode {
  latest = useFocusState();

  return <text id="focus-probe">{latest.state.activeRegion ?? "none"}</text>;
}

/**
 * Renders one focusable region frame with optional children.
 *
 * @param props - Region id and optional content.
 * @returns The region frame.
 */
function Region(props: { id: RegionId; children?: ReactNode }): ReactNode {
  const region = useFocusRegion(props.id);

  return (
    <box {...region.regionProps} width={30} height={3}>
      {props.children ?? <text>{props.id}</text>}
    </box>
  );
}

/**
 * Renders the focus harness with two regions, a text input, and an outside target.
 *
 * @returns The harness layout.
 */
function Harness(): ReactNode {
  return (
    <box flexDirection="column" width={40} height={12}>
      <Region id="branches">
        <input id="field" width={10} />
      </Region>
      <Region id="graph" />
      <box id="outside" focusable width={10} height={1}>
        <text>outside</text>
      </box>
      <FocusProbe />
    </box>
  );
}

/**
 * Renders one region whose id can change while a child input keeps focus.
 *
 * @returns The harness layout.
 */
function RenameHarness(): ReactNode {
  const [regionId, setRegionId] = useState<RegionId>("branches");
  renameRegion = setRegionId;

  return (
    <box flexDirection="column" width={40} height={12}>
      <Region id={regionId}>
        <input id="rename-field" width={10} />
      </Region>
      <FocusProbe />
    </box>
  );
}

/**
 * Renders the focus harness.
 *
 * @returns The renderer setup.
 */
async function renderFocusHarness(): Promise<Awaited<ReturnType<typeof testRender>>> {
  latest = undefined;

  return testRender(
    <ConfigProvider>
      <ThemeProvider>
        <FocusProvider>
          <Harness />
        </FocusProvider>
      </ThemeProvider>
    </ConfigProvider>,
    { width: 40, height: 12 },
  );
}

/**
 * Renders the rename harness.
 *
 * @returns The renderer setup.
 */
async function renderRenameHarness(): Promise<Awaited<ReturnType<typeof testRender>>> {
  latest = undefined;
  renameRegion = undefined;

  return testRender(
    <ConfigProvider>
      <ThemeProvider>
        <FocusProvider>
          <RenameHarness />
        </FocusProvider>
      </ThemeProvider>
    </ConfigProvider>,
    { width: 40, height: 12 },
  );
}

/**
 * Focuses a renderable by id inside an act block.
 *
 * @param setup - Renderer setup.
 * @param id - Renderable id.
 */
async function focusById(setup: Awaited<ReturnType<typeof testRender>>, id: string): Promise<void> {
  await act(async () => {
    setup.renderer.root.findDescendantById(id)?.focus();
  });
  await act(async () => {
    await setup.renderOnce();
  });
}

beforeEach(() => {
  latest = undefined;
});

describe("FocusProvider", () => {
  it("derives the active region from native focus", async () => {
    const setup = await renderFocusHarness();

    await act(async () => {
      await setup.renderOnce();
    });

    expect(latest?.state.activeRegion).toBeNull();

    await focusById(setup, "region-branches");

    expect(latest?.state.activeRegion).toBe("branches");
    expect(latest?.state.focusInsideRegion).toBe(true);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("keeps the region active while a text input inside it owns focus", async () => {
    const setup = await renderFocusHarness();

    await act(async () => {
      await setup.renderOnce();
    });
    await focusById(setup, "region-branches");
    await focusById(setup, "field");

    expect(latest?.state.activeRegion).toBe("branches");
    expect(latest?.state.textInputFocused).toBe(true);
    expect(latest?.state.multilineInputFocused).toBe(false);
    expect(setup.renderer.currentFocusedEditor).not.toBeNull();

    await act(async () => {
      await setup.dispose();
    });
  });

  it("tracks the previous region only when the region changes", async () => {
    const setup = await renderFocusHarness();

    await act(async () => {
      await setup.renderOnce();
    });
    await focusById(setup, "region-branches");
    await focusById(setup, "field");

    expect(latest?.state.previousRegion).toBeNull();

    await focusById(setup, "region-graph");

    expect(latest?.state.activeRegion).toBe("graph");
    expect(latest?.state.previousRegion).toBe("branches");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("keeps the last region active while focus is outside every region", async () => {
    const setup = await renderFocusHarness();

    await act(async () => {
      await setup.renderOnce();
    });
    await focusById(setup, "region-graph");
    await focusById(setup, "outside");

    expect(latest?.state.activeRegion).toBe("graph");
    expect(latest?.state.focusInsideRegion).toBe(false);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("focuses a region and restores a captured renderable", async () => {
    const setup = await renderFocusHarness();

    await act(async () => {
      await setup.renderOnce();
    });

    await act(async () => {
      latest?.focusRegion("branches");
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(latest?.state.activeRegion).toBe("branches");

    await focusById(setup, "field");
    const capturedId = latest?.state.focusedRenderableId;

    expect(capturedId).toBe("field");

    await focusById(setup, "region-graph");

    await act(async () => {
      if (capturedId) {
        latest?.restoreFocus(capturedId);
      }
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(setup.renderer.currentFocusedRenderable?.id).toBe("field");
    expect(latest?.state.activeRegion).toBe("branches");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("re-derives the active region after a frame identity change", async () => {
    const setup = await renderRenameHarness();

    await act(async () => {
      await setup.renderOnce();
    });
    await focusById(setup, "rename-field");

    expect(latest?.state.activeRegion).toBe("branches");

    await act(async () => {
      renameRegion?.("graph");
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(setup.renderer.root.findDescendantById("region-graph")).toBeDefined();
    expect(latest?.state.activeRegion).toBe("branches");

    await act(async () => {
      latest?.refreshFocus();
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(latest?.state.activeRegion).toBe("graph");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("rename-field");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("persists a cursor across a focus round trip", async () => {
    const setup = await renderFocusHarness();

    await act(async () => {
      await setup.renderOnce();
    });

    expect(latest?.getCursor("branches")).toBeNull();

    await act(async () => {
      latest?.setCursor("branches", "main");
    });

    expect(latest?.getCursor("branches")).toBe("main");

    await focusById(setup, "region-graph");
    await focusById(setup, "region-branches");

    expect(latest?.getCursor("branches")).toBe("main");

    await act(async () => {
      latest?.setCursor("branches", null);
    });

    expect(latest?.getCursor("branches")).toBeNull();

    await act(async () => {
      await setup.dispose();
    });
  });
});
