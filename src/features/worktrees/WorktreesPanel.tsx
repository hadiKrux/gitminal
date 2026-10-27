import { type ReactNode, useCallback } from "react";
import { useOverlay } from "@/app/hooks/useOverlay";
import { useScrollSelectedRow } from "@/app/hooks/useScrollSelectedRow";
import type { WorktreeRecord } from "@/domain/git/git.types";
import { DeleteWorktreeModal } from "@/features/worktrees/DeleteWorktreeModal";
import { NewWorktreeModal } from "@/features/worktrees/NewWorktreeModal";
import { NEW_WORKTREE_PATH_INPUT_ID } from "@/features/worktrees/NewWorktreeModal.constants";
import { useWorktrees } from "@/features/worktrees/useWorktrees";
import { WorktreeRow, worktreeRowId } from "@/features/worktrees/WorktreeRow";
import {
  CREATE_WORKTREE_OVERLAY_ID,
  DELETE_WORKTREE_OVERLAY_ID_PREFIX,
  WORKTREE_FILTER_INPUT_ID,
  WORKTREE_FILTER_PLACEHOLDER,
  WORKTREES_BUSY_MESSAGE,
  WORKTREES_EMPTY_MESSAGE,
  WORKTREES_ERROR_MESSAGE,
  WORKTREES_LOADING_LABEL,
  WORKTREES_TRUNCATION_LABEL,
} from "@/features/worktrees/WorktreesPanel.constants";
import { useTokens } from "@/theme/useTokens";
import { EmptyState } from "@/ui/EmptyState";
import { ErrorState } from "@/ui/ErrorState";
import { LoadingRow } from "@/ui/LoadingRow";
import { SearchField } from "@/ui/SearchField";

/**
 * Renders the Worktrees panel body.
 *
 * The shell already supplies the focusable panel frame, the border title with the count, and the
 * scroll container, so this component returns only the filter field, the worktree rows, and the
 * state rows. Rows come from `useWorktrees`, which reads `selectWorktreeRows`; the panel never
 * recomputes the current worktree, the branch map, or the ordering, never calls git, and never
 * registers a global action. The active row id is passed to `useScrollSelectedRow`, so keyboard
 * navigation keeps the selection inside the shell viewport.
 *
 * The New and Delete Worktree modals are overlay entries rendered by the overlay host. Delete for
 * the current worktree never reaches this component, because `useWorktrees` validates availability
 * before opening it.
 *
 * @returns The worktrees panel body.
 */
export function WorktreesPanel(): ReactNode {
  const tokens = useTokens();
  const overlay = useOverlay();
  const worktrees = useWorktrees({
    openCreateWorktree: useCallback(() => {
      overlay.open({
        kind: "modal",
        id: CREATE_WORKTREE_OVERLAY_ID,
        initialFocusId: NEW_WORKTREE_PATH_INPUT_ID,
        render: ({ close }) => <NewWorktreeModal onClose={close} />,
      });
    }, [overlay]),
    openDeleteWorktree: useCallback(
      (worktree: WorktreeRecord) => {
        overlay.open({
          kind: "modal",
          id: `${DELETE_WORKTREE_OVERLAY_ID_PREFIX}${worktree.path}`,
          render: ({ close }) => <DeleteWorktreeModal worktree={worktree} onClose={close} />,
        });
      },
      [overlay],
    ),
  });
  const showNoMatches =
    !worktrees.loading && worktrees.totalCount > 0 && worktrees.rows.length === 0;

  useScrollSelectedRow(
    worktrees.activeRow === null ? null : worktreeRowId(worktrees.activeRow.path),
    worktrees.activeIndex,
  );

  return (
    <box flexDirection="column" flexGrow={1}>
      <box paddingLeft={1} paddingRight={1} flexShrink={0}>
        <SearchField
          id={WORKTREE_FILTER_INPUT_ID}
          value={worktrees.filter}
          placeholder={WORKTREE_FILTER_PLACEHOLDER}
          onInput={worktrees.setFilter}
        />
      </box>
      {worktrees.busy ? (
        <text fg={tokens.dim} wrapMode="none">
          {WORKTREES_BUSY_MESSAGE}
        </text>
      ) : null}
      {worktrees.error === null ? null : (
        <ErrorState
          message={WORKTREES_ERROR_MESSAGE}
          details={worktrees.error}
          onRetry={worktrees.retry}
        />
      )}
      {worktrees.loading ? <LoadingRow label={WORKTREES_LOADING_LABEL} /> : null}
      {worktrees.rows.map((row, index) => (
        <WorktreeRow
          key={row.path}
          row={row}
          selected={index === worktrees.activeIndex}
          focused={worktrees.focused}
          onPress={() => {
            worktrees.handleRowClick(index);
          }}
        />
      ))}
      {worktrees.truncatedCount === 0 ? null : (
        <text fg={tokens.dim} wrapMode="none">
          {`${WORKTREES_TRUNCATION_LABEL} ${worktrees.rows.length} of ${worktrees.filteredCount} worktrees`}
        </text>
      )}
      {worktrees.empty ? (
        <EmptyState message={WORKTREES_EMPTY_MESSAGE} hint={worktrees.emptyHint} />
      ) : null}
      {showNoMatches ? <EmptyState message={`No worktrees match ${worktrees.filter}`} /> : null}
    </box>
  );
}
