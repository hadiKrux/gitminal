import type { ReactNode } from "react";
import type { ShellLayoutMode } from "@/features/shell/focus.types";
import { resolveLayoutMode } from "@/features/shell/regions";
import { TooSmallNotice } from "@/features/shell/TooSmallNotice";
import { useTerminalDimensions } from "@/ui/useTerminalDimensions";

/**
 * Chooses between the shell and the terminal-too-small notice.
 *
 * The gate reads the live terminal dimensions, so the transition happens on resize without a
 * remount of the providers. Below the enforced minimum it renders the notice with the current,
 * enforced, and target sizes instead of attempting an unusable layout. Above it, the render
 * callback receives the active shell layout mode.
 *
 * @param props - Render callback for the shell.
 * @returns The shell or the size notice.
 */
export function ResponsiveGate(props: {
  renderShell: (layoutMode: ShellLayoutMode) => ReactNode;
}): ReactNode {
  const { width, height } = useTerminalDimensions();
  const layoutMode = resolveLayoutMode(width, height);

  if (layoutMode === "too-small") {
    return <TooSmallNotice width={width} height={height} />;
  }

  return props.renderShell(layoutMode);
}
