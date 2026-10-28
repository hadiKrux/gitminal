import { type MutableRefObject, useCallback, useEffect, useRef } from "react";
import type {
  EnsureLoadedResult,
  GraphPageOutcome,
  GraphPaginator,
  GraphWindowState,
} from "@/domain/graph/graph.types";
import type { RepositorySelection } from "@/domain/repository/repository.types";
import { GRAPH_WALK_ERROR_MESSAGE } from "@/features/graph/graph.constants";
import type { GraphSelectionTarget, GraphWalkError } from "@/features/graph/graph.types";
import { readPageError, useGraphWindowLifecycle } from "@/features/graph/graphWindowReload";
import { useScopeTipsReload } from "@/features/graph/useScopeTipsReload";

/**
 * Owns graph loading, paging, the bounded navigator, and the window refresher.
 *
 * The paginator owns the cursor-based page window and the single in-flight request. This hook mirrors
 * its outcomes into React, registers the commit navigator and the provider's window refresher, and
 * discards the stale page result when the repository generation moves on. The git invocation that
 * produced it is not aborted and may run to completion. It never reads git outside the paginator's
 * injected page loader. A graph-window reload that fails a page read restores the captured checkpoint
 * (the exact pre-reload window and emitted set), leaves the selection untouched, and reports failure
 * to the provider so the page Retry can re-run the window reload. A reload whose selection-restoration
 * walk fails keeps its own notice and exposes a walk Retry that always re-runs the provider reload,
 * distinct from the page Retry. A change to the scope-tip key after
 * the first page reloads the same page count through the provider, so the reload owns the in-flight
 * flag and is not cancelled by a status refresh. A failed parent or search-result walk keeps its own
 * notice instead of the page-load error channel, and the next successful walk clears it. The first
 * page waits for the initial repository read, so startup seeds the cursor from the real snapshot tips
 * and issues one page.
 *
 * @param input - Paginator, window setters, generation, readiness, and selection memory.
 * @returns The initial-load, older-page, page Retry, and walk Retry entry points.
 */
export function useGraphPaging(input: {
  readonly paginator: GraphPaginator;
  readonly setWindowState: (state: GraphWindowState) => void;
  readonly setIsLoadingInitial: (loading: boolean) => void;
  readonly setIsLoadingOlder: (loading: boolean) => void;
  readonly setIsLoadingParent: (loading: boolean) => void;
  readonly setBoundedMiss: (visible: boolean) => void;
  readonly setWalkError: (error: GraphWalkError | null) => void;
  readonly setPageError: (message: string | null) => void;
  readonly generation: number;
  readonly isGraphInFlight: boolean;
  readonly ready: boolean;
  readonly refreshGraphWindow: () => Promise<{
    readonly ok: boolean;
    readonly coalesced: boolean;
    readonly error: string | null;
  }>;
  readonly selectionRef: MutableRefObject<RepositorySelection>;
  readonly lastSelectionIndexRef: MutableRefObject<number>;
  readonly selectTarget: (target: GraphSelectionTarget) => void;
  readonly scopeKey: string;
  readonly scopeTipsKey: string;
  readonly pagesLoaded: number;
  readonly searchOpen: boolean;
  readonly registerCommitNavigator: (
    navigator: ((oid: string) => Promise<EnsureLoadedResult>) | null,
  ) => void;
  readonly registerGraphWindowRefresher: (refresher: (() => Promise<boolean>) | null) => void;
}) {
  const {
    generation,
    isGraphInFlight,
    lastSelectionIndexRef,
    pagesLoaded,
    paginator,
    ready,
    refreshGraphWindow,
    registerCommitNavigator,
    registerGraphWindowRefresher,
    scopeKey,
    scopeTipsKey,
    searchOpen,
    selectionRef,
    selectTarget,
    setBoundedMiss,
    setIsLoadingInitial,
    setIsLoadingOlder,
    setIsLoadingParent,
    setPageError,
    setWalkError,
    setWindowState,
  } = input;
  const flowRef = useRef({ olderLoading: false });
  const tipsPaginatorRef = useRef(paginator);
  const recordedTipsKeyRef = useRef(scopeTipsKey);
  const scopeTipsKeyRef = useRef(scopeTipsKey);
  const reloadingTipsRef = useRef(false);
  const windowReloadFailedRef = useRef(false);

  scopeTipsKeyRef.current = scopeTipsKey;

  /** Applies one page outcome to the window and error state. */
  const applyOutcome = useCallback(
    (outcome: GraphPageOutcome): void => {
      applyPageOutcome(outcome, setPageError, setWalkError, setWindowState);
    },
    [setPageError, setWalkError, setWindowState],
  );

  /** Loads the first page and resets the initial-loading flag. */
  const runInitialLoad = useCallback(async (): Promise<void> => {
    windowReloadFailedRef.current = false;
    recordedTipsKeyRef.current = scopeTipsKeyRef.current;
    setIsLoadingInitial(true);
    setPageError(null);
    applyOutcome(await paginator.loadInitial());
    setIsLoadingInitial(false);
  }, [applyOutcome, paginator, setIsLoadingInitial, setPageError]);

  /** Loads one older page unless a request is already running or history is exhausted. */
  const requestOlderPage = useCallback(async (): Promise<void> => {
    if (!canLoadOlderPage(flowRef.current.olderLoading, paginator.getState())) {
      return;
    }

    flowRef.current.olderLoading = true;
    windowReloadFailedRef.current = false;
    setIsLoadingOlder(true);
    setPageError(null);

    try {
      applyOutcome(await paginator.loadOlder());
    } finally {
      flowRef.current.olderLoading = false;
      setIsLoadingOlder(false);
    }
  }, [applyOutcome, paginator, setIsLoadingOlder, setPageError]);

  useScopeTipsReload({
    paginator,
    pagesLoaded,
    refreshGraphWindow,
    scopeTipsKey,
    searchOpen,
    setPageError,
    tipsPaginatorRef,
    recordedTipsKeyRef,
    reloadingTipsRef,
    scopeTipsKeyRef,
  });

  useCommitNavigator({
    paginator,
    registerCommitNavigator,
    setBoundedMiss,
    setIsLoadingParent,
    setWalkError,
    setWindowState,
  });

  const { retry, retryWalk } = useGraphWindowLifecycle({
    paginator,
    ready,
    generation,
    isGraphInFlight,
    setWindowState,
    setPageError,
    setWalkError,
    setBoundedMiss,
    setIsLoadingOlder,
    runInitialLoad,
    requestOlderPage,
    refreshGraphWindow,
    scopeKey,
    selectionRef,
    lastSelectionIndexRef,
    selectTarget,
    scopeTipsKeyRef,
    recordedTipsKeyRef,
    windowReloadFailedRef,
    registerGraphWindowRefresher,
  });

  return { runInitialLoad, requestOlderPage, retry, retryWalk };
}

/**
 * Registers the graph's bounded commit navigator.
 *
 * Selecting a commit already in the window publishes no extra page and clears a stale miss row. A
 * walk that appended pages publishes the enlarged window, and only a genuine bounded miss shows the
 * miss row. A cancelled walk stays neutral. A failed page read keeps the selection and shows the
 * distinct walk-error notice instead of the page-load error channel, so a later successful
 * selection clears it and the page Retry never targets an unrelated older-page read.
 *
 * @param input - Paginator, provider registration, and the parent-loading and window setters.
 */
function useCommitNavigator(input: {
  readonly paginator: GraphPaginator;
  readonly registerCommitNavigator: (
    navigator: ((oid: string) => Promise<EnsureLoadedResult>) | null,
  ) => void;
  readonly setBoundedMiss: (visible: boolean) => void;
  readonly setIsLoadingParent: (loading: boolean) => void;
  readonly setWalkError: (error: GraphWalkError | null) => void;
  readonly setWindowState: (state: GraphWindowState) => void;
}): void {
  const {
    paginator,
    registerCommitNavigator,
    setBoundedMiss,
    setIsLoadingParent,
    setWalkError,
    setWindowState,
  } = input;

  useEffect(() => {
    const navigator = async (oid: string): Promise<EnsureLoadedResult> => {
      if (paginator.getState().rows.some((row) => row.oid === oid)) {
        setBoundedMiss(false);
        setWalkError(null);

        return "loaded";
      }

      setIsLoadingParent(true);

      try {
        const result = await paginator.ensureLoaded(oid);

        setWindowState(paginator.getState());

        if (result === "loaded") {
          setBoundedMiss(false);
          setWalkError(null);
        } else if (result === "notFound" || result === "exceeded") {
          setBoundedMiss(true);
          setWalkError(null);
        } else if (result === "error") {
          setBoundedMiss(false);
          setWalkError({ message: GRAPH_WALK_ERROR_MESSAGE, retryable: false });
        }

        return result;
      } finally {
        setIsLoadingParent(false);
      }
    };

    registerCommitNavigator(navigator);

    return () => {
      registerCommitNavigator(null);
    };
  }, [
    paginator,
    registerCommitNavigator,
    setBoundedMiss,
    setIsLoadingParent,
    setWalkError,
    setWindowState,
  ]);
}

/**
 * Applies one page outcome to the window mirror and error state.
 *
 * @param outcome - Settled page outcome.
 * @param setPageError - Page error writer.
 * @param setWalkError - Walk error writer.
 * @param setWindowState - Window mirror writer.
 */
function applyPageOutcome(
  outcome: GraphPageOutcome,
  setPageError: (message: string | null) => void,
  setWalkError: (error: GraphWalkError | null) => void,
  setWindowState: (state: GraphWindowState) => void,
): void {
  if (outcome.status === "stale") {
    return;
  }

  if (outcome.status === "error") {
    setPageError(readPageError(outcome.error));
    // A page failure owns the error surface: the walk notice would otherwise offer a second Retry
    // for an older failure that no longer matches the visible window.
    setWalkError(null);
    setWindowState(outcome.state);

    return;
  }

  setPageError(null);
  setWalkError(null);
  setWindowState(outcome.state);
}

/**
 * Reports whether an older-page load may start.
 *
 * @param olderLoading - True while an older page request is already running.
 * @param state - Current paginator window.
 * @returns True when the request may start.
 */
function canLoadOlderPage(
  olderLoading: boolean,
  state: Pick<GraphWindowState, "done" | "pagesLoaded">,
): boolean {
  return !olderLoading && !state.done && state.pagesLoaded > 0;
}
