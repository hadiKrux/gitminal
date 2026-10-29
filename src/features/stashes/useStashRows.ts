import { useMemo } from "react";
import { selectStashRows } from "@/domain/repository/repository.selectors";
import type { RepositorySnapshot } from "@/domain/repository/repository.types";
import { STASH_MAX_RENDERED_ROWS } from "@/features/stashes/useStashes.constants";

/**
 * Derives the ordered and capped stash rows the panel renders.
 *
 * Rows come only from `selectStashRows`, so newest-first ordering is the repository's. The visible
 * list initially uses the documented soft cap and extends it for an accepted search result.
 * Cursor items keep the immutable object name as the identity.
 *
 * @param snapshot - Current snapshot, or null before the first read.
 * @param revealId - Accepted immutable stash identity, or null before any search reveal.
 * @returns Ordered rows, visible rows, cursor items, and the full count.
 */
export function useStashRows(snapshot: RepositorySnapshot | null, revealId: string | null = null) {
  const orderedRows = useMemo(() => selectStashRows(snapshot), [snapshot]);
  const visibleRows = useMemo(
    () =>
      orderedRows.slice(
        0,
        Math.max(
          STASH_MAX_RENDERED_ROWS,
          orderedRows.findIndex((row) => row.objectName === revealId) + 1,
        ),
      ),
    [orderedRows, revealId],
  );
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
