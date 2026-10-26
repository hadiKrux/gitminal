import { useEffect, useMemo, useRef } from "react";
import { useConfig } from "@/app/hooks/useConfig";
import { useFocusRegion } from "@/app/hooks/useFocusRegion";
import { useRepository } from "@/app/hooks/useRepository";
import type { GraphScope, GraphWindowState } from "@/domain/graph/graph.types";
import {
  selectGraphScopeTips,
  selectPendingCounts,
} from "@/domain/repository/repository.selectors";
import type {
  RepositoryPrimaryState,
  RepositorySnapshot,
} from "@/domain/repository/repository.types";
import { GRAPH_REGION_ID } from "@/features/graph/graph.constants";
import { formatScopeLabel } from "@/features/graph/graph.format";
import { buildCommitRows, buildDisplayRows } from "@/features/graph/graph.rows";
import type { CommitGraphHandle } from "@/features/graph/graph.types";
import { useCommitSearch } from "@/features/graph/useCommitSearch";
import { useGraphNavigation } from "@/features/graph/useGraphNavigation";
import { useGraphPaging } from "@/features/graph/useGraphPaging";
import { useGraphRefs } from "@/features/graph/useGraphRefs";
import { useGraphSelection } from "@/features/graph/useGraphSelection";
import { useGraphSelectionCommands } from "@/features/graph/useGraphSelectionCommands";
import { useGraphWindow } from "@/features/graph/useGraphWindow";

/**
 * Owns the loaded commit window, selection, navigation, paging, and graph action registration.
 *
 * This hook is the single registration owner for the `graph` scope. This hook is also the
 * composition point: `useGraphWindow` owns the paginator state, `useGraphPaging` owns the reads and
 * provider registrations, `useGraphSelection` owns the cursor and selection sync, `useCommitSearch`
 * owns search, and `useGraphNavigation` owns the page and search actions.
 *
 * The paginator owns the cursor-based page window, the single in-flight request, and the bounded
 * `ensureLoaded` walk. The hook mirrors its state into React, computes lanes once per loaded window,
 * registers the graph-window refresher and commit navigator on the provider, and never reads git
 * outside the injected page and search loaders.
 *
 * @returns Rows, selection flags, loading and error states, the region handle, and search state.
 */
export function useCommitGraph(): CommitGraphHandle {
  const repository = useRepository();
  const { config } = useConfig();
  const region = useFocusRegion(GRAPH_REGION_ID);
  const scopeKey = config.graph.scope;
  const pageSize = config.graph.initialPageSize;
  const cwd =
    repository.snapshot?.root ?? repository.signals.repositoryRoot ?? repository.signals.cwd;
  const client = repository.gitClient;
  const { scrollRef, selectionRef, lastSelectionIndexRef, searchDelegateActionRef } = useGraphRefs(
    repository.selection,
  );
  const { selectTarget, selectCommit } = useGraphSelectionCommands();

  selectionRef.current = repository.selection;

  const scopeTipsKey = readScopeTipsKey(repository.snapshot, scopeKey);

  const window = useGraphWindow({
    client,
    cwd,
    pageSize,
    scopeKey,
    listScopeTips: () => selectGraphScopeTips(repository.snapshot, scopeKey),
  });
  const pendingCounts = selectPendingCounts(repository.snapshot);
  const rows = useMemo(
    () => buildDisplayRows(buildCommitRows(window.windowState.rows), pendingCounts.total),
    [pendingCounts.total, window.windowState.rows],
  );
  const isEmpty = readGraphIsEmpty(repository.state.primary, window.windowState, window.pageError);
  const search = useCommitSearch({
    scopeKey,
    pageSize,
    client,
    cwd,
    enabled: !isEmpty,
    graphFocused: region.focused,
    generation: repository.generation,
    selection: repository.selection,
    setSelection: repository.setSelection,
    selectCommit,
    focusGraph: region.focus,
    readCursor: region.getCursor,
    writeCursor: region.setCursor,
    scrollRef,
    setBoundedMiss: window.setBoundedMiss,
    setWalkError: window.setWalkError,
  });
  const paging = useGraphPaging({
    paginator: window.paginator,
    setWindowState: window.setWindowState,
    setIsLoadingInitial: window.setIsLoadingInitial,
    setIsLoadingOlder: window.setIsLoadingOlder,
    setIsLoadingParent: window.setIsLoadingParent,
    setBoundedMiss: window.setBoundedMiss,
    setWalkError: window.setWalkError,
    setPageError: window.setPageError,
    generation: repository.generation,
    isGraphInFlight: repository.isGraphInFlight,
    ready: repository.state.primary !== "loading",
    refreshGraphWindow: repository.refreshGraphWindow,
    selectionRef,
    lastSelectionIndexRef,
    selectTarget,
    scopeKey,
    scopeTipsKey,
    pagesLoaded: window.windowState.pagesLoaded,
    searchOpen: search.isOpen,
    registerCommitNavigator: repository.registerCommitNavigator,
    registerGraphWindowRefresher: repository.registerGraphWindowRefresher,
  });

  searchDelegateActionRef.current = search.delegateAction;

  const selection = useGraphSelection({
    rows,
    selection: repository.selection,
    selectTarget,
    lastSelectionIndexRef,
    requestOlderPage: paging.requestOlderPage,
    searchOpen: search.isOpen,
    windowState: window.windowState,
    isLoadingInitial: window.isLoadingInitial,
    isLoadingOlder: window.isLoadingOlder,
    pageError: window.pageError,
    searchDelegateActionRef,
  });

  useGraphNavigation({ cursor: selection.cursor, search, scrollRef });
  useGraphFocusRefresh(region.focused, search.isOpen, repository.refreshStatus);

  return {
    region,
    rows,
    activeIndex: selection.cursor.index,
    isLoadingInitial: window.isLoadingInitial,
    isLoadingOlder: window.isLoadingOlder,
    isLoadingParent: window.isLoadingParent,
    boundedMiss: window.boundedMiss,
    walkError: window.walkError,
    error: window.pageError,
    isEmpty,
    isDone: readGraphIsDone(window.windowState),
    loadedCount: window.windowState.rows.length,
    scopeLabel: formatScopeLabel(scopeKey),
    selectedRowId: selection.selectedRowId,
    scrollRef,
    search,
    retry: paging.retry,
    retryWalk: paging.retryWalk,
    scrollBy: search.isOpen && search.isResultsMode ? search.scrollBy : selection.scrollBy,
    handleRowClick: selection.handleRowClick,
  };
}

/**
 * Builds a stable key for the scope tips the graph cursor is seeded from.
 *
 * The key is sorted so ref read order or a duplicate listing cannot look like a change. It only
 * decides whether a started window must reload; the paginator reads the tips themselves.
 *
 * @param snapshot - Current snapshot, or null before the first read.
 * @param scope - Configured graph scope.
 * @returns Sorted, space-separated tip OIDs.
 */
function readScopeTipsKey(snapshot: RepositorySnapshot | null, scope: GraphScope): string {
  return [...selectGraphScopeTips(snapshot, scope)].sort().join(" ");
}

/**
 * Reports whether the graph surface is in its empty-repository state.
 *
 * @param primary - Detected repository primary state.
 * @param windowState - Loaded graph window.
 * @param pageError - Current page error, or null.
 * @returns True when the repository has no commits or the window proved empty.
 */
function readGraphIsEmpty(
  primary: RepositoryPrimaryState,
  windowState: GraphWindowState,
  pageError: string | null,
): boolean {
  if (primary === "empty") {
    return true;
  }

  return (
    windowState.pagesLoaded > 0 &&
    windowState.rows.length === 0 &&
    windowState.done &&
    pageError === null
  );
}

/**
 * Reports whether history is exhausted with at least one loaded row.
 *
 * @param windowState - Loaded graph window.
 * @returns True when the end-of-history marker should render.
 */
function readGraphIsDone(windowState: GraphWindowState): boolean {
  return windowState.done && windowState.rows.length > 0;
}

/**
 * Refreshes the repository status when the graph region gains focus.
 *
 * A focus the search surface itself caused is not a repository change, so no status refresh runs
 * while search is open. Without that guard, the generation the refresh reserves would close the
 * search the moment the focus settled.
 *
 * @param focused - True while the graph region or a descendant owns native focus.
 * @param searchOpen - True while the search surface owns the graph region.
 * @param refreshStatus - Repository status refresh owned by the provider.
 */
function useGraphFocusRefresh(
  focused: boolean,
  searchOpen: boolean,
  refreshStatus: () => Promise<unknown>,
): void {
  const previousFocusedRef = useRef(false);

  useEffect(() => {
    const wasFocused = previousFocusedRef.current;

    previousFocusedRef.current = focused;

    if (!focused || wasFocused || searchOpen) {
      return;
    }

    void refreshStatus();
  }, [focused, refreshStatus, searchOpen]);
}
