import type { ReactNode } from "react";
import { useCallback } from "react";
import { useAction } from "@/app/hooks/useAction";
import { useModalControlCycle } from "@/app/hooks/useModalControlCycle";
import { CONFIRM_LABELS } from "@/domain/commands/confirm.labels";
import type { StashRecord } from "@/domain/git/git.types";
import {
  DELETE_STASH_CANCEL_BUTTON_ID,
  DELETE_STASH_CONSEQUENCE,
  DELETE_STASH_CONTROL_ORDER,
  DELETE_STASH_DROP_BUTTON_ID,
  DELETE_STASH_INITIAL_CONTROL,
  DELETE_STASH_TITLE,
  DELETE_STASH_WIDTH,
} from "@/features/stashes/DeleteStashModal.constants";
import type { DeleteStashControl } from "@/features/stashes/DeleteStashModal.types";
import { readStashMessage } from "@/features/stashes/stash.prefill";
import { useTokens } from "@/theme/useTokens";
import type { ButtonProps } from "@/ui/Button.types";
import { ModalActions } from "@/ui/ModalActions";
import { ModalFrame } from "@/ui/ModalFrame";
/**
 * Renders the Delete Stash confirmation.
 *
 * The dialog names the display index and the recorded message, states that the stash is dropped
 * without keeping a copy, and starts with Cancel focused so the destructive action is never the
 * default. Up and Down step between the two footer actions like the other destructive modals, and
 * Left and Right keep their documented shortcuts. The primary action calls `onDrop` with the
 * immutable object name, never the captured display index, so an external stash operation cannot
 * redirect the drop.
 *
 * @param props - Stash being dropped, close callback, and drop callback.
 * @returns The delete-stash confirmation.
 */
export function DeleteStashModal(props: {
  readonly stash: StashRecord;
  readonly onClose: () => void;
  readonly onDrop: (objectName: string) => void;
}): ReactNode {
  const tokens = useTokens();
  const cycle = useModalControlCycle<DeleteStashControl>({
    order: DELETE_STASH_CONTROL_ORDER,
    initial: DELETE_STASH_INITIAL_CONTROL,
    onHorizontal: ({ direction }) => ({
      kind: "focus",
      control: direction === "left" ? "drop" : "cancel",
    }),
  });
  const control = cycle.control;

  /** Confirms the drop with the immutable object name and closes the modal. */
  const confirmDrop = useCallback((): void => {
    props.onDrop(props.stash.objectName);
    props.onClose();
  }, [props]);

  const actions = buildActions({
    control,
    onDrop: confirmDrop,
    onCancel: props.onClose,
  });

  /** Runs the focused footer action. */
  const activateFocusedAction = useCallback((): void => {
    if (control === "drop") {
      confirmDrop();
      return;
    }

    props.onClose();
  }, [confirmDrop, control, props.onClose]);

  useAction("nav.activate", { scope: "overlay" }, activateFocusedAction);

  return (
    <ModalFrame title={DELETE_STASH_TITLE} width={DELETE_STASH_WIDTH}>
      <text fg={tokens.text} wrapMode="none">
        {`Stash: ${props.stash.index}`}
      </text>
      <text fg={tokens.text} wrapMode="word">
        {`Message: ${readStashMessage(props.stash)}`}
      </text>
      <text fg={tokens.muted} wrapMode="word">
        {DELETE_STASH_CONSEQUENCE}
      </text>
      <ModalActions actions={actions} />
    </ModalFrame>
  );
}

/**
 * Builds the footer actions in display order.
 *
 * @param input - Focused control and the two handlers.
 * @returns The drop and cancel actions with their focus state.
 */
function buildActions(input: {
  readonly control: DeleteStashControl;
  readonly onDrop: () => void;
  readonly onCancel: () => void;
}): readonly ButtonProps[] {
  return [
    {
      id: DELETE_STASH_DROP_BUTTON_ID,
      label: CONFIRM_LABELS.dropStash,
      focused: input.control === "drop",
      onPress: input.onDrop,
    },
    {
      id: DELETE_STASH_CANCEL_BUTTON_ID,
      label: "Cancel",
      focused: input.control === "cancel",
      onPress: input.onCancel,
    },
  ];
}
