import { type ReactNode, useCallback, useState } from "react";
import { useAction } from "@/app/hooks/useAction";
import { isValidBranchName } from "@/domain/git/git.branches";
import {
  CREATE_LOCAL_BASE_REF_LABEL,
  CREATE_LOCAL_CANCEL_ID,
  CREATE_LOCAL_CANCEL_LABEL,
  CREATE_LOCAL_CHECKOUT_ID,
  CREATE_LOCAL_CHECKOUT_LABEL,
  CREATE_LOCAL_MODAL_FRAME_ID,
  CREATE_LOCAL_MODAL_HEIGHT,
  CREATE_LOCAL_MODAL_WIDTH,
  CREATE_LOCAL_NAME_DUPLICATE_PREFIX,
  CREATE_LOCAL_NAME_INPUT_ID,
  CREATE_LOCAL_NAME_INVALID_ERROR,
  CREATE_LOCAL_NAME_LABEL,
  CREATE_LOCAL_NAME_REQUIRED_ERROR,
  CREATE_LOCAL_SUBMIT_ID,
  CREATE_LOCAL_SUBMIT_LABEL,
  CREATE_LOCAL_TITLE_PREFIX,
} from "@/features/remotes/CreateLocalBranchModal.constants";
import type { CreateLocalBranchValues } from "@/features/remotes/CreateLocalBranchModal.types";
import { useTokens } from "@/theme/useTokens";
import type { ButtonProps } from "@/ui/Button.types";
import { Checkbox } from "@/ui/Checkbox";
import { FormField } from "@/ui/FormField";
import { ModalActions } from "@/ui/ModalActions";
import { ModalFrame } from "@/ui/ModalFrame";

/**
 * Renders the Create Local Branch modal for one remote-tracking ref.
 *
 * The local name is prefilled with the branch part, the base ref is read-only, and checkout
 * defaults to on. Validation runs when the form is submitted and keeps the modal open with an
 * inline error, so an invalid or duplicate name never dispatches a command. The footer order is
 * Create then Cancel; `nav.left`, `nav.right`, and `nav.activate` move and run the focused action,
 * while `Esc` is the global `overlay.close` path owned by the overlay host.
 *
 * @param props - Remote branch data, existing local branch names, and submit and cancel callbacks.
 * @returns The composed modal.
 */
export function CreateLocalBranchModal(props: {
  readonly remote: string;
  readonly branch: string;
  readonly existingBranchNames: readonly string[];
  readonly onSubmit: (values: CreateLocalBranchValues) => void;
  readonly onCancel: () => void;
}): ReactNode {
  const tokens = useTokens();
  const [name, setName] = useState(props.branch);
  const [checkout, setCheckout] = useState(true);
  const [attempted, setAttempted] = useState(false);
  const [focusedAction, setFocusedAction] = useState(0);
  const error = attempted ? readLocalBranchNameError(name, props.existingBranchNames) : null;

  /** Validates the draft and reports it when it is complete. */
  const submit = useCallback((): void => {
    setAttempted(true);

    if (readLocalBranchNameError(name, props.existingBranchNames) !== null) {
      return;
    }

    props.onSubmit({ name: name.trim(), checkout });
  }, [checkout, name, props]);

  /** Toggles the checkout checkbox. */
  const toggleCheckout = useCallback((): void => {
    setCheckout((current) => !current);
  }, []);

  /** Moves the focused footer action left. */
  const moveLeft = useCallback((): void => {
    setFocusedAction((index) => Math.max(0, index - 1));
  }, []);

  /** Moves the focused footer action right. */
  const moveRight = useCallback((): void => {
    setFocusedAction((index) => Math.min(1, index + 1));
  }, []);

  /** Runs the focused footer action. */
  const activate = useCallback((): void => {
    if (focusedAction === 0) {
      submit();
      return;
    }

    props.onCancel();
  }, [focusedAction, props, submit]);

  useAction("nav.left", { scope: "overlay" }, moveLeft);
  useAction("nav.right", { scope: "overlay" }, moveRight);
  useAction("nav.activate", { scope: "overlay" }, activate);

  return (
    <ModalFrame
      id={CREATE_LOCAL_MODAL_FRAME_ID}
      title={`${CREATE_LOCAL_TITLE_PREFIX} ${props.remote}/${props.branch}`}
      width={CREATE_LOCAL_MODAL_WIDTH}
      height={CREATE_LOCAL_MODAL_HEIGHT}
    >
      <FormField
        id={CREATE_LOCAL_NAME_INPUT_ID}
        label={CREATE_LOCAL_NAME_LABEL}
        value={name}
        onInput={setName}
        onSubmit={submit}
        error={error ?? undefined}
      />
      <text fg={tokens.muted} wrapMode="none">
        {`${CREATE_LOCAL_BASE_REF_LABEL} ${props.remote}/${props.branch}`}
      </text>
      <Checkbox
        id={CREATE_LOCAL_CHECKOUT_ID}
        label={CREATE_LOCAL_CHECKOUT_LABEL}
        checked={checkout}
        onPress={toggleCheckout}
      />
      <box flexGrow={1} />
      <ModalActions actions={buildActions(props.onCancel, submit, focusedAction)} />
    </ModalFrame>
  );
}

/**
 * Builds the footer actions in display order.
 *
 * @param onCancel - Cancel callback.
 * @param onSubmit - Validated submit callback.
 * @param focusedAction - Index of the visually focused action.
 * @returns Create then Cancel.
 */
function buildActions(
  onCancel: () => void,
  onSubmit: () => void,
  focusedAction: number,
): readonly ButtonProps[] {
  return [
    {
      id: CREATE_LOCAL_SUBMIT_ID,
      label: CREATE_LOCAL_SUBMIT_LABEL,
      focused: focusedAction === 0,
      onPress: onSubmit,
    },
    {
      id: CREATE_LOCAL_CANCEL_ID,
      label: CREATE_LOCAL_CANCEL_LABEL,
      focused: focusedAction === 1,
      onPress: onCancel,
    },
  ];
}

/**
 * Validates a draft local branch name.
 *
 * @param name - Draft value, possibly padded with spaces.
 * @param existingBranchNames - Local branches in the current snapshot.
 * @returns The inline error text, or null when the name may be used.
 */
function readLocalBranchNameError(
  name: string,
  existingBranchNames: readonly string[],
): string | null {
  const candidate = name.trim();

  if (candidate.length === 0) {
    return CREATE_LOCAL_NAME_REQUIRED_ERROR;
  }

  if (!isValidBranchName(candidate)) {
    return CREATE_LOCAL_NAME_INVALID_ERROR;
  }

  return existingBranchNames.includes(candidate)
    ? `${CREATE_LOCAL_NAME_DUPLICATE_PREFIX}${candidate}`
    : null;
}
