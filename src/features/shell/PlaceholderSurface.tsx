import { TextAttributes } from "@opentui/core";
import type { ReactNode } from "react";
import { useTokens } from "@/theme/useTokens";

/**
 * Renders one temporary placeholder surface inside a shell region.
 *
 * This is a temporary M4 composition placeholder. Each real feature surface replaces it in its own
 * milestone. It reads only theme tokens, so it owns no repository or feature state.
 *
 * @param props - Surface title and the detail that names the upcoming feature.
 * @returns The placeholder content.
 */
export function PlaceholderSurface(props: { title: string; detail: string }): ReactNode {
  const tokens = useTokens();

  return (
    <box flexDirection="column" flexGrow={1} paddingLeft={1} paddingRight={1}>
      <text fg={tokens.text} wrapMode="none" attributes={TextAttributes.BOLD}>
        {props.title}
      </text>
      <text fg={tokens.dim} wrapMode="none">
        {props.detail}
      </text>
      <text fg={tokens.dim} wrapMode="none">
        Placeholder until its feature milestone lands.
      </text>
    </box>
  );
}
