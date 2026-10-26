import type { ReactNode } from "react";
import { ICONS } from "@/theme/icons";
import { useTokens } from "@/theme/useTokens";
import { Spinner } from "@/ui/Spinner";

/**
 * Renders the loading row of a list.
 *
 * The row shows the `ICONS.running` marker, an animated `Spinner`, and the caller's label, so the
 * loading state is visible even on a monochrome terminal. The marker and label use the `muted`
 * token and the spinner uses its accent default.
 *
 * @param props - Loading label, for example `loading branches`.
 * @returns The composed loading row.
 */
export function LoadingRow(props: { readonly label: string }): ReactNode {
  const tokens = useTokens();

  return (
    <box flexDirection="row" flexShrink={0} height={1} paddingLeft={1} gap={1}>
      <text fg={tokens.muted} wrapMode="none">
        {ICONS.running}
      </text>
      <Spinner />
      <text fg={tokens.muted} wrapMode="none">
        {props.label}
      </text>
    </box>
  );
}
