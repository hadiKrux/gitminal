import {
  DIFF_GUTTER_MIN_WIDTH,
  DIFF_GUTTER_PADDING_RIGHT,
  DIFF_GUTTER_SEPARATOR_WIDTH,
  DIFF_GUTTER_SIGN_WIDTH,
  DIFF_HUNK_HEADER_PREFIX,
  DIFF_TAB_STOP_WIDTH,
} from "@/features/diff/DiffContent.constants";

/** Matches one unified hunk header and captures both of its line ranges. */
const HUNK_HEADER_PATTERN = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/** Prefixes of the patch lines the renderable paints as hunk content. */
const DIFF_CONTENT_PREFIXES = ["+", "-", " "] as const;

/**
 * Reads the explicit width one diff segment needs inside the diff scrollbox.
 *
 * The installed `@opentui/core` creates each diff code renderable with `width: "100%"` and
 * `wrapMode: "none"`, so a diff never widens its scroll content and long lines are clipped instead
 * of reachable. An explicit width is the only way to make long lines reachable by horizontal
 * scrolling; a segment whose longest rendered line fits the measured viewport keeps the measured
 * width, while a longer line widens the renderable past the viewport. The gutter is added to the
 * natural line width so the widest line clears the line-number column.
 *
 * @param text - Unified patch text of one segment.
 * @param measuredWidth - Content width measured from the scrollbox viewport.
 * @returns The width to pass to the segment's `<diff>` renderable.
 */
export function readDiffContentWidth(text: string, measuredWidth: number): number {
  const naturalWidth = readNaturalLineWidth(text);

  return Math.max(Math.floor(measuredWidth), naturalWidth + readGutterWidth(text));
}

/**
 * Reads the widest rendered content line of a unified patch, with tabs expanded.
 *
 * Only hunk content lines are measured, because the renderable draws only that content. A long path
 * in a leading file header, a hunk header, or a no-newline marker must not create horizontal
 * overflow that no visible line needs. The renderable strips the leading add, remove, or context
 * sign and paints it in the gutter, so the sign is not part of the content width: the tab grid
 * starts at the content origin rather than after the sign. Tabs advance to the next fixed tab stop
 * so a tab-indented line is measured at the columns the renderer actually paints.
 *
 * @param text - Unified patch text of one segment.
 * @returns The widest rendered content line in terminal cells.
 */
function readNaturalLineWidth(text: string): number {
  let widest = 0;
  let inHunk = false;

  for (const line of text.split("\n")) {
    if (!inHunk) {
      inHunk = line.startsWith(DIFF_HUNK_HEADER_PREFIX);
      continue;
    }

    if (!isContentLine(line)) {
      continue;
    }

    widest = Math.max(widest, readLineWidth(line.slice(1)));
  }

  return widest;
}

/**
 * Reports whether one patch line is hunk content rather than a header or marker.
 *
 * @param line - Patch line after the first hunk header.
 * @returns True for an added, removed, or context line.
 */
function isContentLine(line: string): boolean {
  return DIFF_CONTENT_PREFIXES.some((prefix) => line.startsWith(prefix));
}

/**
 * Reads one line's width in cells, expanding tabs to the next tab stop.
 *
 * @param line - Patch line content after the gutter sign.
 * @returns The rendered width in terminal cells.
 */
function readLineWidth(line: string): number {
  const parts = line.split("\t");
  let width = 0;

  for (const [index, part] of parts.entries()) {
    width += Bun.stringWidth(part);

    if (index < parts.length - 1) {
      width += DIFF_TAB_STOP_WIDTH - (width % DIFF_TAB_STOP_WIDTH);
    }
  }

  return width;
}

/**
 * Reads the line-number gutter width for one segment.
 *
 * The formula mirrors `LineNumberRenderable.calculateWidth` in OpenTUI: the widest line number, one
 * cell of padding, one separator cell, a documented minimum, plus the two-cell sign pair. The digit
 * count comes from the last line number the segment's hunk headers actually render, not from the
 * number of lines in the segment, because a short hunk late in a file needs the wider gutter its
 * numbers occupy. A segment without a hunk header renders no content lines, so it reserves no
 * gutter and `readDiffContentWidth` keeps the measured width.
 *
 * @param text - Unified patch text of one segment.
 * @returns Gutter width in terminal cells, or 0 when the segment has no hunk header.
 */
function readGutterWidth(text: string): number {
  const digits = readGutterDigits(text);

  if (digits === null) {
    return 0;
  }

  const baseWidth = Math.max(
    DIFF_GUTTER_MIN_WIDTH,
    digits + DIFF_GUTTER_PADDING_RIGHT + DIFF_GUTTER_SEPARATOR_WIDTH,
  );

  return baseWidth + DIFF_GUTTER_SIGN_WIDTH;
}

/**
 * Reads how many digit cells the gutter must reserve for one segment.
 *
 * @param text - Unified patch text of one segment.
 * @returns The digit count, or null when the segment has no hunk header.
 */
function readGutterDigits(text: string): number | null {
  const lastLineNumber = readLastHunkLine(text);

  if (lastLineNumber === null) {
    return null;
  }

  return String(lastLineNumber).length;
}

/**
 * Reads the highest line number any hunk header in the segment renders.
 *
 * Every `@@ -a,b +c,d @@` header is parsed so a hand-built or future multi-hunk segment cannot
 * under-reserve the gutter, and an omitted count means one line. The result is the highest of
 * `a + b - 1` and `c + d - 1` across every header.
 *
 * @param text - Unified patch text of one segment.
 * @returns The highest rendered line number, or null when no hunk header exists.
 */
function readLastHunkLine(text: string): number | null {
  let lastLine: number | null = null;

  for (const line of text.split("\n")) {
    const match = HUNK_HEADER_PATTERN.exec(line);

    if (match === null) {
      continue;
    }

    const oldEnd = readRangeLastLine(match[1], match[2]);
    const newEnd = readRangeLastLine(match[3], match[4]);

    lastLine = Math.max(lastLine ?? 0, oldEnd, newEnd);
  }

  return lastLine;
}

/**
 * Reads the last line number of one captured hunk range.
 *
 * @param start - Captured start line number, when the header matched.
 * @param count - Captured line count, or undefined when the header omitted it.
 * @returns The last line number the range covers.
 */
function readRangeLastLine(start: string | undefined, count: string | undefined): number {
  const startLine = Number(start ?? "0");
  const lineCount = count === undefined ? 1 : Number(count);

  return startLine + lineCount - 1;
}
