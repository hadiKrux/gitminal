import type { ReactNode } from "react";
import {
  DELETE_WORKTREE_BRANCH_KEPT_TEXT,
  DELETE_WORKTREE_FORCE_CHECKBOX_ID,
  DELETE_WORKTREE_FORCE_REQUIRED_TEXT,
  DELETE_WORKTREE_HEIGHT,
  DELETE_WORKTREE_TITLE,
  DELETE_WORKTREE_WIDTH,
} from "@/features/worktrees/DeleteWorktreeModal.constants";
import type { DeleteWorktreeModalProps } from "@/features/worktrees/DeleteWorktreeModal.types";
import { useDeleteWorktreeModal } from "@/features/worktrees/useDeleteWorktreeModal";
import { readWorktreeLabel } from "@/features/worktrees/WorktreeRow";
import { ICONS } from "@/theme/icons";
import { useTokens } from "@/theme/useTokens";
import { Checkbox } from "@/ui/Checkbox";
import { ModalActions } from "@/ui/ModalActions";
import { ModalFrame } from "@/ui/ModalFrame";
/**
 * Renders the Delete Worktree confirmation.
 *
 * A clean worktree needs one confirmation. A dirty or locked worktree shows the "Force remove"
 * checkbox and keeps the primary action disabled until it is checked, because the app never removes
 * a dirty or locked directory silently. The risk line names the reported dirty and locked state and
 * the reason, and the flag set is computed by the executor from the state it reads at action time:
 * no flag for a clean worktree, one `--force` for a dirty one, and `-f -f` for a locked one.
 *
 * Cancel is the default focused action. The modal always states that the branch is kept, because
 * removing a worktree never deletes its branch, and it dispatches only
 * `runCommand({ commandId: "worktree.delete", ... })` with the documented `force` form key. The
 * state and keyboard cycle live in `useDeleteWorktreeModal`.
 *
 * @param props - Worktree opened by the panel and the overlay close callback.
 * @returns The delete-worktree confirmation.
 */
export function DeleteWorktreeModal(props: DeleteWorktreeModalProps): ReactNode {
  const tokens = useTokens();
  const modal = useDeleteWorktreeModal(props);
  const riskColor = modal.forceRequired ? tokens.warning : tokens.muted;

  return (
    <ModalFrame
      title={DELETE_WORKTREE_TITLE}
      width={DELETE_WORKTREE_WIDTH}
      height={DELETE_WORKTREE_HEIGHT}
    >
      <text fg={tokens.text} wrapMode="none">
        {`Worktree: ${readWorktreeLabel(props.worktree)}`}
      </text>
      <text fg={tokens.muted} wrapMode="word">
        {`Path: ${props.worktree.path}`}
      </text>
      <text fg={riskColor} wrapMode="word">
        {`${modal.forceRequired ? ICONS.warning : ICONS.info} ${modal.riskText}`}
      </text>
      {modal.forceRequired ? (
        <Checkbox
          id={DELETE_WORKTREE_FORCE_CHECKBOX_ID}
          label="Force remove"
          checked={modal.force}
          focused={modal.control === "force"}
          onPress={modal.toggleForce}
        />
      ) : null}
      <text fg={tokens.dim} wrapMode="word">
        {DELETE_WORKTREE_BRANCH_KEPT_TEXT}
      </text>
      {modal.deleteDisabled ? (
        <text fg={tokens.dim} wrapMode="word">
          {`${ICONS.warning} ${DELETE_WORKTREE_FORCE_REQUIRED_TEXT}`}
        </text>
      ) : null}
      <box flexGrow={1} />
      <ModalActions actions={modal.actions} />
    </ModalFrame>
  );
}
