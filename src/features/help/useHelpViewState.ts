import { useCallback, useReducer } from "react";
import { useDebouncedValue } from "@/app/hooks/useDebouncedValue";
import { INITIAL_HELP_VIEW_STATE, reduceHelpView } from "@/features/help/help.view";
import { HELP_SEARCH_DEBOUNCE_MS } from "@/features/help/useHelp.constants";
import type { HelpViewControl } from "@/features/help/useHelp.types";

/**
 * Owns the help search text, its quiet interval, and the row cursor index.
 *
 * An empty field is not a slow keystroke: clearing must restore the whole list immediately, so only
 * a non-empty query waits for the quiet interval. The catalogue, the match count, and `hasQuery` all
 * read the single `activeQuery` this hook returns, so the empty-state guard can never disagree with
 * the count it guards. The query and the cursor index share one reducer, so a query change always
 * returns the cursor to the first match in the same render.
 *
 * @returns The typed query, the settled query, and the writers.
 */
export function useHelpViewState(): HelpViewControl {
  const [state, dispatch] = useReducer(reduceHelpView, INITIAL_HELP_VIEW_STATE);
  const debouncedQuery = useDebouncedValue(state.query, HELP_SEARCH_DEBOUNCE_MS);
  const activeQuery = state.query.length === 0 ? "" : debouncedQuery;

  /** Replaces the search text and resets the row cursor to the first match. */
  const setQuery = useCallback((value: string): void => {
    dispatch({ type: "setQuery", query: value });
  }, []);

  /** Clears the search and resets the row cursor. */
  const clearSearch = useCallback((): void => {
    dispatch({ type: "clearQuery" });
  }, []);

  /** Moves the row cursor to one index inside the visible rows. */
  const setSelectedIndex = useCallback((index: number): void => {
    dispatch({ type: "setIndex", index });
  }, []);

  return {
    query: state.query,
    activeQuery,
    hasQuery: activeQuery.trim().length > 0,
    selectedIndex: state.selectedIndex,
    setQuery,
    clearSearch,
    setSelectedIndex,
  };
}
