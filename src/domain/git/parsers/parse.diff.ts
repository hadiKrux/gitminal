import type {
  DiffFileStatus,
  DiffHunk,
  DiffLine,
  DiffParseError,
  DiffParseResult,
  DiffParseWarning,
  FileDiff,
  FileDiffParseResult,
  ParseDiffOptions,
} from "@/domain/diff/diff.types";

/** Matches a unified hunk header, capturing the old range, new range, and optional heading. */
const HUNK_HEADER_PATTERN = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?: (.*))?$/;

/** Prefix of a `diff --git` file boundary line. */
const DIFF_GIT_PREFIX = "diff --git ";

/** Prefixes of git's combined diff formats, which the panel never renders. */
const COMBINED_DIFF_PREFIXES: readonly string[] = Object.freeze(["diff --cc ", "diff --combined "]);

/** Prefix of the no-newline marker line. */
const NO_NEWLINE_PREFIX = "\\";

/** Prefixes of the conflict markers a synthetic conflict patch carries as context text. */
const CONFLICT_MARKER_PATTERN = /^(?:<{7}|={7}|>{7}|\|{7})/;

/** Header lines that may appear before the first `diff --git` line of a single-file patch. */
const IMPLICIT_HEADER_PREFIXES: readonly string[] = Object.freeze([
  "index ",
  "old mode ",
  "new mode ",
  "new file mode ",
  "deleted file mode ",
  "similarity index ",
  "dissimilarity index ",
  "rename from ",
  "rename to ",
  "copy from ",
  "copy to ",
  "Binary files ",
]);

/** One recognized non-hunk header line and the accumulator write it performs. */
interface FileLineRule {
  /** Label prefix that owns the line; the rest of the line is the rule value. */
  readonly prefix: string;
  /** Applies the value after the prefix to the accumulator. */
  readonly apply: (file: MutableFile, value: string) => void;
}

/** Non-hunk header rules in match order; the first matching prefix owns the line. */
const FILE_LINE_RULES: readonly FileLineRule[] = Object.freeze([
  {
    prefix: "--- ",
    apply: (file, value) => {
      file.oldPath = readHeaderPath(value);
      file.added = file.oldPath === null;
    },
  },
  {
    prefix: "+++ ",
    apply: (file, value) => {
      file.path = readHeaderPath(value);
      file.deleted = file.path === null;
    },
  },
  {
    prefix: "rename from ",
    apply: (file, value) => {
      file.renameFrom = value;
      file.oldPath = value;
    },
  },
  {
    prefix: "rename to ",
    apply: (file, value) => {
      file.renameTo = value;
      file.path = value;
    },
  },
  {
    prefix: "copy from ",
    apply: (file, value) => {
      file.copyFrom = value;
      file.oldPath = value;
    },
  },
  {
    prefix: "copy to ",
    apply: (file, value) => {
      file.copyTo = value;
      file.path = value;
    },
  },
  {
    prefix: "old mode ",
    apply: (file, value) => {
      file.oldMode = value;
    },
  },
  {
    prefix: "new mode ",
    apply: (file, value) => {
      file.newMode = value;
    },
  },
  {
    prefix: "new file mode ",
    apply: (file) => {
      file.added = true;
    },
  },
  {
    prefix: "deleted file mode ",
    apply: (file) => {
      file.deleted = true;
    },
  },
  { prefix: DIFF_GIT_PREFIX, apply: applyDiffGitPaths },
]);

/** Mutable accumulator for one file while parsing. */
interface MutableFile {
  /** Every source line of the file, for `raw`. */
  readonly rawLines: string[];
  /** Lines before the first hunk. */
  readonly headerLines: string[];
  /** Parsed hunks. */
  readonly hunks: DiffHunk[];
  /** Current path from a header line. */
  path: string | null;
  /** Pre-change path from a header line. */
  oldPath: string | null;
  /** `rename from` value. */
  renameFrom: string | null;
  /** `rename to` value. */
  renameTo: string | null;
  /** `copy from` value. */
  copyFrom: string | null;
  /** `copy to` value. */
  copyTo: string | null;
  /** `old mode` value. */
  oldMode: string | null;
  /** `new mode` value. */
  newMode: string | null;
  /** True when `--- /dev/null` reported a new file. */
  added: boolean;
  /** True when `+++ /dev/null` reported a deleted file. */
  deleted: boolean;
  /** True when a binary notice was seen. */
  binary: boolean;
  /** True when a no-newline marker was seen. */
  hasNoNewlineMarker: boolean;
}

/** Mutable accumulator for the hunk currently being parsed. */
interface MutableHunk {
  /** Original header line. */
  readonly header: string;
  /** Parsed range and heading. */
  readonly oldStart: number;
  readonly oldCount: number;
  readonly newStart: number;
  readonly newCount: number;
  readonly heading: string | null;
  /** Parsed lines. */
  readonly lines: DiffLine[];
  /** Next old-file line number. */
  oldCursor: number;
  /** Next new-file line number. */
  newCursor: number;
  /** One-based source line number of the header. */
  readonly sourceLine: number;
}

/** Mutable parse state shared by the per-line helpers of one `parseDiff` call. */
interface DiffParseCursor {
  /** Completed files in source order. */
  readonly files: FileDiff[];
  /** Warnings raised so far. */
  readonly warnings: DiffParseWarning[];
  /** Facts the caller already knows, applied when a file is completed. */
  readonly options: ParseDiffOptions;
  /** File currently being accumulated, or null before the first file. */
  current: MutableFile | null;
  /** Hunk currently being accumulated, or null outside a hunk. */
  hunk: MutableHunk | null;
}

/**
 * Parses unified diff text into one entry per file.
 *
 * The parser is tolerant by default: header lines, rename and mode metadata, binary notices, the
 * no-newline marker, and unrecognized hunk lines are kept as `meta` lines instead of throwing.
 * Malformed hunk headers, content before any file header, and git's combined `--cc` or `--combined`
 * output are reported as typed errors. The function never throws.
 *
 * @param text - Raw unified diff text, possibly containing several files.
 * @param options - Facts the caller already knows, such as the status path.
 * @returns Every parsed file plus any typed error or warnings.
 */
export function parseDiff(text: string, options: ParseDiffOptions = {}): DiffParseResult {
  const cursor = createParseCursor(options);

  for (const [offset, line] of splitLines(text).entries()) {
    const error = consumeLine(cursor, line, offset + 1);

    if (error !== null) {
      return { ok: false, files: cursor.files, error, warnings: cursor.warnings };
    }
  }

  finishFile(cursor);

  return { ok: true, files: cursor.files, warnings: cursor.warnings };
}

/**
 * Creates the empty parse state for one diff text.
 *
 * @param options - Facts the caller already knows, such as the status path.
 * @returns The parse cursor.
 */
function createParseCursor(options: ParseDiffOptions): DiffParseCursor {
  return { files: [], warnings: [], options, current: null, hunk: null };
}

/**
 * Consumes one source line.
 *
 * `diff --git` starts a new file, a combined diff format is a typed error, and every other line is
 * resolved against the current file before it is classified as hunk header, hunk body, or file
 * metadata. A blank line before the first file is ignored.
 *
 * @param cursor - Parse state.
 * @param line - Source line.
 * @param lineNumber - One-based source line number.
 * @returns A typed error when the line cannot be applied, or null.
 */
function consumeLine(
  cursor: DiffParseCursor,
  line: string,
  lineNumber: number,
): DiffParseError | null {
  if (line.startsWith(DIFF_GIT_PREFIX)) {
    startFile(cursor, line);

    return null;
  }

  if (isCombinedDiffLine(line)) {
    finishFile(cursor);

    return combinedDiffError(lineNumber);
  }

  const resolution = resolveFile(cursor, line, lineNumber);

  if (resolution === "skip") {
    return null;
  }

  if (resolution !== null) {
    return resolution;
  }

  return consumeResolvedLine(cursor, line, lineNumber);
}

/**
 * Consumes one line that belongs to an open file.
 *
 * @param cursor - Parse state with an open file.
 * @param line - Source line.
 * @param lineNumber - One-based source line number.
 * @returns A typed error when the hunk header is malformed, or null.
 */
function consumeResolvedLine(
  cursor: DiffParseCursor,
  line: string,
  lineNumber: number,
): DiffParseError | null {
  const file = cursor.current;

  // `resolveFile` opens or rejects every line before this point, so an open file is the only state
  // that can reach here; the guard keeps this helper total without throwing.
  if (file === null) {
    return null;
  }

  if (line.startsWith("@@")) {
    return startHunk(cursor, line, lineNumber);
  }

  if (cursor.hunk !== null && isHunkBodyLine(line)) {
    applyHunkBodyLine(cursor, line, lineNumber);

    return null;
  }

  if (cursor.hunk !== null) {
    finishHunk(cursor);
  }

  applyFileLine(file, line);
  file.rawLines.push(line);

  return null;
}

/**
 * Resolves which file a line belongs to, opening one from an implicit header when needed.
 *
 * @param cursor - Parse state.
 * @param line - Source line.
 * @param lineNumber - One-based source line number.
 * @returns Null when the line belongs to a file, `skip` for an ignorable blank line, or an error.
 */
function resolveFile(
  cursor: DiffParseCursor,
  line: string,
  lineNumber: number,
): DiffParseError | "skip" | null {
  if (cursor.current !== null) {
    return null;
  }

  if (isImplicitHeader(line)) {
    cursor.current = createMutableFile();

    return null;
  }

  if (line.length === 0) {
    return "skip";
  }

  return {
    kind: "content-before-file-header",
    line: lineNumber,
    message: "diff content appeared before any file header",
  };
}

/**
 * Starts a new file from its `diff --git` boundary line.
 *
 * @param cursor - Parse state.
 * @param line - The `diff --git` line, which belongs to the new file.
 */
function startFile(cursor: DiffParseCursor, line: string): void {
  finishFile(cursor);

  const file = createMutableFile();
  cursor.current = file;
  applyFileLine(file, line);
  file.rawLines.push(line);
}

/**
 * Starts a hunk from its `@@` header line.
 *
 * A malformed header completes the current file before the error is reported, so the files parsed
 * so far are still returned with the typed error.
 *
 * @param cursor - Parse state.
 * @param line - Hunk header line.
 * @param lineNumber - One-based source line number.
 * @returns The typed error for a malformed header, or null.
 */
function startHunk(
  cursor: DiffParseCursor,
  line: string,
  lineNumber: number,
): DiffParseError | null {
  finishHunk(cursor);

  const parsed = parseHunkHeader(line, lineNumber);

  if (!parsed.ok) {
    finishFile(cursor);

    return parsed.error;
  }

  cursor.hunk = parsed.hunk;
  cursor.current?.rawLines.push(line);

  return null;
}

/**
 * Applies one hunk body line and advances the line cursors.
 *
 * @param cursor - Parse state with an open file and hunk.
 * @param line - Source line.
 * @param lineNumber - One-based source line number.
 */
function applyHunkBodyLine(cursor: DiffParseCursor, line: string, lineNumber: number): void {
  const file = cursor.current;
  const hunk = cursor.hunk;

  if (file === null || hunk === null) {
    return;
  }

  if (line.startsWith(NO_NEWLINE_PREFIX)) {
    file.hasNoNewlineMarker = true;
  }

  applyHunkLine(hunk, line, lineNumber, cursor.warnings);
  file.rawLines.push(line);
}

/**
 * Completes the open hunk, recording it and any count warnings.
 *
 * @param cursor - Parse state.
 */
function finishHunk(cursor: DiffParseCursor): void {
  const hunk = cursor.hunk;

  if (cursor.current !== null && hunk !== null) {
    cursor.current.hunks.push(toHunk(hunk));
    cursor.warnings.push(...validateHunkCounts(hunk));
  }

  cursor.hunk = null;
}

/**
 * Completes the open file, recording it in source order.
 *
 * @param cursor - Parse state.
 */
function finishFile(cursor: DiffParseCursor): void {
  finishHunk(cursor);

  if (cursor.current !== null) {
    cursor.files.push(toFileDiff(cursor.current, cursor.options));
  }

  cursor.current = null;
}

/**
 * Reports whether a line starts git's unsupported combined diff format.
 *
 * @param line - Candidate source line.
 * @returns True for a `diff --cc` or `diff --combined` boundary line.
 */
function isCombinedDiffLine(line: string): boolean {
  return COMBINED_DIFF_PREFIXES.some((prefix) => line.startsWith(prefix));
}

/**
 * Builds the typed error for combined diff output.
 *
 * @param lineNumber - One-based source line number of the boundary line.
 * @returns The combined-diff error.
 */
function combinedDiffError(lineNumber: number): DiffParseError {
  return {
    kind: "combined-diff-unsupported",
    line: lineNumber,
    message: "combined diff output is not supported; use a synthetic unified patch instead",
  };
}

/**
 * Parses unified diff text and returns the first file.
 *
 * A read for one file still uses `parseDiff`, so a patch that unexpectedly contains several files
 * reports its first file and the same typed errors and warnings.
 *
 * @param text - Raw unified diff text.
 * @param options - Facts the caller already knows, such as the status path.
 * @returns The first parsed file, or null when the text holds no file.
 */
export function parseFileDiff(text: string, options: ParseDiffOptions = {}): FileDiffParseResult {
  const result = parseDiff(text, options);
  const file = result.files[0] ?? null;

  if (result.ok) {
    return { ok: true, file, warnings: result.warnings };
  }

  return { ok: false, file, error: result.error, warnings: result.warnings };
}

/**
 * Splits patch text into lines without a trailing empty line.
 *
 * @param text - Raw patch text.
 * @returns Source lines, keeping any carriage return that belongs to a line.
 */
function splitLines(text: string): string[] {
  if (text.length === 0) {
    return [];
  }

  const lines = text.split("\n");

  if (lines.at(-1) === "") {
    lines.pop();
  }

  return lines;
}

/**
 * Creates an empty file accumulator.
 *
 * @returns The mutable file.
 */
function createMutableFile(): MutableFile {
  return {
    rawLines: [],
    headerLines: [],
    hunks: [],
    path: null,
    oldPath: null,
    renameFrom: null,
    renameTo: null,
    copyFrom: null,
    copyTo: null,
    oldMode: null,
    newMode: null,
    added: false,
    deleted: false,
    binary: false,
    hasNoNewlineMarker: false,
  };
}

/**
 * Reports whether a line can start a file without a preceding `diff --git` line.
 *
 * @param line - Candidate source line.
 * @returns True for a known `---`/`+++` or metadata header line.
 */
function isImplicitHeader(line: string): boolean {
  if (line.startsWith("--- ") || line.startsWith("+++ ")) {
    return true;
  }

  return IMPLICIT_HEADER_PREFIXES.some((prefix) => line.startsWith(prefix));
}

/**
 * Applies one non-hunk line to the current file accumulator.
 *
 * The first matching rule owns the line; an unrecognized line stays in `headerLines` only, which is
 * how the parser keeps metadata such as `index` and `similarity index` without interpreting it.
 *
 * @param file - Mutable file.
 * @param line - Source line.
 */
function applyFileLine(file: MutableFile, line: string): void {
  file.headerLines.push(line);

  if (line.startsWith("Binary files ") || line === "GIT binary patch") {
    file.binary = true;

    return;
  }

  const rule = FILE_LINE_RULES.find((entry) => line.startsWith(entry.prefix));

  rule?.apply(file, line.slice(rule.prefix.length));
}

/**
 * Reads a path from a `---`, `+++`, or `diff --git` header value.
 *
 * A `/dev/null` value means the side does not exist and returns null. The `a/` and `b/` prefixes are
 * removed. Git's C-style quoting is preserved as-is; callers pass the status path as a fallback, so
 * an unusual or quoted header never decides the file identity on its own.
 *
 * @param value - Header value after the label.
 * @returns The root-relative path, or null for `/dev/null`.
 */
function readHeaderPath(value: string): string | null {
  const trimmed = value.trim();

  if (trimmed === "/dev/null") {
    return null;
  }

  if (trimmed.startsWith("a/") || trimmed.startsWith("b/")) {
    return trimmed.slice(2);
  }

  return trimmed;
}

/**
 * Reads the old and new paths from a `diff --git` line.
 *
 * The line is only a fallback identity: binary patches have no `---`/`+++` lines, so the last ` b/`
 * separator is used to split the two prefixes.
 *
 * @param file - Mutable file.
 * @param value - Value after `diff --git `.
 */
function applyDiffGitPaths(file: MutableFile, value: string): void {
  const separator = value.lastIndexOf(" b/");

  if (separator < 0) {
    return;
  }

  if (file.oldPath === null) {
    file.oldPath = readHeaderPath(value.slice(0, separator));
  }

  if (file.path === null) {
    file.path = readHeaderPath(`b/${value.slice(separator + " b/".length)}`);
  }
}

/**
 * Parses one `@@` hunk header.
 *
 * @param line - Hunk header line.
 * @param sourceLine - One-based source line number.
 * @returns The mutable hunk, or a typed error.
 */
function parseHunkHeader(
  line: string,
  sourceLine: number,
):
  | { readonly ok: true; readonly hunk: MutableHunk }
  | { readonly ok: false; readonly error: DiffParseError } {
  const match = HUNK_HEADER_PATTERN.exec(line);

  if (match === null) {
    return {
      ok: false,
      error: {
        kind: "malformed-hunk-header",
        line: sourceLine,
        message: `malformed hunk header: ${line}`,
      },
    };
  }

  const oldStart = Number.parseInt(match[1] ?? "0", 10);
  const oldCount = Number.parseInt(match[2] ?? "1", 10);
  const newStart = Number.parseInt(match[3] ?? "0", 10);
  const newCount = Number.parseInt(match[4] ?? "1", 10);
  const heading = match[5] !== undefined && match[5].length > 0 ? match[5] : null;

  return {
    ok: true,
    hunk: {
      header: line,
      oldStart,
      oldCount,
      newStart,
      newCount,
      heading,
      lines: [],
      oldCursor: oldStart,
      newCursor: newStart,
      sourceLine,
    },
  };
}

/**
 * Reports whether a line belongs to the open hunk body.
 *
 * @param line - Candidate line.
 * @returns True for context, add, remove, no-newline, raw conflict-marker, and empty lines.
 */
function isHunkBodyLine(line: string): boolean {
  if (line.length === 0) {
    return true;
  }

  const prefix = line[0];

  return (
    prefix === " " ||
    prefix === "+" ||
    prefix === "-" ||
    prefix === NO_NEWLINE_PREFIX ||
    CONFLICT_MARKER_PATTERN.test(line)
  );
}

/**
 * Applies one hunk body line and advances the line cursors.
 *
 * @param hunk - Mutable hunk.
 * @param line - Source line.
 * @param sourceLine - One-based source line number.
 * @param warnings - Warning accumulator.
 */
function applyHunkLine(
  hunk: MutableHunk,
  line: string,
  sourceLine: number,
  warnings: DiffParseWarning[],
): void {
  if (line.startsWith(NO_NEWLINE_PREFIX)) {
    hunk.lines.push({ kind: "meta", text: line, oldLine: null, newLine: null });

    return;
  }

  const prefix = line[0] ?? "";

  if (CONFLICT_MARKER_PATTERN.test(line)) {
    hunk.lines.push({ kind: "meta", text: line, oldLine: null, newLine: null });
    warnings.push({
      kind: "unknown-hunk-line",
      line: sourceLine,
      message: "conflict marker line inside a hunk has no line numbers",
    });

    return;
  }

  if (prefix === " ") {
    hunk.lines.push({
      kind: "context",
      text: line,
      oldLine: hunk.oldCursor,
      newLine: hunk.newCursor,
    });
    hunk.oldCursor += 1;
    hunk.newCursor += 1;

    return;
  }

  if (prefix === "+") {
    hunk.lines.push({ kind: "add", text: line, oldLine: null, newLine: hunk.newCursor });
    hunk.newCursor += 1;

    return;
  }

  if (prefix === "-") {
    hunk.lines.push({ kind: "remove", text: line, oldLine: hunk.oldCursor, newLine: null });
    hunk.oldCursor += 1;

    return;
  }

  hunk.lines.push({ kind: "meta", text: line, oldLine: null, newLine: null });
  warnings.push({
    kind: "unknown-hunk-line",
    line: sourceLine,
    message: `unrecognized hunk line prefix: ${line.slice(0, 1)}`,
  });
}

/**
 * Converts the mutable hunk to its immutable form.
 *
 * @param hunk - Mutable hunk.
 * @returns The parsed hunk.
 */
function toHunk(hunk: MutableHunk): DiffHunk {
  return {
    header: hunk.header,
    oldStart: hunk.oldStart,
    oldCount: hunk.oldCount,
    newStart: hunk.newStart,
    newCount: hunk.newCount,
    heading: hunk.heading,
    lines: [...hunk.lines],
  };
}

/**
 * Checks the declared hunk counts against the lines that carried line numbers.
 *
 * A mismatch is a warning, not a failure: the parser keeps the numbered lines so a partially
 * malformed patch still renders instead of disappearing.
 *
 * @param hunk - Mutable hunk.
 * @returns Warnings for each over- or under-counted side.
 */
function validateHunkCounts(hunk: MutableHunk): DiffParseWarning[] {
  const warnings: DiffParseWarning[] = [];
  const oldUsed = hunk.oldCursor - hunk.oldStart;
  const newUsed = hunk.newCursor - hunk.newStart;

  if (oldUsed !== hunk.oldCount) {
    warnings.push({
      kind: "hunk-count-mismatch",
      line: hunk.sourceLine,
      message: `hunk declared ${hunk.oldCount} old lines but contained ${oldUsed}`,
    });
  }

  if (newUsed !== hunk.newCount) {
    warnings.push({
      kind: "hunk-count-mismatch",
      line: hunk.sourceLine,
      message: `hunk declared ${hunk.newCount} new lines but contained ${newUsed}`,
    });
  }

  return warnings;
}

/**
 * Converts one mutable file to its immutable form.
 *
 * @param file - Mutable file.
 * @param options - Caller-known path, old path, and status.
 * @returns The parsed file.
 */
function toFileDiff(file: MutableFile, options: ParseDiffOptions): FileDiff {
  return {
    path: file.path ?? options.path ?? file.oldPath ?? "",
    oldPath: file.oldPath ?? options.oldPath ?? null,
    status: options.status ?? inferStatus(file),
    headerLines: [...file.headerLines],
    hunks: [...file.hunks],
    binary: file.binary,
    modeOnly: isModeOnlyChange(file),
    conflict: options.status === "conflicted",
    hasNoNewlineMarker: file.hasNoNewlineMarker,
    raw: joinRawLines(file.rawLines),
  };
}

/**
 * Joins the captured source lines into the raw patch text of one file.
 *
 * @param lines - Every source line of the file, in order.
 * @returns The lines with a trailing newline, or an empty string when there are no lines.
 */
function joinRawLines(lines: readonly string[]): string {
  return lines.length === 0 ? "" : `${lines.join("\n")}\n`;
}

/**
 * Reports whether the file changed only its mode.
 *
 * @param file - Mutable file.
 * @returns True when both mode headers are present and no hunk was parsed.
 */
function isModeOnlyChange(file: MutableFile): boolean {
  return file.oldMode !== null && file.newMode !== null && file.hunks.length === 0;
}

/**
 * Infers the changed-file status from the parsed headers.
 *
 * @param file - Mutable file.
 * @returns The inferred status.
 */
function inferStatus(file: MutableFile): DiffFileStatus {
  if (file.renameFrom !== null || file.renameTo !== null) {
    return "renamed";
  }

  if (file.copyFrom !== null || file.copyTo !== null) {
    return "copied";
  }

  if (file.deleted) {
    return "deleted";
  }

  if (file.added) {
    return "added";
  }

  return "modified";
}
