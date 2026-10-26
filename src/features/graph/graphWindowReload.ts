import { type MutableRefObject, useCallback, useEffect, useRef } from "react";
import type {
  GraphPaginator,
  GraphPaginatorCheckpoint,
  GraphWindowState,
} from "@/domain/graph/graph.types";
import type { RepositorySelection } from "@/domain/repository/repository.types";
import { GRAPH_WALK_ERROR_MESSAGE } from "@/features/graph/graph.constants";
import type { GraphSelectionTarget, GraphWalkError } from "@/features/graph/graph.types";

/**
 * Owns the graph window reload, its Retry action, and the mount and generation lifecycle effects.
 *
 * The pre-reload window is captured before the paginator resets. A failed page read restores the
 * exact captured window, leaves the selection alone, reports failure to the provider, and keeps the
 * window-reload failure recorded so the page Retry runs the reload again instead of an older-page
 * read. The tip key a reload seeds is recorded only after success, so a failed reload never marks a
 * new tip as handled. A failed selection-restoration walk keeps its own notice with the Retry that
 * re-runs this reload, never the page-load message. A generation move cancels an in-flight page
 * result unless the provider owns a graph-window reload, which this hook detects from
 * `isGraphInFlight`.
 *
 * @param input - Paginator, generation, loading state, readers, and the state setters.
 * @returns The page Retry and the walk Retry entry points.
 */
export function useGraphWindowLifecycle(input: {
  readonly paginator: GraphPaginator;
  readonly ready: boolean;
  readonly generation: number;
  readonly isGraphInFlight: boolean;
  readonly setWindowState: (state: GraphWindowState) => void;
  readonly setPageError: (message: string | null) => void;
  readonly setWalkError: (error: GraphWalkError | null) => void;
  readonly setBoundedMiss: (visible: boolean) => void;
  readonly setIsLoadingOlder: (loading: boolean) => void;
  readonly runInitialLoad: () => Promise<void>;
  readonly requestOlderPage: () => Promise<void>;
  readonly refreshGraphWindow: () => Promise<{
    readonly ok: boolean;
    readonly coalesced: boolean;
    readonly error: string | null;
  }>;
  readonly scopeKey: string;
  readonly selectionRef: MutableRefObject<RepositorySelection>;
  readonly lastSelectionIndexRef: MutableRefObject<number>;
  readonly selectTarget: (target: GraphSelectionTarget) => void;
  readonly scopeTipsKeyRef: MutableRefObject<string>;
  readonly recordedTipsKeyRef: MutableRefObject<string>;
  readonly windowReloadFailedRef: MutableRefObject<boolean>;
  readonly registerGraphWindowRefresher: (refresher: (() => Promise<boolean>) | null) => void;
}): { readonly retry: () => void; readonly retryWalk: () => void } {
  const {
    generation,
    isGraphInFlight,
    lastSelectionIndexRef,
    paginator,
    ready,
    recordedTipsKeyRef,
    refreshGraphWindow,
    registerGraphWindowRefresher,
    requestOlderPage,
    runInitialLoad,
    scopeKey,
    scopeTipsKeyRef,
    selectionRef,
    selectTarget,
    setBoundedMiss,
    setIsLoadingOlder,
    setPageError,
    setWalkError,
    setWindowState,
    windowReloadFailedRef,
  } = input;
  const previousGenerationRef = useRef(generation);

  /**
   * Reloads the same page count after a mutation and restores the selection.
   *
   * The key read before the reload is the tip set the reload will seed its cursor from. It is
   * recorded only when the reload succeeds, so a failed reload leaves the new tip unhandled for the
   * page Retry and for the next tips effect run.
   *
   * @returns True when the reload and its selection restoration succeeded.
   */
  const reloadWindow = useCallback(async (): Promise<boolean> => {
    const tipsKey = scopeTipsKeyRef.current;
    const ok = await reloadGraphWindow({
      paginator,
      scopeKey,
      selectionRef,
      lastSelectionIndexRef,
      selectTarget,
      setPageError,
      setWalkError,
      setWindowState,
    });

    windowReloadFailedRef.current = !ok;

    if (ok) {
      recordedTipsKeyRef.current = tipsKey;
    }

    return ok;
  }, [
    lastSelectionIndexRef,
    paginator,
    recordedTipsKeyRef,
    scopeKey,
    scopeTipsKeyRef,
    selectionRef,
    selectTarget,
    setPageError,
    setWalkError,
    setWindowState,
    windowReloadFailedRef,
  ]);

  /** Retries the failed read that belongs to the current window. */
  const retry = useCallback((): void => {
    retryGraphRead({
      windowReloadFailed: windowReloadFailedRef.current,
      pagesLoaded: paginator.getState().pagesLoaded,
      reloadWindow: () => {
        void refreshGraphWindow();
      },
      loadInitial: () => {
        void runInitialLoad();
      },
      loadOlder: () => {
        void requestOlderPage();
      },
    });
  }, [paginator, refreshGraphWindow, requestOlderPage, runInitialLoad, windowReloadFailedRef]);

  /**
   * Retries the failed window reload that owned the retryable walk notice.
   *
   * The walk failure is not a page-read failure of the visible window, and an older-page attempt
   * clears the reload-failure flag, so this action always asks the provider to re-read the window
   * instead of sharing the page Retry's dispatch.
   */
  const retryWalk = useCallback((): void => {
    void refreshGraphWindow();
  }, [refreshGraphWindow]);

  useEffect(() => {
    setWindowState(paginator.getState());
    setPageError(null);
    setWalkError(null);
    setBoundedMiss(false);
    setIsLoadingOlder(false);

    if (ready) {
      void runInitialLoad();
    }

    return () => {
      paginator.cancel();
    };
  }, [
    paginator,
    ready,
    runInitialLoad,
    setBoundedMiss,
    setIsLoadingOlder,
    setPageError,
    setWalkError,
    setWindowState,
  ]);

  useEffect(() => {
    const previousGeneration = previousGenerationRef.current;

    previousGenerationRef.current = generation;

    if (
      !shouldCancelPaginator(
        previousGeneration,
        generation,
        isGraphInFlight,
        paginator.getState().pagesLoaded,
      )
    ) {
      return;
    }

    paginator.cancel();
  }, [generation, isGraphInFlight, paginator]);

  useEffect(() => {
    registerGraphWindowRefresher(reloadWindow);

    return () => {
      registerGraphWindowRefresher(null);
    };
  }, [registerGraphWindowRefresher, reloadWindow]);

  return { retry, retryWalk };
}

/**
 * Reloads the same page count after a mutation and restores the selection.
 *
 * The pre-reload window is captured before the paginator resets. If any page read fails, the exact
 * captured window is restored, the selection is left alone, and the reload reports failure so the
 * provider can surface `ok: false` and Retry can try the window again. Only `notFound` and `exceeded`
 * prove the selected OID is gone and run the nearest-row repair; a `cancelled` walk keeps the
 * selection, and a failed restoration walk keeps the selection and raises the distinct walk notice
 * with the Retry that re-runs this reload.
 *
 * @param input - Paginator, scope, selection memory, and the state setters.
 * @returns True when the reload succeeded, including a retained selection.
 */
async function reloadGraphWindow(input: {
  readonly paginator: GraphPaginator;
  readonly scopeKey: string;
  readonly selectionRef: MutableRefObject<RepositorySelection>;
  readonly lastSelectionIndexRef: MutableRefObject<number>;
  readonly selectTarget: (target: GraphSelectionTarget) => void;
  readonly setPageError: (message: string | null) => void;
  readonly setWalkError: (error: GraphWalkError | null) => void;
  readonly setWindowState: (state: GraphWindowState) => void;
}): Promise<boolean> {
  const loaded = input.paginator.getState();

  input.setWalkError(null);

  if (loaded.pagesLoaded === 0) {
    return true;
  }

  const targetPages = loaded.pagesLoaded;
  const checkpoint = input.paginator.capture();

  input.paginator.reset(input.scopeKey);

  let outcome = await input.paginator.loadInitial();
  let pages = 1;

  while (pages < targetPages && outcome.status === "appended") {
    outcome = await input.paginator.loadOlder();
    pages += 1;
  }

  if (outcome.status === "error") {
    rollBackReload(
      input.paginator,
      checkpoint,
      input.setWindowState,
      input.setPageError,
      outcome.error,
    );

    return false;
  }

  if (outcome.status === "stale") {
    return false;
  }

  input.setPageError(null);
  input.setWalkError(null);
  input.setWindowState(input.paginator.getState());

  const restored = await restoreSelectionAfterReload({
    paginator: input.paginator,
    selectionRef: input.selectionRef,
    lastSelectionIndexRef: input.lastSelectionIndexRef,
    selectTarget: input.selectTarget,
    setWalkError: input.setWalkError,
  });

  // The restoration can append pages for a selected OID outside the re-read window. Publish the
  // enlarged window so React renders the selected row instead of the pre-restoration mirror.
  input.setWindowState(input.paginator.getState());

  return restored;
}

/**
 * Restores the captured checkpoint and reports the failed page read.
 *
 * The checkpoint carries the emitted set as well as the window, so a rollback after window trimming
 * still knows every OID that was released and cannot re-walk the newest history on the next page.
 *
 * @param paginator - Paginator that owns the window.
 * @param checkpoint - Rollback point captured before the reload reset the window.
 * @param setWindowState - React mirror writer.
 * @param setPageError - Page error writer.
 * @param error - Thrown page-load error.
 */
function rollBackReload(
  paginator: GraphPaginator,
  checkpoint: GraphPaginatorCheckpoint,
  setWindowState: (state: GraphWindowState) => void,
  setPageError: (message: string | null) => void,
  error: unknown,
): void {
  paginator.restore(checkpoint);
  setPageError(readPageError(error));
  setWindowState(checkpoint.state);
}

/**
 * Restores or replaces the selection after a successful graph-window reload.
 *
 * @param input - Paginator, selection memory, internal selection dispatcher, and walk error writer.
 * @returns False when the restoration walk failed a page read, otherwise true.
 */
async function restoreSelectionAfterReload(input: {
  readonly paginator: GraphPaginator;
  readonly selectionRef: MutableRefObject<RepositorySelection>;
  readonly lastSelectionIndexRef: MutableRefObject<number>;
  readonly selectTarget: (target: GraphSelectionTarget) => void;
  readonly setWalkError: (error: GraphWalkError | null) => void;
}): Promise<boolean> {
  const selection = input.selectionRef.current;

  if (selection.kind !== "commit") {
    return true;
  }

  if (input.paginator.getState().rows.some((row) => row.oid === selection.oid)) {
    return true;
  }

  const result = await input.paginator.ensureLoaded(selection.oid);

  if (result === "loaded") {
    return true;
  }

  if (result === "cancelled") {
    return true;
  }

  if (result === "error") {
    input.setWalkError({ message: GRAPH_WALK_ERROR_MESSAGE, retryable: true });

    return false;
  }

  const rows = input.paginator.getState().rows;
  const nearest = rows[Math.min(Math.max(0, input.lastSelectionIndexRef.current), rows.length - 1)];

  input.selectTarget(
    nearest === undefined ? { kind: "pending" } : { kind: "commit", oid: nearest.oid },
  );

  return true;
}

/**
 * Dispatches the Retry action to the read that failed last.
 *
 * @param input - Failure source, loaded page count, and the three read entry points.
 */
function retryGraphRead(input: {
  readonly windowReloadFailed: boolean;
  readonly pagesLoaded: number;
  readonly reloadWindow: () => void;
  readonly loadInitial: () => void;
  readonly loadOlder: () => void;
}): void {
  if (input.windowReloadFailed) {
    input.reloadWindow();

    return;
  }

  if (input.pagesLoaded === 0) {
    input.loadInitial();

    return;
  }

  input.loadOlder();
}

/**
 * Reports whether a generation move must discard the in-flight page result.
 *
 * A graph-window reload owns the in-flight flag, so its own generation writes must not cancel it.
 *
 * @param previousGeneration - Generation seen on the previous render.
 * @param generation - Generation of the current render.
 * @param isGraphInFlight - True while the provider owns a graph-window reload.
 * @param pagesLoaded - Loaded page count.
 * @returns True when the paginator should cancel its in-flight result.
 */
function shouldCancelPaginator(
  previousGeneration: number,
  generation: number,
  isGraphInFlight: boolean,
  pagesLoaded: number,
): boolean {
  return previousGeneration !== generation && !isGraphInFlight && pagesLoaded > 0;
}

/**
 * Reads a page failure message.
 *
 * @param error - Thrown value from the page loader.
 * @returns A one-line message.
 */
export function readPageError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
