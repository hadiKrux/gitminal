import type {
  EnsureLoadedResult,
  GraphCommit,
  GraphPage,
  GraphPageOutcome,
  GraphPageRequest,
  GraphPaginator,
  GraphPaginatorOptions,
  GraphWindowState,
} from "./graph.types";

/** Pages retained before the oldest rows are released. */
const DEFAULT_MAX_RETAINED_PAGES = 10;

/** Pages `ensureLoaded` may walk before reporting `exceeded`. */
const GRAPH_ENSURE_MAX_PAGES = 20;

/** Wall-clock budget for one `ensureLoaded` walk. */
const GRAPH_ENSURE_TIMEOUT_MS = 10_000;

/**
 * Computes the frontier that continues a page.
 *
 * The frontier is every parent of an emitted commit that has not itself been emitted, in first-seen
 * order. Passing it as positive revisions means the next request starts at the real graph edge
 * instead of an offset, so `--skip` is never needed and trimming old rows cannot renumber the next
 * page.
 *
 * @param rows - Emitted commits in display order.
 * @returns Parent OIDs that remain unemitted.
 */
export function computeFrontier(rows: readonly GraphCommit[]): readonly string[] {
  const emitted = new Set(rows.map((row) => row.oid));
  const seen = new Set<string>();
  const frontier: string[] = [];

  for (const row of rows) {
    for (const parent of row.parents) {
      if (emitted.has(parent) || seen.has(parent)) {
        continue;
      }

      seen.add(parent);
      frontier.push(parent);
    }
  }

  return frontier;
}

/**
 * Creates the empty window for one scope.
 *
 * @param scopeKey - Scope key the window belongs to.
 * @returns An empty window with no loaded pages.
 */
export function createEmptyWindow(scopeKey: string): GraphWindowState {
  return {
    scopeKey,
    rows: [],
    pagesLoaded: 0,
    oldestOid: null,
    frontier: [],
    done: false,
  };
}

/**
 * Builds the next page request from the cursor.
 *
 * @param state - Current window state.
 * @param pageSize - Maximum commits per page.
 * @returns The request, or null when history is exhausted.
 */
export function buildNextPageRequest(
  state: GraphWindowState,
  pageSize: number,
): GraphPageRequest | null {
  if (state.done) {
    return null;
  }

  return { scopeKey: state.scopeKey, frontier: state.frontier, limit: pageSize };
}

/**
 * Merges one page into the window.
 *
 * A repeated OID is rejected rather than appended, so a page that overlaps the loaded prefix cannot
 * duplicate rows. The oldest OID and the frontier are computed from the untrimmed rows, then the
 * rows are trimmed to the retained window at the far end from the viewport, which keeps the page
 * just loaded visible and pagination monotonic after trimming.
 *
 * @param state - Current window state.
 * @param page - Page returned by the loader.
 * @param pageSize - Maximum commits per page.
 * @param maxRetainedPages - Pages retained before the oldest rows are released.
 * @returns The next window state.
 */
function mergeGraphPage(
  state: GraphWindowState,
  page: GraphPage,
  pageSize: number,
  maxRetainedPages: number,
): GraphWindowState {
  const known = new Set(state.rows.map((row) => row.oid));
  const added = page.commits.filter((commit) => !known.has(commit.oid));
  const rows = [...state.rows, ...added];
  const lastAdded = added.at(-1);

  return {
    scopeKey: state.scopeKey,
    rows: trimRetainedRows(rows, pageSize, maxRetainedPages),
    pagesLoaded: state.pagesLoaded + 1,
    oldestOid: lastAdded?.oid ?? state.oldestOid,
    frontier: advanceFrontier(state.frontier, added),
    done: state.done || page.done || added.length === 0,
  };
}

/**
 * Advances the frontier after one page.
 *
 * Consumed frontier OIDs leave the list, and the parents of new commits enter it. Advancing the
 * frontier incrementally rather than recomputing it from the retained rows keeps pagination
 * monotonic after old rows are trimmed: a trimmed commit never reappears as an unemitted parent, so
 * the next request can never re-walk the loaded prefix.
 *
 * @param previousFrontier - Frontier before the page.
 * @param added - Commits appended by the page.
 * @returns The frontier for the next request.
 */
function advanceFrontier(
  previousFrontier: readonly string[],
  added: readonly GraphCommit[],
): readonly string[] {
  const addedOids = new Set(added.map((commit) => commit.oid));
  const next = previousFrontier.filter((oid) => !addedOids.has(oid));
  const seen = new Set(next);

  for (const commit of added) {
    for (const parent of commit.parents) {
      if (addedOids.has(parent) || seen.has(parent)) {
        continue;
      }

      seen.add(parent);
      next.push(parent);
    }
  }

  return next;
}

/**
 * Trims rows to the retained window while leaving the cursor untouched.
 *
 * Older pages append below the viewport, so trimming keeps the newest retained tail, which includes
 * the page just loaded, and releases the far end at the top. The frontier and oldest OID used to
 * build the next request are kept by the caller, so pagination stays monotonic after trimming.
 *
 * @param rows - All emitted rows, untrimmed.
 * @param pageSize - Maximum commits per page.
 * @param maxRetainedPages - Pages to retain.
 * @returns The retained rows.
 */
function trimRetainedRows(
  rows: readonly GraphCommit[],
  pageSize: number,
  maxRetainedPages: number,
): readonly GraphCommit[] {
  const maxRows = Math.max(1, Math.floor(pageSize) * Math.max(1, Math.floor(maxRetainedPages)));

  return rows.length > maxRows ? rows.slice(rows.length - maxRows) : rows;
}

/**
 * Reports whether a row list already contains one OID.
 *
 * @param rows - Loaded rows.
 * @param oid - Candidate commit OID.
 * @returns True when the OID is loaded.
 */
function containsOid(rows: readonly GraphCommit[], oid: string): boolean {
  return rows.some((row) => row.oid === oid);
}

/**
 * Reads whether an `ensureLoaded` walk must stop before its next page.
 *
 * @param signal - Optional cancellation signal.
 * @param done - True when history is exhausted.
 * @param pagesWalked - Pages already walked by this call.
 * @param now - Current clock value.
 * @param deadline - Walk deadline.
 * @returns The terminal result, or null when another page may load.
 */
function readEnsureStop(
  signal: AbortSignal | undefined,
  done: boolean,
  pagesWalked: number,
  now: number,
  deadline: number,
): EnsureLoadedResult | null {
  if (signal?.aborted === true) {
    return "cancelled";
  }

  if (done) {
    return "notFound";
  }

  return pagesWalked > 0 && now > deadline ? "exceeded" : null;
}

/**
 * Creates the stateful paging engine.
 *
 * Exactly one page request is in flight. A second `loadOlder` call joins it instead of stacking a
 * new request. Every request carries the generation captured when it started; a result whose
 * generation no longer matches is discarded as `stale`, so a scope change, a status refresh, or an
 * explicit cancel cannot apply an old page. The engine performs no I/O itself: the injected loader
 * reads the page.
 *
 * @param options - Page size, loader, retention, ensure bounds, and clock.
 * @returns The paging engine.
 */
export function createGraphPaginator(options: GraphPaginatorOptions): GraphPaginator {
  const pageSize = Math.max(1, Math.floor(options.pageSize));
  const maxRetainedPages = Math.max(1, options.maxRetainedPages ?? DEFAULT_MAX_RETAINED_PAGES);
  const ensureMaxPages = Math.max(1, options.ensureMaxPages ?? GRAPH_ENSURE_MAX_PAGES);
  const ensureTimeoutMs = options.ensureTimeoutMs ?? GRAPH_ENSURE_TIMEOUT_MS;
  const now = options.now ?? (() => Date.now());
  let state = createEmptyWindow(options.initialScope ?? "");
  let generation = 0;
  let inFlight: {
    readonly generation: number;
    readonly promise: Promise<GraphPageOutcome>;
  } | null = null;

  /**
   * Reports whether a token still belongs to the current generation.
   *
   * @param token - Generation captured by a request.
   * @returns True when the result is stale.
   */
  const isStale = (token: number): boolean => token !== generation;

  /**
   * Builds the current-window outcome when no request can run.
   *
   * @returns A done outcome.
   */
  const doneOutcome = (): GraphPageOutcome => ({ status: "done", state, added: 0 });

  /**
   * Executes one page request and merges it when it is still current.
   *
   * @param token - Generation captured before the request started.
   * @param request - Request built from the current cursor.
   * @returns The settled page outcome.
   */
  const runPageRequest = async (
    token: number,
    request: GraphPageRequest,
  ): Promise<GraphPageOutcome> => {
    try {
      const page = await options.loadPage(request);

      if (isStale(token)) {
        return { status: "stale", state };
      }

      const knownBefore = new Set(state.rows.map((row) => row.oid));
      const added = page.commits.filter((commit) => !knownBefore.has(commit.oid)).length;
      const next = mergeGraphPage(state, page, pageSize, maxRetainedPages);
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
   * Starts or joins the next page request.
   *
   * @returns The settled page outcome.
   */
  const loadNextPage = (): Promise<GraphPageOutcome> => {
    if (inFlight !== null && inFlight.generation === generation) {
      return inFlight.promise;
    }

    const request = buildNextPageRequest(state, pageSize);

    if (request === null) {
      return Promise.resolve(doneOutcome());
    }

    const token = generation;
    const promise = runPageRequest(token, request);

    inFlight = { generation: token, promise };

    return promise;
  };

  return {
    getState(): GraphWindowState {
      return state;
    },

    getGeneration(): number {
      return generation;
    },

    reset(scopeKey: string): void {
      generation += 1;
      state = createEmptyWindow(scopeKey);
      inFlight = null;
    },

    loadInitial(): Promise<GraphPageOutcome> {
      return state.pagesLoaded === 0 ? loadNextPage() : Promise.resolve(doneOutcome());
    },

    loadOlder(): Promise<GraphPageOutcome> {
      return loadNextPage();
    },

    async ensureLoaded(oid: string, signal?: AbortSignal): Promise<EnsureLoadedResult> {
      if (containsOid(state.rows, oid)) {
        return "loaded";
      }

      const deadline = now() + ensureTimeoutMs;
      let pagesWalked = 0;

      while (pagesWalked < ensureMaxPages) {
        const stop = readEnsureStop(signal, state.done, pagesWalked, now(), deadline);

        if (stop !== null) {
          return stop;
        }

        const outcome = await loadNextPage();
        pagesWalked += 1;

        if (outcome.status === "stale" || outcome.status === "error") {
          return "cancelled";
        }

        if (containsOid(state.rows, oid)) {
          return "loaded";
        }

        if (outcome.status === "done") {
          return "notFound";
        }
      }

      return "exceeded";
    },

    cancel(): void {
      generation += 1;
      inFlight = null;
    },
  };
}
