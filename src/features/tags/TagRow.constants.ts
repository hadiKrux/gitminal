/** Width of the leading indent that aligns a tag row with the panel filter field. */
export const TAG_ROW_INDENT_WIDTH = 1;

/** Width of the separator between the tag name and the commit subject. */
export const TAG_ROW_SEPARATOR_WIDTH = 1;

/** Budget below which the commit subject is dropped instead of truncated further. */
export const TAG_ROW_MIN_SUBJECT_BUDGET = 8;

/** Largest commit-subject budget, so a wide terminal never turns a row into a long line. */
export const TAG_ROW_MAX_SUBJECT_BUDGET = 30;

/**
 * Fixed width of the scope indicator: two brackets plus the local and remote slots.
 *
 * The width never depends on the state, so rows keep a stable layout and the subject budget needs
 * no per-state measurement.
 */
export const TAG_SCOPE_INDICATOR_WIDTH = 4;
