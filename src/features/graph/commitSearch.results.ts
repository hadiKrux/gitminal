import type { GraphCommit } from "@/domain/graph/graph.types";
import { GRAPH_SEARCHING_MESSAGE, GRAPH_SNIPPET_BUDGET } from "@/features/graph/graph.constants";
import { buildBodySnippet } from "@/features/graph/graph.snippet";
import type { SearchResultView } from "@/features/graph/graph.types";

/**
 * Builds display rows and body snippets for one result page.
 *
 * @param rows - Engine rows.
 * @param terms - Parsed terms that produced the rows.
 * @returns Prepared search result rows.
 */
export function buildSearchResults(
  rows: readonly GraphCommit[],
  terms: readonly string[],
): readonly SearchResultView[] {
  const results: SearchResultView[] = [];

  for (const commit of rows) {
    if (commit.row === undefined) {
      continue;
    }

    results.push({
      id: commit.oid,
      row: commit.row,
      snippet: buildBodySnippet(commit.row.body, terms, GRAPH_SNIPPET_BUDGET),
    });
  }

  return results;
}

/**
 * Reads the header status text for the current search state.
 *
 * @param state - Search flags and counts.
 * @returns The status text, or null when no status belongs in the header.
 */
export function readStatusText(state: {
  readonly isOpen: boolean;
  readonly isResultsMode: boolean;
  readonly enabled: boolean;
  readonly isLoading: boolean;
  readonly error: string | null;
  readonly done: boolean;
  readonly count: number;
}): string | null {
  if (!state.isOpen || !state.isResultsMode || !state.enabled) {
    return null;
  }

  if (state.isLoading) {
    return GRAPH_SEARCHING_MESSAGE;
  }

  if (state.error !== null || state.count === 0) {
    return null;
  }

  return state.done ? `${state.count} matches` : `${state.count}+ matches`;
}

/**
 * Reads the no-match message for the current search state.
 *
 * @param state - Search flags, counts, and raw query.
 * @returns The empty message, or null when results or another state owns the body.
 */
export function readEmptyMessage(state: {
  readonly isOpen: boolean;
  readonly isResultsMode: boolean;
  readonly enabled: boolean;
  readonly isLoading: boolean;
  readonly error: string | null;
  readonly done: boolean;
  readonly count: number;
  readonly query: string;
}): string | null {
  if (
    !state.isOpen ||
    !state.isResultsMode ||
    !state.enabled ||
    state.isLoading ||
    state.error !== null ||
    !state.done ||
    state.count > 0
  ) {
    return null;
  }

  return `No commits match ${state.query.trim()}`;
}

/**
 * Reads a search failure message.
 *
 * @param error - Thrown value from the page loader.
 * @returns A one-line message.
 */
export function readSearchError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Clamps one result index into a list that may be empty.
 *
 * @param index - Requested index.
 * @param length - Number of rows.
 * @returns A whole index between zero and `length - 1`, or zero.
 */
export function clampIndex(index: number, length: number): number {
  if (length <= 0 || !Number.isFinite(index)) {
    return 0;
  }

  return Math.min(Math.max(0, Math.trunc(index)), length - 1);
}
