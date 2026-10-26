import type {
  GraphFileStat,
  GraphFileStatus,
  GraphLogParseError,
  GraphLogParseErrorKind,
  GraphLogParseResult,
  GraphRow,
} from "@/domain/graph/graph.types";

/**
 * Version of the record format this parser understands.
 *
 * Mirrors `GRAPH_LOG_FORMAT_VERSION` in `git.log.ts`; the builder and the parser cannot import each
 * other without a cycle, so the pair is asserted by the colocated tests.
 */
const LOG_FORMAT_VERSION = "1";

/** Field separator of the versioned log format, which cannot appear in a message or path. */
const LOG_FIELD_SEPARATOR = "\x00";

/** Record separator that starts and ends every versioned log record. */
const LOG_RECORD_SEPARATOR = "\x1e";

/** Number of NUL-separated fields in one versioned log record. */
const LOG_FIELD_COUNT = 9;

/** Status character that marks a rename in the raw block. */
const RAW_RENAME_PREFIX = "R";

/** Status character that marks a copy in the raw block. */
const RAW_COPY_PREFIX = "C";

/** Numstat column value git prints for a binary file. */
const NUMSTAT_BINARY = "-";

/** Tab that separates the three numstat columns. */
const NUMSTAT_SEPARATOR = "\t";

/** Line feed git writes after the commit separator when a diff block follows. */
const FILE_BLOCK_LINE_FEED = "\n";

/** Maximum digits accepted for a numeric numstat column before it is treated as malformed. */
const MAX_NUMSTAT_DIGITS = 12;

/**
 * Shape of the object-id field that starts every record.
 *
 * Git writes a 40-character SHA-1 or 64-character SHA-256 id. The parser also accepts the shorter
 * alphanumeric labels its recorded fixtures use, because the check only needs to reject a NUL-free
 * path token, never to validate a real commit id.
 */
const LOG_OID_TOKEN = /^[0-9A-Za-z]{4,64}$/u;

/**
 * Shape of the parent field that follows the object id.
 *
 * A root commit writes an empty field; every other commit writes space-separated ids. Rejecting any
 * other character is the second piece of evidence that separates a record start from a path token.
 */
const LOG_PARENT_TOKEN = /^(?:[0-9A-Za-z]+(?: [0-9A-Za-z]+)*)?$/u;

/**
 * Parses the version-1 records of a `-z` `git log --raw --numstat` page.
 *
 * Each record starts and ends with the record separator. The fields between them are NUL-separated
 * and ordered oid, parents, author name, author email, author date, committer timestamp,
 * decorations, subject, and body. Git writes a NUL commit terminator after the closing separator and
 * then, when the commit changed anything, a raw block followed by a numstat block, both with NUL
 * path terminators. The file block is associated with the record that precedes it.
 *
 * A body cannot contain NUL, so the closing separator is the first record separator followed by a
 * NUL, and a later record starts only at a record separator followed by the version and a NUL. The
 * parser never guesses: a missing or unknown version, a wrong field count, and a repeated OID inside
 * one page are reported as typed errors.
 *
 * @param stdout - Captured `git log` output.
 * @returns The parsed rows or the typed parse error.
 */
export function parseLogRecords(stdout: string): GraphLogParseResult {
  if (stdout.length === 0) {
    return { ok: true, rows: [] };
  }

  const firstSeparator = stdout.indexOf(LOG_RECORD_SEPARATOR);

  if (firstSeparator < 0) {
    return parseError("missing-version", "graph log output has no record version marker");
  }

  if (stdout.slice(0, firstSeparator).trim().length > 0) {
    return parseError("missing-version", "graph log output does not start with a version marker");
  }

  const rows: GraphRow[] = [];
  const seen = new Set<string>();
  let startIndex: number | null = firstSeparator;

  while (startIndex !== null) {
    const read = readRecordAt(stdout, startIndex);

    if (!read.ok) {
      return { ok: false, error: read.error };
    }

    if (seen.has(read.row.oid)) {
      return parseError("duplicate-oid", `graph log page repeats commit ${read.row.oid}`);
    }

    seen.add(read.row.oid);
    rows.push(read.row);
    startIndex = read.nextIndex < 0 ? null : read.nextIndex;
  }

  return { ok: true, rows };
}

/** One record read: its display row and the next record offset, or the typed parse error. */
type RecordRead =
  | { readonly ok: true; readonly row: GraphRow; readonly nextIndex: number }
  | { readonly ok: false; readonly error: GraphLogParseError };

/**
 * Reads and builds the one record that starts at a record separator.
 *
 * The row is complete here, so the page loop only has to track repeated OIDs and the next offset.
 *
 * @param stdout - Captured log output.
 * @param startIndex - Index of the record separator that starts the record.
 * @returns The row and next record offset, or the typed error.
 */
function readRecordAt(stdout: string, startIndex: number): RecordRead {
  const header = readRecordHeader(stdout, startIndex);

  if (!header.ok) {
    return header;
  }

  const closeIndex = findRecordEnd(stdout, header.contentStart);

  if (closeIndex < 0) {
    return {
      ok: false,
      error: { kind: "field-count", message: "graph log record is not terminated" },
    };
  }

  const fields = stdout.slice(header.contentStart, closeIndex).split(LOG_FIELD_SEPARATOR);

  if (fields.length !== LOG_FIELD_COUNT) {
    return {
      ok: false,
      error: {
        kind: "field-count",
        message: `graph log record has ${fields.length} fields, expected ${LOG_FIELD_COUNT}`,
      },
    };
  }

  const nextIndex = findNextRecordStart(stdout, closeIndex + 1);
  const fileBlock = stdout.slice(closeIndex + 1, nextIndex < 0 ? undefined : nextIndex);

  return { ok: true, row: buildRow(fields, fileBlock), nextIndex };
}

/**
 * Reads and validates the version marker of one record.
 *
 * @param stdout - Captured log output.
 * @param startIndex - Index of the record separator that starts the record.
 * @returns The first content index, or the typed error.
 */
function readRecordHeader(
  stdout: string,
  startIndex: number,
):
  | { readonly ok: true; readonly contentStart: number }
  | { readonly ok: false; readonly error: GraphLogParseError } {
  const versionEnd = stdout.indexOf(LOG_FIELD_SEPARATOR, startIndex + 1);

  if (versionEnd < 0) {
    return { ok: false, error: missingVersionError(stdout, startIndex) };
  }

  const version = stdout.slice(startIndex + 1, versionEnd);

  if (version.length === 0) {
    return { ok: false, error: missingVersionError(stdout, startIndex) };
  }

  if (version !== LOG_FORMAT_VERSION) {
    return {
      ok: false,
      error: {
        kind: "unknown-version",
        message: `graph log record has unknown version ${version}`,
      },
    };
  }

  return { ok: true, contentStart: versionEnd + 1 };
}

/**
 * Builds the typed error for a record without a readable version.
 *
 * @param stdout - Captured log output.
 * @param startIndex - Index of the record separator that starts the record.
 * @returns The missing-version error.
 */
function missingVersionError(stdout: string, startIndex: number): GraphLogParseError {
  const found = stdout.slice(startIndex + 1, startIndex + 8);

  return {
    kind: "missing-version",
    message:
      found.length === 0
        ? "graph log record is missing its version"
        : "graph log record is missing its version field separator",
  };
}

/**
 * Finds the closing record separator of one record.
 *
 * The closing separator is the first record separator followed by the NUL commit terminator. A body
 * cannot contain NUL, so a record separator inside a message is never mistaken for the end.
 *
 * @param stdout - Captured log output.
 * @param from - Index just after the version and its field separator.
 * @returns The closing separator index, or -1 when the record is not terminated.
 */
function findRecordEnd(stdout: string, from: number): number {
  let index = stdout.indexOf(LOG_RECORD_SEPARATOR, from);

  while (index >= 0) {
    if (stdout[index + 1] === LOG_FIELD_SEPARATOR) {
      return index;
    }

    index = stdout.indexOf(LOG_RECORD_SEPARATOR, index + 1);
  }

  return -1;
}

/**
 * Finds the start of the next record after one file block.
 *
 * A record starts only at the record separator followed by the supported version, a field
 * separator, an object-id-shaped field, a field separator, and a parent-shaped field. The
 * separator, version, and NUL alone are not enough: with `-z` a legal file name can end a path token
 * with exactly the byte sequence `\x1e1\x00`, so a boundary also needs the two fields every record
 * begins with. A candidate that does not match them is skipped and the search continues.
 *
 * @param stdout - Captured log output.
 * @param from - Index just after the previous record's closing separator.
 * @returns The next record start, or -1 when this was the last record.
 */
function findNextRecordStart(stdout: string, from: number): number {
  const marker = `${LOG_RECORD_SEPARATOR}${LOG_FORMAT_VERSION}${LOG_FIELD_SEPARATOR}`;
  let index = stdout.indexOf(marker, from);

  while (index >= 0) {
    if (isRecordStart(stdout, index)) {
      return index;
    }

    index = stdout.indexOf(marker, index + 1);
  }

  return -1;
}

/**
 * Reports whether one candidate offset begins a record header.
 *
 * @param stdout - Captured log output.
 * @param startIndex - Index of the record separator that starts the candidate.
 * @returns True when the object id and parent fields follow the version marker.
 */
function isRecordStart(stdout: string, startIndex: number): boolean {
  const oidStart =
    startIndex +
    LOG_RECORD_SEPARATOR.length +
    LOG_FORMAT_VERSION.length +
    LOG_FIELD_SEPARATOR.length;
  const oidEnd = stdout.indexOf(LOG_FIELD_SEPARATOR, oidStart);

  if (oidEnd < 0 || !LOG_OID_TOKEN.test(stdout.slice(oidStart, oidEnd))) {
    return false;
  }

  const parentsStart = oidEnd + LOG_FIELD_SEPARATOR.length;
  const parentsEnd = stdout.indexOf(LOG_FIELD_SEPARATOR, parentsStart);

  return parentsEnd >= 0 && LOG_PARENT_TOKEN.test(stdout.slice(parentsStart, parentsEnd));
}

/**
 * Builds one display row from its parsed fields and file block.
 *
 * @param fields - Nine NUL-separated fields in format order.
 * @param fileBlock - Raw and numstat block that follows the record.
 * @returns The display row.
 */
function buildRow(fields: readonly string[], fileBlock: string): GraphRow {
  const files = parseFileBlock(fileBlock);

  return {
    oid: fields[0] ?? "",
    parents: splitParents(fields[1]),
    authorName: fields[2] ?? "",
    authorEmail: fields[3] ?? "",
    authorDate: fields[4] ?? "",
    committerTimestamp: parseInteger(fields[5], 0),
    decorations: splitDecorationEntries(fields[6]),
    subject: fields[7] ?? "",
    body: trimBody(fields[8] ?? ""),
    fileCount: files.length,
    additions: sumLineCount(files, "additions"),
    deletions: sumLineCount(files, "deletions"),
    files,
  };
}

/**
 * Splits the space-separated parent field.
 *
 * @param value - Raw `%P` value, empty for a root commit.
 * @returns Parent OIDs in git order.
 */
function splitParents(value: string | undefined): readonly string[] {
  if (value === undefined || value.length === 0) {
    return [];
  }

  return value.split(" ").filter((oid) => oid.length > 0);
}

/**
 * Splits the raw decoration field into its entries.
 *
 * `%D` joins entries with a comma and a space. A ref name cannot contain a space, so the separator
 * is unambiguous. Entries keep git's own form, for example `HEAD -> refs/heads/main` or
 * `tag: refs/tags/v1.0.0`. Exported so the single-commit details read uses one definition.
 *
 * @param value - Raw `%D` value.
 * @returns Decoration entries in git order.
 */
export function splitDecorationEntries(value: string | undefined): readonly string[] {
  if (value === undefined || value.length === 0) {
    return [];
  }

  return value
    .split(", ")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/**
 * Removes the trailing newline git appends to a non-empty body.
 *
 * @param value - Raw `%b` value.
 * @returns The body without trailing newlines.
 */
function trimBody(value: string): string {
  return value.replace(/\n+$/, "");
}

/**
 * Sums one numeric line-count column across the file stats.
 *
 * Binary files report null and contribute zero.
 *
 * @param files - Parsed file stats.
 * @param column - Column to sum.
 * @returns The total line count.
 */
function sumLineCount(files: readonly GraphFileStat[], column: "additions" | "deletions"): number {
  return files.reduce((total, file) => total + (file[column] ?? 0), 0);
}

/**
 * Parses the raw block and its numstat block, then joins them by path.
 *
 * The raw block supplies the file list and statuses; the numstat block supplies line counts. Git
 * writes all raw entries before all numstat entries, both with NUL terminators, and a rename or copy
 * pairs the old and new path in both blocks.
 *
 * @param block - Bytes between the record's closing separator and the next record.
 * @returns One file stat per raw path, in raw order.
 */
function parseFileBlock(block: string): readonly GraphFileStat[] {
  const tokens = readFileTokens(block);

  if (tokens.length === 0) {
    return [];
  }

  const rawEntries: RawFileEntry[] = [];
  const numstatEntries: NumstatFileEntry[] = [];
  let index = 0;

  while (index < tokens.length) {
    const read = readBlockEntry(tokens, index);

    collectBlockEntry(read, rawEntries, numstatEntries);
    index = read === null ? index + 1 : read.nextIndex;
  }

  return joinFileStats(rawEntries, numstatEntries);
}

/** One token group of a file block: a raw entry or a numstat entry, plus the next token index. */
type BlockEntryRead =
  | { readonly kind: "raw"; readonly entry: RawFileEntry; readonly nextIndex: number }
  | { readonly kind: "numstat"; readonly entry: NumstatFileEntry; readonly nextIndex: number };

/**
 * Reads the token group at one index as a raw entry or a numstat entry.
 *
 * A raw entry starts with the `:` metadata token; everything else is attempted as numstat.
 *
 * @param tokens - All file-block tokens.
 * @param index - Index of the first token of the group.
 * @returns The typed entry and next index, or null for a malformed group.
 */
function readBlockEntry(tokens: readonly string[], index: number): BlockEntryRead | null {
  const token = readToken(tokens, index);

  if (token.startsWith(":")) {
    const raw = readRawEntry(tokens, index);

    return raw === null ? null : { kind: "raw", ...raw };
  }

  const numstat = readNumstatEntry(tokens, index);

  return numstat === null ? null : { kind: "numstat", ...numstat };
}

/**
 * Files one read block entry into its accumulator.
 *
 * @param read - Typed entry read, or null for a malformed group that is skipped.
 * @param rawEntries - Raw entry accumulator in git order.
 * @param numstatEntries - Numstat entry accumulator in git order.
 */
function collectBlockEntry(
  read: BlockEntryRead | null,
  rawEntries: RawFileEntry[],
  numstatEntries: NumstatFileEntry[],
): void {
  if (read === null) {
    return;
  }

  if (read.kind === "raw") {
    rawEntries.push(read.entry);

    return;
  }

  numstatEntries.push(read.entry);
}

/**
 * Reads one file-block token, treating a missing token as an empty string.
 *
 * @param tokens - All file-block tokens.
 * @param index - Token index.
 * @returns The token, or an empty string past the end.
 */
function readToken(tokens: readonly string[], index: number): string {
  return tokens[index] ?? "";
}

/**
 * Splits the file block into its non-empty NUL-terminated tokens.
 *
 * @param block - Bytes after the closing record separator.
 * @returns Tokens without the commit separator, the diff line feed, or trailing empty tokens.
 */
function readFileTokens(block: string): readonly string[] {
  let start = 0;

  while (start < block.length) {
    const character = block[start];

    if (character !== LOG_FIELD_SEPARATOR && character !== FILE_BLOCK_LINE_FEED) {
      break;
    }

    start += 1;
  }

  const body = block.slice(start);

  if (body.length === 0) {
    return [];
  }

  const tokens = body.split(LOG_FIELD_SEPARATOR);

  while (tokens.at(-1) === "") {
    tokens.pop();
  }

  return tokens;
}

/** One parsed raw entry before numstat counts are joined. */
interface RawFileEntry {
  /** Path in the commit tree; the new path for a rename or copy. */
  readonly path: string;
  /** Previous path for a rename or copy. */
  readonly oldPath: string | null;
  /** Raw change kind. */
  readonly status: GraphFileStatus;
}

/** One parsed numstat entry before raw statuses are joined. */
interface NumstatFileEntry {
  /** Path in the commit tree; the new path for a rename or copy. */
  readonly path: string;
  /** Added lines, or null for a binary file. */
  readonly additions: number | null;
  /** Removed lines, or null for a binary file. */
  readonly deletions: number | null;
  /** True when both columns were `-`. */
  readonly binary: boolean;
}

/**
 * Reads one `:<mode> <mode> <sha> <sha> <status>` raw entry and its path tokens.
 *
 * @param tokens - All file-block tokens.
 * @param index - Index of the raw metadata token.
 * @returns The raw entry and the next token index, or null for a malformed entry.
 */
function readRawEntry(
  tokens: readonly string[],
  index: number,
): { readonly entry: RawFileEntry; readonly nextIndex: number } | null {
  const metadata = readToken(tokens, index).slice(1).split(" ");
  const statusCode = metadata.at(-1) ?? "";
  const status = toFileStatus(statusCode[0]);

  if (status === "renamed" || status === "copied") {
    return readPairedRawEntry(tokens, index, status);
  }

  const path = tokens[index + 1];

  return isPresentPath(path)
    ? { entry: { path, oldPath: null, status }, nextIndex: index + 2 }
    : null;
}

/**
 * Reads one raw entry that carries an old path and a new path token.
 *
 * @param tokens - All file-block tokens.
 * @param index - Index of the raw metadata token.
 * @param status - Renamed or copied status read from the metadata.
 * @returns The raw entry and the next token index, or null for a malformed entry.
 */
function readPairedRawEntry(
  tokens: readonly string[],
  index: number,
  status: GraphFileStatus,
): { readonly entry: RawFileEntry; readonly nextIndex: number } | null {
  const path = tokens[index + 2];

  return isPresentPath(path)
    ? {
        entry: { path, oldPath: tokens[index + 1] ?? null, status },
        nextIndex: index + 3,
      }
    : null;
}

/**
 * Reports whether a token is a usable path.
 *
 * @param path - Candidate token.
 * @returns True when the token exists and is not empty.
 */
function isPresentPath(path: string | undefined): path is string {
  return path !== undefined && path.length > 0;
}

/**
 * Reads one `<added>\t<removed>\t<path>` numstat token and its rename path tokens.
 *
 * A rename or copy writes an empty path column and then the old and new path as separate tokens. The
 * first two tabs always delimit the numeric columns, so a path that contains a tab stays intact.
 *
 * @param tokens - All file-block tokens.
 * @param index - Index of the numstat token.
 * @returns The numstat entry and the next token index, or null for a malformed entry.
 */
function readNumstatEntry(
  tokens: readonly string[],
  index: number,
): { readonly entry: NumstatFileEntry; readonly nextIndex: number } | null {
  const token = tokens[index] ?? "";
  const firstTab = token.indexOf(NUMSTAT_SEPARATOR);

  if (firstTab < 0) {
    return null;
  }

  const secondTab = token.indexOf(NUMSTAT_SEPARATOR, firstTab + 1);

  if (secondTab < 0) {
    return null;
  }

  const added = token.slice(0, firstTab);
  const removed = token.slice(firstTab + 1, secondTab);
  const pathColumn = token.slice(secondTab + 1);
  const binary = added === NUMSTAT_BINARY && removed === NUMSTAT_BINARY;

  if (pathColumn.length > 0) {
    return {
      entry: {
        path: pathColumn,
        additions: readCount(added, binary),
        deletions: readCount(removed, binary),
        binary,
      },
      nextIndex: index + 1,
    };
  }

  const path = tokens[index + 2];

  return path === undefined || path.length === 0
    ? null
    : {
        entry: {
          path,
          additions: readCount(added, binary),
          deletions: readCount(removed, binary),
          binary,
        },
        nextIndex: index + 3,
      };
}

/**
 * Joins raw statuses with numstat line counts by path.
 *
 * @param rawEntries - Raw entries in git order.
 * @param numstatEntries - Numstat entries in git order.
 * @returns One stat per raw path, in raw order.
 */
function joinFileStats(
  rawEntries: readonly RawFileEntry[],
  numstatEntries: readonly NumstatFileEntry[],
): readonly GraphFileStat[] {
  const countsByPath = new Map<string, NumstatFileEntry>();

  for (const entry of numstatEntries) {
    if (!countsByPath.has(entry.path)) {
      countsByPath.set(entry.path, entry);
    }
  }

  return rawEntries.map((raw) => {
    const counts = countsByPath.get(raw.path);

    return {
      path: raw.path,
      oldPath: raw.oldPath,
      status: raw.status,
      additions: counts === undefined ? 0 : counts.additions,
      deletions: counts === undefined ? 0 : counts.deletions,
      binary: counts?.binary ?? false,
    };
  });
}

/**
 * Maps a raw status character to a typed file status.
 *
 * @param character - First character of the raw status, such as `M` or `R`.
 * @returns The typed status, or `unknown` for an unsupported code.
 */
function toFileStatus(character: string | undefined): GraphFileStatus {
  switch (character) {
    case "A":
      return "added";
    case "M":
      return "modified";
    case "D":
      return "deleted";
    case RAW_RENAME_PREFIX:
      return "renamed";
    case RAW_COPY_PREFIX:
      return "copied";
    case "T":
      return "type-changed";
    default:
      return "unknown";
  }
}

/**
 * Reads one numstat count column.
 *
 * @param value - Raw column text, a decimal count or `-`.
 * @param binary - True when both columns reported `-`.
 * @returns The count, or null for a binary file.
 */
function readCount(value: string, binary: boolean): number | null {
  return binary ? null : parseInteger(value, 0);
}

/**
 * Parses a decimal integer defensively.
 *
 * @param value - Raw text, possibly missing.
 * @param fallback - Value used when the text is not a bounded decimal number.
 * @returns The parsed integer or the fallback.
 */
function parseInteger(value: string | undefined, fallback: number): number {
  if (value === undefined || value.length === 0 || value.length > MAX_NUMSTAT_DIGITS) {
    return fallback;
  }

  return /^\d+$/.test(value) ? Number.parseInt(value, 10) : fallback;
}

/**
 * Builds one typed parse error.
 *
 * @param kind - Failure category.
 * @param message - One-line message.
 * @returns The parse result carrying the error.
 */
function parseError(kind: GraphLogParseErrorKind, message: string): GraphLogParseResult {
  return { ok: false, error: { kind, message } };
}
