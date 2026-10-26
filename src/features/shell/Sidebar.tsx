import type { ReactNode } from "react";
import type { ShellLayoutMode, SidebarPanel } from "@/features/shell/focus.types";
import { SIDEBAR_WIDTHS } from "@/features/shell/regions";
import { SidebarPanelFrame } from "@/features/shell/SidebarPanelFrame";
import { SidebarSwitcher } from "@/features/shell/SidebarSwitcher";
import { PANEL_BORDER_WIDTH } from "@/ui/Panel.constants";

/**
 * Lays out the five sidebar panels or the collapsed single-panel switcher.
 *
 * The component never imports a panel feature. Full and narrow layouts render every panel as its
 * own focusable region frame with a scroll container. The collapsed layout renders only the
 * selected panel, with a native `<tab-select>` inside the same frame so Left and Right switch
 * panels under native list mode and focus derivation keeps the active panel region. Keyboard entry
 * to the sidebar focuses the visible panel frame; the switcher remains focusable for mouse use.
 *
 * @param props - Layout mode, panels, and the collapsed selection.
 * @returns The sidebar column.
 */
export function Sidebar(props: {
  layoutMode: ShellLayoutMode;
  panels: readonly SidebarPanel[];
  selectedPanel: number;
  onSelectPanel: (index: number) => void;
}): ReactNode {
  const width = SIDEBAR_WIDTHS[props.layoutMode];
  const contentWidth = width - PANEL_BORDER_WIDTH;

  if (props.layoutMode === "sidebar-collapsed") {
    const active = props.panels[props.selectedPanel] ?? props.panels[0];

    if (active === undefined) {
      return <box width={width} flexShrink={0} />;
    }

    return (
      <box width={width} flexShrink={0} flexDirection="column">
        <SidebarPanelFrame
          panel={active}
          contentWidth={contentWidth}
          flexGrow={1}
          switcher={
            <SidebarSwitcher
              panels={props.panels}
              selectedPanel={props.selectedPanel}
              onSelectPanel={props.onSelectPanel}
            />
          }
        />
      </box>
    );
  }

  return (
    <box width={width} flexShrink={0} flexDirection="column">
      {props.panels.map((panel) => (
        <SidebarPanelFrame
          key={panel.regionId}
          panel={panel}
          contentWidth={contentWidth}
          flexGrow={1}
        />
      ))}
    </box>
  );
}
