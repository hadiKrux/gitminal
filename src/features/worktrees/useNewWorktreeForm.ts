import { useCallback, useEffect, useMemo, useState } from "react";
import { useAction } from "@/app/hooks/useAction";
import { useCommandRunner } from "@/app/hooks/useCommandRunner";
import { useFocusState } from "@/app/hooks/useFocusState";
import { useModalControlCycle } from "@/app/hooks/useModalControlCycle";
import { useRepository } from "@/app/hooks/useRepository";
import { describeCommandReason } from "@/domain/commands/commands.reasons";
import type { CommandAvailability } from "@/domain/commands/commands.types";
import { isValidBranchName } from "@/domain/git/git.branches";
import type { WorktreeBranchMode, WorktreeRecord } from "@/domain/git/git.types";
import { validateNewWorktree } from "@/domain/git/git.worktrees";
import {
  selectBranchRows,
  selectWorktreeBranchMap,
} from "@/domain/repository/repository.selectors";
import {
  NEW_WORKTREE_BRANCH_INPUT_ID,
  NEW_WORKTREE_EXISTING_BRANCH_CONTROL_ORDER,
  NEW_WORKTREE_EXISTING_SELECT_ID,
  NEW_WORKTREE_MODE_SELECT_ID,
  NEW_WORKTREE_NEW_BRANCH_CONTROL_ORDER,
  NEW_WORKTREE_PATH_INPUT_ID,
} from "@/features/worktrees/NewWorktreeModal.constants";
import type {
  NewWorktreeControl,
  NewWorktreeFieldError,
  NewWorktreeModalProps,
} from "@/features/worktrees/NewWorktreeModal.types";
import { deriveWorktreePath } from "@/features/worktrees/worktree.path";
import { isSamePath } from "@/lib/paths";
import { MODAL_FRAME_ID } from "@/ui/ModalFrame.constants";

/**
 * Owns the New Worktree form state, validation, and submit dispatch.
 *
 * The path field is prefilled with a sibling directory under the current worktree's parent, named
 * after the sanitized branch, so the common case needs no typing. The path keeps tracking the
 * branch until the user edits it, after which it is never rewritten. Branch mode chooses between a
 * new branch created from `HEAD` and an existing local branch that no worktree has checked out; the
 * picker comes from `selectWorktreeBranchMap`, so a branch already checked out elsewhere is never
 * offered.
 *
 * Validation runs inline through the pure `validateNewWorktree` rules plus the shared
 * `isValidBranchName` git-ref check: the path is required, must not be a known worktree or
 * repository path, and the branch must be a legal ref that is free. Two product checks are
 * deliberately deferred and belong to the orchestrator's bounded filesystem read: an arbitrary path
 * that exists on disk but is absent from the snapshot cannot be detected here, and the parent
 * directory's writability is not probed. The feature has no filesystem or git read access, so git
 * refuses such a path at execution time instead of this form guessing.
 *
 * @param props - Overlay close callback.
 * @returns The form state, control cycle, and submit handler.
 */
export function useNewWorktreeForm(props: NewWorktreeModalProps) {
  const repository = useRepository();
  const snapshot = repository.snapshot;
  const basePath = snapshot?.currentWorktreePath ?? snapshot?.root ?? null;
  const existingBranches = useMemo(() => readExistingBranches(snapshot), [snapshot]);
  const fields = useNewWorktreeFields(basePath, existingBranches);
  const controlCycle = useNewWorktreeControl(fields.mode);
  const { focusRenderable } = useFocusState();
  const blockedReason = readAvailabilityText(
    repository.getAvailability("worktree.create", { kind: "none" }, "worktrees"),
  );
  const submit = useNewWorktreeSubmit({
    blockedReason,
    control: controlCycle.control,
    existingBranches,
    fields,
    onClose: props.onClose,
    snapshot,
  });

  /** Confirms the branch mode and moves focus to the field that mode shows. */
  const confirmMode = useCallback(
    (value: string): void => {
      fields.changeMode(value);

      if (value === "existing") {
        controlCycle.focusControl("existing-branch");
        return;
      }

      controlCycle.focusControl("branch");
      focusRenderable(NEW_WORKTREE_BRANCH_INPUT_ID);
    },
    [controlCycle, fields.changeMode, focusRenderable],
  );

  /** Confirms the selected existing branch and moves focus to the primary action. */
  const confirmExistingBranch = useCallback(
    (value: string): void => {
      fields.changeExistingBranch(value);
      controlCycle.focusControl("confirm");
    },
    [controlCycle, fields.changeExistingBranch],
  );

  return {
    ...fields,
    ...controlCycle,
    ...submit,
    confirmMode,
    confirmExistingBranch,
    existingBranches,
    blockedReason,
  };
}

/**
 * Owns the editable field state and its path derivation.
 *
 * @param basePath - Current worktree path or repository root, or null before the first read.
 * @param existingBranches - Local branches no worktree has checked out.
 * @returns The field values and change handlers.
 */
function useNewWorktreeFields(basePath: string | null, existingBranches: readonly string[]) {
  const [mode, setMode] = useState<WorktreeBranchMode>("new");
  const [newBranch, setNewBranch] = useState("");
  const [existingBranch, setExistingBranch] = useState("");
  const [pathValue, setPathValue] = useState(() => deriveWorktreePath(basePath, ""));
  const [pathEdited, setPathEdited] = useState(false);
  const [error, setError] = useState<NewWorktreeFieldError | null>(null);
  const selectedExistingBranch =
    existingBranch.length > 0 ? existingBranch : (existingBranches[0] ?? "");

  usePrefilledPath({ basePath, pathValue, pathEdited, setPathValue });

  /** Records a typed path and stops tracking the branch-name derivation. */
  const changePath = useCallback(
    (value: string): void => {
      const derived = deriveWorktreePath(
        basePath,
        mode === "existing" ? selectedExistingBranch : newBranch,
      );

      setPathValue(value);
      setError(null);

      if (value !== derived) {
        setPathEdited(true);
      }
    },
    [basePath, mode, newBranch, selectedExistingBranch],
  );

  /** Records a typed new branch name and keeps an untouched path in sync with it. */
  const changeNewBranch = useCallback(
    (value: string): void => {
      setNewBranch(value);
      setError(null);

      if (!pathEdited) {
        setPathValue(deriveWorktreePath(basePath, value));
      }
    },
    [basePath, pathEdited],
  );

  /** Switches the branch mode and realigns an untouched path. */
  const changeMode = useCallback(
    (value: string): void => {
      const nextMode: WorktreeBranchMode = value === "existing" ? "existing" : "new";

      setMode(nextMode);
      setError(null);

      if (!pathEdited) {
        setPathValue(
          deriveWorktreePath(
            basePath,
            nextMode === "existing" ? selectedExistingBranch : newBranch,
          ),
        );
      }
    },
    [basePath, newBranch, pathEdited, selectedExistingBranch],
  );

  /** Records the selected existing branch and keeps an untouched path in sync with it. */
  const changeExistingBranch = useCallback(
    (value: string): void => {
      setExistingBranch(value);
      setError(null);

      if (!pathEdited) {
        setPathValue(deriveWorktreePath(basePath, value));
      }
    },
    [basePath, pathEdited],
  );

  return {
    mode,
    newBranch,
    selectedExistingBranch,
    pathValue,
    error,
    setError,
    changePath,
    changeNewBranch,
    changeMode,
    changeExistingBranch,
  };
}

/**
 * Owns the keyboard control cycle for the visible form controls.
 *
 * @param mode - Current branch mode, which chooses the control order.
 * @returns The focused control and its order.
 */
function useNewWorktreeControl(mode: WorktreeBranchMode) {
  const { focusRenderable } = useFocusState();
  const controlOrder = useMemo(
    () =>
      mode === "new"
        ? NEW_WORKTREE_NEW_BRANCH_CONTROL_ORDER
        : NEW_WORKTREE_EXISTING_BRANCH_CONTROL_ORDER,
    [mode],
  );
  const cycle = useModalControlCycle<NewWorktreeControl>({
    order: controlOrder,
    initial: "path",
    onHorizontal: ({ direction }) => ({
      kind: "focus",
      control: direction === "left" ? "cancel" : "confirm",
    }),
    onControlChange: (next) => {
      if (next === "mode") {
        focusRenderable(NEW_WORKTREE_MODE_SELECT_ID);

        return;
      }

      if (next === "existing-branch") {
        focusRenderable(NEW_WORKTREE_EXISTING_SELECT_ID);

        return;
      }

      focusRenderable(MODAL_FRAME_ID);
    },
  });

  return { control: cycle.control, controlOrder, focusControl: cycle.focusControl };
}

/**
 * Owns form submission and the activation of each focusable control.
 *
 * @param input - Form fields, availability block, close callback, and snapshot.
 * @returns The submit handler and the control activator.
 */
function useNewWorktreeSubmit(input: {
  readonly blockedReason: string | null;
  readonly control: NewWorktreeControl;
  readonly existingBranches: readonly string[];
  readonly fields: ReturnType<typeof useNewWorktreeFields>;
  readonly onClose: () => void;
  readonly snapshot: ReturnType<typeof useRepository>["snapshot"];
}) {
  const { runCommand } = useCommandRunner();
  const { focusRenderable } = useFocusState();
  const { blockedReason, control, existingBranches, fields, onClose, snapshot } = input;

  /** Validates the form and dispatches one create command when every rule passes. */
  const submit = useCallback((): void => {
    if (blockedReason !== null) {
      return;
    }

    const trimmedPath = fields.pathValue.trim();
    const branch = fields.mode === "new" ? fields.newBranch.trim() : fields.selectedExistingBranch;
    const validationError = readWorktreeFormError({
      branch,
      existingBranchCount: existingBranches.length,
      mode: fields.mode,
      path: trimmedPath,
      snapshot,
    });

    if (validationError !== null) {
      fields.setError(validationError);
      return;
    }

    void runCommand({
      commandId: "worktree.create",
      target: { kind: "none" },
      formValues: { path: trimmedPath, mode: fields.mode, branch },
    }).catch(() => undefined);
    onClose();
  }, [blockedReason, existingBranches.length, fields, onClose, runCommand, snapshot]);

  /** Activates the focused control, deferring field and select activation to native focus. */
  const activateFocusedControl = useCallback((): void => {
    switch (control) {
      case "path":
        focusRenderable(NEW_WORKTREE_PATH_INPUT_ID);

        return;
      case "mode":
        focusRenderable(NEW_WORKTREE_MODE_SELECT_ID);

        return;
      case "branch":
        focusRenderable(NEW_WORKTREE_BRANCH_INPUT_ID);

        return;
      case "existing-branch":
        focusRenderable(NEW_WORKTREE_EXISTING_SELECT_ID);

        return;
      case "cancel":
        onClose();

        return;
      case "confirm":
        submit();

        return;
    }
  }, [control, focusRenderable, onClose, submit]);

  useAction("nav.activate", { scope: "overlay" }, activateFocusedControl);
  useAction("form.submit", { scope: "overlay" }, submit);

  return { submit, activateFocusedControl };
}

/**
 * Fills a still-empty path field once the repository snapshot supplies a base path.
 *
 * The modal can mount before the first snapshot settles, so the initial state cannot always derive a
 * path. This effect runs only while the field is empty and untouched, so it never overwrites a typed
 * or branch-derived path.
 *
 * @param input - Base path, current path state, edit flag, and the path setter.
 */
function usePrefilledPath(input: {
  readonly basePath: string | null;
  readonly pathValue: string;
  readonly pathEdited: boolean;
  readonly setPathValue: (value: string) => void;
}): void {
  const { basePath, pathEdited, pathValue, setPathValue } = input;

  useEffect(() => {
    if (pathEdited || basePath === null || pathValue.length > 0) {
      return;
    }

    setPathValue(deriveWorktreePath(basePath, ""));
  }, [basePath, pathEdited, pathValue, setPathValue]);
}

/**
 * Validates the form and returns the field that should show the message.
 *
 * @param input - Trimmed path, branch, mode, existing-branch count, and snapshot.
 * @returns The field error, or null when the form may submit.
 */
function readWorktreeFormError(input: {
  readonly branch: string;
  readonly existingBranchCount: number;
  readonly mode: WorktreeBranchMode;
  readonly path: string;
  readonly snapshot: ReturnType<typeof useRepository>["snapshot"];
}): NewWorktreeFieldError | null {
  if (input.mode === "existing" && input.existingBranchCount === 0) {
    return { field: "branch", message: "no existing branch available" };
  }

  const message = readWorktreeRuleMessage(input);

  if (message === null) {
    return null;
  }

  return { field: readErrorField(message), message };
}

/**
 * Runs the shared domain validation plus the git-ref branch rule.
 *
 * @param input - Trimmed path, branch, mode, and snapshot.
 * @returns The validation message, or null when every rule passes.
 */
function readWorktreeRuleMessage(input: {
  readonly branch: string;
  readonly mode: WorktreeBranchMode;
  readonly path: string;
  readonly snapshot: ReturnType<typeof useRepository>["snapshot"];
}): string | null {
  const message = validateNewWorktree(
    { path: input.path, mode: input.mode, branch: input.branch },
    {
      branches: input.snapshot?.branches ?? [],
      worktrees: input.snapshot?.worktrees ?? [],
      pathExists: readKnownPathExists(input.path, input.snapshot),
    },
  );

  if (message !== null) {
    return message;
  }

  return isValidBranchName(input.branch) ? null : "invalid branch name";
}

/**
 * Reads local branches that no worktree has checked out.
 *
 * The worktree branch map is the single source for checked-out branches, so a branch shown in
 * another worktree never appears here. Branch order comes from `selectBranchRows`, keeping the
 * picker stable across refreshes.
 *
 * @param snapshot - Current snapshot, or null before the first read.
 * @returns Branch names eligible for an existing-branch worktree.
 */
function readExistingBranches(
  snapshot: ReturnType<typeof useRepository>["snapshot"],
): readonly string[] {
  const checkedOut = selectWorktreeBranchMap(snapshot);

  return selectBranchRows(snapshot)
    .filter((branch) => !checkedOut.has(branch.name))
    .map((branch) => branch.name);
}

/**
 * Reports whether a candidate path is already a known worktree or the repository itself.
 *
 * This is the only existence answer available from the snapshot. A path that exists on disk but is
 * not a worktree of this repository cannot be detected without a shared bounded filesystem read.
 *
 * @param candidate - Path typed into the form.
 * @param snapshot - Current snapshot, or null before the first read.
 * @returns True when the snapshot can prove the path is occupied.
 */
function readKnownPathExists(
  candidate: string,
  snapshot: ReturnType<typeof useRepository>["snapshot"],
): boolean {
  if (candidate.length === 0) {
    return false;
  }

  const known: readonly (string | null)[] = [
    snapshot?.root ?? null,
    snapshot?.currentWorktreePath ?? null,
    ...(snapshot?.worktrees ?? []).map((worktree: WorktreeRecord) => worktree.path),
  ];

  return known.some(
    (knownPath) => knownPath !== null && knownPath.length > 0 && isSamePath(candidate, knownPath),
  );
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
 * Chooses the field that should show a validation message.
 *
 * @param message - Validation message returned by `validateNewWorktree`.
 * @returns `branch` for branch rules and `path` for every path or placeholder rule.
 */
function readErrorField(message: string): "path" | "branch" {
  return message.toLowerCase().includes("branch") ? "branch" : "path";
}
