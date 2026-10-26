import { describe, expect, it } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act, type ReactNode } from "react";
import type { SidebarPanel } from "@/features/shell/focus.types";
import { Sidebar } from "@/features/shell/Sidebar";
import { ShellTestProviders } from "@/test/shell.harness";
import { usePanelScroll } from "@/ui/PanelScrollContext";
import type { PanelScrollValue } from "@/ui/PanelScrollContext.types";

let capturedScroll: PanelScrollValue | null = null;

/**
 * Records the panel scroll value the shell frame provides to a body.
 *
 * @returns A one-row panel body.
 */
function PanelWidthProbe(): ReactNode {
  capturedScroll = usePanelScroll();

  return <text>panel body</text>;
}

/**
 * Builds the panel descriptors the sidebar renders.
 *
 * @returns Two panels whose bodies record their drawable width.
 */
function buildPanels(): readonly SidebarPanel[] {
  return [
    {
      regionId: "branches",
      label: "Branches (1)",
      shortLabel: "Branches",
      content: <PanelWidthProbe />,
    },
    {
      regionId: "remotes",
      label: "Remotes (1)",
      shortLabel: "Remotes",
      content: <PanelWidthProbe />,
    },
  ];
}

/**
 * Renders the collapsed sidebar at its documented width.
 *
 * @returns The renderer setup.
 */
async function renderCollapsedSidebar(): Promise<Awaited<ReturnType<typeof testRender>>> {
  capturedScroll = null;

  const setup = await testRender(
    <ShellTestProviders>
      <box width={26} height={12} flexDirection="column">
        <Sidebar
          layoutMode="sidebar-collapsed"
          panels={buildPanels()}
          selectedPanel={0}
          onSelectPanel={() => {}}
        />
      </box>
    </ShellTestProviders>,
    { width: 26, height: 12 },
  );

  await act(async () => {
    await setup.renderOnce();
  });

  return setup;
}

describe("Sidebar", () => {
  it("provides the collapsed panel drawable width without the border or scrollbar", async () => {
    const setup = await renderCollapsedSidebar();

    expect(capturedScroll?.drawableWidth).toBe(23);

    await act(async () => {
      await setup.dispose();
    });
  });
});
