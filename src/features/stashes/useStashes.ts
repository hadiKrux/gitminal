import { useEffect, useRef } from "react";
import { useFeatureSearch, useFeatureSearchReveal } from "@/app/hooks/useFeatureSearch";
import { useFocusRegion } from "@/app/hooks/useFocusRegion";
import { useRepository } from "@/app/hooks/useRepository";
import { useStatus } from "@/app/hooks/useStatus";
import { stashRowId } from "@/features/stashes/StashRow";
import { isReadablePrimary } from "@/features/stashes/stash.availability";
import { usePendingStashSelection } from "@/features/stashes/usePendingStashSelection";
import { useStashAvailability } from "@/features/stashes/useStashAvailability";
import { useStashCreateCommand } from "@/features/stashes/useStashCreateCommand";
import { STASHES_REGION_ID } from "@/features/stashes/useStashes.constants";
import type { UseStashesOptions } from "@/features/stashes/useStashes.types";
import { useStashRowCommands } from "@/features/stashes/useStashRowCommands";
import { useStashRows } from "@/features/stashes/useStashRows";
import { useStashSelection, useStashSelectionRepair } from "@/features/stashes/useStashSelection";

/**
 * Owns the stashes panel state, four stash actions, and read-only feature search.
 *
 * Rows come only from `selectStashRows` through `useStashRows`, so newest-first ordering, the source
 * branch, and the age are the repository's. The immutable object name is the identity of every row
 * and every action; `stash@{n}` is display-only. Navigation and double click come from
 * `useStashSelection`, availability from `useStashAvailability`, and the modal and row commands from
 * `useStashCreateCommand` and `useStashRowCommands`.
 *
 * The hook composes `stash.create`, `stash.apply`, `stash.pop`, `stash.delete`, and the `list.filter`
 * search opener in the `stashes` scope. It never registers `nav.*`, `app.refresh`, `focus.*`, or `remote.*`; the cursor
 * owns navigation and the app or shell owns global actions. A focus transition to true refreshes
 * the repository through `refreshStatus()`. Every mutation goes through `useCommandRunner`; this
 * hook never calls git or a domain executor directly.
 *
 * @param options - Renderers for the two modals the panel owns.
 * @returns Rows, panel state, availability text, and row and action callbacks.
 */
export function useStashes(options: UseStashesOptions) {
  const repository = useRepository();
  const { setStatus, operation } = useStatus();
  const region = useFocusRegion(STASHES_REGION_ID);
  const { rows, selection } = useStashList(repository);
  const availability = useStashAvailability(repository, selection.selected, rows.totalCount);
  const pendingSelection = usePendingStashSelection({
    snapshot: repository.snapshot,
    orderedRows: rows.orderedRows,
    visibleRows: rows.visibleRows,
    selectStash: selection.selectStash,
    selectIndex: selection.cursor.select,
  });
  const busy = operation !== null;
  const lastSelectionIndexRef = useRef(0);

  useStashCreateCommand({
    availability: availability.createAvailability,
    busy,
    orderedRowCount: rows.totalCount,
    renderCreateStashModal: options.renderCreateStashModal,
    repository,
    setPendingCreatedStash: pendingSelection.requestCreatedStash,
    setStatus,
  });
  useStashRowCommands({
    busy,
    renderDeleteStashModal: options.renderDeleteStashModal,
    repository,
    selected: selection.selected,
    setStatus,
    totalCount: rows.totalCount,
  });

  useStashSelectionRepair({
    rows: rows.orderedRows,
    snapshotReady: repository.snapshot !== null,
    selection: repository.selection,
    lastSelectionIndexRef,
    setSelection: repository.setSelection,
  });

  useStashFocusRefresh(region.focused, repository.refreshStatus);

  const error = repository.listFailures.stashes ?? repository.lastRefreshError;
  const loading =
    repository.snapshot === null && repository.state.primary === "loading" && error === null;
  const empty =
    !loading &&
    error === null &&
    rows.totalCount === 0 &&
    isReadablePrimary(repository.state.primary);

  return {
    rows: rows.visibleRows,
    totalCount: rows.totalCount,
    hiddenCount: rows.totalCount - rows.visibleRows.length,
    loading,
    error,
    empty,
    emptyHint: "s Stash changes",
    busy,
    focused: region.focused,
    selected: selection.selected,
    selectedIndex: selection.selectedIndex,
    createReason: availability.createReason,
    applyReason: availability.applyReason,
    popReason: availability.popReason,
    deleteReason: availability.deleteReason,
    handleRowClick: selection.cursor.handleRowClick,
    retry: createRetryAction(repository.refreshStatus),
  };
}

/**
 * Owns the stash list's read-only view flow: ordered rows, search reveal, and cursor selection.
 * @param repository - Snapshot and the activation-only right-pane selection writer.
 * @returns The visible row ledger and cursor helpers shared by stash operations.
 */
function useStashList(repository: ReturnType<typeof useRepository>) {
  const search = useFeatureSearch("stashes");
  const rows = useStashRows(repository.snapshot, search.revealId);
  const selection = useStashSelection(rows.items, repository.setSelection);
  useFeatureSearchReveal(search, rows.items, selection.cursor.selectId, stashRowId);
  return { rows, selection };
}

/**
 * Refreshes the stash list when the region gains focus.
 *
 * Only the false-to-true transition reads, so focus that stays inside a descendant input never
 * repeats the read and no timer or poll is introduced.
 *
 * @param focused - True while the stashes region or a descendant owns native focus.
 * @param refreshStatus - Repository status refresh owned by the provider.
 */
function useStashFocusRefresh(
  focused: boolean,
  refreshStatus: ReturnType<typeof useRepository>["refreshStatus"],
): void {
  const previousFocusRef = useRef(false);

  useEffect(() => {
    const wasFocused = previousFocusRef.current;

    previousFocusRef.current = focused;

    if (!focused || wasFocused) {
      return;
    }

    void refreshStatus();
  }, [focused, refreshStatus]);
}

/**
 * Builds the panel Retry handler.
 *
 * @param refreshStatus - Repository status refresh owned by the provider.
 * @returns A callback that starts one silent read.
 */
function createRetryAction(
  refreshStatus: ReturnType<typeof useRepository>["refreshStatus"],
): () => void {
  return () => {
    void refreshStatus();
  };
}
