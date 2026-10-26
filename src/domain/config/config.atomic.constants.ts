/** Suffix of every temp file this writer creates next to its target. */
export const TEMP_FILE_SUFFIX = ".tmp";

/**
 * Token used when the random base-36 slice is empty.
 *
 * The fallback is a single base-36 digit, so a temp name always matches
 * `TEMP_FILE_MIDDLE_PATTERN` and can never leave an unsweepable file behind.
 */
export const TEMP_FILE_TOKEN_FALLBACK = "0";

/**
 * Age after which a leftover matching temp file is treated as stale.
 *
 * A temp file younger than this may belong to another gitminal process that is still between its
 * write and its rename, so the sweep leaves it alone; a file older than this is residue from a
 * killed process when the writer shares this host's clock. A same-host, same-clock writer is
 * protected, while a skewed clock on a shared filesystem can misjudge the age.
 */
export const STALE_TEMP_FILE_AGE_MS = 60_000;

/**
 * Shape of the middle segment of this writer's temp file name.
 *
 * `buildTempPath` writes `<digits>-<base36 token>`, so a sibling such as `.config.json.notes.tmp`
 * never matches and is never removed.
 */
export const TEMP_FILE_MIDDLE_PATTERN = /^\d+-[a-z0-9]+$/;
