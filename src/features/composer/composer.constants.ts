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

/** Placeholder shown in the empty message field. */
export const COMPOSER_PLACEHOLDER = "Commit message...";

/** Rows the composer body reserves for the identity/staged row and the button row. */
export const COMPOSER_RESERVED_ROWS = 2;

/** Rows the inline reason or state line takes when it renders. */
export const COMPOSER_REASON_ROWS = 1;

/** Columns between the identity line and the staged count on the composer meta row. */
export const COMPOSER_META_GAP = 2;

/** Cells of horizontal padding on each side of the composer body. */
export const COMPOSER_BODY_PADDING = 1;
