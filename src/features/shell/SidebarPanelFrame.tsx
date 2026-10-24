import type { ReactNode } from "react";
import { useFocusRegion } from "@/app/hooks/useFocusRegion";
import type { SidebarPanel } from "@/features/shell/focus.types";
import { Panel } from "@/ui/Panel";

/**
 * Renders one focusable sidebar panel frame with its scroll container.
 *
 * The frame carries the stable `region-<id>` identity so the collapsed layout can focus the visible
 * panel body instead of the native switcher.
 *
 * @param props - Panel data, flex sizing, and an optional collapsed-layout switcher.
 * @returns The panel frame.
 */
export function SidebarPanelFrame(props: {
  panel: SidebarPanel;
  flexGrow?: number;
  switcher?: ReactNode;
}): ReactNode {
  const region = useFocusRegion(props.panel.regionId);

  return (
    <Panel
      {...region.regionProps}
      focused={region.focused}
      title={props.panel.label}
      flexGrow={props.flexGrow}
      flexBasis={0}
      minHeight={3}
    >
      {props.switcher}
      <scrollbox flexGrow={1} focusable={false} viewportCulling>
        {props.panel.content}
      </scrollbox>
    </Panel>
  );
}
