/** Overlay entry id of the command palette. */
export const PALETTE_OVERLAY_ID = "command-palette";

/** Stable renderable id of the palette search input. */
export const PALETTE_SEARCH_INPUT_ID = "palette-search";

/** Stable renderable id of the palette result select. */
export const PALETTE_SELECT_ID = "palette-results";

/** Modal title. */
export const PALETTE_TITLE = "Command palette";

/** Search placeholder. */
export const PALETTE_SEARCH_PLACEHOLDER = "Search commands";

/** Requested modal width in cells; `ModalFrame` clamps it to the terminal. */
export const PALETTE_WIDTH = 72;

/** Columns the modal chrome occupies outside the option text. */
export const PALETTE_RESERVED_COLUMNS = 10;

/** Rows reserved for terminal insets, borders, padding, search, hints, and content gaps. */
export const PALETTE_RESERVED_ROWS = 12;

/** Largest option window handed to the native select. */
export const PALETTE_MAX_OPTION_ROWS = 15;

/** Smallest usable option window. */
export const PALETTE_MIN_OPTION_ROWS = 1;

/** Session recents are capped at this many command ids. */
export const PALETTE_RECENT_LIMIT = 5;

/** Action id that toggles the palette closed while it is open. */
export const PALETTE_TOGGLE_ACTION_ID = "app.palette";

/** Action id that closes the palette without running anything. */
export const PALETTE_CLOSE_ACTION_ID = "overlay.close";

/** Action id that moves focus to the result list. */
export const PALETTE_NEXT_FIELD_ACTION_ID = "focus.next";

/** Action id that runs the highlighted command. */
export const PALETTE_ACTIVATE_ACTION_ID = "nav.activate";

/**
 * Command ids whose palette activation only dismisses the palette.
 *
 * `app.palette` is the palette's own global toggle. Activating that row must close the palette and
 * stop: the overlay has already closed by the time a post-restore completion runs, so the toggle
 * would observe no open palette and reopen it, losing the query and the highlight.
 */
export const PALETTE_SELF_COMMAND_IDS: ReadonlySet<string> = Object.freeze(
  new Set([PALETTE_TOGGLE_ACTION_ID]),
);
