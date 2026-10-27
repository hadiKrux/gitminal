import { ICONS } from "@/theme/icons";

/** Bit that marks a line touching the top edge of a graph cell. */
export const GRAPH_EDGE_UP = 1;

/** Bit that marks a line touching the bottom edge of a graph cell. */
export const GRAPH_EDGE_DOWN = 2;

/** Bit that marks a line touching the left edge of a graph cell. */
export const GRAPH_EDGE_LEFT = 4;

/** Bit that marks a line touching the right edge of a graph cell. */
export const GRAPH_EDGE_RIGHT = 8;

/**
 * Line glyph for every combination of graph cell edges, indexed by the edge bit mask.
 *
 * The table is lazygit's `getBoxDrawingChars` result: a cell with both a top and a bottom edge is
 * the vertical bar, so a lane passing through another line's bend stays readable, and a cell with
 * only horizontal edges is the horizontal bar. The mask is `up | down | left | right`.
 */
export const GRAPH_LINE_GLYPHS: readonly string[] = Object.freeze([
  " ",
  ICONS.graphEndUp,
  ICONS.graphEndDown,
  ICONS.graphVertical,
  ICONS.graphHorizontal,
  ICONS.graphUpLeft,
  ICONS.graphDownLeft,
  ICONS.graphVertical,
  ICONS.graphEndRight,
  ICONS.graphUpRight,
  ICONS.graphDownRight,
  ICONS.graphVertical,
  ICONS.graphHorizontal,
  ICONS.graphTeeUp,
  ICONS.graphTeeDown,
  ICONS.graphVertical,
]);

/** Cell content used when a row is shorter than the requested lane width. */
export const GRAPH_EMPTY_LANE = "  ";
