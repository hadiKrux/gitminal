import type { ReactNode } from "react";
import { useTokens } from "@/theme/useTokens";

/**
 * Renders one footer hint as an accent key followed by its action label.
 *
 * @param props - Formatted key and the action label.
 * @returns A single-line hint.
 */
export function KeyHint(props: { keyLabel: string; label: string }): ReactNode {
  const tokens = useTokens();

  return (
    <text wrapMode="none">
      <span fg={tokens.accent}>{props.keyLabel}</span>
      <span fg={tokens.muted}> {props.label}</span>
    </text>
  );
}
