import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GraphSearch, GraphSearchOutcome } from "@/domain/graph/graph.types";
import { buildSearchResults, readSearchError } from "@/features/graph/commitSearch.results";
import type { SearchResultState } from "@/features/graph/graph.types";

/** Empty result state. */
const EMPTY_RESULT_STATE: SearchResultState = Object.freeze({ rows: [], done: true });

/**
 * Owns the search result page state, loading flag, and error text.
 *
 * The query effect reads one page per settled debounced query and discards a stale result through
 * the engine generation. `onSelectionReset` keeps the cursor hook at index zero whenever the query or
 * the result set is replaced, and `reset` clears the query and every result on open and close.
 *
 * @param input - Engine, settled terms, surface flags, raw query setter, and selection reset.
 * @returns Result rows, loading and error state, and the query, retry, load-more, and reset entry points.
 */
export function useSearchResults(input: {
  readonly engine: GraphSearch;
  readonly debouncedQuery: string;
  readonly terms: readonly string[];
  readonly isOpen: boolean;
  readonly enabled: boolean;
  readonly setQuery: (value: string) => void;
  readonly onSelectionReset: () => void;
}) {
  const { debouncedQuery, enabled, engine, isOpen, onSelectionReset, setQuery, terms } = input;
  const [resultState, setResultState] = useState<SearchResultState>(EMPTY_RESULT_STATE);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const previousQueryRef = useRef("");
  const results = useMemo(
    () => buildSearchResults(resultState.rows, terms),
    [resultState.rows, terms],
  );

  /** Applies one engine outcome to the result, loading, and error state. */
  const applyOutcome = useCallback(
    (outcome: GraphSearchOutcome): void => {
      if (outcome.status === "stale") {
        return;
      }

      if (outcome.status === "error") {
        setError(readSearchError(outcome.error));
        setIsLoading(false);

        return;
      }

      if (outcome.status === "empty-query") {
        previousQueryRef.current = "";
        setResultState(EMPTY_RESULT_STATE);
        setError(null);
        setIsLoading(false);
        onSelectionReset();

        return;
      }

      if (previousQueryRef.current !== outcome.state.query) {
        previousQueryRef.current = outcome.state.query;
        onSelectionReset();
      }

      setResultState({ rows: outcome.state.rows, done: outcome.state.done });
      setError(null);
      setIsLoading(false);
    },
    [onSelectionReset],
  );

  /** Clears the query and every result for an open or close. */
  const reset = useCallback((): void => {
    engine.cancel();
    setQuery("");
    setResultState(EMPTY_RESULT_STATE);
    setError(null);
    setIsLoading(false);
    previousQueryRef.current = "";
    onSelectionReset();
  }, [engine, onSelectionReset, setQuery]);

  /** Replaces the raw query and cancels the previous read. */
  const handleQueryChange = useCallback(
    (value: string): void => {
      setQuery(value);
      onSelectionReset();
      setIsLoading(value.trim().length > 0);
      engine.cancel();
    },
    [engine, onSelectionReset, setQuery],
  );

  /** Re-runs the current query after a failure. */
  const retry = useCallback((): void => {
    if (terms.length === 0) {
      return;
    }

    setIsLoading(true);
    setError(null);

    void engine.search(debouncedQuery).then(applyOutcome);
  }, [applyOutcome, debouncedQuery, engine, terms.length]);

  /** Loads one older result page. */
  const loadMore = useCallback(async (): Promise<void> => {
    if (isLoading || resultState.done || terms.length === 0) {
      return;
    }

    setIsLoading(true);
    setError(null);
    applyOutcome(await engine.loadMore());
  }, [applyOutcome, engine, isLoading, resultState.done, terms.length]);

  useEffect(() => {
    if (!isOpen || !enabled) {
      return;
    }

    if (terms.length === 0) {
      engine.cancel();
      previousQueryRef.current = "";
      setResultState(EMPTY_RESULT_STATE);
      setError(null);
      setIsLoading(false);
      onSelectionReset();

      return;
    }

    let active = true;

    setIsLoading(true);
    setError(null);

    void engine.search(debouncedQuery).then((outcome) => {
      if (active) {
        applyOutcome(outcome);
      }
    });

    return () => {
      active = false;
    };
  }, [applyOutcome, debouncedQuery, enabled, engine, isOpen, onSelectionReset, terms.length]);

  return {
    results,
    isLoading,
    error,
    done: resultState.done,
    reset,
    handleQueryChange,
    retry,
    loadMore,
  };
}
