/** Width of the leading selection marker `ListRow` renders. */
export const TAG_ROW_MARKER_WIDTH = 1;

/** Width of the separator between the tag name and the commit subject. */
export const TAG_ROW_SEPARATOR_WIDTH = 1;

/** Budget below which the commit subject is dropped instead of truncated further. */
export const TAG_ROW_MIN_SUBJECT_BUDGET = 8;

/** Largest commit-subject budget, so a wide terminal never turns a row into a long line. */
export const TAG_ROW_MAX_SUBJECT_BUDGET = 30;

/** Text shown when local scope cannot be confirmed against remote tag knowledge. */
export const TAG_ROW_UNKNOWN_SCOPE_TEXT = "remote unknown";
