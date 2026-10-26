/** Overlay entry id of the help modal. */
export const HELP_OVERLAY_ID = "help";

/** Action id that opens and toggles help. */
export const HELP_TOGGLE_ACTION_ID = "app.help";

/** Stable renderable id of the help modal frame. */
export const HELP_MODAL_ID = "help-modal";

/** Stable renderable id of the help search input. */
export const HELP_SEARCH_INPUT_ID = "help-search";

/** Stable renderable id of the scrollable help body. */
export const HELP_BODY_ID = "help-body";

/** Modal title. */
export const HELP_TITLE = "Help";

/** Search placeholder. */
export const HELP_SEARCH_PLACEHOLDER = "Search actions, keys, and descriptions";

/** Requested modal width in cells; `ModalFrame` clamps it to the terminal. */
export const HELP_MODAL_WIDTH = 88;

/** Requested modal height in rows; `ModalFrame` clamps it to the terminal. */
export const HELP_MODAL_HEIGHT = 26;

/** Columns the modal chrome occupies outside the row text, including the scrollbar. */
export const HELP_MODAL_CHROME_COLUMNS = 4;

/** Action id that focuses the search field. */
export const HELP_SEARCH_ACTION_ID = "help.search";

/** Action id that clears the search and then closes help. */
export const HELP_CLOSE_ACTION_ID = "overlay.close";
