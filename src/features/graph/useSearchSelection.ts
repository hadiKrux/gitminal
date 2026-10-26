import { useCallback, useEffect, useRef, useState } from "react";
import type { EnsureLoadedResult } from "@/domain/graph/graph.types";
import { clampIndex } from "@/features/graph/commitSearch.results";
import {
  GRAPH_DOUBLE_CLICK_MS,
  GRAPH_NEAR_BOTTOM_ROWS,
  GRAPH_SEARCH_PAGE_STEP,
  GRAPH_WALK_ERROR_MESSAGE,
} from "@/features/graph/graph.constants";
import type { GraphWalkError, SearchResultView } from "@/features/graph/graph.types";

/**
 * Owns the search result cursor, selection, page movement, and confirmation.
 *
 * The cursor stays in range when a smaller page replaces a larger one, asks for another page near the
 * bottom, and resolves Enter and double click through the same bounded commit selection the graph
 * navigator uses. A confirmed result closes the surface with success; a genuine bounded miss
 * (`notFound` or `exceeded`) closes it with the miss row visible; a walk cancelled by a refresh
 * closes it neutrally without a false miss, and a page read error closes it neutrally while the
 * distinct walk-error row shows the failed walk.
 *
 * @param input - Result rows, surface flags, load-more, close, and commit selection.
 * @returns The selected index plus the movement, click, submit, and delegation entry points.
 */
export function useSearchSelection(input: {
  readonly results: readonly SearchResultView[];
  readonly isOpen: boolean;
  readonly isResultsMode: boolean;
  readonly isLoading: boolean;
  readonly done: boolean;
  readonly closeSearch: (
    mode: "cancel" | "confirm-success" | "confirm-failure",
    cursorId?: string,
  ) => void;
  readonly selectCommit: (oid: string) => Promise<EnsureLoadedResult>;
  readonly setBoundedMiss: (visible: boolean) => void;
  readonly setWalkError: (error: GraphWalkError | null) => void;
  readonly loadMore: () => Promise<void>;
}) {
  const {
    closeSearch,
    done,
    isLoading,
    isOpen,
    isResultsMode,
    loadMore,
    results,
    selectCommit,
    setBoundedMiss,
    setWalkError,
  } = input;
  const [selectedIndex, setSelectedIndex] = useState(0);
  const lastClickRef = useRef<{ readonly index: number; readonly at: number } | null>(null);

  /** Resets the result cursor for a new query or a closed surface. */
  const reset = useCallback((): void => {
    setSelectedIndex(0);
    lastClickRef.current = null;
  }, []);

  /** Confirms one result through the bounded commit selection. */
  const confirmAt = useCallback(
    async (index: number): Promise<void> => {
      const result = results[index];

      if (result === undefined) {
        return;
      }

      const selected = await selectCommit(result.id);

      if (selected === "loaded") {
        closeSearch("confirm-success", result.id);

        return;
      }

      if (selected === "cancelled") {
        closeSearch("cancel");

        return;
      }

      if (selected === "error") {
        setWalkError({ message: GRAPH_WALK_ERROR_MESSAGE, retryable: false });
        closeSearch("cancel");

        return;
      }

      setBoundedMiss(true);
      closeSearch("confirm-failure");
    },
    [closeSearch, results, selectCommit, setBoundedMiss, setWalkError],
  );

  /** Confirms the selected result. */
  const submit = useCallback((): void => {
    void confirmAt(selectedIndex);
  }, [confirmAt, selectedIndex]);

  /** Sets the cursor and asks for another page near the bottom. */
  const moveCursor = useCallback(
    (nextIndex: number): void => {
      if (results.length === 0) {
        return;
      }

      const clamped = clampIndex(nextIndex, results.length);

      setSelectedIndex(clamped);

      if (clamped >= results.length - GRAPH_NEAR_BOTTOM_ROWS) {
        void loadMore();
      }
    },
    [loadMore, results.length],
  );

  /** Handles a click on one result row and confirms a double click. */
  const handleResultClick = useCallback(
    (index: number): void => {
      const clamped = clampIndex(index, results.length);

      setSelectedIndex(clamped);

      const now = Date.now();
      const previous = lastClickRef.current;

      lastClickRef.current = { index: clamped, at: now };

      if (previous === null || previous.index !== clamped) {
        return;
      }

      if (now - previous.at > GRAPH_DOUBLE_CLICK_MS) {
        return;
      }

      lastClickRef.current = null;
      void confirmAt(clamped);
    },
    [confirmAt, results.length],
  );

  /** Moves the result cursor by one page. */
  const pageBy = useCallback(
    (direction: "up" | "down"): void => {
      const delta = direction === "up" ? -GRAPH_SEARCH_PAGE_STEP : GRAPH_SEARCH_PAGE_STEP;

      moveCursor(selectedIndex + delta);
    },
    [moveCursor, selectedIndex],
  );

  /** Moves the result cursor by a bounded wheel delta. */
  const scrollBy = useCallback(
    (delta: number): void => {
      moveCursor(selectedIndex + delta);
    },
    [moveCursor, selectedIndex],
  );

  /** Handles one list navigation action while search owns the cursor. */
  const delegateAction = useCallback(
    (action: "up" | "down" | "first" | "last" | "activate"): boolean => {
      if (!isOpen || !isResultsMode) {
        return false;
      }

      if (results.length === 0) {
        return true;
      }

      switch (action) {
        case "up":
          moveCursor(selectedIndex - 1);
          return true;
        case "down":
          moveCursor(selectedIndex + 1);
          return true;
        case "first":
          moveCursor(0);
          return true;
        case "last":
          moveCursor(results.length - 1);
          return true;
        case "activate":
          submit();
          return true;
      }
    },
    [isOpen, isResultsMode, moveCursor, results.length, selectedIndex, submit],
  );

  useEffect(() => {
    setSelectedIndex((current) => clampIndex(current, results.length));
  }, [results.length]);

  useEffect(() => {
    if (!isOpen || !isResultsMode || isLoading || done) {
      return;
    }

    if (selectedIndex >= results.length - GRAPH_NEAR_BOTTOM_ROWS) {
      void loadMore();
    }
  }, [done, isLoading, isOpen, isResultsMode, loadMore, results.length, selectedIndex]);

  return {
    selectedIndex,
    reset,
    submit,
    handleResultClick,
    pageBy,
    scrollBy,
    delegateAction,
  };
}
