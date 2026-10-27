import type { ReactNode } from "react";
import type { GraphLaneCell } from "@/domain/graph/graph.types";
import {
  GRAPH_EDGE_DOWN,
  GRAPH_EDGE_LEFT,
  GRAPH_EDGE_RIGHT,
  GRAPH_EDGE_UP,
  GRAPH_EMPTY_LANE,
  GRAPH_LINE_GLYPHS,
} from "@/features/graph/GraphLanes.constants";
import { ICONS } from "@/theme/icons";
import { useTokens } from "@/theme/useTokens";

/** One rendered lane cell: the glyph pair and the color that belongs to its branch. */
interface RenderedLaneCell {
  /** Stable key for the span. */
  readonly key: string;
  /** Foreground color of the cell. */
  readonly color: string;
  /** Two-cell glyph pair, the second cell carrying the horizontal connector. */
  readonly glyphs: string;
}

/**
 * Renders the lane cells of one commit row.
 *
 * The graph uses lazygit's two-character cell model. The first character is the line or the commit
 * symbol and the second character carries the horizontal connector, so a fork reads as `◎─╮` and a
 * join reads as `○─╯`. The engine provides only geometry; this component maps the four cell edges
 * onto the box-drawing glyphs and colors each cell by the branch lane that owns it, so a branch
 * keeps its color when the line shifts to another column.
 *
 * Every cell is its own `<span>`, so lanes can be colored independently. Missing cells render blank,
 * which lets a caller pad a short row to a wider lane count.
 *
 * @param props - One cell per lane column and the gutter width in lane cells.
 * @returns The inline lane cells.
 */
export function GraphLanes(props: {
  readonly cells: readonly GraphLaneCell[];
  readonly width: number;
}): ReactNode {
  const tokens = useTokens();
  const laneColors = tokens.graph;
  const width = Math.max(0, Math.floor(props.width));
  const cells: RenderedLaneCell[] = Array.from({ length: width }, (_, index) => {
    const cell = props.cells[index];
    const color = laneColors[(cell?.lane ?? index) % laneColors.length] ?? tokens.accent;

    return {
      key: `lane-${index}`,
      color,
      glyphs: cell === undefined ? GRAPH_EMPTY_LANE : readCellGlyphs(cell),
    };
  });

  return (
    <text wrapMode="none" flexShrink={0}>
      {cells.map((cell) => (
        <span key={cell.key} fg={cell.color}>
          {cell.glyphs}
        </span>
      ))}
    </text>
  );
}

/**
 * Maps one cell's edges onto its two-character glyph pair.
 *
 * The mapping is lazygit's box-drawing table: a cell with both a top and a bottom edge is always
 * the vertical bar, so a lane passing through another line's bend stays readable, and the right
 * connector decides the second character. A commit or merge cell replaces the first character with
 * its symbol and keeps the right connector.
 *
 * @param cell - One graph cell.
 * @returns The two characters of the cell.
 */
function readCellGlyphs(cell: GraphLaneCell): string {
  const second = cell.right ? ICONS.graphHorizontal : " ";

  if (cell.kind === "commit") {
    return `${ICONS.graphCommit}${second}`;
  }

  if (cell.kind === "merge") {
    return `${ICONS.graphMerge}${second}`;
  }

  return `${readLineGlyph(cell)}${second}`;
}

/**
 * Reads the line glyph of one non-commit cell.
 *
 * @param cell - One graph cell with the line kind.
 * @returns The single-cell line glyph.
 */
function readLineGlyph(cell: GraphLaneCell): string {
  return GRAPH_LINE_GLYPHS[readEdgeMask(cell)] ?? " ";
}

/**
 * Reads the edge mask of one graph cell.
 *
 * @param cell - One graph cell.
 * @returns The `up | down | left | right` bit mask.
 */
function readEdgeMask(cell: GraphLaneCell): number {
  return (
    (cell.up ? GRAPH_EDGE_UP : 0) |
    (cell.down ? GRAPH_EDGE_DOWN : 0) |
    (cell.left ? GRAPH_EDGE_LEFT : 0) |
    (cell.right ? GRAPH_EDGE_RIGHT : 0)
  );
}
