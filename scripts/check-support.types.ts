/** A single checker finding tied to a file and line. */
export interface Diagnostic {
  /** Repository-relative file path in POSIX form. */
  file: string;
  /** One-based line number of the finding. */
  line: number;
  /** Human-readable explanation. */
  message: string;
}
