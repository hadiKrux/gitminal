import type { ReactNode } from "react";
import { useCallback, useState } from "react";
import { useAction } from "@/app/hooks/useAction";
import { CONFIRM_LABELS } from "@/domain/commands/confirm.labels";
import type { StashRecord } from "@/domain/git/git.types";
import {
  DELETE_STASH_CANCEL_ACTION_INDEX,
  DELETE_STASH_CANCEL_BUTTON_ID,
  DELETE_STASH_CONSEQUENCE,
  DELETE_STASH_DROP_ACTION_INDEX,
  DELETE_STASH_DROP_BUTTON_ID,
  DELETE_STASH_HEIGHT,
  DELETE_STASH_TITLE,
  DELETE_STASH_WIDTH,
} from "@/features/stashes/DeleteStashModal.constants";
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
 * default. The primary action calls `onDrop` with the immutable object name, never the captured
 * display index, so an external stash operation cannot redirect the drop.
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
  const [focusedAction, setFocusedAction] = useState(DELETE_STASH_CANCEL_ACTION_INDEX);
  const actions = buildActions({
    focusedAction,
    onDrop: () => {
      props.onDrop(props.stash.objectName);
      props.onClose();
    },
    onCancel: props.onClose,
  });

  /** Focuses the primary drop action. */
  const focusDrop = useCallback((): void => {
    setFocusedAction(DELETE_STASH_DROP_ACTION_INDEX);
  }, []);

  /** Focuses the cancel action. */
  const focusCancel = useCallback((): void => {
    setFocusedAction(DELETE_STASH_CANCEL_ACTION_INDEX);
  }, []);

  /** Runs the focused footer action. */
  const activateFocusedAction = useCallback((): void => {
    const action = actions[focusedAction];

    action?.onPress?.();
  }, [actions, focusedAction]);

  useAction("nav.left", { scope: "overlay" }, focusDrop);
  useAction("nav.right", { scope: "overlay" }, focusCancel);
  useAction("nav.activate", { scope: "overlay" }, activateFocusedAction);

  return (
    <ModalFrame title={DELETE_STASH_TITLE} width={DELETE_STASH_WIDTH} height={DELETE_STASH_HEIGHT}>
      <text fg={tokens.text} wrapMode="none">
        {`Stash: ${props.stash.index}`}
      </text>
      <text fg={tokens.text} wrapMode="word">
        {`Message: ${readStashMessage(props.stash)}`}
      </text>
      <text fg={tokens.muted} wrapMode="word">
        {DELETE_STASH_CONSEQUENCE}
      </text>
      <box flexGrow={1} />
      <ModalActions actions={actions} />
    </ModalFrame>
  );
}

/**
 * Builds the footer actions in display order.
 *
 * @param input - Focused index and the two handlers.
 * @returns The drop and cancel actions with their focus state.
 */
function buildActions(input: {
  readonly focusedAction: number;
  readonly onDrop: () => void;
  readonly onCancel: () => void;
}): readonly ButtonProps[] {
  return [
    {
      id: DELETE_STASH_DROP_BUTTON_ID,
      label: CONFIRM_LABELS.dropStash,
      focused: input.focusedAction === DELETE_STASH_DROP_ACTION_INDEX,
      onPress: input.onDrop,
    },
    {
      id: DELETE_STASH_CANCEL_BUTTON_ID,
      label: "Cancel",
      focused: input.focusedAction === DELETE_STASH_CANCEL_ACTION_INDEX,
      onPress: input.onCancel,
    },
  ];
}
