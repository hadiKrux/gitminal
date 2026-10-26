import { buildSearchPageArgs } from "@/domain/git/git.log";
import type {
  GraphCommit,
  GraphPage,
  GraphSearch,
  GraphSearchOptions,
  GraphSearchOutcome,
  GraphSearchRequest,
  GraphSearchState,
} from "./graph.types";

/** Maximum terms passed to one search, matching the bounded `--grep` list. */
const GRAPH_SEARCH_MAX_TERMS = 8;

/**
 * Splits a search query into terms.
 *
 * Git receives one `--grep` per term with `--all-match`, so whitespace separates terms and a
 * repeated term is dropped. Fixed-string matching means metacharacters are literal and no regular
 * expression is compiled. The list is bounded so one query cannot build an unbounded argv.
 *
 * @param query - Raw search input.
 * @returns Unique terms in input order.
 */
export function parseSearchTerms(query: string): readonly string[] {
  const seen = new Set<string>();
  const terms: string[] = [];

  for (const part of query.trim().split(/\s+/)) {
    if (part.length === 0) {
      continue;
    }

    const key = part.toLowerCase();

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    terms.push(part);

    if (terms.length === GRAPH_SEARCH_MAX_TERMS) {
      break;
    }
  }

  return terms;
}

/**
 * Builds the `git log` argument array for a bounded fixed-string search page.
 *
 * The region after the options is always the fixed scope. Continuation is a stable result offset
 * rather than a parent frontier: search results are append-only and never trimmed, so skipping the
 * matches already returned over the same scope and query is stable. `--skip` is emitted only when
 * the offset is greater than zero, and the scope is never combined with a frontier. The versioned
 * log format, `--raw`, and `--numstat` are part of the shared builder in `git.log.ts`, so every
 * result carries the subject, body, refs, file count, author, and date the search UI renders.
 *
 * @param input - Scope arguments, terms, limit, and result offset.
 * @returns The git argument array without the executable.
 */
export function buildSearchArgs(input: {
  readonly scopeArgs: readonly string[];
  readonly terms: readonly string[];
  readonly limit: number;
  readonly offset: number;
}): readonly string[] {
  return buildSearchPageArgs(input);
}

/**
 * Creates the stateful search engine.
 *
 * Each query owns a generation. Starting a new query bumps the generation and resets the offset, so
 * a slower older query resolves as `stale` and is never merged into the current results. Result
 * pages coalesce into one in-flight request and continue from the stable offset of matching commits
 * already returned. The offset advances by the number of commits git returned for the page, before
 * de-duplication, because git counted every returned match. A repeated OID is rejected, and only git
 * exhaustion or an empty page ends the query; a page that adds no new rows advances the offset and
 * continues, so a shifted scope cannot hide an older match behind the loaded prefix. The offset is
 * stable only for an unchanged repository, so a match inserted above the current offset after the
 * first page can be skipped while older matches are still returned.
 *
 * @param options - Scope, page size, and injected loader.
 * @returns The search engine.
 */
export function createGraphSearch(options: GraphSearchOptions): GraphSearch {
  const pageSize = Math.max(1, Math.floor(options.pageSize));
  let state = createEmptySearchState(options.scopeKey);
  let generation = 0;
  let inFlight: {
    readonly generation: number;
    readonly promise: Promise<GraphSearchOutcome>;
  } | null = null;

  /**
   * Reports whether a token still belongs to the current query.
   *
   * @param token - Generation captured by a request.
   * @returns True when the result is stale.
   */
  const isStale = (token: number): boolean => token !== generation;

  /**
   * Executes one search page request.
   *
   * @param token - Generation captured before the request started.
   * @param request - Search request.
   * @returns The settled outcome.
   */
  const runSearchRequest = async (
    token: number,
    request: GraphSearchRequest,
  ): Promise<GraphSearchOutcome> => {
    try {
      const page = await options.loadPage(request);

      if (isStale(token)) {
        return { status: "stale", state };
      }

      const added = countNewCommits(state.rows, page);
      const next = mergeSearchPage(state, page);
      state = next;

      return { status: next.done ? "done" : "appended", state: next, added };
    } catch (error) {
      return isStale(token) ? { status: "stale", state } : { status: "error", state, error };
    } finally {
      if (inFlight?.generation === token) {
        inFlight = null;
      }
    }
  };

  /**
   * Joins the in-flight page or starts the next one.
   *
   * @returns The settled outcome.
   */
  const loadNextPage = (): Promise<GraphSearchOutcome> => {
    if (inFlight !== null && inFlight.generation === generation) {
      return inFlight.promise;
    }

    if (state.done || state.terms.length === 0) {
      return Promise.resolve({ status: "done", state, added: 0 });
    }

    const token = generation;
    const request: GraphSearchRequest = {
      scopeKey: state.scopeKey,
      terms: state.terms,
      offset: state.offset,
      limit: pageSize,
    };
    const promise = runSearchRequest(token, request);

    inFlight = { generation: token, promise };

    return promise;
  };

  return {
    getState(): GraphSearchState {
      return state;
    },

    getGeneration(): number {
      return generation;
    },

    async search(query: string): Promise<GraphSearchOutcome> {
      generation += 1;
      const terms = parseSearchTerms(query);
      state = createSearchState(options.scopeKey, query, terms);

      if (terms.length === 0) {
        inFlight = null;

        return { status: "empty-query", state };
      }

      return await loadNextPage();
    },

    loadMore(): Promise<GraphSearchOutcome> {
      return loadNextPage();
    },

    cancel(): void {
      generation += 1;
      inFlight = null;
    },
  };
}

/**
 * Creates an empty search state.
 *
 * @param scopeKey - Scope the search runs in.
 * @returns The empty state.
 */
function createEmptySearchState(scopeKey: string): GraphSearchState {
  return createSearchState(scopeKey, "", []);
}

/**
 * Creates a search state for one query.
 *
 * @param scopeKey - Scope the search runs in.
 * @param query - Raw query.
 * @param terms - Parsed terms.
 * @returns The fresh state with a zero offset.
 */
function createSearchState(
  scopeKey: string,
  query: string,
  terms: readonly string[],
): GraphSearchState {
  return {
    scopeKey,
    query,
    terms,
    rows: [],
    pagesLoaded: 0,
    offset: 0,
    done: terms.length === 0,
  };
}

/**
 * Counts commits in a page that are not already loaded.
 *
 * @param rows - Loaded rows.
 * @param page - Candidate page.
 * @returns The number of new commits.
 */
function countNewCommits(rows: readonly GraphCommit[], page: GraphPage): number {
  const known = new Set(rows.map((row) => row.oid));

  return page.commits.filter((commit) => !known.has(commit.oid)).length;
}

/**
 * Merges one search page, rejecting repeated OIDs and advancing the stable offset.
 *
 * The offset advances by every commit git returned, including a repeated OID, because git counted
 * that match in the page it produced. History is exhausted only when git says so or the page is
 * empty. A page whose rows are all already loaded still moves the offset forward, so a result set
 * that shifted between pages continues past the loaded prefix instead of ending the query early;
 * non-matching parents are part of git's traversal and are never consulted here.
 *
 * @param state - Current search state.
 * @param page - Page returned by the loader.
 * @returns The next state.
 */
function mergeSearchPage(state: GraphSearchState, page: GraphPage): GraphSearchState {
  const known = new Set(state.rows.map((row) => row.oid));
  const added = page.commits.filter((commit) => !known.has(commit.oid));
  const rows = [...state.rows, ...added];

  return {
    scopeKey: state.scopeKey,
    query: state.query,
    terms: state.terms,
    rows,
    pagesLoaded: state.pagesLoaded + 1,
    offset: state.offset + page.commits.length,
    done: state.done || page.done || page.commits.length === 0,
  };
}
