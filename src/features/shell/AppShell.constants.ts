/**
 * Cells taken by the top-bar frame border and its title padding.
 *
 * The native border draws one corner cell on each side, and `Panel` pads the title with one space on
 * each side. The title text is the same in both focus states, so no marker width is reserved.
 */
export const TOP_BAR_TITLE_CHROME_WIDTH = 4;

/** Maximum height of the console drawer, in rows, including its frame. */
export const CONSOLE_DRAWER_MAX_HEIGHT = 11;

/** Minimum height of the console drawer, in rows, including its frame. */
export const CONSOLE_DRAWER_MIN_HEIGHT = 5;

/** Share of the terminal height the console drawer may take. */
export const CONSOLE_DRAWER_HEIGHT_DIVISOR = 3;
