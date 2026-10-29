import { useEffect, useMemo, useState } from "react";
import { registerInputMode } from "@/app/hooks/inputMode.registry";
import { useActions } from "@/app/hooks/useAction";
import { useRepository } from "@/app/hooks/useRepository";
import { clampIndex } from "@/lib/list";
import { FEATURE_SEARCH_INPUT_ID, FEATURE_SEARCH_PAGE_ROWS } from "./FeatureSearchModal.constants";
import type { FeatureSearchModalProps } from "./FeatureSearchModal.types";
import { readFeatureSearchRows } from "./featureSearch.rows";

/**
 * Owns the transient search query and highlight; sidebar state is untouched until acceptance.
 * Escape closes immediately, even with a non-empty query. Refreshes keep results live.
 * @param props - Owning region, captured cursor, reveal callback, and overlay close operation.
 * @returns Filtered rows, highlighted item, query writer, and read state.
 */
export function useFeatureSearchModal(props: FeatureSearchModalProps) {
  const repository = useRepository();
  const [query, setQueryState] = useState("");
  const [highlight, setHighlight] = useState(props.selectedId);
  const allRows = useMemo(
    () => readFeatureSearchRows(props.region, repository.snapshot, repository.remoteTagChecks),
    [props.region, repository.snapshot, repository.remoteTagChecks],
  );
  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return allRows.filter((row) => `${row.name} ${row.details}`.toLowerCase().includes(needle));
  }, [allRows, query]);
  const found = rows.findIndex((row) => row.id === highlight);
  const index = Math.max(0, found);
  const selected = rows[index];

  useEffect(() => registerInputMode(FEATURE_SEARCH_INPUT_ID, "search"), []);

  /** Changes only the overlay query and resets its highlight. */
  function setQuery(value: string): void {
    setQueryState(value);
    setHighlight(null);
  }

  /** Moves the overlay highlight without activating a sidebar row. */
  function move(delta: number): void {
    setHighlight(rows[clampIndex(index + delta, rows.length)]?.id ?? null);
  }

  /** Closes and reveals the selected identity after native focus has been restored. */
  function accept(): void {
    if (selected !== undefined) {
      props.onClose(() => props.onSelect(selected.id));
    }
  }

  const options = { scope: "overlay" } as const;
  useActions([
    { actionId: "nav.up", options, handler: () => move(-1) },
    { actionId: "nav.down", options, handler: () => move(1) },
    { actionId: "nav.pageUp", options, handler: () => move(-FEATURE_SEARCH_PAGE_ROWS) },
    { actionId: "nav.pageDown", options, handler: () => move(FEATURE_SEARCH_PAGE_ROWS) },
    { actionId: "nav.first", options, handler: () => setHighlight(rows[0]?.id ?? null) },
    { actionId: "nav.last", options, handler: () => setHighlight(rows.at(-1)?.id ?? null) },
    { actionId: "nav.activate", options, handler: accept },
    { actionId: "overlay.close", options, handler: () => props.onClose() },
  ]);

  const listKey = props.region === "remotes" ? "remoteBranches" : props.region;
  return {
    query,
    setQuery,
    rows,
    selected,
    setHighlight,
    index,
    loading: repository.snapshot === null && repository.state.primary === "loading",
    error: repository.listFailures[listKey] ?? repository.lastRefreshError,
  };
}
