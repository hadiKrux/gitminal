import type { ReactNode } from "react";
import { truncateText } from "@/lib/text";
import { ICONS } from "@/theme/icons";
import { useTokens } from "@/theme/useTokens";

/**
 * Renders text truncated to an explicit display budget.
 *
 * The budget comes from the caller, normally from `useTerminalDimensions` in the owning feature.
 * Truncation uses `truncateText` from `@/lib/text` with the `ICONS.ellipsis` marker, so the result
 * never exceeds the budget and never wraps onto a second line.
 *
 * @param props - Text, maximum character budget, and an optional foreground color.
 * @returns The single-line truncated text.
 */
export function TruncatedText(props: {
  readonly text: string;
  readonly maxWidth: number;
  readonly fg?: string;
}): ReactNode {
  const tokens = useTokens();

  return (
    <text fg={props.fg ?? tokens.text} wrapMode="none" flexShrink={1}>
      {truncateText(props.text, props.maxWidth, ICONS.ellipsis)}
    </text>
  );
}
