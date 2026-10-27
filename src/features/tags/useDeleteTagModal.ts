import { useCallback, useState } from "react";
import { useAction } from "@/app/hooks/useAction";
import { useCommandRunner } from "@/app/hooks/useCommandRunner";
import { useFocusState } from "@/app/hooks/useFocusState";
import { useModalControlCycle } from "@/app/hooks/useModalControlCycle";
import type {
  ModalControlCycle,
  ModalControlResolution,
  ModalHorizontalInput,
} from "@/app/hooks/useModalControlCycle.types";
import { CONFIRM_LABELS } from "@/domain/commands/confirm.labels";
import type { TagRowRecord } from "@/domain/git/git.types";
import {
  DELETE_TAG_CANCEL_BUTTON_ID,
  DELETE_TAG_COMPACT_CONTROL_ORDER,
  DELETE_TAG_DELETE_BUTTON_ID,
  DELETE_TAG_FULL_CONTROL_ORDER,
  DELETE_TAG_NOT_ON_REMOTE,
  DELETE_TAG_REMOTE_SELECT_ID,
  DELETE_TAG_SCOPE_SELECT_ID,
} from "@/features/tags/DeleteTagModal.constants";
import type {
  DeleteControl,
  DeleteScope,
  DeleteScopeOption,
  DeleteTagModalHandle,
  DeleteTagModalProps,
} from "@/features/tags/DeleteTagModal.types";
import type { ButtonProps } from "@/ui/Button.types";
import { MODAL_FRAME_ID } from "@/ui/ModalFrame.constants";

/**
 * Owns the Delete Tag modal state, delete dispatch, and keyboard control cycle.
 *
 * The scope list offers local deletion for a tag that exists locally, local-and-remote deletion
 * when a remote contains it, and remote-only deletion only when the tag is absent locally. A remote
 * scope is unavailable with the reason "not on any remote" when no last successful check knows the
 * tag, and the primary action is disabled with the same reason. The remote picker appears only when
 * more than one remote contains the tag; a single remote is named as text so the app never guesses.
 *
 * The scope and remote selects take native focus whenever their control owns the keyboard, so Up and
 * Down change the option in place. Native selection changes only record the value; confirming a
 * selection with Enter advances focus to the remote picker when it is shown, otherwise to the Delete
 * action, so a second Enter runs the delete instead of refocusing the select. The scope select owns
 * the keyboard when the modal opens, so Up and Down work without a navigation step and the Delete
 * action is never the default focus.
 *
 * @param props - Merged tag row opened by the panel and the overlay close callback.
 * @returns The state, actions, and display text consumed by the modal view.
 */
export function useDeleteTagModal(props: DeleteTagModalProps): DeleteTagModalHandle {
  const { runCommand } = useCommandRunner();
  const { focusRenderable } = useFocusState();
  const selection = useDeleteTagSelection(props.row, focusRenderable);
  const { scope, remote, requiresRemote, remoteMissing } = selection;

  /** Dispatches the delete command for the selected scope and closes the modal. */
  const submitDelete = useCallback((): void => {
    if (remoteMissing) {
      return;
    }

    void runCommand({
      commandId: "tag.delete",
      target: { kind: "tag", name: props.row.name },
      formValues: { scope, remote: requiresRemote ? remote : "" },
    }).catch(() => undefined);
    props.onClose();
  }, [props, remote, remoteMissing, requiresRemote, runCommand, scope]);

  useAction("nav.activate", { scope: "overlay" }, () =>
    runFocusedControl({
      control: selection.control,
      showRemotePicker: selection.showRemotePicker,
      focusRenderable,
      onCancel: props.onClose,
      onConfirm: submitDelete,
    }),
  );

  return {
    control: selection.control,
    scopeOptions: selection.scopeOptions,
    scope,
    remote,
    remoteMissing,
    requiresRemote,
    showRemotePicker: selection.showRemotePicker,
    actions: buildActions({
      control: selection.control,
      remoteMissing,
      onDelete: submitDelete,
      onCancel: props.onClose,
    }),
    consequence: readConsequence(props.row, scope, remote),
    selectScope: selection.selectScope,
    selectRemote: selection.selectRemote,
    confirmScope: selection.confirmScope,
    confirmRemote: selection.confirmRemote,
  };
}

/**
 * Owns the selected scope and remote, their native navigation, and the keyboard control cycle.
 *
 * @param row - Merged tag row the modal deletes.
 * @param focusRenderable - Focus operation for the active control.
 * @returns The selection state, derived flags, and the select handlers.
 */
function useDeleteTagSelection(
  row: TagRowRecord,
  focusRenderable: (id: string) => boolean,
): {
  readonly control: DeleteControl;
  readonly scopeOptions: readonly DeleteScopeOption[];
  readonly scope: DeleteScope;
  readonly remote: string;
  readonly requiresRemote: boolean;
  readonly remoteMissing: boolean;
  readonly showRemotePicker: boolean;
  readonly selectScope: (value: string) => void;
  readonly selectRemote: (value: string) => void;
  readonly confirmScope: (value: string) => void;
  readonly confirmRemote: (value: string) => void;
} {
  const scopeOptions = buildScopeOptions(row);
  const [scope, setScope] = useState<DeleteScope>(scopeOptions[0]?.value ?? "local");
  const [remote, setRemote] = useState(row.remotes[0] ?? "");
  const requiresRemote = scope !== "local";
  const remoteMissing = requiresRemote && row.remotes.length === 0;
  const showRemotePicker = requiresRemote && row.remotes.length > 1;
  const cycle = useDeleteTagControl({
    order: showRemotePicker ? DELETE_TAG_FULL_CONTROL_ORDER : DELETE_TAG_COMPACT_CONTROL_ORDER,
    showRemotePicker,
    focusRenderable,
  });

  /** Records a scope value reported by native navigation. */
  const selectScope = useCallback((value: string): void => {
    if (isDeleteScope(value)) {
      setScope(value);
    }
  }, []);

  /** Records a confirmed scope value and moves focus to the next field or the primary action. */
  const confirmScope = useCallback(
    (value: string): void => {
      if (isDeleteScope(value)) {
        setScope(value);
      }

      focusRenderable(MODAL_FRAME_ID);
      cycle.focusControl(readConfirmedScopeControl(value, row.remotes.length));
    },
    [cycle, focusRenderable, row.remotes.length],
  );

  /** Records a remote value reported by native navigation. */
  const selectRemote = useCallback((value: string): void => {
    setRemote(value);
  }, []);

  /** Records a confirmed remote value and moves focus to the primary action. */
  const confirmRemote = useCallback(
    (value: string): void => {
      setRemote(value);
      focusRenderable(MODAL_FRAME_ID);
      cycle.focusControl("confirm");
    },
    [cycle, focusRenderable],
  );

  return {
    control: cycle.control,
    scopeOptions,
    scope,
    remote,
    requiresRemote,
    remoteMissing,
    showRemotePicker,
    selectScope,
    selectRemote,
    confirmScope,
    confirmRemote,
  };
}

/**
 * Builds the keyboard control cycle for the visible controls.
 *
 * @param input - Control order, remote picker visibility, and the focus operation.
 * @returns The cycle with the current control and its operations.
 */
function useDeleteTagControl(input: {
  readonly order: readonly DeleteControl[];
  readonly showRemotePicker: boolean;
  readonly focusRenderable: (id: string) => boolean;
}): ModalControlCycle<DeleteControl> {
  return useModalControlCycle<DeleteControl>({
    order: input.order,
    initial: "scope",
    onHorizontal: readDeleteHorizontalResolution,
    onControlChange: (next) => {
      input.focusRenderable(readDeleteControlFocusId(next, input.showRemotePicker));
    },
  });
}

/**
 * Applies the modal's left and right rule.
 *
 * A select steps through the control order so the footer stays reachable, while a footer action
 * jumps to the other footer action.
 *
 * @param input - Focused control and requested direction.
 * @returns The control step or focus resolution.
 */
function readDeleteHorizontalResolution(
  input: ModalHorizontalInput<DeleteControl>,
): ModalControlResolution<DeleteControl> {
  if (input.control === "scope" || input.control === "remote") {
    return { kind: "step", delta: input.direction === "left" ? -1 : 1 };
  }

  return { kind: "focus", control: input.direction === "left" ? "confirm" : "cancel" };
}

/**
 * Reads the renderable id that should own native focus for one control.
 *
 * @param control - Control that now owns the keyboard.
 * @param showRemotePicker - Whether the remote picker is rendered.
 * @returns The renderable id to focus.
 */
function readDeleteControlFocusId(control: DeleteControl, showRemotePicker: boolean): string {
  if (control === "scope") {
    return DELETE_TAG_SCOPE_SELECT_ID;
  }

  if (control === "remote" && showRemotePicker) {
    return DELETE_TAG_REMOTE_SELECT_ID;
  }

  return MODAL_FRAME_ID;
}

/**
 * Reads the control that should follow a confirmed scope.
 *
 * @param value - Raw scope value reported by the select.
 * @param remoteCount - Number of remotes that contain the tag.
 * @returns The remote picker when it is shown, otherwise the Delete action.
 */
function readConfirmedScopeControl(value: string, remoteCount: number): DeleteControl {
  return isDeleteScope(value) && value !== "local" && remoteCount > 1 ? "remote" : "confirm";
}

/**
 * Runs the focused control.
 *
 * A select control only receives native focus; Enter is then handled by the select itself, which
 * reports the confirmed value back through the scope handlers. Footer controls run immediately.
 *
 * @param input - Focused control, remote picker visibility, focus operation, and footer handlers.
 */
function runFocusedControl(input: {
  readonly control: DeleteControl;
  readonly showRemotePicker: boolean;
  readonly focusRenderable: (id: string) => boolean;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}): void {
  switch (input.control) {
    case "scope":
      input.focusRenderable(DELETE_TAG_SCOPE_SELECT_ID);

      return;
    case "remote":
      if (input.showRemotePicker) {
        input.focusRenderable(DELETE_TAG_REMOTE_SELECT_ID);
      }

      return;
    case "cancel":
      input.onCancel();

      return;
    case "confirm":
      input.onConfirm();
  }
}

/**
 * Reports whether a select value is one of the offered delete scopes.
 *
 * @param value - Raw select value.
 * @returns True for a known scope.
 */
function isDeleteScope(value: string): value is DeleteScope {
  return value === "local" || value === "local-remote" || value === "remote";
}

/**
 * Builds the offered delete scopes for one tag row.
 *
 * @param row - Merged tag row.
 * @returns The scope options in display order.
 */
function buildScopeOptions(row: TagRowRecord): readonly DeleteScopeOption[] {
  if (!row.local) {
    return [{ label: "Delete from remote only", value: "remote" }];
  }

  if (row.remotes.length === 0) {
    return [
      { label: "Delete locally", value: "local" },
      {
        label: "Delete locally and from a remote",
        value: "local-remote",
        description: DELETE_TAG_NOT_ON_REMOTE,
      },
    ];
  }

  return [
    { label: "Delete locally", value: "local" },
    { label: "Delete locally and from a remote", value: "local-remote" },
  ];
}

/**
 * Builds the footer actions in display order.
 *
 * @param input - Focused control, remote availability, and the two handlers.
 * @returns The delete and cancel actions with their focus and disabled state.
 */
function buildActions(input: {
  readonly control: DeleteControl;
  readonly remoteMissing: boolean;
  readonly onDelete: () => void;
  readonly onCancel: () => void;
}): readonly ButtonProps[] {
  return [
    {
      id: DELETE_TAG_DELETE_BUTTON_ID,
      label: CONFIRM_LABELS.deleteTag,
      focused: input.control === "confirm",
      disabled: input.remoteMissing,
      reason: input.remoteMissing ? DELETE_TAG_NOT_ON_REMOTE : undefined,
      onPress: input.onDelete,
    },
    {
      id: DELETE_TAG_CANCEL_BUTTON_ID,
      label: "Cancel",
      focused: input.control === "cancel",
      onPress: input.onCancel,
    },
  ];
}

/**
 * Builds the consequence text for the selected scope.
 *
 * @param row - Merged tag row.
 * @param scope - Selected delete scope.
 * @param remote - Selected remote name.
 * @returns The consequence text naming the tag and scope.
 */
function readConsequence(row: TagRowRecord, scope: DeleteScope, remote: string): string {
  if (scope === "local") {
    return `Delete tag ${row.name} locally. The commit it points to is kept.`;
  }

  if (scope === "local-remote") {
    return `Delete tag ${row.name} locally and from ${remote}. The commit it points to is kept.`;
  }

  return `Delete tag ${row.name} from ${remote}. The local tag does not exist.`;
}
