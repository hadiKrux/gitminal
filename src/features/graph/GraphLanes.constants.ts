import type { GraphStyle } from "@/domain/config/config.types";
import { ICONS } from "@/theme/icons";

/** Bit that marks a line touching the top edge of a graph cell. */
export const GRAPH_EDGE_UP = 1;

/** Bit that marks a line touching the bottom edge of a graph cell. */
export const GRAPH_EDGE_DOWN = 2;

/** Bit that marks a line touching the left edge of a graph cell. */
export const GRAPH_EDGE_LEFT = 4;

/** Bit that marks a line touching the right edge of a graph cell. */
export const GRAPH_EDGE_RIGHT = 8;

/** Cell content used when a row is shorter than the requested lane width. */
export const GRAPH_EMPTY_LANE = "  ";

/** Glyphs of one commit graph style. */
export interface GraphGlyphSet {
  /** Commit node symbol. */
  readonly commit: string;
  /** Merge node symbol. */
  readonly merge: string;
  /** Horizontal connector that follows a cell with a right edge. */
  readonly connector: string;
  /** Line glyph per edge bit mask, indexed by `up | down | left | right`. */
  readonly lines: readonly string[];
}

/**
 * Line glyph table of the rounded style, indexed by the edge bit mask.
 *
 * The table is lazygit's `getBoxDrawingChars` result: a cell with both a top and a bottom edge is
 * the vertical bar, so a lane passing through another line's bend stays readable, and a cell with
 * only horizontal edges is the horizontal bar.
 */
const ROUNDED_LINES: readonly string[] = Object.freeze([
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

/**
 * Line glyph table of the sharp style, indexed by the edge bit mask.
 *
 * Every glyph is in WGL4 and CP437: the arc corners become sharp corners and the half-line ends
 * become full lines, so a font with only the IBM PC box-drawing subset still draws the tree.
 */
const SHARP_LINES: readonly string[] = Object.freeze([
  " ",
  ICONS.graphVertical,
  ICONS.graphVertical,
  ICONS.graphVertical,
  ICONS.graphHorizontal,
  ICONS.graphSharpUpLeft,
  ICONS.graphSharpDownLeft,
  ICONS.graphVertical,
  ICONS.graphHorizontal,
  ICONS.graphSharpUpRight,
  ICONS.graphSharpDownRight,
  ICONS.graphVertical,
  ICONS.graphHorizontal,
  ICONS.graphTeeUp,
  ICONS.graphTeeDown,
  ICONS.graphVertical,
]);

/**
 * Glyph sets by configured graph style.
 *
 * `rounded` is the lazygit-style arc set with the bullseye merge symbol. `sharp` trades the arcs for
 * WGL4 and CP437 safe corners and uses an ASCII `+` merge symbol, so it survives fonts and terminals
 * that lack the arc subset.
 */
export const GRAPH_GLYPHS: Readonly<Record<GraphStyle, GraphGlyphSet>> = Object.freeze({
  rounded: Object.freeze({
    commit: ICONS.graphCommit,
    merge: ICONS.graphMerge,
    connector: ICONS.graphHorizontal,
    lines: ROUNDED_LINES,
  }),
  sharp: Object.freeze({
    commit: ICONS.graphCommit,
    merge: ICONS.graphMergeSharp,
    connector: ICONS.graphHorizontal,
    lines: SHARP_LINES,
  }),
});
