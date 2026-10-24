import type { ConsoleCapLimits, ConsoleEntry, ConsoleOutputBlock } from "./console.types";

/** Maximum console entries retained in one session. */
export const CONSOLE_ENTRY_LIMIT = 200;

/** Default per-output caps: first and last lines are kept around the omitted middle. */
const CONSOLE_OUTPUT_LIMITS: ConsoleCapLimits = Object.freeze({
  maxLines: 200,
  maxBytes: 16 * 1024,
});

/** Marker inserted where lines were removed. */
const OMITTED_MARKER = "... {count} lines omitted ...";

/**
 * Appends one entry to a bounded console history.
 *
 * The oldest entry is dropped when the bound is exceeded. Entries are immutable, so the buffer is a
 * new array rather than an in-place mutation, which keeps React state updates predictable.
 *
 * @param entries - Current history, newest last.
 * @param entry - Entry to append.
 * @param limit - Maximum retained entries. Defaults to `CONSOLE_ENTRY_LIMIT`.
 * @returns The bounded history.
 */
export function appendConsoleEntry(
  entries: readonly ConsoleEntry[],
  entry: ConsoleEntry,
  limit: number = CONSOLE_ENTRY_LIMIT,
): readonly ConsoleEntry[] {
  const boundedLimit = Math.max(1, Math.floor(limit));
  const next = [...entries, entry];

  return next.length > boundedLimit ? next.slice(next.length - boundedLimit) : next;
}

/**
 * Caps one output block, keeping its head and tail.
 *
 * The head names the failing command and the tail carries the decisive git error, so both ends are
 * preserved and the middle is replaced by a counted marker. The line cap is applied first, then the
 * byte cap, and both report the number of omitted lines.
 *
 * @param text - Raw output.
 * @param limits - Cap overrides, defaulting to `CONSOLE_OUTPUT_LIMITS`.
 * @returns The bounded block.
 */
export function capConsoleOutput(
  text: string,
  limits: Partial<ConsoleCapLimits> = {},
): ConsoleOutputBlock {
  const maxLines = Math.max(1, limits.maxLines ?? CONSOLE_OUTPUT_LIMITS.maxLines);
  const maxBytes = Math.max(1, limits.maxBytes ?? CONSOLE_OUTPUT_LIMITS.maxBytes);
  const lines = splitLines(text);

  if (lines.length === 0) {
    return { text: "", omittedLines: 0, totalLines: 0 };
  }

  const lineBounded = capByLines(lines, maxLines);
  const byteBounded = capByBytes(lineBounded.head, lineBounded.tail, maxBytes);
  const omittedLines = lineBounded.omittedLines + byteBounded.omittedLines;

  if (omittedLines === 0) {
    return {
      text: [...byteBounded.head, ...byteBounded.tail].join("\n"),
      omittedLines: 0,
      totalLines: lines.length,
    };
  }

  const marker = OMITTED_MARKER.replace("{count}", String(omittedLines));

  return {
    text: [...byteBounded.head, marker, ...byteBounded.tail].join("\n"),
    omittedLines,
    totalLines: lines.length,
  };
}

/**
 * Splits output into lines without a trailing empty line.
 *
 * @param text - Raw output.
 * @returns The lines.
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
 * Keeps the first and last lines within a line cap.
 *
 * @param lines - Original lines.
 * @param maxLines - Maximum retained lines.
 * @returns The head and tail runs plus the omitted count.
 */
function capByLines(
  lines: readonly string[],
  maxLines: number,
): { head: readonly string[]; tail: readonly string[]; omittedLines: number } {
  if (lines.length <= maxLines) {
    return { head: lines, tail: [], omittedLines: 0 };
  }

  const headCount = Math.ceil(maxLines / 2);
  const tailCount = maxLines - headCount;

  return {
    head: lines.slice(0, headCount),
    tail: lines.slice(lines.length - tailCount),
    omittedLines: lines.length - maxLines,
  };
}

/**
 * Keeps the first and last lines within a byte cap.
 *
 * The line cap already produced separate head and tail runs. Keeping them separate even when the
 * byte cap removes nothing lets the omission marker sit between the two runs instead of after the
 * tail.
 *
 * @param headLines - Head run from the line cap.
 * @param tailLines - Tail run from the line cap.
 * @param maxBytes - Maximum retained UTF-8 bytes.
 * @returns Retained head and tail lines and the omitted count.
 */
function capByBytes(
  headLines: readonly string[],
  tailLines: readonly string[],
  maxBytes: number,
): {
  head: readonly string[];
  tail: readonly string[];
  omittedLines: number;
} {
  const combined = [...headLines, ...tailLines];

  if (bufferBytes(combined.join("\n")) <= maxBytes) {
    return { head: headLines, tail: tailLines, omittedLines: 0 };
  }

  const halfBudget = Math.max(1, Math.floor(maxBytes / 2));
  const head = takeHeadLines(combined, halfBudget);
  const tail = takeTailLines(combined, head.length, halfBudget);
  const omittedLines = Math.max(0, combined.length - head.length - tail.length);

  return { head, tail, omittedLines };
}

/**
 * Takes lines from the start of a block within a byte budget.
 *
 * @param lines - Candidate lines.
 * @param budget - Byte budget for the head.
 * @returns The retained head lines.
 */
function takeHeadLines(lines: readonly string[], budget: number): readonly string[] {
  const head: string[] = [];
  let used = 0;

  for (const line of lines) {
    const size = bufferBytes(line);

    if (used + size > budget) {
      break;
    }

    head.push(line);
    used += size;
  }

  return head;
}

/**
 * Takes lines from the end of a block within a byte budget.
 *
 * @param lines - Candidate lines.
 * @param startIndex - First index not already retained by the head.
 * @param budget - Byte budget for the tail.
 * @returns The retained tail lines in original order.
 */
function takeTailLines(
  lines: readonly string[],
  startIndex: number,
  budget: number,
): readonly string[] {
  const tail: string[] = [];
  let used = 0;

  for (let index = lines.length - 1; index >= startIndex; index -= 1) {
    const line = lines[index] ?? "";
    const size = bufferBytes(line);

    if (used + size > budget) {
      break;
    }

    tail.unshift(line);
    used += size;
  }

  return tail;
}

/**
 * Reads the UTF-8 byte length of a string.
 *
 * @param value - Candidate text.
 * @returns Its UTF-8 byte length.
 */
function bufferBytes(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

/**
 * Drops expansion ids whose entries were trimmed from the buffer.
 *
 * Expansion state is bounded by the buffer, so trimming an entry also forgets that it was expanded.
 *
 * @param expandedIds - Expanded entry ids.
 * @param entries - Current bounded history.
 * @returns The ids that still have an entry.
 */
export function retainExpandedEntryIds(
  expandedIds: ReadonlySet<string>,
  entries: readonly ConsoleEntry[],
): ReadonlySet<string> {
  const live = new Set(entries.map((entry) => entry.id));
  const retained = new Set<string>();

  for (const id of expandedIds) {
    if (live.has(id)) {
      retained.add(id);
    }
  }

  return retained;
}
