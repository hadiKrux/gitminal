/**
 * Columns a tab advances to when a unified patch line is measured.
 *
 * The renderer's exact tab advance is not documented, so 4 is an assumption. Over-estimating is
 * harmless because the renderable only becomes a little wider than it needs to be, while
 * under-estimating clips the last columns of a tab-indented line.
 */
export const DIFF_TAB_STOP_WIDTH = 4;

/** Minimum gutter columns OpenTUI reserves for diff line numbers. */
export const DIFF_GUTTER_MIN_WIDTH = 3;

/** Cells the gutter keeps between the line number and its trailing separator. */
export const DIFF_GUTTER_PADDING_RIGHT = 1;

/** Cells the gutter adds after the widest line number. */
export const DIFF_GUTTER_SEPARATOR_WIDTH = 1;

/**
 * Cells one added or removed sign occupies in the gutter.
 *
 * OpenTUI paints unified signs as `" +"` and `" -"`, so the sign cell pair includes a leading
 * space and occupies two columns rather than one.
 */
export const DIFF_GUTTER_SIGN_WIDTH = 2;

/**
 * Hunk header prefix that separates a patch's leading headers from its rendered lines.
 *
 * The renderable draws only the hunk content after this line, so a long path in a `diff --git`
 * header must not widen the renderable.
 */
export const DIFF_HUNK_HEADER_PREFIX = "@@ ";
