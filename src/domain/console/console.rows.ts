import { CONSOLE_OUTPUT_MAX_ROWS } from "./console.constants";
import type {
  ConsoleEntry,
  ConsoleEntryDetail,
  ConsoleOutputBlock,
  ConsolePageStepInput,
} from "./console.types";

/**
 * Reads the rendered row height of one console entry.
 *
 * The row is laid out as a one-row header, one row per git invocation (or one command-id row when no
 * step ran), an optional one-row cwd line, an optional one-row phase or summary line, and, when the
 * entry is expanded, one label row plus the visible height of every non-empty stdout and stderr pane.
 * The height ignores terminal width because every field is either truncated to one row or rendered
 * inside a fixed-height pane.
 *
 * @param entry - Console entry to measure.
 * @param expanded - True when the entry's output panes are visible.
 * @returns The number of terminal rows the entry occupies.
 */
export function readConsoleEntryRows(entry: ConsoleEntry, expanded: boolean): number {
  const commandRows = entry.steps.length > 0 ? entry.steps.length : 1;
  const cwdRows = entry.cwd === null ? 0 : 1;
  const detail = readConsoleEntryDetail(entry);
  const detailRows = detail.phase !== null || detail.summary !== null ? 1 : 0;
  const outputRows = expanded ? readOutputRows(entry) : 0;

  return 1 + commandRows + cwdRows + detailRows + outputRows;
}

/**
 * Reads how many entries one PageUp or PageDown press moves.
 *
 * The step is expressed in entries, not rows: it walks from the current entry in the requested
 * direction and stops once the accumulated rendered height reaches the usable viewport height, so a
 * press moves about one screenful even when entries occupy several rows. Rows reserved by non-entry
 * content inside the viewport, such as the running spinner row, are subtracted first. At least one
 * entry is always returned so a tall selected entry cannot make the page keys inert.
 *
 * @param input - History, cursor, direction, viewport height, reserved rows, and expansion projection.
 * @returns The number of entries one page press moves.
 */
export function readConsolePageStep(input: ConsolePageStepInput): number {
  const startIndex =
    input.currentIndex < 0
      ? input.entries.length - 1
      : Math.min(input.currentIndex, input.entries.length - 1);
  const startEntry = input.entries[startIndex];

  if (startEntry === undefined) {
    return 1;
  }

  const viewportHeight = Math.max(1, input.viewportHeight - (input.reservedRows ?? 0));
  let rows = readConsoleEntryRows(startEntry, input.isExpanded(startEntry.id));
  let step = 0;
  let index = startIndex;

  while (rows < viewportHeight) {
    const nextIndex = index + input.direction;
    const nextEntry = input.entries[nextIndex];

    if (nextEntry === undefined) {
      break;
    }

    index = nextIndex;
    step += 1;
    rows += readConsoleEntryRows(nextEntry, input.isExpanded(nextEntry.id));
  }

  return Math.max(1, step);
}

/**
 * Reads the phase and summary lines that render for an entry.
 *
 * A cancelled or timed-out entry already names its outcome in the header, so its summary is omitted;
 * every other non-empty summary renders. The row component and row measurement both read this
 * helper, so they cannot disagree about whether a detail line occupies a terminal row.
 *
 * @param entry - Console entry.
 * @returns The visible phase and summary, each null when it renders no line.
 */
export function readConsoleEntryDetail(entry: ConsoleEntry): ConsoleEntryDetail {
  const namesOutcome =
    entry.status === "cancelled" || entry.status === "timed-out" || entry.summary.length === 0;

  return {
    phase: entry.phase,
    summary: namesOutcome ? null : entry.summary,
  };
}

/**
 * Reads the total visible height of an entry's expanded output panes.
 *
 * @param entry - Console entry.
 * @returns One label row plus the pane height for every non-empty block.
 */
function readOutputRows(entry: ConsoleEntry): number {
  let rows = 0;

  for (const step of entry.steps) {
    rows += readBlockRows(step.stdout);
    rows += readBlockRows(step.stderr);
  }

  return rows;
}

/**
 * Reads the visible height of one output block, including its label row.
 *
 * @param block - Capped output block.
 * @returns Zero for an empty block, otherwise the label row plus the pane height.
 */
function readBlockRows(block: ConsoleOutputBlock): number {
  if (block.text.length === 0) {
    return 0;
  }

  const lines = block.text.split("\n").length;
  const paneRows = Math.min(CONSOLE_OUTPUT_MAX_ROWS, Math.max(1, lines));

  return 1 + paneRows;
}
