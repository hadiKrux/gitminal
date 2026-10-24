/** One commit row needed by the paging and search engines. */
export interface GraphCommit {
  /** Full commit OID. */
  readonly oid: string;
  /** Full parent OIDs, in git order. */
  readonly parents: readonly string[];
}

/** One bounded page returned by a log or search read. */
export interface GraphPage {
  /** Commits in display order, already free of duplicates within the page. */
  readonly commits: readonly GraphCommit[];
  /** True when git reported no more history for this request. */
  readonly done: boolean;
}

/** One page request. The frontier is passed as positive revisions; `--skip` never exists. */
export interface GraphPageRequest {
  /** Scope key such as `all`, `local`, or `current`. */
  readonly scopeKey: string;
  /** Parent OIDs not yet emitted, used as the positive revision starting point. */
  readonly frontier: readonly string[];
  /** Maximum commits to read. */
  readonly limit: number;
}

/** Loads one page for a request. Injected so the engine never spawns. */
export type GraphPageLoader = (request: GraphPageRequest) => Promise<GraphPage>;

/** Loaded page window held by the graph feature. */
export interface GraphWindowState {
  /** Scope the window belongs to. */
  readonly scopeKey: string;
  /** Loaded commits in order, trimmed to the retained window. */
  readonly rows: readonly GraphCommit[];
  /** Number of pages appended since the last reset. */
  readonly pagesLoaded: number;
  /** Oldest emitted OID, the monotonic display anchor. */
  readonly oldestOid: string | null;
  /** Parents of emitted commits that have not themselves been emitted. */
  readonly frontier: readonly string[];
  /** True when history is exhausted. */
  readonly done: boolean;
}

/** Outcome of one page load. */
export type GraphPageOutcome =
  | { readonly status: "appended"; readonly state: GraphWindowState; readonly added: number }
  | { readonly status: "done"; readonly state: GraphWindowState; readonly added: number }
  | { readonly status: "stale"; readonly state: GraphWindowState }
  | { readonly status: "error"; readonly state: GraphWindowState; readonly error: unknown };

/** Outcome of one bounded `ensureLoaded` walk. */
export type EnsureLoadedResult = "loaded" | "notFound" | "exceeded" | "cancelled";

/** Options accepted by `createGraphPaginator`. */
export interface GraphPaginatorOptions {
  /** Page size, normally `graph.initialPageSize`. */
  readonly pageSize: number;
  /** Loader for one page. */
  readonly loadPage: GraphPageLoader;
  /** Initial scope key. Defaults to an empty key until `reset` is called. */
  readonly initialScope?: string;
  /** Maximum retained pages before the oldest rows are released. Defaults to 10. */
  readonly maxRetainedPages?: number;
  /** Maximum pages `ensureLoaded` may walk. Defaults to 20. */
  readonly ensureMaxPages?: number;
  /** Wall-clock budget for `ensureLoaded` in milliseconds. Defaults to 10000. */
  readonly ensureTimeoutMs?: number;
  /** Clock used for the ensure budget. */
  readonly now?: () => number;
}

/** Stateful paging engine owned by the graph feature. */
export interface GraphPaginator {
  /** Current window state. */
  getState(): GraphWindowState;
  /** Current generation token; stale results carry an older value. */
  getGeneration(): number;
  /** Resets the window for a scope and bumps the generation. */
  reset(scopeKey: string): void;
  /** Loads the first page. */
  loadInitial(): Promise<GraphPageOutcome>;
  /** Loads the next page, coalescing into the in-flight request. */
  loadOlder(): Promise<GraphPageOutcome>;
  /**
   * Walks pages until the OID is loaded or a page or time bound is reached.
   *
   * @param oid - Commit OID to find.
   * @param signal - Optional cancellation signal.
   * @returns Whether the OID loaded, was absent, exceeded a bound, or was cancelled.
   */
  ensureLoaded(oid: string, signal?: AbortSignal): Promise<EnsureLoadedResult>;
  /** Bumps the generation and discards the in-flight result. */
  cancel(): void;
}

/** Search request: a bounded page of matching commits. */
export interface GraphSearchRequest {
  /** Scope key. */
  readonly scopeKey: string;
  /** Search terms, already split and de-duplicated. */
  readonly terms: readonly string[];
  /** Frontier that continues the previous search page. */
  readonly frontier: readonly string[];
  /** Maximum results to read. */
  readonly limit: number;
}

/** Loads one search page. Injected so the engine never spawns. */
export type GraphSearchLoader = (request: GraphSearchRequest) => Promise<GraphPage>;

/** Loaded search results and cursor. */
export interface GraphSearchState {
  /** Scope key. */
  readonly scopeKey: string;
  /** Raw query the results belong to. */
  readonly query: string;
  /** Parsed terms. */
  readonly terms: readonly string[];
  /** Matching commits in order. */
  readonly rows: readonly GraphCommit[];
  /** Number of result pages appended for the current query. */
  readonly pagesLoaded: number;
  /** Frontier that continues the results. */
  readonly frontier: readonly string[];
  /** True when no more matches exist. */
  readonly done: boolean;
}

/** Outcome of one search or search-page load. */
export type GraphSearchOutcome =
  | { readonly status: "appended"; readonly state: GraphSearchState; readonly added: number }
  | { readonly status: "done"; readonly state: GraphSearchState; readonly added: number }
  | { readonly status: "empty-query"; readonly state: GraphSearchState }
  | { readonly status: "stale"; readonly state: GraphSearchState }
  | { readonly status: "error"; readonly state: GraphSearchState; readonly error: unknown };

/** Options accepted by `createGraphSearch`. */
export interface GraphSearchOptions {
  /** Scope key the search runs in. */
  readonly scopeKey: string;
  /** Page size for each search request. */
  readonly pageSize: number;
  /** Loader for one search page. */
  readonly loadPage: GraphSearchLoader;
}

/** Stateful search engine with cursor pagination and stale-query discard. */
export interface GraphSearch {
  /** Current search state. */
  getState(): GraphSearchState;
  /** Current generation token. */
  getGeneration(): number;
  /**
   * Starts a new query, cancelling the previous result through the generation token.
   *
   * @param query - Raw search input.
   * @returns The first result page outcome.
   */
  search(query: string): Promise<GraphSearchOutcome>;
  /** Loads the next result page, coalescing into the in-flight request. */
  loadMore(): Promise<GraphSearchOutcome>;
  /** Bumps the generation and discards in-flight results. */
  cancel(): void;
}
