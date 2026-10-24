import { beforeEach, describe, expect, it } from "bun:test";
import { type BoxRenderable, RGBA, type TabSelectRenderable } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import { act, type ReactNode, useState } from "react";
import { resetActionRegistry } from "@/app/hooks/useAction";
import { useFocusState } from "@/app/hooks/useFocusState";
import { useHotkeys } from "@/app/hooks/useHotkeys";
import { DEFAULT_THEME_NAME } from "@/domain/theme/theme.catppuccin";
import { resolveTheme } from "@/domain/theme/theme.resolve";
import { AppShell } from "@/features/shell/AppShell";
import type { FocusContextValue, SidebarPanel } from "@/features/shell/focus.types";
import { SIDEBAR_SWITCHER_ID } from "@/features/shell/regions";
import { ShellTestProviders } from "@/test/shell.harness";

/** Latest focus context captured by the probe. */
let latestFocus: FocusContextValue | undefined;

/** Sidebar surfaces used by the shell test. */
const PANELS: readonly SidebarPanel[] = [
  { regionId: "branches", label: "Branches", content: <text>branch body</text> },
  { regionId: "remotes", label: "Remotes", content: <text>remote body</text> },
  { regionId: "tags", label: "Tags", content: <text>tag body</text> },
  { regionId: "stashes", label: "Stashes", content: <text>stash body</text> },
  { regionId: "worktrees", label: "Worktrees", content: <text>worktree body</text> },
];

/**
 * Captures the active region.
 *
 * @returns A status line.
 */
function FocusProbe(): ReactNode {
  latestFocus = useFocusState();

  return <text id="active-region">{latestFocus.state.activeRegion ?? "none"}</text>;
}

/**
 * Mounts the shell with the keyboard dispatcher and console state.
 *
 * @returns The harness layout.
 */
function ShellHarness(props: {
  layoutMode?: "full" | "sidebar-collapsed";
  width?: number;
  height?: number;
}): ReactNode {
  const [consoleOpen, setConsoleOpen] = useState(false);

  useHotkeys();

  return (
    <box flexDirection="column" flexGrow={1} width={props.width ?? 120} height={props.height ?? 40}>
      <AppShell
        layoutMode={props.layoutMode ?? "full"}
        topBar={<text> Gitminal branch main</text>}
        sidebarPanels={PANELS}
        graph={<text>graph body</text>}
        rightPane={<text>composer body</text>}
        diffPanel={<text>diff body</text>}
        console={<text>console body</text>}
        consoleOpen={consoleOpen}
        onOpenConsole={() => setConsoleOpen(true)}
      />
      <FocusProbe />
    </box>
  );
}

/**
 * Renders the shell harness.
 *
 * @returns The renderer setup.
 */
async function renderShell(
  width: number = 120,
  layoutMode: "full" | "sidebar-collapsed" = "full",
  height: number = 40,
): Promise<Awaited<ReturnType<typeof testRender>>> {
  latestFocus = undefined;

  return testRender(
    <ShellTestProviders>
      <ShellHarness layoutMode={layoutMode} width={width} height={height} />
    </ShellTestProviders>,
    { width, height },
  );
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

/**
 * Presses Tab and renders the result.
 *
 * @param setup - Renderer setup.
 */
async function pressTab(setup: Awaited<ReturnType<typeof testRender>>): Promise<void> {
  await act(async () => {
    setup.mockInput.pressTab();
  });
  await act(async () => {
    await setup.renderOnce();
  });
}

beforeEach(() => {
  resetActionRegistry();
});

describe("AppShell", () => {
  it("renders every region surface", async () => {
    const setup = await renderShell();

    await act(async () => {
      await setup.renderOnce();
    });

    const frame = setup.captureCharFrame();

    expect(frame).toContain("Gitminal branch main");
    expect(frame).toContain("Branches");
    expect(frame).toContain("Remotes");
    expect(frame).toContain("Tags");
    expect(frame).toContain("Stashes");
    expect(frame).toContain("Worktrees");
    expect(frame).toContain("Commits");
    expect(frame).toContain("Right pane");
    expect(frame).toContain("Diffs");
    expect(frame).not.toContain("console body");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("focuses the top bar on mount, then moves with Tab, Shift+Tab, and a digit jump", async () => {
    const setup = await renderShell();

    await act(async () => {
      await setup.renderOnce();
    });

    expect(latestFocus?.state.activeRegion).toBe("top-bar");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region-top-bar");

    await pressTab(setup);
    expect(latestFocus?.state.activeRegion).toBe("branches");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region-branches");

    await pressTab(setup);
    expect(latestFocus?.state.activeRegion).toBe("remotes");

    await act(async () => {
      setup.mockInput.pressTab({ shift: true });
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(latestFocus?.state.activeRegion).toBe("branches");

    await pressKey(setup, "6");
    expect(latestFocus?.state.activeRegion).toBe("graph");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region-graph");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("moves the focus marker and border to the focused region", async () => {
    const setup = await renderShell();

    await act(async () => {
      await setup.renderOnce();
    });

    const branchesFrame = setup.renderer.root.findDescendantById("region-branches") as
      | BoxRenderable
      | undefined;

    expect(setup.captureCharFrame()).toMatch(/>\s+Gitminal branch main/);
    expect(branchesFrame?.title).toBe(" Branches ");

    await pressTab(setup);

    const tabbedFrame = setup.captureCharFrame();

    expect(tabbedFrame).toContain("> Branches");
    expect(tabbedFrame).not.toContain("> Gitminal branch main");
    expect(branchesFrame?.title).toBe(" > Branches ");

    await pressKey(setup, "6");

    const frame = setup.captureCharFrame();
    const graphFrame = setup.renderer.root.findDescendantById("region-graph") as
      | BoxRenderable
      | undefined;
    const tokens = resolveTheme(DEFAULT_THEME_NAME).tokens;

    expect(frame).toContain("> Commits");
    expect(graphFrame?.title).toBe(" > Commits ");
    expect(graphFrame?.focused).toBe(true);
    expect(graphFrame?.borderColor.equals(RGBA.fromHex(tokens.focus))).toBe(true);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("gives the diff region at least three times the right-pane height", async () => {
    const setup = await renderShell();

    await act(async () => {
      await setup.renderOnce();
    });

    const rightPane = setup.renderer.root.findDescendantById("region-right-pane") as
      | BoxRenderable
      | undefined;
    const diff = setup.renderer.root.findDescendantById("region-diff") as BoxRenderable | undefined;

    expect(rightPane).toBeDefined();
    expect(diff).toBeDefined();
    expect(diff?.height ?? 0).toBeGreaterThanOrEqual((rightPane?.height ?? 0) * 3);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("keeps both right-column surfaces usable at the enforced 80x24 minimum", async () => {
    const setup = await renderShell(80, "sidebar-collapsed", 24);

    await act(async () => {
      await setup.renderOnce();
    });

    const rightPane = setup.renderer.root.findDescendantById("region-right-pane") as
      | BoxRenderable
      | undefined;
    const diff = setup.renderer.root.findDescendantById("region-diff") as BoxRenderable | undefined;

    expect(rightPane?.height ?? 0).toBeGreaterThanOrEqual(3);
    expect(diff?.height ?? 0).toBeGreaterThanOrEqual(3);
    expect(diff?.height ?? 0).toBeGreaterThan(rightPane?.height ?? 0);
    expect(setup.captureCharFrame()).toContain("Diffs");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("opens and focuses the console from its digit", async () => {
    const setup = await renderShell();

    await act(async () => {
      await setup.renderOnce();
    });

    await pressKey(setup, "9");

    expect(latestFocus?.state.activeRegion).toBe("console");
    expect(setup.captureCharFrame()).toContain("console body");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("focuses the visible collapsed panel frame on Tab entry and a digit jump", async () => {
    const setup = await renderShell(85, "sidebar-collapsed");

    await act(async () => {
      await setup.renderOnce();
    });

    await pressTab(setup);

    expect(latestFocus?.state.activeRegion).toBe("branches");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region-branches");

    await pressKey(setup, "3");

    const switcher = setup.renderer.root.findDescendantById(SIDEBAR_SWITCHER_ID) as
      | TabSelectRenderable
      | undefined;

    expect(latestFocus?.state.activeRegion).toBe("tags");
    expect(setup.renderer.currentFocusedRenderable?.id).toBe("region-tags");
    expect(switcher?.getSelectedIndex()).toBe(2);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("keeps the collapsed switcher usable for pointer-driven panel changes", async () => {
    const setup = await renderShell(85, "sidebar-collapsed");

    await act(async () => {
      await setup.renderOnce();
    });

    const switcher = setup.renderer.root.findDescendantById(SIDEBAR_SWITCHER_ID) as
      | TabSelectRenderable
      | undefined;

    await act(async () => {
      switcher?.focus();
    });
    await act(async () => {
      setup.mockInput.pressArrow("right");
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(switcher?.getSelectedIndex()).toBe(1);
    expect(setup.captureCharFrame()).toContain("Remotes");

    await act(async () => {
      await setup.dispose();
    });
  });

  it("focuses a region on click through native auto-focus", async () => {
    const setup = await renderShell();

    await act(async () => {
      await setup.renderOnce();
    });

    await act(async () => {
      await setup.mockMouse.click(40, 10);
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(latestFocus?.state.activeRegion).toBe("graph");

    await act(async () => {
      await setup.dispose();
    });
  });
});
