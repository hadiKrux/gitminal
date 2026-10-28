import { useCallback, useRef, useState } from "react";
import { readEmptyMessage, readStatusText } from "@/features/graph/commitSearch.results";
import type { CommitSearchHandle, UseCommitSearchInput } from "@/features/graph/graph.types";
import { useSearchQuery } from "@/features/graph/useSearchQuery";
import { useSearchResults } from "@/features/graph/useSearchResults";
import { useSearchSelection } from "@/features/graph/useSearchSelection";
import { useSearchSession } from "@/features/graph/useSearchSession";

/**
 * Owns commit search view state and the delegates the graph registration calls.
 *
 * The hook never registers a navigation action: `useCommitGraph` remains the single registration
 * owner and forwards `nav.*` to these delegates while search is open. This hook is the composition
 * point: `useSearchQuery` owns the query and engine, `useSearchResults` owns the result pages,
 * `useSearchSession` owns the snapshot and surface lifetime, and `useSearchSelection` owns the result
 * cursor and confirmation.
 *
 * @param input - Scope, client, selection, graph cursor access, and bounded commit selection.
 * @returns Search view state, opening and closing helpers, and the navigation delegates.
 */
export function useCommitSearch(input: UseCommitSearchInput): CommitSearchHandle {
  const {
    client,
    cwd,
    enabled,
    focusGraph,
    generation,
    graphFocused,
    pageSize,
    readCursor,
    scopeKey,
    scrollRef,
    selectCommit,
    selection,
    setBoundedMiss,
    setWalkError,
    setSelection,
    writeCursor,
  } = input;
  const [isOpen, setIsOpen] = useState(false);
  const resetSelectionRef = useRef<() => void>(() => {});
  const resetSelection = useCallback((): void => {
    resetSelectionRef.current();
  }, []);
  const query = useSearchQuery({ scopeKey, pageSize, client, cwd });
  const isResultsMode = isOpen && query.highlight.length > 0;
  const results = useSearchResults({
    engine: query.engine,
    debouncedQuery: query.debouncedQuery,
    terms: query.terms,
    isOpen,
    enabled,
    setQuery: query.setQuery,
    onSelectionReset: resetSelection,
  });
  const session = useSearchSession({
    isOpen,
    setIsOpen,
    enabled,
    focusGraph,
    generation,
    graphFocused,
    scopeKey,
    selection,
    readCursor,
    writeCursor,
    setBoundedMiss,
    setSelection,
    resetResults: results.reset,
    resetSelection,
  });
  const selectionState = useSearchSelection({
    results: results.results,
    scrollRef,
    isOpen,
    isResultsMode,
    isLoading: results.isLoading,
    done: results.done,
    closeSearch: session.closeSearch,
    selectCommit,
    setBoundedMiss,
    setWalkError,
    loadMore: results.loadMore,
  });

  resetSelectionRef.current = selectionState.reset;

  const state = {
    isOpen,
    isResultsMode,
    enabled,
    isLoading: results.isLoading,
    error: results.error,
    done: results.done,
    count: results.results.length,
  };

  return {
    isOpen,
    isResultsMode,
    isUnavailable: isOpen && !enabled,
    query: query.query,
    setQuery: results.handleQueryChange,
    results: results.results,
    selectedIndex: selectionState.selectedIndex,
    statusText: readStatusText(state),
    isLoading: results.isLoading,
    error: results.error,
    done: results.done,
    emptyMessage: readEmptyMessage({ ...state, query: query.query }),
    open: session.open,
    cancelAndRestore: session.cancelAndRestore,
    submit: selectionState.submit,
    retry: results.retry,
    handleResultClick: selectionState.handleResultClick,
    pageBy: selectionState.pageBy,
    delegateAction: selectionState.delegateAction,
  };
}
