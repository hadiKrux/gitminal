import { useEffect, useRef } from "react";
import { useFeatureSearch, useFeatureSearchReveal } from "@/app/hooks/useFeatureSearch";
import { useFocusRegion } from "@/app/hooks/useFocusRegion";
import { useListCursor } from "@/app/hooks/useListCursor";
import { useRepository } from "@/app/hooks/useRepository";
import { useScrollSelectedRow } from "@/app/hooks/useScrollSelectedRow";
import { useStatus } from "@/app/hooks/useStatus";
import { selectRemoteFreshness } from "@/domain/repository/repository.selectors";
import type { RemoteCheckRecord, RemoteFreshness } from "@/domain/repository/repository.types";
import { useRemoteActions } from "@/features/remotes/useRemoteActions";
import { useRemoteCreateLocal } from "@/features/remotes/useRemoteCreateLocal";
import { useRemoteRows } from "@/features/remotes/useRemoteRows";
import type { RemoteBranchTarget, VisibleRemoteGroup } from "@/features/remotes/useRemotes.types";

/**
 * Owns the remotes panel state, rows, navigation, actions, and mutation dispatch.
 *
 * Rows come from `useRemoteRows`, so grouping, capping, and ordering are owned by the
 * selector and one focused hook. Freshness comes from `selectRemoteFreshness` over the provider's
 * per-remote successful check and fetch timestamps, so a ref commit date is never used.
 *
 * The hook registers `remote.createLocal` through `useRemoteActions` and opens read-only feature
 * search through `useFeatureSearch` for `list.filter` in the `remotes` scope. `useListCursor` owns `nav.up`, `nav.down`, `nav.first`, `nav.last`, and
 * `nav.activate`, plus double click detection. `nav.activate` is a deliberate no-op in v1. Entering
 * the region refreshes refs through `repository.refreshStatus()`.
 *
 * @returns Rows, search reveal state, cursor, freshness, actions, and the read state for the panel body.
 */
export function useRemotes() {
  const repository = useRepository();
  const { setStatus } = useStatus();
  const region = useFocusRegion("remotes");
  const { refreshStatus } = repository;
  const search = useFeatureSearch("remotes");
  const rows = useRemoteRows(repository.snapshot, search.revealId);
  const createLocal = useRemoteCreateLocal({
    existingBranchNames: rows.existingBranchNames,
    setStatus,
  });
  const cursor = useListCursor({
    regionId: "remotes",
    items: rows.items,
    enableFirstLast: true,
    onActivate: noop,
    onDoubleClick: (index) => {
      createLocal.openTarget(rows.items[index] ?? null);
    },
  });
  useFeatureSearchReveal(
    search,
    rows.items,
    cursor.selectId,
    (id) => rows.items.find((row) => row.id === id)?.rowId ?? null,
  );
  const activeItem = rows.items[cursor.index];
  const selectedBranch = toRemoteBranchTarget(activeItem);
  const actions = useRemoteActions({
    selectedBranch,
    openTarget: createLocal.openTarget,
    repository,
  });

  useScrollSelectedRow(activeItem?.rowId ?? null, cursor.index);

  useRemoteFocusRefresh(region.focused, refreshStatus);

  return {
    groups: rows.groups,
    rowIndexById: rows.rowIndexById,
    activeRowId: activeItem?.rowId ?? null,
    branchCount: rows.branchCount,
    filteredCount: rows.filteredCount,
    hiddenCount: rows.hiddenCount,
    focused: region.focused,
    cursor,
    selectRow: cursor.handleRowClick,
    selectedBranch,
    freshnessByRemote: readFreshnessByRemote(rows.groups, repository.remoteChecks, Date.now()),
    loading: repository.state.primary === "loading",
    emptyRepository: repository.state.primary === "empty",
    noRemotes: repository.signals.remotes.length === 0,
    hasRemoteBranches: (repository.snapshot?.remoteBranches.length ?? 0) > 0,
    loadError: repository.listFailures.remoteBranches ?? repository.lastRefreshError,
    operationInProgress: actions.operationInProgress,
    retry: actions.retry,
  };
}

/**
 * Converts a cursor item into the command target, or null when no row is active.
 *
 * @param item - Active row, or undefined for an empty list.
 * @returns The remote branch target, or null.
 */
function toRemoteBranchTarget(
  item: { readonly remote: string; readonly branch: string } | undefined,
): RemoteBranchTarget | null {
  return item === undefined ? null : { remote: item.remote, branch: item.branch };
}

/**
 * Runs the focus refresh on the false-to-true transition only.
 *
 * @param focused - True while the remotes region or a descendant owns native focus.
 * @param refreshStatus - Repository status refresh owned by the provider.
 */
function useRemoteFocusRefresh(
  focused: boolean,
  refreshStatus: ReturnType<typeof useRepository>["refreshStatus"],
): void {
  const wasFocused = useRef(focused);

  useEffect(() => {
    const entered = focused && !wasFocused.current;

    wasFocused.current = focused;

    if (entered) {
      void refreshStatus();
    }
  }, [focused, refreshStatus]);
}

/**
 * Reads the freshness of every rendered remote.
 *
 * @param groups - Visible groups in display order.
 * @param remoteChecks - Provider timestamps of the last successful check and fetch per remote.
 * @param now - Current clock value in milliseconds.
 * @returns A freshness value per rendered remote.
 */
function readFreshnessByRemote(
  groups: readonly VisibleRemoteGroup[],
  remoteChecks: Readonly<Record<string, RemoteCheckRecord>>,
  now: number,
): Readonly<Record<string, RemoteFreshness>> {
  const freshness: Record<string, RemoteFreshness> = {};

  for (const group of groups) {
    freshness[group.remote] = selectRemoteFreshness(remoteChecks[group.remote], now);
  }

  return freshness;
}

/** No-op activation handler for `nav.activate`, which has no v1 behavior in this region. */
function noop(): void {}
