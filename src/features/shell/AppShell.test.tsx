import { beforeEach, describe, expect, it } from "bun:test";
import { type BoxRenderable, RGBA, type TabSelectRenderable } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import { act, type ReactNode, useState } from "react";
import { RIGHT_PANE_MIN_ROWS } from "@/app/hooks/rightPane.layout";
import { resetActionRegistry } from "@/app/hooks/useAction";
import { useFocusRegion } from "@/app/hooks/useFocusRegion";
import { useFocusState } from "@/app/hooks/useFocusState";
import { useHotkeys } from "@/app/hooks/useHotkeys";
import { DEFAULT_THEME_NAME } from "@/domain/theme/theme.catppuccin";
import { resolveTheme } from "@/domain/theme/theme.resolve";
import { AppShell } from "@/features/shell/AppShell";
import type { FocusContextValue, SidebarPanel } from "@/features/shell/focus.types";
import { SIDEBAR_SWITCHER_ID } from "@/features/shell/regions";
import { ShellTestProviders } from "@/test/shell.harness";
import { Panel } from "@/ui/Panel";

/** Latest focus context captured by the probe. */
let latestFocus: FocusContextValue | undefined;

/**
 * Renders a stand-in main-area surface that owns its frame, like the real features do.
 *
 * The shell test cannot import a feature, so it supplies small surfaces that follow the same
 * contract: each surface owns its `Panel`, its region identity, and its body.
 *
 * @param props - Region id, border title, and visible body text.
 * @returns The mock surface panel.
 */
function MockMainSurface(props: {
  readonly regionId: "graph" | "right-pane" | "diff";
  readonly title: string;
  readonly body: string;
}): ReactNode {
  const region = useFocusRegion(props.regionId);

  return (
    <Panel
      {...region.regionProps}
      focused={region.focused}
      title={props.title}
      flexGrow={1}
      flexBasis={0}
    >
      <text>{props.body}</text>
    </Panel>
  );
}

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
  topBarTitle?: string;
  panels?: readonly SidebarPanel[];
}): ReactNode {
  const [consoleOpen, setConsoleOpen] = useState(false);

  useHotkeys();

  return (
    <box flexDirection="column" flexGrow={1} width={props.width ?? 120} height={props.height ?? 40}>
      <AppShell
        layoutMode={props.layoutMode ?? "full"}
        topBar={<text> Gitminal branch main</text>}
        topBarTitle={props.topBarTitle ?? "Gitminal"}
        sidebarPanels={props.panels ?? PANELS}
        graph={<MockMainSurface regionId="graph" title="Commits" body="graph body" />}
        rightPane={
          <MockMainSurface regionId="right-pane" title="Right pane" body="composer body" />
        }
        diffPanel={<MockMainSurface regionId="diff" title="Diffs" body="diff body" />}
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
 * @param width - Terminal width.
 * @param layoutMode - Sidebar layout mode.
 * @param height - Terminal height.
 * @param topBarTitle - Optional repository title.
 * @param panels - Optional panel descriptors to override the fixture.
 * @returns The renderer setup.
 */
async function renderShell(
  width: number = 120,
  layoutMode: "full" | "sidebar-collapsed" = "full",
  height: number = 40,
  topBarTitle?: string,
  panels?: readonly SidebarPanel[],
): Promise<Awaited<ReturnType<typeof testRender>>> {
  latestFocus = undefined;

  return testRender(
    <ShellTestProviders>
      <ShellHarness
        layoutMode={layoutMode}
        width={width}
        height={height}
        topBarTitle={topBarTitle}
        panels={panels}
      />
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

  it("moves the focus border and title color to the focused region", async () => {
    const setup = await renderShell();
    const tokens = resolveTheme(DEFAULT_THEME_NAME).tokens;

    await act(async () => {
      await setup.renderOnce();
    });

    const branchesFrame = setup.renderer.root.findDescendantById("region-branches") as
      | BoxRenderable
      | undefined;
    const topBarFrame = setup.renderer.root.findDescendantById("region-top-bar") as
      | BoxRenderable
      | undefined;

    expect(setup.captureCharFrame()).toContain("Gitminal branch main");
    expect(topBarFrame?.title).toBe(" Gitminal ");
    expect(topBarFrame?.borderColor.equals(RGBA.fromHex(tokens.focus))).toBe(true);
    expect(branchesFrame?.title).toBe(" Branches ");
    expect(branchesFrame?.borderColor.equals(RGBA.fromHex(tokens.focus))).toBe(false);

    await pressTab(setup);

    const tabbedFrame = setup.captureCharFrame();

    expect(tabbedFrame).toContain("Branches");
    expect(topBarFrame?.title).toBe(" Gitminal ");
    expect(branchesFrame?.title).toBe(" Branches ");
    expect(branchesFrame?.focused).toBe(true);
    expect(branchesFrame?.borderColor.equals(RGBA.fromHex(tokens.focus))).toBe(true);

    await pressKey(setup, "6");

    const frame = setup.captureCharFrame();
    const graphFrame = setup.renderer.root.findDescendantById("region-graph") as
      | BoxRenderable
      | undefined;

    expect(frame).toContain("Commits");
    expect(graphFrame?.title).toBe(" Commits ");
    expect(graphFrame?.focused).toBe(true);
    expect(graphFrame?.borderColor.equals(RGBA.fromHex(tokens.focus))).toBe(true);

    await act(async () => {
      await setup.dispose();
    });
  });

  it("shows a home-relative repository path and shortens an overlong title", async () => {
    const home = process.env.HOME ?? process.env.USERPROFILE ?? "/home/tester";
    const setup = await renderShell(80, "full", 24, `${home}/repos/gitminal`);

    await act(async () => {
      await setup.renderOnce();
    });

    const frame = setup.renderer.root.findDescendantById("region-top-bar") as
      | BoxRenderable
      | undefined;

    expect(frame?.title).toBe(" ~/repos/gitminal ");
    expect(setup.captureCharFrame()).toContain("~/repos/gitminal");

    await act(async () => {
      await setup.dispose();
    });

    const longPath = `${home}/repos/${"nested-directory/".repeat(8)}gitminal`;
    const longSetup = await renderShell(80, "full", 24, longPath);

    await act(async () => {
      await longSetup.renderOnce();
    });

    const longFrame = longSetup.renderer.root.findDescendantById("region-top-bar") as
      | BoxRenderable
      | undefined;

    expect(longFrame?.title).toContain("...");
    expect(longFrame?.title?.length ?? 0).toBeLessThanOrEqual(80);
    expect(longFrame?.title?.endsWith("gitminal ")).toBeTrue();

    await act(async () => {
      await longSetup.dispose();
    });
  });

  it("gives the diff the remaining right-column height above the right-pane minimum", async () => {
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
    expect(rightPane?.height ?? 0).toBeGreaterThanOrEqual(RIGHT_PANE_MIN_ROWS);
    expect(diff?.height ?? 0).toBeGreaterThan(0);

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

    expect(rightPane?.height ?? 0).toBeGreaterThanOrEqual(RIGHT_PANE_MIN_ROWS);
    expect(diff?.height ?? 0).toBeGreaterThanOrEqual(3);
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

  it("keeps the counted title in the frame and short names in the collapsed tabs", async () => {
    const counted: readonly SidebarPanel[] = [
      {
        regionId: "branches",
        label: "Branches (2)",
        shortLabel: "Branches",
        content: <text>branch body</text>,
      },
      { regionId: "remotes", label: "Remotes (1)", content: <text>remote body</text> },
      { regionId: "tags", label: "Tags (0)", shortLabel: "Tags", content: <text>tag body</text> },
      {
        regionId: "stashes",
        label: "Stashes (4)",
        shortLabel: "Stashes",
        content: <text>stash body</text>,
      },
      {
        regionId: "worktrees",
        label: "Worktrees (1)",
        shortLabel: "Worktrees",
        content: <text>worktree body</text>,
      },
    ];
    const setup = await renderShell(85, "sidebar-collapsed", 30, undefined, counted);

    await act(async () => {
      await setup.renderOnce();
    });

    const switcher = setup.renderer.root.findDescendantById(SIDEBAR_SWITCHER_ID) as
      | TabSelectRenderable
      | undefined;

    expect(switcher?.options.map((option) => option.name)).toEqual([
      "Branches",
      "Remotes (1)",
      "Tags",
      "Stashes",
      "Worktrees",
    ]);
    expect(setup.captureCharFrame()).toContain("Branches (2)");

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
