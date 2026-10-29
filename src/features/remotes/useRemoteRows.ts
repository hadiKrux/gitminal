import { useMemo } from "react";
import { selectRemoteBranchGroups } from "@/domain/repository/repository.selectors";
import type { RepositorySnapshot } from "@/domain/repository/repository.types";
import type {
  RemoteBranchGroups,
  RemoteBranchItem,
  VisibleRemoteGroup,
} from "@/features/remotes/useRemotes.types";

/** Soft cap on rendered remote-branch rows; the panel reports the hidden count above it. */
const REMOTES_ROW_RENDER_CAP = 5000;

/** Prefix of the stable renderable id of one remote-branch row. */
const REMOTE_ROW_ID_PREFIX = "remote-row-";

/**
 * Owns the capped and grouped remote-branch rows, extending the cap for an accepted search result.
 *
 * Grouping and ordering come from `selectRemoteBranchGroups`. The initial list is capped at 5000
 * rows; an accepted search result extends that prefix so its sidebar row can be selected and revealed.
 *
 * @param snapshot - Current snapshot, or null before the first read.
 * @param revealId - Accepted full remote/branch identity, or null before any search reveal.
 * @returns The visible groups, row identity map, counts, and known local branch names.
 */
export function useRemoteRows(snapshot: RepositorySnapshot | null, revealId: string | null = null) {
  const orderedGroups = useMemo(() => selectRemoteBranchGroups(snapshot), [snapshot]);
  const filteredItems = useMemo(() => readBranchItems(orderedGroups), [orderedGroups]);
  const items = useMemo(
    () =>
      filteredItems.slice(
        0,
        Math.max(REMOTES_ROW_RENDER_CAP, filteredItems.findIndex((row) => row.id === revealId) + 1),
      ),
    [filteredItems, revealId],
  );
  const groups = useMemo(() => readVisibleGroups(items), [items]);
  const rowIndexById = useMemo(() => readRowIndexes(items), [items]);
  const existingBranchNames = useMemo(
    () => (snapshot?.branches ?? []).map((branch) => branch.name),
    [snapshot],
  );

  return {
    items,
    groups,
    rowIndexById,
    existingBranchNames,
    branchCount: items.length,
    filteredCount: filteredItems.length,
    hiddenCount: Math.max(0, filteredItems.length - items.length),
  };
}

/**
 * Flattens the grouped rows into the selectable cursor items.
 *
 * @param groups - Filtered groups in display order.
 * @returns One item per branch, in display order.
 */
function readBranchItems(groups: RemoteBranchGroups): readonly RemoteBranchItem[] {
  return groups.flatMap((group) =>
    group.branches.map((branch) => ({
      id: `${group.remote}/${branch.branch}`,
      rowId: `${REMOTE_ROW_ID_PREFIX}${group.remote}-${branch.branch}`,
      remote: group.remote,
      branch: branch.branch,
      hasLocalTracker: branch.hasLocalTracker,
    })),
  );
}

/**
 * Groups the capped items back into their display groups.
 *
 * @param items - Visible branch rows in display order.
 * @returns Groups in first-seen remote order, each preserving item order.
 */
function readVisibleGroups(items: readonly RemoteBranchItem[]): readonly VisibleRemoteGroup[] {
  const groups: VisibleRemoteGroup[] = [];

  for (const item of items) {
    const last = groups[groups.length - 1];

    if (last?.remote === item.remote) {
      groups[groups.length - 1] = {
        remote: last.remote,
        branches: [
          ...last.branches,
          { branch: item.branch, hasLocalTracker: item.hasLocalTracker },
        ],
      };

      continue;
    }

    groups.push({
      remote: item.remote,
      branches: [{ branch: item.branch, hasLocalTracker: item.hasLocalTracker }],
    });
  }

  return groups;
}

/**
 * Maps each row renderable id to its cursor index.
 *
 * @param items - Selectable branch rows in display order.
 * @returns A read-only map from row id to index.
 */
function readRowIndexes(items: readonly RemoteBranchItem[]): ReadonlyMap<string, number> {
  return new Map(items.map((item, index) => [item.rowId, index]));
}
