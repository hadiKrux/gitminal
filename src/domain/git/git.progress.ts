import type { GitProgressEvent, GitProgressParser } from "./git.types";

/** Maximum characters retained for an unterminated progress line. */
const MAX_PENDING_CHARACTERS = 4096;

/** Matches a git progress phase line, with an optional `remote:` prefix. */
const PHASE_LINE_PATTERN = /^\s*(?:remote:\s*)?([A-Za-z][A-Za-z0-9 _.-]*?):\s*(.*)$/;

/** Matches a percentage inside a progress line. */
const PERCENT_PATTERN = /(\d{1,3})%/;

/** Case-insensitive phase labels that carry no progress meaning. */
const NON_PROGRESS_PHASES: ReadonlySet<string> = new Set([
  "error",
  "fatal",
  "hint",
  "warning",
  "from",
  "to",
  "done",
]);

/** Line prefixes that describe transport headers rather than progress. */
const TRANSPORT_PREFIXES: readonly string[] = Object.freeze(["From ", "To "]);

/**
 * Creates an incremental parser for git `--progress` output.
 *
 * Git writes progress to stderr using carriage returns to redraw one line and newlines to finish
 * it. The parser keeps only the incomplete trailing line, extracts the phase before the colon and
 * the first percentage after it, and suppresses a repeated identical event so a redraw loop cannot
 * flood the status strip. A line without a percentage produces a phase-only event, which is how
 * `Enumerating objects` is reported for commands that never publish a total.
 *
 * @returns A parser with `push`, `flush`, and `reset`.
 */
export function createGitProgressParser(): GitProgressParser {
  let pending = "";
  let lastSignature: string | null = null;

  /**
   * Parses one complete line.
   *
   * @param line - Line without its terminator.
   * @returns The event, or null when the line carries no progress.
   */
  function parseLine(line: string): GitProgressEvent | null {
    const event = readPhaseEvent(line);

    if (event === null) {
      return null;
    }

    const signature = progressSignature(event);

    if (signature === lastSignature) {
      return null;
    }

    lastSignature = signature;

    return event;
  }

  /**
   * Consumes a chunk and collects the events completed by it.
   *
   * @param chunk - Decoded stderr text.
   * @returns Completed progress events in stream order.
   */
  function push(chunk: string): readonly GitProgressEvent[] {
    const events: GitProgressEvent[] = [];
    let rest = chunk;

    while (rest.length > 0) {
      const boundary = rest.search(/[\r\n]/);

      if (boundary < 0) {
        pending = appendBounded(pending, rest);

        return events;
      }

      const event = parseLine(pending + rest.slice(0, boundary));
      pending = "";

      if (event !== null) {
        events.push(event);
      }

      rest = rest.slice(boundary + 1);
    }

    return events;
  }

  return {
    push,

    flush(): readonly GitProgressEvent[] {
      if (pending.length === 0) {
        return [];
      }

      const event = parseLine(pending);
      pending = "";

      return event === null ? [] : [event];
    },

    get bufferedCharacters(): number {
      return pending.length;
    },

    reset(): void {
      pending = "";
      lastSignature = null;
    },
  };
}

/**
 * Reads the progress event encoded by one line.
 *
 * @param line - Line without its terminator.
 * @returns The event, or null when the line is not a progress line.
 */
function readPhaseEvent(line: string): GitProgressEvent | null {
  const trimmed = line.trim();

  if (trimmed.length === 0 || isTransportLine(trimmed)) {
    return null;
  }

  const match = PHASE_LINE_PATTERN.exec(trimmed);

  if (match === null) {
    return null;
  }

  const phase = (match[1] ?? "").trim();

  if (!isProgressPhase(phase)) {
    return null;
  }

  const percent = readPercent(match[2] ?? "");

  return percent === null ? { phase } : { phase, percent };
}

/**
 * Builds the signature used to suppress repeated redraws.
 *
 * @param event - Parsed progress event.
 * @returns A stable key for the phase and percentage.
 */
function progressSignature(event: GitProgressEvent): string {
  return `${event.phase}|${event.percent === undefined ? "" : event.percent}`;
}

/**
 * Reports whether a line is a transport header such as `From github.com:org/repo`.
 *
 * @param line - Trimmed progress line.
 * @returns True when the line names a transport endpoint instead of a phase.
 */
function isTransportLine(line: string): boolean {
  return TRANSPORT_PREFIXES.some((prefix) => line.startsWith(prefix));
}

/**
 * Reports whether a phase label describes progress.
 *
 * @param phase - Captured text before the colon.
 * @returns False for known non-progress labels and labels without letters.
 */
function isProgressPhase(phase: string): boolean {
  if (phase.length === 0 || !/[A-Za-z]/.test(phase)) {
    return false;
  }

  return !NON_PROGRESS_PHASES.has(phase.toLowerCase());
}

/**
 * Reads the first percentage from a progress line.
 *
 * @param text - Text after the phase colon.
 * @returns A percentage from 0 to 100, or null when none is reported.
 */
function readPercent(text: string): number | null {
  const match = PERCENT_PATTERN.exec(text);

  if (match === null) {
    return null;
  }

  const value = Number.parseInt(match[1] ?? "", 10);

  if (!Number.isFinite(value) || value < 0 || value > 100) {
    return null;
  }

  return value;
}

/**
 * Appends text to the pending line while keeping it bounded.
 *
 * @param pending - Existing incomplete line.
 * @param text - New characters without a terminator.
 * @returns The retained tail of the incomplete line.
 */
function appendBounded(pending: string, text: string): string {
  const combined = pending + text;

  return combined.length > MAX_PENDING_CHARACTERS
    ? combined.slice(combined.length - MAX_PENDING_CHARACTERS)
    : combined;
}
