import { TextAttributes } from "@opentui/core";
import type { ReactNode } from "react";
import {
  ENFORCED_MIN_TERMINAL_HEIGHT,
  ENFORCED_MIN_TERMINAL_WIDTH,
  MIN_TERMINAL_HEIGHT,
  MIN_TERMINAL_WIDTH,
  NOTICE_WORDMARK_MIN_COLUMNS,
  NOTICE_WORDMARK_MIN_ROWS,
} from "@/features/shell/regions";
import { useTokens } from "@/theme/useTokens";

/**
 * Renders the terminal-too-small notice with the current, enforced, and target sizes.
 *
 * The shell still renders between the enforced minimum and the target size, so the notice names
 * both values instead of advertising only the target. The wordmark falls back to plain bold text on
 * very small terminals so the notice never wraps.
 *
 * @param props - Current terminal width and height.
 * @returns The centered notice.
 */
export function TooSmallNotice(props: { width: number; height: number }): ReactNode {
  const tokens = useTokens();
  const showWordmark =
    props.width >= NOTICE_WORDMARK_MIN_COLUMNS && props.height >= NOTICE_WORDMARK_MIN_ROWS;

  return (
    <box
      flexDirection="column"
      flexGrow={1}
      alignItems="center"
      justifyContent="center"
      backgroundColor={tokens.background}
    >
      {showWordmark ? (
        <ascii-font id="too-small-wordmark" font="tiny" text="GITMINAL" />
      ) : (
        <text id="too-small-wordmark-fallback" fg={tokens.warning} attributes={TextAttributes.BOLD}>
          GITMINAL
        </text>
      )}
      <text
        fg={tokens.warning}
        attributes={TextAttributes.BOLD}
        wrapMode="none"
        marginTop={1}
        height={1}
      >
        Terminal too small
      </text>
      <text fg={tokens.muted} wrapMode="none" height={1}>
        Current size: {props.width}x{props.height}
      </text>
      <text fg={tokens.muted} wrapMode="none" height={1}>
        Minimum size: {ENFORCED_MIN_TERMINAL_WIDTH}x{ENFORCED_MIN_TERMINAL_HEIGHT}
      </text>
      <text fg={tokens.dim} wrapMode="none" height={1}>
        Target size: {MIN_TERMINAL_WIDTH}x{MIN_TERMINAL_HEIGHT}
      </text>
      <text fg={tokens.dim} wrapMode="none" height={1}>
        Resize the terminal to continue.
      </text>
    </box>
  );
}
