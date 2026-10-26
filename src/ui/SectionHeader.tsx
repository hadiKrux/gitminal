import type { ReactNode } from "react";
import { ICONS } from "@/theme/icons";
import { useTokens } from "@/theme/useTokens";

/**
 * Renders one expandable section header row.
 *
 * The leading marker comes from `ICONS.expanded` or `ICONS.collapsed` and the title follows it, so
 * the expand state reads without color while the marker stays `muted` and the title stays `text`.
 * The row is always one line: the title is truncated by the caller's own budget and an overlong
 * title clips instead of wrapping, so a section header never shifts the rows below it.
 *
 * The component is presentational. The owning feature keeps the expansion state, toggles it from
 * the click reported by `onMouseDown`, and binds keyboard activation to its own action; this
 * primitive never calls `focus()`.
 *
 * @param props - Section title, expanded state, optional stable id, and optional mouse handler.
 * @returns The composed section header row.
 */
export function SectionHeader(props: {
  readonly title: string;
  readonly expanded: boolean;
  readonly id?: string;
  readonly onMouseDown?: () => void;
}): ReactNode {
  const tokens = useTokens();

  return (
    <box
      id={props.id}
      flexDirection="row"
      flexShrink={0}
      minHeight={1}
      gap={1}
      overflow="hidden"
      onMouseDown={props.onMouseDown}
    >
      <text fg={tokens.muted} wrapMode="none" flexShrink={0}>
        {props.expanded ? ICONS.expanded : ICONS.collapsed}
      </text>
      <text fg={tokens.text} wrapMode="none" flexShrink={1}>
        {props.title}
      </text>
    </box>
  );
}
