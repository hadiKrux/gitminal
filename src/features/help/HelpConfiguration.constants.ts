/** Value shown for a configuration file that is not present. */
export const HELP_FILE_NOT_PRESENT = "not present";

/** Label of the resolved `config.json` row. */
export const HELP_CONFIG_LABEL = "Config file";

/** Label of the resolved `keybindings.json` row. */
export const HELP_KEYBINDINGS_LABEL = "Keybindings file";

/** Label of the resolved `theme.json` row. */
export const HELP_THEME_FILE_LABEL = "Theme file";

/** Label of the per-file load status row. */
export const HELP_LOAD_STATUS_LABEL = "Load status";

/** Label of the active theme row. */
export const HELP_ACTIVE_THEME_LABEL = "Active theme";

/** Maximum configuration warnings rendered in the section. */
export const HELP_MAX_WARNINGS = 5;

/** Summary line for warnings beyond the display cap. */
export const HELP_MORE_WARNINGS_PREFIX = "and";

/** Summary line suffix for warnings beyond the display cap. */
export const HELP_MORE_WARNINGS_SUFFIX = "more; see the console";

/** Markdown note that points at the reload entry point. */
export const HELP_RELOAD_NOTE = "Reload configuration is available from the command palette.";

/** Stable id of the rendered reload note. */
export const HELP_RELOAD_NOTE_ID = "help-reload-note";

/** Note describing the `field` input mode. */
export const HELP_FIELD_NOTE =
  "field: printable and editing keys stay in the focused field. Enter submits a single-line field and inserts a newline in a multiline field.";

/** Note describing the `search` input mode. */
export const HELP_SEARCH_NOTE =
  "search: arrows, paging, and Enter drive the result list while the query keeps focus.";

/** Note describing the `form` input mode before the effective submit keys. */
export const HELP_FORM_NOTE_PREFIX =
  "form: Tab moves between fields and footer actions. A multiline form submits with form.submit";

/** Note describing the `form` input mode after the effective submit keys. */
export const HELP_FORM_NOTE_SUFFIX = "; Tab indents inside a multiline field.";

/** Fallback submit key label when `form.submit` is unbound. */
export const HELP_FORM_SUBMIT_UNBOUND = "unbound";

/** Separator between several effective submit keys. */
export const HELP_FORM_SUBMIT_SEPARATOR = " or ";

/** Prefix of the file key used for a missing display label. */
export const HELP_FILE_KEY_LABELS: Readonly<Record<string, string>> = Object.freeze({
  config: "config.json",
  keybindings: "keybindings.json",
  theme: "theme.json",
});
