import { useCallback, useMemo, useState } from "react";
import { useAction } from "@/app/hooks/useAction";
import { useCommandRunner } from "@/app/hooks/useCommandRunner";
import { useFocusState } from "@/app/hooks/useFocusState";
import { useModalControlCycle } from "@/app/hooks/useModalControlCycle";
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
 * @param props - Merged tag row opened by the panel and the overlay close callback.
 * @returns The state, actions, and display text consumed by the modal view.
 */
export function useDeleteTagModal(props: DeleteTagModalProps): DeleteTagModalHandle {
  const { runCommand } = useCommandRunner();
  const { focusRenderable } = useFocusState();
  const scopeOptions = buildScopeOptions(props.row);
  const [scope, setScope] = useState<DeleteScope>(scopeOptions[0]?.value ?? "local");
  const [remote, setRemote] = useState(props.row.remotes[0] ?? "");
  const requiresRemote = scope !== "local";
  const remoteMissing = requiresRemote && props.row.remotes.length === 0;
  const showRemotePicker = requiresRemote && props.row.remotes.length > 1;
  const controlOrder = useMemo(
    () => (showRemotePicker ? DELETE_TAG_FULL_CONTROL_ORDER : DELETE_TAG_COMPACT_CONTROL_ORDER),
    [showRemotePicker],
  );
  const cycle = useModalControlCycle<DeleteControl>({
    order: controlOrder,
    initial: "cancel",
    onHorizontal: ({ control, direction }) => {
      if (control === "scope" || control === "remote") {
        return { kind: "step", delta: direction === "left" ? -1 : 1 };
      }

      return { kind: "focus", control: direction === "left" ? "confirm" : "cancel" };
    },
  });
  const control = cycle.control;

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

  /** Records the selected scope and returns native focus to the modal frame. */
  const selectScope = useCallback(
    (value: string): void => {
      if (isDeleteScope(value)) {
        setScope(value);
      }

      focusRenderable(MODAL_FRAME_ID);
    },
    [focusRenderable],
  );

  /** Records the selected remote and returns native focus to the modal frame. */
  const selectRemote = useCallback(
    (value: string): void => {
      setRemote(value);
      focusRenderable(MODAL_FRAME_ID);
    },
    [focusRenderable],
  );

  /**
   * Runs the focused control.
   *
   * A select control only receives native focus; Enter is then handled by the select itself, which
   * opens its own value and reports the choice back. Footer controls run immediately.
   */
  const activateFocusedControl = useCallback((): void => {
    switch (control) {
      case "scope":
        focusRenderable(DELETE_TAG_SCOPE_SELECT_ID);

        return;
      case "remote":
        if (showRemotePicker) {
          focusRenderable(DELETE_TAG_REMOTE_SELECT_ID);
        }

        return;
      case "cancel":
        props.onClose();

        return;
      case "confirm":
        submitDelete();

        return;
    }
  }, [control, focusRenderable, props, showRemotePicker, submitDelete]);

  useAction("nav.activate", { scope: "overlay" }, activateFocusedControl);

  return {
    scopeOptions,
    scope,
    remote,
    remoteMissing,
    requiresRemote,
    showRemotePicker,
    actions: buildActions({
      control,
      remoteMissing,
      onDelete: submitDelete,
      onCancel: props.onClose,
    }),
    consequence: readConsequence(props.row, scope, remote),
    selectScope,
    selectRemote,
  };
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
