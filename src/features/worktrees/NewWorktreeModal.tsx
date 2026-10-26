import type { ReactNode } from "react";
import {
  NEW_WORKTREE_BRANCH_INPUT_ID,
  NEW_WORKTREE_BRANCH_MODE_OPTIONS,
  NEW_WORKTREE_CANCEL_BUTTON_ID,
  NEW_WORKTREE_CREATE_BUTTON_ID,
  NEW_WORKTREE_EXISTING_SELECT_ID,
  NEW_WORKTREE_HEIGHT,
  NEW_WORKTREE_MODE_SELECT_ID,
  NEW_WORKTREE_PATH_INPUT_ID,
  NEW_WORKTREE_TITLE,
  NEW_WORKTREE_WIDTH,
} from "@/features/worktrees/NewWorktreeModal.constants";
import type { NewWorktreeModalProps } from "@/features/worktrees/NewWorktreeModal.types";
import { useNewWorktreeForm } from "@/features/worktrees/useNewWorktreeForm";
import { ICONS } from "@/theme/icons";
import { useTokens } from "@/theme/useTokens";
import type { ButtonProps } from "@/ui/Button.types";
import { FormField } from "@/ui/FormField";
import { ModalActions } from "@/ui/ModalActions";
import { ModalFrame } from "@/ui/ModalFrame";
import { SelectField } from "@/ui/SelectField";
/**
 * Renders the New Worktree modal.
 *
 * The path field is prefilled with a sibling directory under the current worktree's parent, named
 * after the sanitized branch, so the common case needs no typing. The path keeps tracking the branch
 * until the user edits it, after which it is never rewritten. Branch mode chooses between a new
 * branch created from `HEAD` and an existing local branch that no worktree has checked out; the
 * picker comes from `selectWorktreeBranchMap`, so a branch already checked out elsewhere is never
 * offered.
 *
 * Validation runs inline through the pure `validateNewWorktree` rules plus the shared
 * `isValidBranchName` git-ref check. Create is disabled with the shared reason when
 * `worktree.create` is unavailable, including the empty-repository "no commits yet" case.
 * Submission dispatches only `runCommand({ commandId: "worktree.create", ... })` with the
 * documented `path`, `mode`, and `branch` form keys, then closes through the overlay context.
 *
 * The form state, control cycle, and submit handler live in `useNewWorktreeForm`, so this component
 * only renders the fields it describes.
 *
 * @param props - Close callback supplied by the overlay host.
 * @returns The new-worktree modal.
 */
export function NewWorktreeModal(props: NewWorktreeModalProps): ReactNode {
  const tokens = useTokens();
  const form = useNewWorktreeForm(props);
  const actions: readonly ButtonProps[] = [
    {
      id: NEW_WORKTREE_CREATE_BUTTON_ID,
      label: "Create worktree",
      focused: form.control === "confirm",
      disabled: form.blockedReason !== null,
      reason: form.blockedReason ?? undefined,
      onPress: form.submit,
    },
    {
      id: NEW_WORKTREE_CANCEL_BUTTON_ID,
      label: "Cancel",
      focused: form.control === "cancel",
      onPress: props.onClose,
    },
  ];

  return (
    <ModalFrame title={NEW_WORKTREE_TITLE} width={NEW_WORKTREE_WIDTH} height={NEW_WORKTREE_HEIGHT}>
      <FormField
        id={NEW_WORKTREE_PATH_INPUT_ID}
        label="Path"
        placeholder="/path/to/worktree"
        value={form.pathValue}
        onInput={form.changePath}
        onSubmit={form.submit}
        error={form.error?.field === "path" ? form.error.message : undefined}
      />
      <SelectField
        id={NEW_WORKTREE_MODE_SELECT_ID}
        options={NEW_WORKTREE_BRANCH_MODE_OPTIONS}
        selectedIndex={NEW_WORKTREE_BRANCH_MODE_OPTIONS.findIndex(
          (option) => option.value === form.mode,
        )}
        height={2}
        onChange={form.changeMode}
        onSelect={form.changeMode}
      />
      {form.mode === "new" ? (
        <FormField
          id={NEW_WORKTREE_BRANCH_INPUT_ID}
          label="New branch"
          placeholder="feature/my-worktree"
          value={form.newBranch}
          onInput={form.changeNewBranch}
          onSubmit={form.submit}
          error={form.error?.field === "branch" ? form.error.message : undefined}
        />
      ) : (
        <FormField
          label="Existing branch"
          error={form.error?.field === "branch" ? form.error.message : undefined}
        >
          <SelectField
            id={NEW_WORKTREE_EXISTING_SELECT_ID}
            options={form.existingBranches.map((name) => ({ label: name, value: name }))}
            selectedIndex={Math.max(0, form.existingBranches.indexOf(form.selectedExistingBranch))}
            height={Math.max(2, Math.min(6, form.existingBranches.length))}
            onChange={form.changeExistingBranch}
            onSelect={form.changeExistingBranch}
          />
        </FormField>
      )}
      {form.mode === "new" ? (
        <text fg={tokens.muted} wrapMode="none">
          {"Start point: HEAD"}
        </text>
      ) : null}
      {form.blockedReason === null ? null : (
        <text fg={tokens.dim} wrapMode="word">
          {`${ICONS.warning} ${form.blockedReason}`}
        </text>
      )}
      <box flexGrow={1} />
      <ModalActions actions={actions} />
    </ModalFrame>
  );
}
