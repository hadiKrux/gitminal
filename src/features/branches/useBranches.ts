import { useFocusRegion } from "@/app/hooks/useFocusRegion";
import { useRepository } from "@/app/hooks/useRepository";
import { describeCommandReason } from "@/domain/commands/commands.reasons";
import { useBranchActions } from "@/features/branches/useBranchActions";
import type { BranchesHandle, UseBranchesOptions } from "@/features/branches/useBranches.types";
import { useBranchRows } from "@/features/branches/useBranchRows";

/** Region this hook owns. */
const REGION_ID = "branches" as const;

/**
 * Owns the branches panel state and the two region-scoped actions it registers.
 *
 * The hook is a thin composition: `useBranchRows` owns selection, the persisted cursor, scrolling,
 * and checkout activation, while `useBranchActions` owns the two scoped actions, modal dispatch,
 * availability publication, pending-create selection, and focus refresh. This function only
 * assembles their output and derives the read states the panel renders, so no single function
 * carries the whole panel.
 *
 * The hook registers exactly `branch.create` and `branch.delete` in the `branches` scope, through
 * the action hook. Navigation comes from `useListCursor` with `nav.first` and `nav.last` enabled.
 *
 * @param options - Renderers for the two modals the panel owns.
 * @returns Rows, panel state, selection, availability text, and the row and action callbacks.
 */
export function useBranches(options: UseBranchesOptions): BranchesHandle {
  const repository = useRepository();
  const region = useFocusRegion(REGION_ID);
  const rows = useBranchRows({ repository, regionId: REGION_ID });
  const actions = useBranchActions({
    repository,
    items: rows.items,
    selected: rows.selected,
    selectId: rows.selectId,
    focused: region.focused,
    options,
  });
  const loading = repository.state.primary === "loading" && repository.lastRefreshError === null;
  const error = repository.listFailures.branches ?? repository.lastRefreshError;
  const empty =
    !loading &&
    error === null &&
    rows.totalCount === 0 &&
    isReadablePrimary(repository.state.primary);

  return {
    items: rows.items,
    totalCount: rows.totalCount,
    hiddenCount: rows.hiddenCount,
    activeRowId: rows.activeRowId,
    loading,
    error,
    empty,
    emptyHint: readEmptyHint(repository.state.primary),
    focused: region.focused,
    selected: rows.selected,
    selectedIndex: rows.selectedIndex,
    selectedDeleteReason: actions.selectedDeleteReason,
    createReason: actions.createReason,
    handleRowClick: rows.handleRowClick,
    openCreate: actions.openCreate,
    openDelete: actions.openDelete,
    retry: actions.retry,
  };
}

/**
 * Reports whether the detected primary state exposes a branch list.
 *
 * A gated state such as a plain directory, a bare repository, or a missing git executable has no
 * branches to report, so the panel must not claim "No local branches" for it.
 *
 * @param primary - Detected repository primary state.
 * @returns True for a readable work tree, including an empty repository.
 */
function isReadablePrimary(primary: string): boolean {
  return primary === "normal" || primary === "subdirectory" || primary === "empty";
}

/**
 * Reads the empty-state hint.
 *
 * @param primary - Detected repository primary state.
 * @returns The `n New branch` hint, with the empty-repository explanation when required.
 */
function readEmptyHint(primary: string): string {
  if (primary !== "empty") {
    return "n New branch";
  }

  return `n New branch - ${describeCommandReason("no-commits-yet")}; a commit is required first`;
}
