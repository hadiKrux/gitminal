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
 * Builds the `git log` argument array for a bounded search page.
 *
 * The region after the options is the scope, followed by the cursor frontier as positive
 * revisions. `--skip` is never produced: continuation is anchored on the frontier, so a search page
 * cannot re-walk or skip the loaded prefix.
 *
 * @param input - Scope arguments, terms, limit, and frontier.
 * @returns The git argument array without the executable.
 */
export function buildSearchArgs(input: {
  readonly scopeArgs: readonly string[];
  readonly terms: readonly string[];
  readonly limit: number;
  readonly frontier: readonly string[];
}): readonly string[] {
  return [
    "log",
    "--topo-order",
    "--decorate=full",
    "--raw",
    "--numstat",
    "-z",
    "--diff-merges=first-parent",
    "--root",
    "--fixed-strings",
    "-i",
    "--all-match",
    ...input.terms.flatMap((term) => ["--grep", term]),
    `--max-count=${Math.max(1, Math.floor(input.limit))}`,
    ...input.scopeArgs,
    ...input.frontier,
  ];
}

/**
 * Creates the stateful search engine.
 *
 * Each query owns a generation. Starting a new query bumps the generation, so a slower older query
 * resolves as `stale` and is never merged into the current results. Result pages continue from the
 * frontier of the rows already loaded, coalesce into one in-flight request, and reject a repeated
 * OID, which keeps pagination monotonic without `--skip`.
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
      frontier: state.frontier,
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
 * @returns The fresh state.
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
    frontier: [],
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
 * Merges one search page, rejecting repeated OIDs and advancing the cursor.
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
    frontier: computeSearchFrontier(rows),
    done: state.done || page.done || added.length === 0,
  };
}

/**
 * Computes the frontier for the next search page.
 *
 * Search results are a filtered subset, so every result that has not been emitted yet is a valid
 * continuation point. Only the last result is used, because git's search walk continues from it
 * without `--skip`.
 *
 * @param rows - Loaded search rows.
 * @returns The last loaded OID as the frontier, or an empty list.
 */
function computeSearchFrontier(rows: readonly GraphCommit[]): readonly string[] {
  const last = rows.at(-1);

  return last === undefined ? [] : [last.oid];
}
