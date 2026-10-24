import { type ReactNode, useEffect, useRef, useState } from "react";
import { useFocusRegion } from "@/app/hooks/useFocusRegion";
import { Footer } from "@/features/shell/Footer";
import type { ShellLayoutMode, SidebarPanel } from "@/features/shell/focus.types";
import { MainArea } from "@/features/shell/MainArea";
import { Sidebar } from "@/features/shell/Sidebar";
import { useFocusModel } from "@/features/shell/useFocusModel";
import { useTokens } from "@/theme/useTokens";
import { Panel } from "@/ui/Panel";
import { TextMarker } from "@/ui/TextMarker";

/**
 * Renders the persistent four-region shell frame.
 *
 * The shell owns the top-bar and console region frames, composes the sidebar and main-area frames,
 * and registers Tab traversal and direct region jumps through `useFocusModel`. Feature surfaces
 * arrive as props or children, so this component never imports another feature. It acquires focus
 * once on mount, on the top bar, so the first Tab enters the sidebar and the footer has a region
 * context from the first frame. The console drawer mounts only when open; its region is still
 * registered so a digit jump can open and focus it.
 *
 * @param props - Feature surfaces, active layout mode, and console visibility.
 * @returns The shell frame.
 */
export function AppShell(props: {
  layoutMode: ShellLayoutMode;
  topBar: ReactNode;
  sidebarPanels: readonly SidebarPanel[];
  graph: ReactNode;
  rightPane: ReactNode;
  diffPanel: ReactNode;
  console: ReactNode;
  consoleOpen: boolean;
  onOpenConsole: () => void;
  overlays?: ReactNode;
}): ReactNode {
  const [activeSidebarPanel, setActiveSidebarPanel] = useState(0);
  const initialFocusApplied = useRef(false);
  const topBar = useFocusRegion("top-bar");
  const consoleRegion = useFocusRegion("console");
  const tokens = useTokens();

  useFocusModel({
    layoutMode: props.layoutMode,
    activeSidebarPanel,
    onSelectSidebarPanel: setActiveSidebarPanel,
    consoleOpen: props.consoleOpen,
    onOpenConsole: props.onOpenConsole,
  });

  useEffect(() => {
    if (initialFocusApplied.current) {
      return;
    }

    initialFocusApplied.current = true;
    topBar.focus();
  }, [topBar.focus]);

  return (
    <box flexDirection="column" flexGrow={1} backgroundColor={tokens.background}>
      <Panel
        {...topBar.regionProps}
        focused={topBar.focused}
        height={3}
        flexShrink={0}
        justifyContent="center"
      >
        <box flexDirection="row" height={1} flexShrink={0}>
          <TextMarker focused={topBar.focused} />
          <box flexGrow={1} flexDirection="row" marginLeft={1}>
            {props.topBar}
          </box>
        </box>
      </Panel>

      <box flexDirection="row" flexGrow={1} gap={1}>
        <Sidebar
          layoutMode={props.layoutMode}
          panels={props.sidebarPanels}
          selectedPanel={activeSidebarPanel}
          onSelectPanel={setActiveSidebarPanel}
        />
        <MainArea graph={props.graph} rightPane={props.rightPane} diffPanel={props.diffPanel} />
      </box>

      {props.consoleOpen ? (
        <Panel
          {...consoleRegion.regionProps}
          focused={consoleRegion.focused}
          title="Console"
          height={6}
          flexShrink={0}
        >
          <scrollbox flexGrow={1} focusable={false} viewportCulling>
            {props.console}
          </scrollbox>
        </Panel>
      ) : null}

      <Footer />
      {props.overlays}
    </box>
  );
}
