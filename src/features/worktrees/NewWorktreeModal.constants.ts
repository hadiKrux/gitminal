import type { WorktreeBranchMode } from "@/domain/git/git.types";
import type { NewWorktreeControl } from "@/features/worktrees/NewWorktreeModal.types";

/** Stable renderable id of the worktree path field, focused when the modal opens. */
export const NEW_WORKTREE_PATH_INPUT_ID = "new-worktree-path";

/** Stable renderable id of the branch-mode select. */
export const NEW_WORKTREE_MODE_SELECT_ID = "new-worktree-mode";

/** Stable renderable id of the new branch-name field. */
export const NEW_WORKTREE_BRANCH_INPUT_ID = "new-worktree-branch";

/** Stable renderable id of the existing-branch select. */
export const NEW_WORKTREE_EXISTING_SELECT_ID = "new-worktree-existing-branch";

/** Renderable id of the primary create action. */
export const NEW_WORKTREE_CREATE_BUTTON_ID = "new-worktree-create";

/** Renderable id of the cancel action. */
export const NEW_WORKTREE_CANCEL_BUTTON_ID = "new-worktree-cancel";

/** Requested modal width, in cells, before terminal clamping. */
export const NEW_WORKTREE_WIDTH = 70;

/** Requested modal height, in rows, holding the path, mode, branch field or picker, and footer. */
export const NEW_WORKTREE_HEIGHT = 21;

/** Modal title. */
export const NEW_WORKTREE_TITLE = "New worktree";

/** Branch modes in the order the select shows them. */
export const NEW_WORKTREE_BRANCH_MODE_OPTIONS: readonly {
  readonly label: string;
  readonly value: WorktreeBranchMode;
}[] = Object.freeze([
  { label: "New branch from HEAD", value: "new" },
  { label: "Existing branch", value: "existing" },
]);

/** Focusable controls while the new-branch field is shown. */
export const NEW_WORKTREE_NEW_BRANCH_CONTROL_ORDER: readonly NewWorktreeControl[] = Object.freeze([
  "path",
  "mode",
  "branch",
  "cancel",
  "confirm",
]);

/** Focusable controls while the existing-branch picker is shown. */
export const NEW_WORKTREE_EXISTING_BRANCH_CONTROL_ORDER: readonly NewWorktreeControl[] =
  Object.freeze(["path", "mode", "existing-branch", "cancel", "confirm"]);
