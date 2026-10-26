import type { DiffHunk, DiffHunkRange, DiffLine, DiffSegment, FileDiff } from "./diff.types";

/**
 * Collapses long runs of unchanged lines and re-serializes every kept region.
 *
 * A run of consecutive `context` lines longer than `2 * contextLines + 1` keeps its first and last
 * `contextLines` lines and replaces the middle with one `collapsed` segment. Runs at or below the
 * threshold stay whole. With `contextLines` at 0 every hunk stays whole: git was asked for no
 * context, so a context run longer than the threshold cannot describe unchanged lines the user
 * asked to hide.
 *
 * A conflicted file is never collapsed. Its synthetic patch is one all-context run, so collapsing
 * would hide the `<<<<<<<`, `=======`, and `>>>>>>>` markers behind a marker the user cannot expand.
 * Every hunk of a conflicted file is returned as one diff segment, exactly as the caller read it.
 *
 * Each kept region becomes a `diff` segment containing a complete unified patch: the original file
 * header lines, one recomputed `@@` header for the region, and the region's lines. The patch is
 * therefore always valid input for the diff renderer.
 *
 * @param file - Parsed file diff.
 * @param contextLines - Configured context lines, normally `diff.contextLines`.
 * @returns Ordered diff and collapsed segments.
 */
export function collapseFileDiff(file: FileDiff, contextLines: number): readonly DiffSegment[] {
  const limit = file.conflict ? 0 : Math.max(0, Math.floor(contextLines));
  const segments: DiffSegment[] = [];

  file.hunks.forEach((hunk, hunkIndex) => {
    if (limit === 0 || hunk.lines.length === 0) {
      segments.push(createDiffSegment(file, hunk, hunkIndex, hunk.lines, null, null));

      return;
    }

    segments.push(...collapseHunk(file, hunk, hunkIndex, limit));
  });

  return segments;
}

/**
 * Formats a unified hunk header with explicit counts.
 *
 * Counts are always written, including `,1`, so a recomputed header never depends on git's
 * shorthand. The optional heading is preserved after the closing `@@`.
 *
 * @param range - Region start lines and counts.
 * @param heading - Section heading to keep, or null.
 * @returns The `@@ -old,count +new,count @@` header line.
 */
export function formatHunkHeader(range: DiffHunkRange, heading: string | null = null): string {
  const suffix = heading === null || heading.length === 0 ? "" : ` ${heading}`;

  return `@@ -${range.oldStart},${range.oldCount} +${range.newStart},${range.newCount} @@${suffix}`;
}

/**
 * Serializes one kept region of a file into a complete unified patch.
 *
 * @param headerLines - Original file header lines.
 * @param range - Recomputed region range.
 * @param heading - Original hunk heading, or null.
 * @param lines - Kept lines in source order.
 * @returns Patch text ending with a newline.
 */
function serializeDiffSegment(
  headerLines: readonly string[],
  range: DiffHunkRange,
  heading: string | null,
  lines: readonly DiffLine[],
): string {
  const output = [...headerLines, formatHunkHeader(range, heading)];

  for (const line of lines) {
    output.push(line.text);
  }

  return `${output.join("\n")}\n`;
}

/**
 * Collapses one hunk into alternating diff and collapsed segments.
 *
 * @param file - Parsed file diff that owns the header lines.
 * @param hunk - Hunk to collapse.
 * @param hunkIndex - Hunk position in the file.
 * @param limit - Context lines kept at each edge of a long run.
 * @returns Segments in source order.
 */
function collapseHunk(
  file: FileDiff,
  hunk: DiffHunk,
  hunkIndex: number,
  limit: number,
): readonly DiffSegment[] {
  const keep = buildKeepMask(hunk, limit);
  const segments: DiffSegment[] = [];
  let previousOld: number | null = null;
  let previousNew: number | null = null;
  let index = 0;

  while (index < hunk.lines.length) {
    if (keep[index] === true) {
      const kept = collectRun(hunk, keep, index, true);

      segments.push(createDiffSegment(file, hunk, hunkIndex, kept.lines, previousOld, previousNew));
      previousOld = readPreviousOld(kept.lines, previousOld);
      previousNew = readPreviousNew(kept.lines, previousNew);
      index = kept.nextIndex;
      continue;
    }

    const hidden = collectRun(hunk, keep, index, false);
    const count = hidden.nextIndex - index;

    segments.push({
      kind: "collapsed",
      count,
      oldStart: readRangeStart(firstOldLine(hidden.lines), previousOld, hunk.oldStart),
      newStart: readRangeStart(firstNewLine(hidden.lines), previousNew, hunk.newStart),
    });
    previousOld = readPreviousOld(hidden.lines, previousOld);
    previousNew = readPreviousNew(hidden.lines, previousNew);
    index = hidden.nextIndex;
  }

  return segments;
}

/**
 * Collects one contiguous run of lines with the requested keep flag.
 *
 * @param hunk - Hunk being collapsed.
 * @param keep - One keep flag per hunk line.
 * @param startIndex - First line of the run.
 * @param keepValue - Flag the run must share.
 * @returns The run's defined lines and the first index after it.
 */
function collectRun(
  hunk: DiffHunk,
  keep: readonly boolean[],
  startIndex: number,
  keepValue: boolean,
): { readonly lines: readonly DiffLine[]; readonly nextIndex: number } {
  const lines: DiffLine[] = [];
  let index = startIndex;

  while (index < hunk.lines.length && keep[index] === keepValue) {
    const line = hunk.lines[index];

    if (line !== undefined) {
      lines.push(line);
    }

    index += 1;
  }

  return { lines, nextIndex: index };
}

/**
 * Reads the start line for a recomputed region.
 *
 * @param first - First line number in the region, or null when it carries none.
 * @param previous - Last line number before the region, or null.
 * @param fallback - Hunk start used when neither is known.
 * @returns The region's start line.
 */
function readRangeStart(first: number | null, previous: number | null, fallback: number): number {
  return first ?? previous ?? fallback;
}

/**
 * Reads the last old-file line seen so far, keeping the previous value when the run has none.
 *
 * @param lines - Lines in the run.
 * @param previous - Last old line number before the run.
 * @returns The last old line number after the run.
 */
function readPreviousOld(lines: readonly DiffLine[], previous: number | null): number | null {
  return lastOldLine(lines) ?? previous;
}

/**
 * Reads the last new-file line seen so far, keeping the previous value when the run has none.
 *
 * @param lines - Lines in the run.
 * @param previous - Last new line number before the run.
 * @returns The last new line number after the run.
 */
function readPreviousNew(lines: readonly DiffLine[], previous: number | null): number | null {
  return lastNewLine(lines) ?? previous;
}

/**
 * Marks every line that survives the collapse.
 *
 * @param hunk - Hunk to evaluate.
 * @param limit - Context lines kept at each edge of a long run.
 * @returns One flag per hunk line, true when the line is kept.
 */
function buildKeepMask(hunk: DiffHunk, limit: number): boolean[] {
  const keep = hunk.lines.map(() => true);
  const threshold = 2 * limit + 1;
  let index = 0;

  while (index < hunk.lines.length) {
    const line = hunk.lines[index];

    if (line === undefined || line.kind !== "context") {
      index += 1;
      continue;
    }

    let end = index;

    while (end < hunk.lines.length && hunk.lines[end]?.kind === "context") {
      end += 1;
    }

    const runLength = end - index;

    if (runLength > threshold) {
      for (let cursor = index + limit; cursor < end - limit; cursor += 1) {
        keep[cursor] = false;
      }
    }

    index = end;
  }

  return keep;
}

/**
 * Builds one renderable segment from a contiguous kept region.
 *
 * @param file - Parsed file diff that owns the header lines.
 * @param hunk - Hunk the region belongs to.
 * @param hunkIndex - Hunk position in the file.
 * @param lines - Kept lines.
 * @param previousOld - Last old line number before the region, or null.
 * @param previousNew - Last new line number before the region, or null.
 * @returns The diff segment with its recomputed range and patch text.
 */
function createDiffSegment(
  file: FileDiff,
  hunk: DiffHunk,
  hunkIndex: number,
  lines: readonly DiffLine[],
  previousOld: number | null,
  previousNew: number | null,
): DiffSegment {
  const oldCount = lines.filter((line) => line.oldLine !== null).length;
  const newCount = lines.filter((line) => line.newLine !== null).length;
  const range = {
    oldStart: firstOldLine(lines) ?? previousOld ?? hunk.oldStart,
    oldCount,
    newStart: firstNewLine(lines) ?? previousNew ?? hunk.newStart,
    newCount,
  };

  return {
    kind: "diff",
    hunkIndex,
    text: serializeDiffSegment(file.headerLines, range, hunk.heading, lines),
    ...range,
  };
}

/**
 * Reads the first old-file line number from a list of lines.
 *
 * @param lines - Candidate lines.
 * @returns The first old line number, or null when none carries one.
 */
function firstOldLine(lines: readonly DiffLine[]): number | null {
  for (const line of lines) {
    if (line.oldLine !== null) {
      return line.oldLine;
    }
  }

  return null;
}

/**
 * Reads the first new-file line number from a list of lines.
 *
 * @param lines - Candidate lines.
 * @returns The first new line number, or null when none carries one.
 */
function firstNewLine(lines: readonly DiffLine[]): number | null {
  for (const line of lines) {
    if (line.newLine !== null) {
      return line.newLine;
    }
  }

  return null;
}

/**
 * Reads the last old-file line number from a list of lines.
 *
 * @param lines - Candidate lines.
 * @returns The last old line number, or null when none carries one.
 */
function lastOldLine(lines: readonly DiffLine[]): number | null {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];

    if (line !== undefined && line.oldLine !== null) {
      return line.oldLine;
    }
  }

  return null;
}

/**
 * Reads the last new-file line number from a list of lines.
 *
 * @param lines - Candidate lines.
 * @returns The last new line number, or null when none carries one.
 */
function lastNewLine(lines: readonly DiffLine[]): number | null {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];

    if (line !== undefined && line.newLine !== null) {
      return line.newLine;
    }
  }

  return null;
}
