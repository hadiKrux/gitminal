import { formatHunkHeader } from "./diff.collapse";
import type {
  DiffHunk,
  DiffLimitResult,
  DiffLimits,
  FileDiff,
  FileDiffLimitResult,
} from "./diff.types";

/** Default caps for one file diff. */
export const DIFF_LIMIT_DEFAULTS: DiffLimits = Object.freeze({
  maxLines: 5000,
  maxBytes: 512 * 1024,
});

/** Marks the start of a hunk header. */
const HUNK_HEADER_PREFIX = "@@ ";

/**
 * Applies the line and byte caps to one unified diff.
 *
 * Truncation cuts only at a hunk boundary: the file header is always kept and a hunk is either kept
 * whole or dropped whole, so the result stays a valid unified patch with no dangling `@@` header.
 * The flags and counts let the diff panel render a truncation notice without re-parsing the text.
 *
 * @param diff - Raw unified diff for one file.
 * @param limits - Cap overrides, defaulting to `DIFF_LIMIT_DEFAULTS`.
 * @returns The retained text and truncation metadata.
 */
export function applyDiffLimits(diff: string, limits: Partial<DiffLimits> = {}): DiffLimitResult {
  const maxLines = Math.max(1, limits.maxLines ?? DIFF_LIMIT_DEFAULTS.maxLines);
  const maxBytes = Math.max(1, limits.maxBytes ?? DIFF_LIMIT_DEFAULTS.maxBytes);
  const lines = splitDiffLines(diff);
  const blocks = splitDiffBlocks(lines);
  const kept: string[] = [...blocks.header];
  let truncated = false;

  for (const hunk of blocks.hunks) {
    const candidate = [...kept, ...hunk];

    if (candidate.length > maxLines || bufferBytes(candidate.join("\n")) > maxBytes) {
      truncated = true;
      break;
    }

    kept.push(...hunk);
  }

  if (
    blocks.hunks.length === 0 &&
    (kept.length > maxLines || bufferBytes(kept.join("\n")) > maxBytes)
  ) {
    truncated = true;
  }

  const text = kept.length === 0 ? "" : `${kept.join("\n")}\n`;

  return {
    text,
    truncated,
    totalLines: lines.length,
    shownLines: kept.length,
    totalBytes: bufferBytes(diff),
    shownBytes: bufferBytes(text),
  };
}

/**
 * Splits diff text into lines without a trailing empty line.
 *
 * @param diff - Raw diff text.
 * @returns The lines.
 */
function splitDiffLines(diff: string): string[] {
  if (diff.length === 0) {
    return [];
  }

  const lines = diff.split("\n");

  if (lines.at(-1) === "") {
    lines.pop();
  }

  return lines;
}

/**
 * Splits diff lines into the file header and its hunks.
 *
 * @param lines - Diff lines.
 * @returns Header lines and one entry per hunk.
 */
function splitDiffBlocks(lines: readonly string[]): {
  header: readonly string[];
  hunks: readonly (readonly string[])[];
} {
  const header: string[] = [];
  const hunks: string[][] = [];
  let current: string[] | null = null;

  for (const line of lines) {
    if (line.startsWith(HUNK_HEADER_PREFIX)) {
      current = [line];
      hunks.push(current);
      continue;
    }

    if (current === null) {
      header.push(line);
      continue;
    }

    current.push(line);
  }

  return { header, hunks };
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
 * Applies the line and byte caps to one parsed file diff.
 *
 * The file header is always kept and a hunk is kept whole or dropped whole, so the retained patch
 * never ends with a dangling `@@` header. Every retained hunk is re-serialized with an explicit
 * `@@ -oldStart,oldCount +newStart,newCount @@` header, which makes the returned `raw` a valid
 * unified patch even when git used its `,1` shorthand.
 *
 * @param file - Parsed file diff.
 * @param limits - Cap overrides, defaulting to `DIFF_LIMIT_DEFAULTS`.
 * @returns The retained file and truncation metadata.
 */
export function applyFileDiffLimits(
  file: FileDiff,
  limits: Partial<DiffLimits> = {},
): FileDiffLimitResult {
  const maxLines = Math.max(1, limits.maxLines ?? DIFF_LIMIT_DEFAULTS.maxLines);
  const maxBytes = Math.max(1, limits.maxBytes ?? DIFF_LIMIT_DEFAULTS.maxBytes);
  const retainedLines: string[] = [...file.headerLines];
  const retainedHunks: DiffHunk[] = [];
  let truncated = false;

  for (const hunk of file.hunks) {
    const hunkLines = [
      formatHunkHeader(hunk, hunk.heading),
      ...hunk.lines.map((line) => line.text),
    ];
    const candidate = [...retainedLines, ...hunkLines];

    if (candidate.length > maxLines || bufferBytes(candidate.join("\n")) > maxBytes) {
      truncated = true;
      break;
    }

    retainedLines.push(...hunkLines);
    retainedHunks.push(hunk);
  }

  if (file.hunks.length === 0 && exceedsCaps(retainedLines, maxLines, maxBytes)) {
    truncated = true;
  }

  const text = retainedLines.length === 0 ? "" : `${retainedLines.join("\n")}\n`;
  const retainedFile: FileDiff = { ...file, hunks: retainedHunks, raw: text };

  return {
    file: retainedFile,
    truncated,
    totalLines: countFileLines(file),
    shownLines: retainedLines.length,
    totalBytes: bufferBytes(file.raw),
    shownBytes: bufferBytes(text),
  };
}

/**
 * Reports whether a file size exceeds the preview byte cap.
 *
 * An unknown size (`null`) is never oversized on its own: the caller keeps the bounded read and this
 * module's caps instead of claiming the file is small. A negative or non-finite size is likewise
 * treated as unknown.
 *
 * @param sizeBytes - Probed size in bytes, or null when unknown.
 * @param limits - Cap overrides, defaulting to `DIFF_LIMIT_DEFAULTS`.
 * @returns True when the size is known and exceeds the byte cap.
 */
export function isDiffOversized(
  sizeBytes: number | null,
  limits: Partial<DiffLimits> = {},
): boolean {
  if (sizeBytes === null || !Number.isFinite(sizeBytes) || sizeBytes < 0) {
    return false;
  }

  const maxBytes = Math.max(1, limits.maxBytes ?? DIFF_LIMIT_DEFAULTS.maxBytes);

  return sizeBytes > maxBytes;
}

/**
 * Counts the physical lines of a parsed patch.
 *
 * @param file - Parsed file diff.
 * @returns Header lines plus one header and its body lines per hunk.
 */
function countFileLines(file: FileDiff): number {
  let total = file.headerLines.length;

  for (const hunk of file.hunks) {
    total += 1 + hunk.lines.length;
  }

  return total;
}

/**
 * Reports whether a set of physical lines exceeds either cap.
 *
 * @param lines - Physical lines.
 * @param maxLines - Line cap.
 * @param maxBytes - Byte cap.
 * @returns True when the line count or the joined byte length exceeds its cap.
 */
function exceedsCaps(lines: readonly string[], maxLines: number, maxBytes: number): boolean {
  return lines.length > maxLines || bufferBytes(lines.join("\n")) > maxBytes;
}
