/** Line and byte caps applied to one parsed file diff. */
export interface DiffLimits {
  /** Maximum retained lines. */
  readonly maxLines: number;
  /** Maximum retained UTF-8 bytes. */
  readonly maxBytes: number;
}

/** Result of applying the caps to one diff. */
export interface DiffLimitResult {
  /** The retained unified diff, cut only at a hunk boundary. */
  readonly text: string;
  /** True when at least one hunk was dropped or the header alone exceeded a cap. */
  readonly truncated: boolean;
  /** Total lines in the original diff. */
  readonly totalLines: number;
  /** Lines retained in `text`. */
  readonly shownLines: number;
  /** UTF-8 bytes in the original diff. */
  readonly totalBytes: number;
  /** UTF-8 bytes retained in `text`. */
  readonly shownBytes: number;
}
