import { useCallback, useEffect, useMemo, useRef } from "react";
import { useFeatureSearch, useFeatureSearchReveal } from "@/app/hooks/useFeatureSearch";
import { useFocusRegion } from "@/app/hooks/useFocusRegion";
import { useListCursor } from "@/app/hooks/useListCursor";
import { useRepository } from "@/app/hooks/useRepository";
import { useStatus } from "@/app/hooks/useStatus";
import { describeCommandReason } from "@/domain/commands/commands.reasons";
import type { CommandAvailability } from "@/domain/commands/commands.types";
import type { WorktreeRecord } from "@/domain/git/git.types";
import { selectWorktreeRows } from "@/domain/repository/repository.selectors";
import type { RepositorySelection } from "@/domain/repository/repository.types";
import { useWorktreeActions } from "@/features/worktrees/useWorktreeActions";
import { useWorktreeAvailability } from "@/features/worktrees/useWorktreeAvailability";
import { worktreeRowId } from "@/features/worktrees/WorktreeRow";

/** Region this hook owns. */
const REGION_ID = "worktrees" as const;

/** Soft cap on rendered worktree rows; the panel reports the hidden count above it. */
const WORKTREE_ROW_RENDER_CAP = 500;

/**
 * Owns the Worktrees panel view state and the region-scoped worktree actions.
 *
 * Rows come only from `selectWorktreeRows`, so the current-worktree-first ordering is the
 * repository's and never recomputed here. Navigation, the persisted cursor, and double click belong
 * to `useListCursor` with `nav.first`/`nav.last` disabled, because the Worktrees context does not
 * claim `g` and `G`. The hook registers exactly `worktree.create`, `worktree.delete`, and
 * `list.filter` in the `worktrees` scope; it never registers `nav.*`, `app.refresh`, or `focus.*`.
 *
 * Search is a read-only overlay opened by `useFeatureSearch`, which reveals the accepted path
 * without activating it or switching repositories. A focus flip refreshes the repository through `refreshStatus()`.
 * Delete validates availability first and refuses to open its modal for the current worktree,
 * because the app never removes the worktree it is running in.
 *
 * @param input - Callbacks that open the create and delete modals owned by `WorktreesPanel`.
 * @returns Rows, search reveal state, cursor helpers, state flags, and availability text.
 */
export function useWorktrees(input: {
  readonly openCreateWorktree: () => void;
  readonly openDeleteWorktree: (worktree: WorktreeRecord) => void;
}) {
  const repository = useRepository();
  const { operation, setStatus } = useStatus();
  const { focused } = useFocusRegion(REGION_ID);
  const search = useFeatureSearch("worktrees");
  const list = useWorktreeList(search.revealId);
  const navigation = useWorktreeNavigation(list.rows, list.cursorItems);
  useFeatureSearchReveal(search, list.cursorItems, navigation.selectId, worktreeRowId);
  const activeRowRef = useRef<WorktreeRecord | null>(navigation.activeRow);

  activeRowRef.current = navigation.activeRow;

  const error = repository.listFailures.worktrees ?? repository.lastRefreshError;
  const createAvailability = repository.getAvailability(
    "worktree.create",
    { kind: "none" },
    REGION_ID,
  );
  const deleteAvailability = readDeleteAvailability(repository, navigation.activeRow);

  useWorktreeAvailability(createAvailability.available, deleteAvailability.available);

  useWorktreeSelectionRepair({
    rows: list.allRows,
    snapshotReady: repository.snapshot !== null,
    selection: repository.selection,
    setSelection: repository.setSelection,
  });

  useWorktreeFocusRefresh(focused);

  useWorktreeActions({
    readActiveRow: () => activeRowRef.current,
    openCreateWorktree: input.openCreateWorktree,
    openDeleteWorktree: input.openDeleteWorktree,
    regionId: REGION_ID,
    setStatus,
  });

  const loading =
    repository.snapshot === null && repository.state.primary === "loading" && error === null;
  const empty =
    !loading &&
    error === null &&
    list.totalCount === 0 &&
    isReadablePrimary(repository.state.primary);

  return {
    rows: list.rows,
    totalCount: list.totalCount,
    filteredCount: list.filteredCount,
    truncatedCount: list.truncatedCount,
    empty,
    emptyHint: "n New worktree",
    focused,
    loading,
    error,
    busy: operation !== null,
    activeIndex: navigation.activeIndex,
    activeRow: navigation.activeRow,
    handleRowClick: navigation.handleRowClick,
    createReason: readAvailabilityText(createAvailability),
    selectedDeleteReason: readSelectedDeleteReason(repository, navigation.activeRow),
    retry: createRetryAction(repository.refreshStatus),
  };
}

/**
 * Repairs the right-pane selection when the selected worktree path disappears.
 *
 * The cursor already falls back to the same position, but the provider selection is written only on
 * activation. When the selected path leaves the snapshot, this effect moves the selection to the
 * nearest surviving row at the last known position, or back to the Pending Changes row when no row
 * survives. It runs only after a snapshot exists, so the first load never overwrites a carried
 * selection before the list is known.
 *
 * @param input - Refreshed rows, snapshot readiness, current selection, and setter.
 */
function useWorktreeSelectionRepair(input: {
  readonly rows: readonly WorktreeRecord[];
  readonly snapshotReady: boolean;
  readonly selection: RepositorySelection;
  readonly setSelection: (selection: RepositorySelection) => void;
}): void {
  const { rows, selection, setSelection, snapshotReady } = input;
  const lastSelectionIndexRef = useRef(0);
  const selectedIndex =
    selection.kind === "worktree" ? rows.findIndex((row) => row.path === selection.path) : -1;

  if (selectedIndex >= 0) {
    lastSelectionIndexRef.current = selectedIndex;
  }

  useEffect(() => {
    if (!snapshotReady || selection.kind !== "worktree") {
      return;
    }

    if (rows.some((row) => row.path === selection.path)) {
      return;
    }

    const nearestIndex = Math.min(Math.max(0, lastSelectionIndexRef.current), rows.length - 1);
    const nearest = rows[nearestIndex];

    setSelection(
      nearest === undefined ? { kind: "pending" } : { kind: "worktree", path: nearest.path },
    );
  }, [rows, selection, setSelection, snapshotReady]);
}

/**
 * Reads the target-aware delete availability for one worktree row.
 *
 * @param repository - Current repository context.
 * @param row - Active worktree row, or null when the list is empty.
 * @returns The availability result for the target.
 */
function readDeleteAvailability(
  repository: ReturnType<typeof useRepository>,
  row: WorktreeRecord | null,
): CommandAvailability {
  if (row === null) {
    return { available: false, reason: "missing-target" };
  }

  return repository.getAvailability(
    "worktree.delete",
    { kind: "worktree", path: row.path },
    REGION_ID,
  );
}

/**
 * Owns the capped selector-derived worktree rows.
 *
 * @param revealId - Accepted path used to extend the visible prefix beyond its soft cap.
 * @returns The row counts, visible rows, and cursor items.
 */
function useWorktreeList(revealId: string | null) {
  const repository = useRepository();
  const rows = useMemo(() => selectWorktreeRows(repository.snapshot), [repository.snapshot]);
  const visibleRows = useMemo(
    () =>
      rows.slice(
        0,
        Math.max(WORKTREE_ROW_RENDER_CAP, rows.findIndex((row) => row.path === revealId) + 1),
      ),
    [rows, revealId],
  );
  const cursorItems = useMemo(() => visibleRows.map((row) => ({ id: row.path })), [visibleRows]);

  return {
    rows: visibleRows,
    allRows: rows,
    totalCount: rows.length,
    filteredCount: rows.length,
    truncatedCount: Math.max(0, rows.length - visibleRows.length),
    cursorItems,
  };
}

/**
 * Owns the worktree cursor, row selection, and activation.
 *
 * `nav.activate` and a double click both select the active worktree in the right pane through
 * `RepositoryProvider.selection`. The hook never changes the repository root, so the app stays on
 * the repository it was launched in.
 *
 * @param rows - Visible rows in render order.
 * @param cursorItems - Stable row identities for the persisted cursor.
 * @returns The active index and row plus the cursor click helper.
 */
function useWorktreeNavigation(
  rows: readonly WorktreeRecord[],
  cursorItems: readonly { readonly id: string }[],
) {
  const repository = useRepository();
  const rowsRef = useRef(rows);
  const indexRef = useRef(0);

  rowsRef.current = rows;

  /**
   * Applies the right-pane selection to one worktree row.
   *
   * @param row - Row to select, or undefined when the index is outside the list.
   */
  const activateRowAt = useCallback(
    (row: WorktreeRecord | undefined): void => {
      if (row === undefined) {
        return;
      }

      repository.setSelection({ kind: "worktree", path: row.path });
    },
    [repository],
  );

  /** Selects the active worktree in the right pane without a git call or repository switch. */
  const activateRow = useCallback((): void => {
    activateRowAt(rowsRef.current[indexRef.current]);
  }, [activateRowAt]);

  /**
   * Selects one clicked worktree in the right pane.
   *
   * @param index - Row index reported by the click that completed the double click.
   */
  const activateAtIndex = useCallback(
    (index: number): void => {
      activateRowAt(rowsRef.current[index]);
    },
    [activateRowAt],
  );

  const cursor = useListCursor({
    regionId: REGION_ID,
    items: cursorItems,
    onActivate: activateRow,
    onDoubleClick: activateAtIndex,
    enableFirstLast: false,
  });

  indexRef.current = cursor.index;

  return {
    activeIndex: cursor.index,
    activeRow: rows[cursor.index] ?? null,
    handleRowClick: cursor.handleRowClick,
    selectId: cursor.selectId,
  };
}

/**
 * Refreshes the repository when the Worktrees region gains focus.
 *
 * Only the false-to-true transition reads, so focus that stays inside a descendant input never
 * repeats the read and no timer or poll is introduced.
 *
 * @param focused - True while the worktrees region or a descendant owns native focus.
 */
function useWorktreeFocusRefresh(focused: boolean): void {
  const repository = useRepository();
  const previousFocusedRef = useRef(false);
  const { refreshStatus } = repository;

  useEffect(() => {
    const wasFocused = previousFocusedRef.current;

    previousFocusedRef.current = focused;

    if (!focused || wasFocused) {
      return;
    }

    void refreshStatus();
  }, [focused, refreshStatus]);
}

/**
 * Converts an availability result into display text.
 *
 * @param availability - Result from `getAvailability`.
 * @returns The documented reason text, or null when the command is available.
 */
function readAvailabilityText(availability: CommandAvailability): string | null {
  if (availability.available) {
    return null;
  }

  return describeCommandReason(availability.reason ?? "invalid-target");
}

/**
 * Reads the delete availability text for one row.
 *
 * @param repository - Repository context with the target-aware availability reader.
 * @param row - Active worktree row, or null when the list is empty.
 * @returns The display reason, or null when delete is available.
 */
function readSelectedDeleteReason(
  repository: ReturnType<typeof useRepository>,
  row: WorktreeRecord | null,
): string | null {
  if (row === null) {
    return null;
  }

  return readAvailabilityText(
    repository.getAvailability("worktree.delete", { kind: "worktree", path: row.path }, REGION_ID),
  );
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

/**
 * Reports whether the detected primary state exposes a worktree list.
 *
 * A gated state such as a plain directory, a bare repository, or a missing git executable has no
 * worktrees to report, so the panel must not claim "No worktrees" for it.
 *
 * @param primary - Detected repository primary state.
 * @returns True for a readable work tree, including an empty repository.
 */
function isReadablePrimary(primary: string): boolean {
  return primary === "normal" || primary === "subdirectory" || primary === "empty";
}
