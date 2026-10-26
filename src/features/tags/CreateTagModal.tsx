import type { ReactNode } from "react";
import {
  CREATE_TAG_HEIGHT,
  CREATE_TAG_MESSAGE_INPUT_ID,
  CREATE_TAG_NAME_INPUT_ID,
  CREATE_TAG_PUSH_CHECKBOX_ID,
  CREATE_TAG_TITLE,
  CREATE_TAG_WIDTH,
} from "@/features/tags/CreateTagModal.constants";
import type { CreateTagModalProps } from "@/features/tags/CreateTagModal.types";
import { useCreateTagModal } from "@/features/tags/useCreateTagModal";
import { useTokens } from "@/theme/useTokens";
import { Checkbox } from "@/ui/Checkbox";
import { FormField } from "@/ui/FormField";
import { ModalActions } from "@/ui/ModalActions";
import { ModalFrame } from "@/ui/ModalFrame";
/**
 * Renders the Create Tag modal.
 *
 * The name field validates inline: an empty name, whitespace, an unsafe tag name, an existing local
 * name, and a name known on a remote are all refused before a command is requested. The target is
 * read-only and comes from the right-pane selection when it is a commit, otherwise `HEAD`. An empty
 * message requests a lightweight tag and a non-empty message requests an annotated tag. The optional
 * push names the remote that will receive the tag and is off by default.
 *
 * `useCreateTagModal` owns the form state and validation; the modal renders it and dispatches only
 * `runCommand({ commandId: "tag.create", ... })`, so it never calls a domain executor or git. It
 * closes itself through the render context supplied by the overlay host.
 *
 * @param props - Close callback supplied by the overlay host.
 * @returns The create-tag modal.
 */
export function CreateTagModal(props: CreateTagModalProps): ReactNode {
  const tokens = useTokens();
  const form = useCreateTagModal(props);

  return (
    <ModalFrame title={CREATE_TAG_TITLE} width={CREATE_TAG_WIDTH} height={CREATE_TAG_HEIGHT}>
      <FormField
        label="Tag name"
        id={CREATE_TAG_NAME_INPUT_ID}
        value={form.name}
        placeholder="v1.0.0"
        onInput={form.handleNameInput}
        onSubmit={form.submit}
        error={form.error ?? undefined}
      />
      <text fg={tokens.muted} wrapMode="none">
        {form.targetLabel}
      </text>
      <FormField label="Message (optional)">
        <textarea
          ref={form.messageRef}
          id={CREATE_TAG_MESSAGE_INPUT_ID}
          height={3}
          placeholder="empty creates a lightweight tag"
          backgroundColor={tokens.surface}
          focusedBackgroundColor={tokens.surface}
          textColor={tokens.text}
          focusedTextColor={tokens.text}
          placeholderColor={tokens.dim}
        />
      </FormField>
      <Checkbox
        id={CREATE_TAG_PUSH_CHECKBOX_ID}
        label={form.pushLabel}
        checked={form.pushAfterCreate}
        disabled={form.pushDisabled}
        onPress={form.togglePush}
      />
      <box flexGrow={1} />
      <ModalActions actions={form.actions} />
    </ModalFrame>
  );
}
