/** Leading spaces on every continuation line of an entry row. */
export const CONSOLE_ROW_INDENT = "  ";

/** Width of the row indent in cells. */
export const CONSOLE_ROW_INDENT_WIDTH = CONSOLE_ROW_INDENT.length;

/** Label before a non-root working directory. */
export const CONSOLE_ROW_CWD_LABEL = "cwd";

/** Cells consumed by the indent, the cwd label, and its trailing space. */
export const CONSOLE_ROW_CWD_BUDGET_WIDTH =
  CONSOLE_ROW_INDENT_WIDTH + CONSOLE_ROW_CWD_LABEL.length + 1;
