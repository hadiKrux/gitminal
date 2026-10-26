/** Loading row label while the first read is in flight. */
export const REMOTES_LOADING_LABEL = "loading remote branches";

/** Empty state message when the repository has no remote-tracking branches. */
export const REMOTES_EMPTY_MESSAGE = "No remote branches";

/** Empty state hint naming the fetch scope rule. */
export const REMOTES_EMPTY_HINT = "Fetch updates upstream refs only";

/** Empty state message when no remote is configured. */
export const REMOTES_NO_REMOTES_MESSAGE = "No remotes configured";

/** Empty state hint for an empty repository with no commits. */
export const REMOTES_EMPTY_REPOSITORY_HINT = "no commits yet";

/** Empty state hint when the active filter matches no row. */
export const REMOTES_NO_MATCH_HINT = "Esc clears the filter";

/** Prefix of the empty state message when the filter matches nothing. */
export const REMOTES_NO_MATCH_PREFIX = "No remote branches match";

/** Error state message for a failed remote-branch read. */
export const REMOTES_ERROR_MESSAGE = "Could not read remote branches";

/** Read-only notice shown while another mutation runs. */
export const REMOTES_OPERATION_IN_PROGRESS = "operation in progress";

/** Disabled reason for `nav.activate` in the remotes region. */
export const REMOTES_NAV_ACTIVATE_REASON =
  "Enter does nothing in v1; press Space to create a local branch";

/** Prefix of the row-cap notice, followed by the visible, filtered, and hidden counts. */
export const REMOTES_TRUNCATION_LABEL = "showing first";
