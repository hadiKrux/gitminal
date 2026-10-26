/** Stable renderable id of the composer textarea, used by the shell-owned `commit.focus`. */
export const COMPOSER_TEXTAREA_ID = "commit-composer-textarea";

/** Stable renderable id of the icon-only More button. */
export const COMPOSER_MORE_BUTTON_ID = "commit-composer-more";

/** Stable renderable id of the primary Commit button. */
export const COMPOSER_COMMIT_BUTTON_ID = "commit-composer-commit";

/** Stable renderable id of the auto-grown scroll region used past eight rows. */
export const COMPOSER_SCROLL_ID = "commit-composer-scroll";

/** Stable renderable id of the commit options select. */
export const COMPOSER_MENU_SELECT_ID = "commit-options-select";

/** Stable overlay entry id of the commit options menu. */
export const COMPOSER_MENU_OVERLAY_ID = "commit-options-menu";

/** Action id that opens the commit options menu. */
export const COMMIT_OPTIONS_ACTION_ID = "commit.options";

/** Primary Commit button label while the normal commit has no staged files. */
export const COMPOSER_NOTHING_TO_COMMIT_LABEL = "Nothing to commit";

/** Primary Commit button label. */
export const COMPOSER_COMMIT_LABEL = "Commit";

/** Text shown while a commit or amend is running. */
export const COMPOSER_COMMITTING_LABEL = "Committing...";

/** Rows the textarea grows to before it scrolls inside a bounded region. */
export const COMPOSER_MAX_VISIBLE_ROWS = 8;

/** Rows the composer body reserves for the staged, identity, label, button, and reason rows. */
export const COMPOSER_RESERVED_ROWS = 5;

/** Minimum textarea rows, so an empty draft still has a visible field. */
export const COMPOSER_MIN_ROWS = 1;
