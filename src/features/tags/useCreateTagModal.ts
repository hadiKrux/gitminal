import type { TextareaRenderable } from "@opentui/core";
import { useCallback, useRef, useState } from "react";
import { useCommandRunner } from "@/app/hooks/useCommandRunner";
import { useFooterActionCycle } from "@/app/hooks/useFooterActionCycle";
import { useRepository } from "@/app/hooks/useRepository";
import { describeCommandReason } from "@/domain/commands/commands.reasons";
import { isSafeGitName } from "@/domain/git/git.remotes";
import type { TagRecord } from "@/domain/git/git.types";
import type { RemoteTagChecks } from "@/domain/repository/repository.types";
import {
  CREATE_TAG_CANCEL_ACTION_INDEX,
  CREATE_TAG_CANCEL_BUTTON_ID,
  CREATE_TAG_CREATE_ACTION_INDEX,
  CREATE_TAG_CREATE_BUTTON_ID,
  CREATE_TAG_SHORT_OID_LENGTH,
} from "@/features/tags/CreateTagModal.constants";
import type {
  CreateTagFormHandle,
  CreateTagModalProps,
} from "@/features/tags/CreateTagModal.types";
import { resolveDefaultRemote } from "@/features/tags/useTags";
import type { ButtonProps } from "@/ui/Button.types";

/**
 * Owns the Create Tag form state, validation, and footer action cycle.
 *
 * The name validates against local and remote tag knowledge before a command is requested. The
 * target is read-only and comes from the right-pane selection when it is a commit, otherwise
 * `HEAD`. An empty message requests a lightweight tag and a non-empty message requests an annotated
 * tag. The optional push names the remote that will receive the tag and is off by default.
 *
 * @param props - Overlay close callback.
 * @returns The form state and handlers consumed by the modal view.
 */
export function useCreateTagModal(props: CreateTagModalProps): CreateTagFormHandle {
  const repository = useRepository();
  const { runCommand } = useCommandRunner();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pushAfterCreate, setPushAfterCreate] = useState(false);
  const messageRef = useRef<TextareaRenderable | null>(null);
  const selection = repository.selection;
  const selectedOid = selection.kind === "commit" ? selection.oid : null;
  const target = selectedOid ?? "HEAD";
  const defaultRemote = resolveDefaultRemote(repository.snapshot);
  const hasRemote = defaultRemote.length > 0;

  /** Updates the name draft and clears a stale validation message. */
  const handleNameInput = useCallback((value: string): void => {
    setName(value);
    setError(null);
  }, []);

  /** Submits the form after validating the name against local and remote tag knowledge. */
  const submit = useCallback((): void => {
    const trimmed = name.trim();
    const nameError = readCreateTagError(
      trimmed,
      repository.snapshot?.tags ?? [],
      repository.remoteTagChecks,
    );

    if (nameError !== null) {
      setError(nameError);
      return;
    }

    const rawMessage = messageRef.current?.plainText ?? "";
    const message = rawMessage.trim().length === 0 ? "" : rawMessage;
    const push = pushAfterCreate && hasRemote;

    void runCommand({
      commandId: "tag.create",
      target: { kind: "none" },
      formValues: {
        name: trimmed,
        message,
        push: push ? "true" : "false",
        remote: defaultRemote,
        target,
      },
    }).catch(() => undefined);
    props.onClose();
  }, [defaultRemote, hasRemote, name, props, pushAfterCreate, repository, runCommand, target]);

  /** Owns the footer action cycle. */
  const footer = useFooterActionCycle({
    actionCount: 2,
    initialIndex: CREATE_TAG_CREATE_ACTION_INDEX,
    onActivate: (index) => {
      if (index === CREATE_TAG_CREATE_ACTION_INDEX) {
        submit();
        return;
      }

      props.onClose();
    },
  });

  /** Toggles the optional post-create push. */
  const togglePush = useCallback((): void => {
    setPushAfterCreate((current) => !current);
  }, []);

  return {
    name,
    error,
    pushAfterCreate: pushAfterCreate && hasRemote,
    pushDisabled: !hasRemote,
    targetLabel: readTargetLabel(selectedOid, repository.snapshot?.branch ?? null),
    pushLabel: readPushLabel(defaultRemote),
    messageRef,
    actions: buildActions({
      focusedAction: footer.focusedAction,
      onPress: submit,
      onCancel: props.onClose,
    }),
    handleNameInput,
    submit,
    togglePush,
  };
}

/**
 * Reads the inline validation message for a candidate tag name.
 *
 * A remote duplicate names the remote whose last successful read already advertises the tag. The
 * local duplicate uses the shared `tag already exists` wording.
 *
 * @param name - Trimmed candidate name.
 * @param tags - Local tags from the current snapshot.
 * @param checks - Last known tag names per configured remote.
 * @returns The error text, or null when the name may be created.
 */
function readCreateTagError(
  name: string,
  tags: readonly TagRecord[],
  checks: RemoteTagChecks,
): string | null {
  if (name.length === 0) {
    return "Enter a tag name";
  }

  if (/\s/.test(name)) {
    return "Tag names cannot contain whitespace";
  }

  if (!isSafeGitName(name)) {
    return "invalid tag name";
  }

  if (tags.some((tag) => tag.name === name)) {
    return describeCommandReason("tag-already-exists");
  }

  const remote = Object.keys(checks)
    .sort()
    .find((candidate) => checks[candidate]?.names.includes(name) === true);

  return remote === undefined ? null : `tag exists on ${remote}`;
}

/**
 * Builds the read-only target label.
 *
 * @param selectedOid - Selected commit id, or null when the selection is not a commit.
 * @param branch - Current branch name, or null when detached or unknown.
 * @returns The labeled target text.
 */
function readTargetLabel(selectedOid: string | null, branch: string | null): string {
  if (selectedOid !== null) {
    return `Target commit: ${selectedOid.slice(0, CREATE_TAG_SHORT_OID_LENGTH)} (selected commit)`;
  }

  return branch === null ? "Target commit: HEAD" : `Target commit: HEAD (${branch})`;
}

/**
 * Builds the checkbox label, naming the remote that would receive the tag.
 *
 * @param remote - Resolved default remote, or an empty string when none is configured.
 * @returns The checkbox label.
 */
function readPushLabel(remote: string): string {
  return remote.length === 0
    ? "Push to remote after creating (no remote)"
    : `Push to remote after creating (${remote})`;
}

/**
 * Builds the footer actions in display order.
 *
 * @param input - Focused action, name draft, and callbacks.
 * @returns The create and cancel actions with their focus state.
 */
function buildActions(input: {
  readonly focusedAction: number;
  readonly onPress: () => void;
  readonly onCancel: () => void;
}): readonly ButtonProps[] {
  return [
    {
      id: CREATE_TAG_CREATE_BUTTON_ID,
      label: "Create",
      focused: input.focusedAction === CREATE_TAG_CREATE_ACTION_INDEX,
      onPress: input.onPress,
    },
    {
      id: CREATE_TAG_CANCEL_BUTTON_ID,
      label: "Cancel",
      focused: input.focusedAction === CREATE_TAG_CANCEL_ACTION_INDEX,
      onPress: input.onCancel,
    },
  ];
}
