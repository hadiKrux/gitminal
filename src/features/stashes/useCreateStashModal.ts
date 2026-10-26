import { useCallback, useState } from "react";
import { useFooterActionCycle } from "@/app/hooks/useFooterActionCycle";
import { useRepository } from "@/app/hooks/useRepository";
import { describeCommandReason } from "@/domain/commands/commands.reasons";
import { getStashCreateAvailability } from "@/domain/git/git.stashes";
import {
  CREATE_STASH_CANCEL_ACTION_INDEX,
  CREATE_STASH_CANCEL_BUTTON_ID,
  CREATE_STASH_CREATE_ACTION_INDEX,
  CREATE_STASH_CREATE_BUTTON_ID,
  CREATE_STASH_MESSAGE_REQUIRED,
} from "@/features/stashes/CreateStashModal.constants";
import type {
  CreateStashFormHandle,
  CreateStashModalProps,
} from "@/features/stashes/CreateStashModal.types";
import type { ButtonProps } from "@/ui/Button.types";

/**
 * Owns the Create Stash form state, validation text, and footer action cycle.
 *
 * The message starts from the panel prefill and the checkbox starts from the configured default.
 * Changing the checkbox re-evaluates `getStashCreateAvailability`, so the confirm always shows the
 * exact disabled reason for the current draft. The hook dispatches nothing: a valid submit calls
 * the panel's `onCreate`.
 *
 * @param props - Message field id, prefill, checkbox default, close callback, and submit callback.
 * @returns The form state and handlers consumed by the modal view.
 */
export function useCreateStashModal(props: CreateStashModalProps): CreateStashFormHandle {
  const repository = useRepository();
  const [message, setMessage] = useState(props.initialMessage);
  const [includeUntracked, setIncludeUntracked] = useState(props.includeUntrackedByDefault);
  const [error, setError] = useState<string | null>(null);
  const status = repository.snapshot?.status ?? null;
  const availabilityCode = getStashCreateAvailability(status, includeUntracked);
  const availabilityText =
    availabilityCode === null ? null : describeCommandReason(availabilityCode);
  const blockedReason = readBlockedReason(message, availabilityText);

  /** Updates the draft message and clears a stale validation error. */
  const handleMessageInput = useCallback((value: string): void => {
    setMessage(value);
    setError(null);
  }, []);

  /** Submits the form through the primary action. */
  const submit = useCallback((): void => {
    submitMessage(
      message,
      includeUntracked,
      availabilityText,
      props.onCreate,
      props.onClose,
      setError,
    );
  }, [availabilityText, includeUntracked, message, props.onCreate, props.onClose]);

  /** Toggles whether untracked files are included. */
  const toggleUntracked = useCallback((): void => {
    setIncludeUntracked((current) => !current);
  }, []);

  /** Owns the footer action cycle and refuses a disabled primary action. */
  const footer = useFooterActionCycle({
    actionCount: 2,
    initialIndex: CREATE_STASH_CREATE_ACTION_INDEX,
    onActivate: (index) => {
      if (index !== CREATE_STASH_CREATE_ACTION_INDEX) {
        props.onClose();
        return;
      }

      if (blockedReason !== null) {
        return;
      }

      submit();
    },
  });

  const actions = buildActions({
    focusedAction: footer.focusedAction,
    blockedReason,
    onCreate: submit,
    onCancel: props.onClose,
  });

  return {
    message,
    includeUntracked,
    error,
    availabilityText,
    actions,
    handleMessageInput,
    submit,
    toggleUntracked,
  };
}

/**
 * Reads the reason the primary action is disabled.
 *
 * The required message runs first so an empty draft is explained even when the working tree also
 * blocks the command. An availability reason is the shared wording from `commands.reasons.ts`.
 *
 * @param message - Current draft message.
 * @param availabilityText - Live stash creation reason, or null when it may run.
 * @returns The disabled reason, or null when the form may submit.
 */
function readBlockedReason(message: string, availabilityText: string | null): string | null {
  return message.trim().length === 0 ? CREATE_STASH_MESSAGE_REQUIRED : availabilityText;
}

/**
 * Validates and dispatches a create request.
 *
 * The message is trimmed for emptiness but sent as entered after trimming, so a stray leading or
 * trailing space never changes the row identity the user sees. A validation or availability block
 * keeps the modal open and stores the message error; a valid submit closes it after calling the
 * panel's `onCreate`.
 *
 * @param message - Current draft message.
 * @param includeUntracked - Current checkbox state.
 * @param availabilityText - Live stash creation reason, or null when it may run.
 * @param onCreate - Panel callback that runs the command.
 * @param onClose - Overlay close callback.
 * @param setError - Inline error writer.
 */
function submitMessage(
  message: string,
  includeUntracked: boolean,
  availabilityText: string | null,
  onCreate: CreateStashModalProps["onCreate"],
  onClose: () => void,
  setError: (error: string | null) => void,
): void {
  const trimmed = message.trim();

  if (trimmed.length === 0) {
    setError(CREATE_STASH_MESSAGE_REQUIRED);
    return;
  }

  if (availabilityText !== null) {
    return;
  }

  onCreate({ message: trimmed, includeUntracked });
  onClose();
}

/**
 * Builds the footer actions in display order.
 *
 * @param input - Focused index, disabled reason, and callbacks.
 * @returns The create and cancel actions with their focus and disabled state.
 */
function buildActions(input: {
  readonly focusedAction: number;
  readonly blockedReason: string | null;
  readonly onCreate: () => void;
  readonly onCancel: () => void;
}): readonly ButtonProps[] {
  return [
    {
      id: CREATE_STASH_CREATE_BUTTON_ID,
      label: "Create stash",
      focused: input.focusedAction === CREATE_STASH_CREATE_ACTION_INDEX,
      disabled: input.blockedReason !== null,
      reason: input.blockedReason ?? undefined,
      onPress: input.onCreate,
    },
    {
      id: CREATE_STASH_CANCEL_BUTTON_ID,
      label: "Cancel",
      focused: input.focusedAction === CREATE_STASH_CANCEL_ACTION_INDEX,
      onPress: input.onCancel,
    },
  ];
}
