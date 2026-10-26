import type { ReactNode } from "react";
import { useTokens } from "@/theme/useTokens";

/**
 * Renders the empty state of a list or panel.
 *
 * The message uses the `muted` token and the optional hint uses the `dim` token. The hint is plain
 * text, normally naming the key and action that fills the list, so an empty surface still explains
 * itself without relying on color.
 *
 * @param props - Empty message and an optional action hint.
 * @returns The composed empty state.
 */
export function EmptyState(props: { readonly message: string; readonly hint?: string }): ReactNode {
  const tokens = useTokens();

  return (
    <box flexDirection="column" flexShrink={0} paddingLeft={1}>
      <text fg={tokens.muted} wrapMode="word">
        {props.message}
      </text>
      {props.hint === undefined ? null : (
        <text fg={tokens.dim} wrapMode="word">
          {props.hint}
        </text>
      )}
    </box>
  );
}
