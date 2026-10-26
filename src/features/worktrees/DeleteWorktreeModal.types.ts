import type { WorktreeRecord } from "@/domain/git/git.types";
import type { ButtonProps } from "@/ui/Button.types";

/** One focusable control of the Delete Worktree confirmation, in navigation order. */
export type DeleteWorktreeControl = "force" | "cancel" | "delete";

/** Props accepted by the Delete Worktree confirmation. */
export interface DeleteWorktreeModalProps {
  /** Worktree opened by the panel. */
  readonly worktree: WorktreeRecord;
  /** Overlay close callback. */
  readonly onClose: () => void;
}

/** State and handlers returned by `useDeleteWorktreeModal`. */
export interface DeleteWorktreeModalHandle {
  /** True when the worktree is dirty or locked and force is required. */
  readonly forceRequired: boolean;
  /** Current force acknowledgement. */
  readonly force: boolean;
  /** True while the acknowledgement blocks the primary action. */
  readonly deleteDisabled: boolean;
  /** Focused control. */
  readonly control: DeleteWorktreeControl;
  /** Footer actions in display order. */
  readonly actions: readonly ButtonProps[];
  /** Risk text naming the dirty or locked state. */
  readonly riskText: string;
  /** Toggles the force acknowledgement. */
  toggleForce(): void;
}
