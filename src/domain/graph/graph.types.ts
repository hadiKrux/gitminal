import type { GraphScope } from "@/domain/config/config.types";
import type { GitFailure, GitReadOptions } from "@/domain/git/git.types";

export type { GraphScope };

/** Change kind of one file in a commit's own diff. */
export type GraphFileStatus =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "copied"
  | "type-changed"
  | "unknown";

/** One file changed by a commit, joined from the raw and numstat block. */
export interface GraphFileStat {
  /** Path in the commit's tree. For a rename or copy this is the new path. */
  readonly path: string;
  /** Previous path for a rename or copy, otherwise null. */
  readonly oldPath: string | null;
  /** Change kind reported by the raw status. */
  readonly status: GraphFileStatus;
  /** Added lines, or null when git reported the file as binary. */
  readonly additions: number | null;
  /** Removed lines, or null when git reported the file as binary. */
  readonly deletions: number | null;
  /** True when `--numstat` reported `-` for both line counts. */
  readonly binary: boolean;
}

/**
 * One commit row with every value the Commit graph row and search result row need.
 *
 * The row is produced once by the parser and travels through pagination and search unchanged, so
 * the UI never re-reads git or recomputes file stats while rendering.
 */
export interface GraphRow {
  /** Full commit OID. */
  readonly oid: string;
  /** Full parent OIDs, in git order. */
  readonly parents: readonly string[];
  /** Author name from `%an`. */
  readonly authorName: string;
  /** Author email from `%ae`. */
  readonly authorEmail: string;
  /** Author date as strict ISO 8601 from `%aI`. */
  readonly authorDate: string;
  /** Committer time in seconds since the epoch from `%ct`. */
  readonly committerTimestamp: number;
  /** Raw decoration entries from `%D` with `--decorate=full`, in git order. */
  readonly decorations: readonly string[];
  /** Subject line from `%s`. */
  readonly subject: string;
  /** Message body from `%b`, without git's trailing newline. */
  readonly body: string;
  /** Number of entries in the commit's raw block. */
  readonly fileCount: number;
  /** Sum of the numeric added lines; binary files contribute zero. */
  readonly additions: number;
  /** Sum of the numeric removed lines; binary files contribute zero. */
  readonly deletions: number;
  /** One entry per raw path, joined with its numstat line counts. */
  readonly files: readonly GraphFileStat[];
}

/** One commit row needed by the paging and search engines. */
export interface GraphCommit {
  /** Full commit OID. */
  readonly oid: string;
  /** Full parent OIDs, in git order. */
  readonly parents: readonly string[];
  /**
   * Display payload when the loader read this row from `git log`.
   *
   * Paging and search accept either a bare commit or a full row, so the engines stay usable with
   * minimal fixtures while production loaders keep every display value on the row.
   */
  readonly row?: GraphRow;
}

/** Kind of failure produced while parsing the versioned log stream. */
export type GraphLogParseErrorKind =
  | "missing-version"
  | "unknown-version"
  | "field-count"
  | "duplicate-oid";

/** Typed parse error for one log page. The page error row shows the message and a Retry action. */
export interface GraphLogParseError {
  /** Failure category. */
  readonly kind: GraphLogParseErrorKind;
  /** One-line message naming the malformed record. */
  readonly message: string;
}

/** Result of parsing one versioned log stream. */
export type GraphLogParseResult =
  | { readonly ok: true; readonly rows: readonly GraphRow[] }
  | { readonly ok: false; readonly error: GraphLogParseError };

/** Classified failure of one log or search page read. */
export type GraphLogFailure =
  | { readonly kind: "git"; readonly message: string; readonly git: GitFailure }
  | { readonly kind: "parse"; readonly message: string; readonly parse: GraphLogParseError };

/** Result of one bounded `git log` page read. */
export interface GraphLogReadResult {
  /** True when git exited cleanly and every record parsed. */
  readonly ok: boolean;
  /** Parsed rows in display order, empty when the read failed. */
  readonly rows: readonly GraphRow[];
  /** True when git reported no more history or matches for this request. */
  readonly done: boolean;
  /** Classified failure, or null on success. */
  readonly failure: GraphLogFailure | null;
}

/** Options for one bounded log page read. */
export interface GraphLogPageOptions extends GitReadOptions {
  /** Scope the page is read from. */
  readonly scope: GraphScope;
  /** Maximum commits to read. */
  readonly limit: number;
  /** Parent OIDs not yet emitted, passed as positive revisions. */
  readonly frontier?: readonly string[];
}

/** Options for one bounded search page read. */
export interface GraphSearchPageOptions extends GitReadOptions {
  /** Scope the search runs in. */
  readonly scope: GraphScope;
  /** Search terms, one `--grep` each. */
  readonly terms: readonly string[];
  /** Maximum matches to read. */
  readonly limit: number;
  /** Number of matching commits already returned, passed as the stable `--skip` value. */
  readonly offset?: number;
}

/**
 * One cell of the commit graph on the commit line.
 *
 * A cell records which of its four edges a line touches, so the renderer can map the geometry onto
 * box-drawing glyphs. The commit cell replaces its line glyph with the commit or merge symbol while
 * keeping the right connection in the second character, matching lazygit's two-character cells.
 */
export interface GraphLaneCell {
  /** True when the top edge connects to a line. */
  readonly up: boolean;
  /** True when the bottom edge connects to a line. */
  readonly down: boolean;
  /** True when the left edge connects to a line. */
  readonly left: boolean;
  /** True when the right edge connects to a line. */
  readonly right: boolean;
  /** Cell role: a plain line, a normal commit, or a merge commit. */
  readonly kind: "line" | "commit" | "merge";
  /**
   * Lane identity used for per-branch coloring.
   *
   * The value is the lane the line belongs to, not the column the cell occupies, so a branch keeps
   * its color when the pipe shifts to a free column. It is an index into the theme's lane colors.
   */
  readonly lane: number;
}

/** One row of graph lane output. */
export interface GraphLaneRow {
  /** Commit OID the row belongs to. */
  readonly oid: string;
  /** Column index of the node cell. */
  readonly nodeColumn: number;
  /** One cell per lane column on the commit line, from left to right. */
  readonly cells: readonly GraphLaneCell[];
  /**
   * One cell per lane column on the continuation line below the commit.
   *
   * A lane that continues into the next row is a vertical cell and a freed lane is an empty cell,
   * so the row below the commit shows the same columns and the tree reads as continuous. The caller
   * pads the line to the fixed graph gutter.
   */
  readonly below: readonly GraphLaneCell[];
}

/**
 * Lane state carried across a page boundary.
 *
 * Each slot holds the OID that lane expects next, or null when the lane is free. Passing the state
 * returned by one page into the next keeps lane columns continuous across a page load.
 */
export interface GraphLaneState {
  /** Expected OID per lane column. */
  readonly lanes: readonly (string | null)[];
}

/** Result of one lane assignment pass. */
export interface GraphLaneAssignment {
  /** One lane row per input commit, in input order. */
  readonly rows: readonly GraphLaneRow[];
  /** State to pass to the next page. */
  readonly state: GraphLaneState;
}

/** One bounded page returned by a log or search read. */
export interface GraphPage {
  /**
   * Commits in display order, already free of duplicates within the page.
   *
   * A production loader returns rows from `git.log.ts`, so each commit carries its optional `row`
   * display payload; a minimal fixture may return bare commits.
   */
  readonly commits: readonly GraphCommit[];
  /** True when git reported no more history for this request. */
  readonly done: boolean;
}

/** One page request. The frontier is passed as positive revisions; `--skip` never exists. */
export interface GraphPageRequest {
  /** Scope key such as `all`, `local`, or `current`. */
  readonly scopeKey: string;
  /**
   * Unvisited scope tips plus parent OIDs not yet emitted, used as the positive revision starting
   * point. The first page leaves this empty so the full scope resolves the walk.
   */
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
  /** Unvisited scope tips plus parents of emitted commits that have not themselves been emitted. */
  readonly frontier: readonly string[];
  /** True when history is exhausted. */
  readonly done: boolean;
}

/**
 * Opaque rollback point for one graph window.
 *
 * The checkpoint pairs the window state with every OID the window emitted since the last reset.
 * Callers never inspect or edit it; they only pass a value returned by `capture()` back to
 * `restore()`. Keeping the full emitted set is what stops a rollback after window trimming from
 * re-adding a released tip and re-walking the newest history.
 */
export interface GraphPaginatorCheckpoint {
  /** Window state captured before the reload. */
  readonly state: GraphWindowState;
  /** Every OID the window emitted since the last reset, including rows released by trimming. */
  readonly emitted: readonly string[];
}

/** Outcome of one page load. */
export type GraphPageOutcome =
  | { readonly status: "appended"; readonly state: GraphWindowState; readonly added: number }
  | { readonly status: "done"; readonly state: GraphWindowState; readonly added: number }
  | { readonly status: "stale"; readonly state: GraphWindowState }
  | { readonly status: "error"; readonly state: GraphWindowState; readonly error: unknown };

/**
 * Outcome of one bounded `ensureLoaded` walk.
 *
 * `cancelled` means the walk was superseded by a generation move, while `error` means a page read
 * failed. Callers keep the selection for both, but only `notFound` and `exceeded` prove the commit
 * is outside the loaded history.
 */
export type EnsureLoadedResult = "loaded" | "notFound" | "exceeded" | "cancelled" | "error";

/** Options accepted by `createGraphPaginator`. */
export interface GraphPaginatorOptions {
  /** Page size, normally `graph.initialPageSize`. */
  readonly pageSize: number;
  /** Loader for one page. */
  readonly loadPage: GraphPageLoader;
  /** Initial scope key. Defaults to an empty key until `reset` is called. */
  readonly initialScope?: string;
  /**
   * Reads the current tip OIDs of the configured scope.
   *
   * The initial window and every `reset` seed the frontier with this list, so a branch or HEAD tip
   * outside the first page is still walked. The callback is plain data: repository state stays in
   * the feature and the paginator never imports it. Returns no tips when omitted.
   */
  readonly listScopeTips?: () => readonly string[];
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
  /**
   * Captures the current window and its full emitted set as an opaque rollback point.
   *
   * @returns The checkpoint to pass to `restore`.
   */
  capture(): GraphPaginatorCheckpoint;
  /**
   * Replaces the window and emitted set with a captured checkpoint and discards in-flight results.
   *
   * A failed reload uses this to roll back the empty post-reset window, so the loaded rows, the
   * cursor, and the emitted set survive a transient page-read failure. The generation is bumped, so
   * a result that started before the rollback can never be applied on top of the restored window.
   *
   * @param checkpoint - Value returned by `capture` before the reload.
   */
  restore(checkpoint: GraphPaginatorCheckpoint): void;
  /** Loads the first page. */
  loadInitial(): Promise<GraphPageOutcome>;
  /** Loads the next page, coalescing into the in-flight request. */
  loadOlder(): Promise<GraphPageOutcome>;
  /**
   * Walks pages until the OID is loaded or a page or time bound is reached.
   *
   * @param oid - Commit OID to find.
   * @param signal - Optional cancellation signal.
   * @returns Whether the OID loaded, was absent, exceeded a bound, was cancelled by a generation
   * move, or failed a page read.
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
  /** Number of matching commits already returned, used as the stable search offset. */
  readonly offset: number;
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
  /** Number of matching commits git returned, including any duplicate OIDs. */
  readonly offset: number;
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
