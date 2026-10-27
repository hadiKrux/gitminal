import type { ReactNode } from "react";
import { MoreMenuLive } from "@/features/top-bar/MoreMenuLive";
import { TopBarActions } from "@/features/top-bar/TopBarActions";
import { TopBarStatus } from "@/features/top-bar/TopBarStatus";
import { calculateTopBarBudgets } from "@/features/top-bar/topBar.budgets";
import { useTopBar } from "@/features/top-bar/useTopBar";
import type { TopBarControl } from "@/features/top-bar/useTopBar.types";
import { useTerminalDimensions } from "@/ui/useTerminalDimensions";

/**
 * Renders the branch, upstream, sync and status strip, and the remote actions.
 *
 * The app identity is the shell frame's border title, so this component renders a single content
 * row inside that frame. The status strip sits on the left and the Pull, Push, and More buttons on
 * the right, so a long branch or a long message truncates in the middle while the primary actions
 * stay visible. The More menu is an overlay entry owned by `OverlayProvider`; this component
 * supplies the JSX and the explicit command routing. The bar reads derived data from `useTopBar`
 * and never recomputes repository state.
 *
 * @returns The one-row top-bar content.
 */
export function TopBar(): ReactNode {
  const dimensions = useTerminalDimensions();
  const topBar = useTopBar({
    renderMoreMenu: ({ close, activate }) => (
      <MoreMenuLive
        onSelect={(commandId) => {
          close();
          activate(commandId);
        }}
      />
    ),
  });
  const budgets = calculateTopBarBudgets(dimensions.width, readDisabledReasons(topBar.controls));
  const infoFocused = topBar.focusedKind === "info" && topBar.focusedIndex >= 0;

  return (
    <box flexDirection="row" height={1} flexGrow={1}>
      <box flexGrow={1} flexShrink={1} height={1} overflow="hidden">
        <TopBarStatus mode={topBar.statusMode} width={budgets.statusWidth} focused={infoFocused} />
      </box>
      <box flexDirection="row" height={1} flexShrink={0} marginRight={1}>
        <TopBarActions
          controls={topBar.controls}
          focusedKind={topBar.focusedKind}
          reasonWidth={budgets.reasonWidth}
          onActivate={topBar.activateControl}
        />
      </box>
    </box>
  );
}

/**
 * Reads the display reasons of the action controls that need one.
 *
 * @param controls - Control list including the idle info control.
 * @returns One reason per unavailable Pull, Push, or More control.
 */
function readDisabledReasons(controls: readonly TopBarControl[]): readonly string[] {
  return controls
    .filter((control) => control.kind !== "info" && !control.available)
    .map((control) => control.reason ?? "");
}
