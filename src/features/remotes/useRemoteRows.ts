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
 * Owns the filtered, capped, and grouped remote-branch rows.
 *
 * Grouping and ordering come from `selectRemoteBranchGroups`; filtering is the only local transform
 * and only drops rows whose full `<remote>/<branch>` name does not contain the filter. The filtered
 * list is capped at 5000 rendered rows and the full filtered count is kept so the panel can report
 * the hidden rows.
 *
 * @param snapshot - Current snapshot, or null before the first read.
 * @param filter - Raw filter string.
 * @returns The visible groups, row identity map, counts, and known local branch names.
 */
export function useRemoteRows(snapshot: RepositorySnapshot | null, filter: string) {
  const filteredGroups = useMemo(
    () => readFilteredGroups(selectRemoteBranchGroups(snapshot), filter),
    [snapshot, filter],
  );
  const filteredItems = useMemo(() => readBranchItems(filteredGroups), [filteredGroups]);
  const items = useMemo(() => filteredItems.slice(0, REMOTES_ROW_RENDER_CAP), [filteredItems]);
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
 * Reads the grouped rows filtered by the case-insensitive full remote branch name.
 *
 * @param groups - Selector output ordered by remote and branch.
 * @param filter - Raw filter string; surrounding space is ignored.
 * @returns The surviving groups, with empty groups dropped.
 */
function readFilteredGroups(groups: RemoteBranchGroups, filter: string): RemoteBranchGroups {
  const needle = filter.trim().toLowerCase();

  if (needle.length === 0) {
    return groups;
  }

  return groups
    .map((group) => ({
      remote: group.remote,
      branches: group.branches.filter((branch) =>
        `${group.remote}/${branch.branch}`.toLowerCase().includes(needle),
      ),
    }))
    .filter((group) => group.branches.length > 0);
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
        branches: [...last.branches, { branch: item.branch }],
      };

      continue;
    }

    groups.push({ remote: item.remote, branches: [{ branch: item.branch }] });
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
