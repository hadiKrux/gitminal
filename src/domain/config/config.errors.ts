/**
 * Shared classification helpers for configuration filesystem failures.
 *
 * The configuration reader, the theme writer, and the atomic write all inspect thrown errors for
 * the same facts: the Node error code, whether the file is missing, and a single-line message safe
 * for a warning or the status strip. Keeping them in one module means the reader and the writer
 * cannot drift apart.
 */

/**
 * Reports whether a thrown error means the file does not exist.
 *
 * A missing file is a supported outcome in both directions: the reader treats it as the silent
 * default case, and the writer creates the minimal configuration or keeps the configured path.
 *
 * @param error - The thrown filesystem error.
 * @returns True when the error carries an `ENOENT` code.
 */
export function isMissingFileError(error: unknown): boolean {
  return readErrorCode(error) === "ENOENT";
}

/**
 * Reads the Node error code of a thrown value.
 *
 * @param error - Thrown value from a filesystem call.
 * @returns The error code, or an empty string when the error has none.
 */
export function readErrorCode(error: unknown): string {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : "";
}

/**
 * Reads a single-line message from a thrown value.
 *
 * Newlines become spaces, so one warning or status line can never break the layout.
 *
 * @param error - Thrown value from a filesystem call or a parser.
 * @returns A single-line message safe for console and status rendering.
 */
export function readErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  return message.replaceAll("\n", " ");
}
