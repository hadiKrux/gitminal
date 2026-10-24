import type { DiffLimitResult, DiffLimits } from "./diff.types";

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
