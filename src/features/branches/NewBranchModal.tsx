import { type ReactNode, useCallback, useState } from "react";
import { useAction } from "@/app/hooks/useAction";
import { isValidBranchName } from "@/domain/git/git.branches";
import {
  NEW_BRANCH_CANCEL_ID,
  NEW_BRANCH_CHECKOUT_ID,
  NEW_BRANCH_CREATE_ID,
  NEW_BRANCH_MODAL_WIDTH,
} from "@/features/branches/NewBranchModal.constants";
import { ICONS } from "@/theme/icons";
import { useTokens } from "@/theme/useTokens";
import { Checkbox } from "@/ui/Checkbox";
import { FormField } from "@/ui/FormField";
import { ModalActions } from "@/ui/ModalActions";
import { ModalFrame } from "@/ui/ModalFrame";

/**
 * Renders the New Branch modal.
 *
 * The name field is a native single-line input, so typing and Enter submission stay OpenTUI's
 * behavior. The start point is read-only text: `HEAD` for the current tip, or the selected commit
 * when the graph supplies one. The checkout checkbox defaults on, and Create submits one atomic
 * create-and-checkout through the owning hook. Validation uses the shared `isValidBranchName` git
 * rules, so the same names are accepted here, in Create Local Branch, and in New Worktree; a name
 * that already exists in the snapshot's local branch list is refused inline. An unavailable
 * `branch.create` (for example "no commits yet") keeps Create visible with its dim reason instead
 * of hiding it. The padded layout fits its content, growing for validation and availability
 * messages. After a failed submission, validation follows edits so corrected names clear the error.
 *
 * Create and Cancel are footer actions with mouse activation; Enter inside the field submits and
 * `overlay.close` on Esc cancels. The footer keeps Create focused by default because creating a
 * branch is not destructive.
 *
 * @param props - Field id, start point, existing branch names, availability reason, and callbacks.
 * @returns The composed modal.
 */
export function NewBranchModal(props: {
  readonly nameFieldId: string;
  readonly startPointLabel: string;
  readonly existingBranchNames: readonly string[];
  readonly blockedReason: string | null;
  readonly onClose: () => void;
  readonly onCreate: (input: { readonly name: string; readonly checkout: boolean }) => void;
}): ReactNode {
  const tokens = useTokens();
  const [name, setName] = useState("");
  const [checkout, setCheckout] = useState(true);
  const [attempted, setAttempted] = useState(false);
  const error = attempted ? validateBranchName(name, props.existingBranchNames) : null;
  const [focusedAction, setFocusedAction] = useState<"create" | "cancel">("create");
  const blocked = props.blockedReason !== null;

  /** Validates the name and submits the create form when it is usable. */
  const submit = useCallback((): void => {
    setAttempted(true);

    if (validateBranchName(name, props.existingBranchNames) !== null) {
      return;
    }

    if (props.blockedReason !== null) {
      return;
    }

    props.onCreate({ name, checkout });
  }, [checkout, name, props]);

  /** Records the typed branch name. */
  const changeName = useCallback((value: string): void => {
    setName(value);
  }, []);

  useAction("nav.activate", { scope: "overlay" }, () => {
    if (focusedAction === "cancel") {
      props.onClose();

      return;
    }

    submit();
  });
  useAction("nav.left", { scope: "overlay" }, () => {
    setFocusedAction("cancel");
  });
  useAction("nav.right", { scope: "overlay" }, () => {
    setFocusedAction("create");
  });
  useAction("form.submit", { scope: "overlay" }, submit);

  return (
    <ModalFrame title="New branch" width={NEW_BRANCH_MODAL_WIDTH}>
      <FormField
        id={props.nameFieldId}
        label="Branch name"
        placeholder="feature/my-branch"
        value={name}
        onInput={changeName}
        onSubmit={submit}
        error={error ?? undefined}
      />
      <box flexDirection="column" flexShrink={0}>
        <text fg={tokens.muted} wrapMode="none">
          {`Start point: ${props.startPointLabel}`}
        </text>
        <Checkbox
          id={NEW_BRANCH_CHECKOUT_ID}
          label="Check out after creating"
          checked={checkout}
          onPress={() => {
            setCheckout((current) => !current);
          }}
        />
        {props.blockedReason === null ? null : (
          <text fg={tokens.dim} wrapMode="word">
            {`${ICONS.warning} ${props.blockedReason}`}
          </text>
        )}
      </box>
      <ModalActions
        actions={[
          {
            id: NEW_BRANCH_CREATE_ID,
            label: "Create",
            focused: focusedAction === "create",
            disabled: blocked,
            reason: props.blockedReason ?? undefined,
            onPress: submit,
          },
          {
            id: NEW_BRANCH_CANCEL_ID,
            label: "Cancel",
            focused: focusedAction === "cancel",
            onPress: props.onClose,
          },
        ]}
      />
    </ModalFrame>
  );
}

/**
 * Validates a branch name before it reaches git.
 *
 * The shared `isValidBranchName` owns every `git check-ref-format --branch` rule, including the
 * reserved `HEAD` name and a `.lock` component at any depth. The duplicate check runs after it, so
 * the inline error names an existing local branch instead of the generic ref rule.
 *
 * @param name - Candidate branch name as typed.
 * @param existingBranchNames - Local branches in the current snapshot.
 * @returns The inline error text, or null when the name is usable.
 */
function validateBranchName(name: string, existingBranchNames: readonly string[]): string | null {
  if (name.length === 0) {
    return "Enter a branch name";
  }

  if (!isValidBranchName(name)) {
    return "Branch name is not a valid git ref";
  }

  return existingBranchNames.includes(name) ? "A local branch with this name already exists" : null;
}
