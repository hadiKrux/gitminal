import { TextAttributes } from "@opentui/core";
import type { ReactNode } from "react";
import { WORDMARK_MIN_COLUMNS, WORDMARK_MIN_ROWS } from "@/features/splash/SplashScreen.constants";
import { SplashUpdateNotice } from "@/features/splash/SplashUpdateNotice";
import type { UpdateCheckState } from "@/features/splash/useUpdateCheck.types";
import { useTerminalDimensions } from "@/ui/useTerminalDimensions";

/**
 * Renders the startup splash with the wordmark, running version, update state, and dismiss hint.
 *
 * The component is presentational: it never subscribes to keys and never runs the update check.
 * Below the wordmark breakpoint it falls back to plain bold text so the splash never wraps. Every
 * variable-length line uses `wrapMode="none"`, so the version, notice, install command, and hint
 * stay on one line and clip at narrow widths instead of wrapping.
 *
 * @param props - The package name, running version, and update view state.
 * @returns The centered splash layout.
 */
export function SplashScreen(props: {
  packageName: string;
  version: string;
  update: UpdateCheckState;
}): ReactNode {
  const { width, height } = useTerminalDimensions();
  const showWordmark = width >= WORDMARK_MIN_COLUMNS && height >= WORDMARK_MIN_ROWS;

  return (
    <box flexDirection="column" flexGrow={1} alignItems="center" justifyContent="center">
      {showWordmark ? (
        <ascii-font id="splash-wordmark" font="tiny" text="GITMINAL" />
      ) : (
        <text id="splash-wordmark-fallback" attributes={TextAttributes.BOLD} wrapMode="none">
          GITMINAL
        </text>
      )}

      <box flexDirection="column" alignItems="center" marginTop={1}>
        <text attributes={TextAttributes.DIM} wrapMode="none">
          version {props.version}
        </text>
        <SplashUpdateNotice packageName={props.packageName} update={props.update} />
        <box marginTop={1}>
          <text wrapMode="none">Press any key to continue</text>
        </box>
      </box>
    </box>
  );
}
