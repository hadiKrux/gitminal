import type { ReactNode } from "react";
import { useTokens } from "@/theme/useTokens";

/**
 * Renders the lane prefix of one commit row.
 *
 * Every cell becomes its own `<span>`, so a theme can color lanes independently and a future lane
 * palette can vary per column without changing the row. The lane characters come from
 * `assignGraphLanes`; this component never computes or reflows them.
 *
 * @param props - Lane cells in display order and the node column.
 * @returns The inline lane prefix.
 */
export function GraphLanes(props: {
  readonly cells: readonly string[];
  readonly nodeColumn: number;
}): ReactNode {
  const tokens = useTokens();
  const laneColors = tokens.graph;
  const cells = props.cells.map((cell, index) => ({
    cell,
    key: `lane-${index}-${cell}`,
    color:
      index === props.nodeColumn
        ? tokens.accent
        : (laneColors[index % laneColors.length] ?? tokens.accent),
  }));

  return (
    <text wrapMode="none" flexShrink={0}>
      {cells.map((lane) => (
        <span key={lane.key} fg={lane.color}>
          {lane.cell}
        </span>
      ))}
    </text>
  );
}
