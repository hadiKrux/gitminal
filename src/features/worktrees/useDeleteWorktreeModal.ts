import { useCallback, useMemo, useState } from "react";
import { useAction } from "@/app/hooks/useAction";
import { useCommandRunner } from "@/app/hooks/useCommandRunner";
import { useModalControlCycle } from "@/app/hooks/useModalControlCycle";
import { CONFIRM_LABELS } from "@/domain/commands/confirm.labels";
import type { WorktreeRecord } from "@/domain/git/git.types";
import {
  DELETE_WORKTREE_CANCEL_BUTTON_ID,
  DELETE_WORKTREE_DELETE_BUTTON_ID,
  DELETE_WORKTREE_FORCE_REQUIRED_TEXT,
} from "@/features/worktrees/DeleteWorktreeModal.constants";
import type {
  DeleteWorktreeControl,
  DeleteWorktreeModalHandle,
  DeleteWorktreeModalProps,
} from "@/features/worktrees/DeleteWorktreeModal.types";
import type { ButtonProps } from "@/ui/Button.types";

/**
 * Owns the Delete Worktree confirmation state, force acknowledgement, and control cycle.
 *
 * A clean worktree needs one confirmation. A dirty or locked worktree requires the force
 * acknowledgement before the primary action enables, because the app never removes such a directory
 * silently. The flag set is computed by the executor from the state it reads at action time: no flag
 * for a clean worktree, one `--force` for a dirty one, and `-f -f` for a locked one.
 *
 * @param props - Worktree opened by the panel and the overlay close callback.
 * @returns The state, actions, and risk text consumed by the modal view.
 */
export function useDeleteWorktreeModal(props: DeleteWorktreeModalProps): DeleteWorktreeModalHandle {
  const { runCommand } = useCommandRunner();
  const forceRequired = props.worktree.dirty || props.worktree.locked;
  const [force, setForce] = useState(false);
  const deleteDisabled = forceRequired && !force;
  const controlOrder = useMemo(() => readControlOrder(forceRequired), [forceRequired]);
  const cycle = useModalControlCycle<DeleteWorktreeControl>({
    order: controlOrder,
    initial: forceRequired ? "force" : "cancel",
    onHorizontal: ({ direction }) => ({
      kind: "focus",
      control: direction === "left" ? "cancel" : "delete",
    }),
  });
  const control = cycle.control;

  /** Toggles the force acknowledgement. */
  const toggleForce = useCallback((): void => {
    setForce((current) => !current);
  }, []);

  /** Submits one delete command when the acknowledgement allows it. */
  const confirm = useCallback((): void => {
    if (deleteDisabled) {
      return;
    }

    void runCommand({
      commandId: "worktree.delete",
      target: { kind: "worktree", path: props.worktree.path },
      formValues: { force: force ? "true" : "false" },
    }).catch(() => undefined);
    props.onClose();
  }, [deleteDisabled, force, props, runCommand]);

  /** Activates the focused control. */
  const activate = useCallback((): void => {
    if (control === "force") {
      toggleForce();
      return;
    }

    if (control === "delete") {
      confirm();
      return;
    }

    props.onClose();
  }, [confirm, control, props, toggleForce]);

  useAction("nav.activate", { scope: "overlay" }, activate);
  useAction("form.submit", { scope: "overlay" }, confirm);

  return {
    forceRequired,
    force,
    deleteDisabled,
    control,
    actions: buildActions({
      control,
      deleteDisabled,
      onDelete: confirm,
      onCancel: props.onClose,
    }),
    riskText: readRiskText(props.worktree),
    toggleForce,
  };
}

/**
 * Reads the visible control order for the modal.
 *
 * The force acknowledgement exists only for a dirty or locked worktree, so a clean confirmation
 * navigates between Cancel and Delete only.
 *
 * @param forceRequired - Whether the force checkbox is rendered.
 * @returns The controls in navigation order.
 */
function readControlOrder(forceRequired: boolean): readonly DeleteWorktreeControl[] {
  return forceRequired ? ["force", "cancel", "delete"] : ["cancel", "delete"];
}

/**
 * Reads the risk text for one worktree.
 *
 * @param worktree - Worktree being removed.
 * @returns Text naming the dirty or locked state and the resulting force level.
 */
function readRiskText(worktree: WorktreeRecord): string {
  const lockReason = worktree.lockReason === null ? "no reason reported" : worktree.lockReason;

  if (worktree.locked && worktree.dirty) {
    return `This worktree is locked (${lockReason}) and has uncommitted changes; it is removed with -f -f.`;
  }

  if (worktree.locked) {
    return `This worktree is locked (${lockReason}); it is removed with -f -f.`;
  }

  if (worktree.dirty) {
    return "This worktree has uncommitted changes; removal uses --force.";
  }

  return "No dirty or locked state was reported for this worktree.";
}

/**
 * Builds the footer actions in display order.
 *
 * @param input - Focused control, acknowledgement state, and handlers.
 * @returns The delete and cancel actions with their focus and disabled state.
 */
function buildActions(input: {
  readonly control: DeleteWorktreeControl;
  readonly deleteDisabled: boolean;
  readonly onDelete: () => void;
  readonly onCancel: () => void;
}): readonly ButtonProps[] {
  return [
    {
      id: DELETE_WORKTREE_DELETE_BUTTON_ID,
      label: CONFIRM_LABELS.deleteWorktree,
      focused: input.control === "delete",
      disabled: input.deleteDisabled,
      reason: input.deleteDisabled ? DELETE_WORKTREE_FORCE_REQUIRED_TEXT : undefined,
      onPress: input.onDelete,
    },
    {
      id: DELETE_WORKTREE_CANCEL_BUTTON_ID,
      label: "Cancel",
      focused: input.control === "cancel",
      onPress: input.onCancel,
    },
  ];
}
