import type { ReactNode } from "react";
import {
  CREATE_STASH_HEIGHT,
  CREATE_STASH_INCLUDE_CHECKBOX_ID,
  CREATE_STASH_TITLE,
  CREATE_STASH_WIDTH,
} from "@/features/stashes/CreateStashModal.constants";
import type { CreateStashModalProps } from "@/features/stashes/CreateStashModal.types";
import { useCreateStashModal } from "@/features/stashes/useCreateStashModal";
import { ICONS } from "@/theme/icons";
import { useTokens } from "@/theme/useTokens";
import { Checkbox } from "@/ui/Checkbox";
import { FormField } from "@/ui/FormField";
import { ModalActions } from "@/ui/ModalActions";
import { ModalFrame } from "@/ui/ModalFrame";
/**
 * Renders the Create Stash modal.
 *
 * The message is required and starts from the deterministic prefill supplied by the panel. The
 * Include untracked files checkbox starts from `stash.includeUntrackedByDefault`; changing it
 * re-evaluates `getStashCreateAvailability`, so the confirm shows the exact disabled reason for an
 * empty repository, a clean working tree, or only-untracked changes until the checkbox is on.
 *
 * The component owns rendering only. `useCreateStashModal` owns the form state and footer action
 * cycle, and a valid submit calls `onCreate`; the panel runs the command through
 * `useCommandRunner`. Closing happens through the overlay render context supplied by the host.
 *
 * @param props - Message field id, prefill, checkbox default, close callback, and submit callback.
 * @returns The create-stash modal.
 */
export function CreateStashModal(props: CreateStashModalProps): ReactNode {
  const tokens = useTokens();
  const form = useCreateStashModal(props);

  return (
    <ModalFrame title={CREATE_STASH_TITLE} width={CREATE_STASH_WIDTH} height={CREATE_STASH_HEIGHT}>
      <text fg={tokens.muted} wrapMode="word">
        The message identifies this stash in the list and in confirmations.
      </text>
      {form.availabilityText === null ? null : (
        <text fg={tokens.warning} wrapMode="word">
          {`${ICONS.warning} ${form.availabilityText}`}
        </text>
      )}
      <FormField
        label="Stash message"
        id={props.messageFieldId}
        value={form.message}
        placeholder="what changed"
        onInput={form.handleMessageInput}
        onSubmit={form.submit}
        error={form.error ?? undefined}
      />
      <Checkbox
        id={CREATE_STASH_INCLUDE_CHECKBOX_ID}
        label="Include untracked files"
        checked={form.includeUntracked}
        onPress={form.toggleUntracked}
      />
      <box flexGrow={1} />
      <ModalActions actions={form.actions} />
    </ModalFrame>
  );
}
