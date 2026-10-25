import type { CommandResult } from "@/domain/commands/commands.types";

/** Escape byte, built without a regex literal so no control characters appear in source patterns. */
const ESCAPE = String.fromCharCode(27);

/** Bell byte that terminates an OSC sequence. */
const BELL = String.fromCharCode(7);

/** OSC sequences, terminated by BEL or ST. */
const OSC_SEQUENCE_PATTERN = new RegExp(
  `${ESCAPE}\\][^${BELL}${ESCAPE}]*(?:${BELL}|${ESCAPE}\\\\)`,
  "g",
);

/** CSI sequences such as color, cursor, and erase controls. */
const CSI_SEQUENCE_PATTERN = new RegExp(`${ESCAPE}\\[[0-?]*[ -/]*[@-~]`, "g");

/** Two-character escape sequences that are not CSI or OSC. */
const ESCAPE_SEQUENCE_PATTERN = new RegExp(`${ESCAPE}[@-_]`, "g");

/**
 * Invisible marks removed because they can hide or reorder visible text.
 *
 * The zero-width space, the bidi marks (LRM, RLM, ALM), the word joiner, the byte-order mark, and
 * the soft hyphen have no visible width and can be used to spoof a row. ZWNJ (U+200C) and ZWJ
 * (U+200D) are deliberately preserved: they are legitimate in Persian, Arabic, and Indic shaping and
 * in emoji sequences, and removing them would change the user's text.
 */
const REMOVED_INVISIBLE_CODE_POINTS: ReadonlySet<number> = new Set([
  0x00ad, 0x061c, 0x200b, 0x200e, 0x200f, 0x2060, 0xfeff,
]);

/** Removed control ranges other than tab and newline: C0, DEL, C1, and bidi embeddings. */
const REMOVED_CONTROL_RANGES: readonly (readonly [number, number])[] = Object.freeze([
  [0x00, 0x08],
  [0x0b, 0x1f],
  [0x7f, 0x9f],
  [0x202a, 0x202e],
  [0x2066, 0x2069],
]);

/**
 * Removes terminal control characters from captured command text.
 *
 * Git output can contain ANSI color sequences when a user forces `color.ui=always`, progress frames
 * separated by carriage returns, and arbitrary hook output. The drawer and the error overlay render
 * those strings as plain text, so an ESC or CR byte would otherwise reach the cell buffer and
 * corrupt the frame. The function is pure and idempotent: it strips OSC, CSI, and two-character
 * escape sequences, normalizes a carriage return to a newline, and removes C0, DEL, C1, bidi
 * embeddings/isolates, and invisible marks other than ZWNJ and ZWJ while preserving newline and tab.
 *
 * @param value - Raw stdout, stderr, argv element, or error message.
 * @returns The same text with control sequences removed.
 */
export function sanitizeConsoleText(value: string): string {
  const withoutSequences = value
    .replace(OSC_SEQUENCE_PATTERN, "")
    .replace(CSI_SEQUENCE_PATTERN, "")
    .replace(ESCAPE_SEQUENCE_PATTERN, "")
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n");

  return removeControlCharacters(withoutSequences);
}

/**
 * Sanitizes text that is rendered on a single row.
 *
 * Command arguments and working directories render in `wrapMode="none"` rows, so a newline or tab
 * would otherwise add a visual line or shift the row layout. Control sequences are removed first,
 * then every remaining newline and tab becomes one space; stdout, stderr, and error messages keep
 * the multi-line behavior of `sanitizeConsoleText`.
 *
 * @param value - Raw argv element, cwd, warning, or other single-line text.
 * @returns The same text on one line.
 */
export function sanitizeConsoleLine(value: string): string {
  return sanitizeConsoleText(value).replaceAll("\n", " ").replaceAll("\t", " ");
}

/**
 * Sanitizes every text field of a command result before it is capped or stored.
 *
 * The orchestrator calls this once after redaction and before formatting, so the console entry and
 * the persisted error detail cannot contain terminal control bytes. Command arguments, the working
 * directory, and warnings are single-line fields, so they use the single-line mode; stdout and
 * stderr keep newlines and tabs. The result shape, step order, and flags are preserved.
 *
 * @param result - Redacted command result.
 * @returns A new result with sanitized cwd, argv, warnings, stdout, and stderr.
 */
export function sanitizeCommandResult(result: CommandResult): CommandResult {
  return {
    ...result,
    cwd: sanitizeConsoleLine(result.cwd),
    warnings: result.warnings?.map(sanitizeConsoleLine),
    steps: result.steps.map((step) => ({
      ...step,
      argv: step.argv.map(sanitizeConsoleLine),
      stdout: sanitizeConsoleText(step.stdout),
      stderr: sanitizeConsoleText(step.stderr),
    })),
  };
}

/**
 * Reports whether a code point must be removed from captured text.
 *
 * Newline and tab are outside the removed ranges so multi-line output keeps its shape. C0 controls,
 * DEL, the C1 range that carries 8-bit CSI and OSC introducers, bidi embeddings and isolates, and
 * invisible marks other than ZWNJ and ZWJ are removed because they either corrupt the cell buffer or
 * visually spoof the text.
 *
 * @param code - Code point to classify.
 * @returns True when the code point is not allowed in rendered text.
 */
function isRemovedControl(code: number): boolean {
  if (REMOVED_INVISIBLE_CODE_POINTS.has(code)) {
    return true;
  }

  return REMOVED_CONTROL_RANGES.some(([start, end]) => code >= start && code <= end);
}

/**
 * Keeps only printable characters, newline, and tab.
 *
 * @param value - Text with control bytes removed or not.
 * @returns The printable text.
 */
function removeControlCharacters(value: string): string {
  let result = "";

  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;

    if (!isRemovedControl(code)) {
      result += character;
    }
  }

  return result;
}
