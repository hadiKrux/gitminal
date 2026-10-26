import { useMemo } from "react";
import { selectStashRows } from "@/domain/repository/repository.selectors";
import type { RepositorySnapshot } from "@/domain/repository/repository.types";
import { STASH_MAX_RENDERED_ROWS } from "@/features/stashes/useStashes.constants";

/**
 * Derives the ordered and capped stash rows the panel renders.
 *
 * Rows come only from `selectStashRows`, so newest-first ordering is the repository's. The visible
 * list is capped at the documented row limit, and the cursor items keep the immutable object name
 * as the identity.
 *
 * @param snapshot - Current snapshot, or null before the first read.
 * @returns Ordered rows, visible rows, cursor items, and the full count.
 */
export function useStashRows(snapshot: RepositorySnapshot | null) {
  const orderedRows = useMemo(() => selectStashRows(snapshot), [snapshot]);
  const visibleRows = useMemo(() => orderedRows.slice(0, STASH_MAX_RENDERED_ROWS), [orderedRows]);
  const items = useMemo(
    () => visibleRows.map((stash) => ({ id: stash.objectName, stash })),
    [visibleRows],
  );

  return {
    orderedRows,
    visibleRows,
    items,
    totalCount: orderedRows.length,
  };
}
