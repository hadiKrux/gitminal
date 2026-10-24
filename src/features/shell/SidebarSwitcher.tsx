import type { TabSelectRenderable } from "@opentui/core";
import { type ReactNode, useEffect, useRef } from "react";
import { useFocusState } from "@/app/hooks/useFocusState";
import type { SidebarPanel } from "@/features/shell/focus.types";
import { SIDEBAR_SWITCHER_ID } from "@/features/shell/regions";

/**
 * Renders the native panel switcher used by the collapsed sidebar.
 *
 * The switcher stays focusable for mouse-driven panel switching. The selected index is
 * synchronised so a direct region jump updates the visible tab as well as the panel below it, and
 * `refreshFocus` re-derives the focus projection after the frame under native focus changes.
 *
 * @param props - Panel list and collapsed selection callbacks.
 * @returns The native tab selector.
 */
export function SidebarSwitcher(props: {
  panels: readonly SidebarPanel[];
  selectedPanel: number;
  onSelectPanel: (index: number) => void;
}): ReactNode {
  const ref = useRef<TabSelectRenderable | null>(null);
  const { refreshFocus } = useFocusState();
  const options = props.panels.map((panel) => ({
    name: panel.label,
    description: panel.label,
  }));

  useEffect(() => {
    ref.current?.setSelectedIndex(props.selectedPanel);
    refreshFocus();
  }, [props.selectedPanel, refreshFocus]);

  return (
    <tab-select
      id={SIDEBAR_SWITCHER_ID}
      ref={ref}
      options={options}
      showDescription={false}
      showUnderline
      onChange={(index) => props.onSelectPanel(index)}
    />
  );
}
