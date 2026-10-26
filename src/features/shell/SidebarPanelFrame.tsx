import type { ScrollBoxRenderable } from "@opentui/core";
import { type ReactNode, useMemo, useRef } from "react";
import { useFocusRegion } from "@/app/hooks/useFocusRegion";
import type { SidebarPanel } from "@/features/shell/focus.types";
import { Panel } from "@/ui/Panel";
import { PANEL_SCROLLBAR_WIDTH } from "@/ui/Panel.constants";
import { PanelScrollProvider } from "@/ui/PanelScrollContext";
import type { PanelScrollValue } from "@/ui/PanelScrollContext.types";

/**
 * Renders one focusable sidebar panel frame with its scroll container.
 *
 * The frame carries the stable `region-<id>` identity so the collapsed layout can focus the visible
 * panel body instead of the native switcher. It owns the single `<scrollbox>` of the panel and
 * provides its `scrollChildIntoView` and drawable width to the body through `PanelScrollProvider`.
 * The drawable width subtracts the vertical scrollbar column from the supplied inner width, so a
 * panel can keep the active row visible and budget row text against the width that is actually
 * paintable even while the scrollbar is shown, without rendering a second scroll container.
 *
 * @param props - Panel data, inner content width before the scrollbar column, flex sizing, and an optional collapsed-layout switcher.
 * @returns The panel frame.
 */
export function SidebarPanelFrame(props: {
  panel: SidebarPanel;
  contentWidth: number;
  flexGrow?: number;
  switcher?: ReactNode;
}): ReactNode {
  const region = useFocusRegion(props.panel.regionId);
  const scrollRef = useRef<ScrollBoxRenderable | null>(null);
  const scrollValue = useMemo<PanelScrollValue>(
    () => ({
      drawableWidth: Math.max(0, props.contentWidth - PANEL_SCROLLBAR_WIDTH),
      scrollChildIntoView: (childId: string): void => {
        scrollRef.current?.scrollChildIntoView(childId);
      },
    }),
    [props.contentWidth],
  );

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
      <scrollbox ref={scrollRef} flexGrow={1} focusable={false} viewportCulling>
        <PanelScrollProvider value={scrollValue}>{props.panel.content}</PanelScrollProvider>
      </scrollbox>
    </Panel>
  );
}
