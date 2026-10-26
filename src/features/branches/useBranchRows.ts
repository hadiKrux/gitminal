import { useCallback, useMemo, useRef } from "react";
import { useAction } from "@/app/hooks/useAction";
import { useCommandRunner } from "@/app/hooks/useCommandRunner";
import { useListCursor } from "@/app/hooks/useListCursor";
import { useScrollSelectedRow } from "@/app/hooks/useScrollSelectedRow";
import { useStatus } from "@/app/hooks/useStatus";
import { describeCommandReason } from "@/domain/commands/commands.reasons";
import type { BranchRecord } from "@/domain/git/git.types";
import { selectBranchRows } from "@/domain/repository/repository.selectors";
import type {
  BranchesRepository,
  BranchRowItem,
  BranchRowsHandle,
  BranchTarget,
} from "@/features/branches/useBranches.types";

/** Prefix of the stable renderable id of one branch row. */
const BRANCH_ROW_ID_PREFIX = "branch-row-";

/** Soft cap on rendered branch rows; the panel reports the hidden count above it. */
const MAX_RENDERED_ROWS = 2000;

/**
 * Owns the branches row list, cursor, and checkout activation.
 *
 * Rows come only from `selectBranchRows`, so the current-branch-first ordering and the ahead and
 * behind counts are the repository's, never recomputed here. Navigation, the persisted cursor, and
 * double click come from `useListCursor`; the selected row is scrolled into view through the shell
 * frame. Checkout runs through the shared command runner after the same target-aware availability
 * pre-check the rest of the panel uses, so this hook never calls git directly. The same
 * `branch.checkout` path is registered in the `branches` scope, so the palette, help, and direct
 * dispatch reach the identical activation instead of a second checkout implementation.
 *
 * @param input - Repository context and the region whose cursor the rows use.
 * @returns Rendered rows, counts, selection, and the row click handler.
 */
export function useBranchRows(input: {
  readonly repository: BranchesRepository;
  readonly regionId: "branches";
}): BranchRowsHandle {
  const { repository, regionId } = input;
  const { runCommand } = useCommandRunner();
  const { setStatus } = useStatus();
  const itemsRef = useRef<readonly BranchRowItem[]>([]);
  const cursorIndexRef = useRef(0);

  const orderedRows = useMemo(() => selectBranchRows(repository.snapshot), [repository.snapshot]);
  const items = useMemo(
    () => orderedRows.slice(0, MAX_RENDERED_ROWS).map((branch) => ({ id: branch.name, branch })),
    [orderedRows],
  );

  itemsRef.current = items;

  /** Checks out one branch through the shared command runner. */
  const checkoutBranch = useCallback(
    (branch: BranchRecord): void => {
      const target: BranchTarget = { kind: "branch", name: branch.name };
      const availability = repository.getAvailability("branch.checkout", target, regionId);

      if (!availability.available) {
        setStatus({
          kind: "warning",
          message: describeCommandReason(availability.reason ?? "invalid-target"),
        });

        return;
      }

      void runCommand({ commandId: "branch.checkout", target });
    },
    [regionId, repository, runCommand, setStatus],
  );

  /**
   * Checks out the active row, or explains why no row is active.
   *
   * The palette reaches this handler for `branch.checkout` with the target it captured at open, but
   * handlers take no argument, so the row is re-read from the live branches cursor here. That is
   * the documented delivery mechanism: the palette re-derived the same target and compared it for
   * equality with the captured one before dispatching, so this handler is safe as long as the
   * cursor index still names the row that identity names. The index and identity are projected
   * together in one render and `useListCursor` repairs the index in an effect after the row list
   * changes, so that agreement is an assumption of the post-restore dispatch, not a second
   * validation. A background refresh that lands between the palette's validation and that dispatch
   * can still rewrite the row list in that window, which is the residual risk.
   */
  const checkoutSelected = useCallback((): void => {
    const branch = itemsRef.current[cursorIndexRef.current]?.branch ?? null;

    if (branch === null) {
      setStatus({ kind: "info", message: describeCommandReason("missing-target") });

      return;
    }

    checkoutBranch(branch);
  }, [checkoutBranch, setStatus]);

  const cursor = useListCursor({
    regionId,
    items,
    enableFirstLast: true,
    onActivate: checkoutSelected,
    onDoubleClick: (index) => {
      const clicked = itemsRef.current[index]?.branch;

      if (clicked !== undefined) {
        checkoutBranch(clicked);
      }
    },
  });

  cursorIndexRef.current = cursor.index;

  useAction("branch.checkout", { scope: regionId, targetKind: "branch" }, checkoutSelected);

  const selected = items[cursor.index]?.branch ?? null;
  const activeRowId = selected === null ? null : `${BRANCH_ROW_ID_PREFIX}${selected.name}`;

  useScrollSelectedRow(activeRowId, cursor.index);

  return {
    items,
    totalCount: orderedRows.length,
    hiddenCount: orderedRows.length - items.length,
    activeRowId,
    selected,
    selectedIndex: cursor.index,
    handleRowClick: cursor.handleRowClick,
    selectId: cursor.selectId,
  };
}
