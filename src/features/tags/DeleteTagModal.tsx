import type { ReactNode } from "react";
import {
  DELETE_TAG_NOT_ON_REMOTE,
  DELETE_TAG_REMOTE_MAX_ROWS,
  DELETE_TAG_REMOTE_SELECT_ID,
  DELETE_TAG_SCOPE_SELECT_ID,
  DELETE_TAG_TITLE,
  DELETE_TAG_WIDTH,
} from "@/features/tags/DeleteTagModal.constants";
import type { DeleteTagModalProps } from "@/features/tags/DeleteTagModal.types";
import { useDeleteTagModal } from "@/features/tags/useDeleteTagModal";
import { ICONS } from "@/theme/icons";
import { useTokens } from "@/theme/useTokens";
import { ModalActions } from "@/ui/ModalActions";
import { ModalFrame } from "@/ui/ModalFrame";
import { SelectField } from "@/ui/SelectField";
/**
 * Renders the Delete Tag modal.
 *
 * The scope list offers local deletion for a tag that exists locally, local-and-remote deletion when
 * a remote contains it, and remote-only deletion only when the tag is absent locally. A remote scope
 * is unavailable with the reason "not on any remote" when no last successful check knows the tag,
 * and the primary action is disabled with the same reason. The remote picker appears only when more
 * than one remote contains the tag; a single remote is named as text so the app never guesses.
 *
 * The confirmation names the tag and the selected scope, starts with the scope select focused so Up
 * and Down change the scope immediately, and dispatches only
 * `runCommand({ commandId: "tag.delete", ... })`. Deleting a tag never deletes the commit it points
 * to. `useDeleteTagModal` owns the state and keyboard cycle; the scope and remote selects take native
 * focus while their control owns the keyboard, so Up and Down change the option. Enter on a select
 * moves to the next field or to the Delete action, and the Delete action is never the default focus.
 *
 * @param props - Merged tag row opened by the panel and the overlay close callback.
 * @returns The delete-tag modal.
 */
export function DeleteTagModal(props: DeleteTagModalProps): ReactNode {
  const tokens = useTokens();
  const modal = useDeleteTagModal(props);

  return (
    <ModalFrame title={DELETE_TAG_TITLE} width={DELETE_TAG_WIDTH}>
      <text fg={tokens.text} wrapMode="none">
        {`Tag: ${props.row.name}`}
      </text>
      <SelectField
        id={DELETE_TAG_SCOPE_SELECT_ID}
        options={modal.scopeOptions}
        selectedIndex={modal.scopeOptions.findIndex((option) => option.value === modal.scope)}
        focused={modal.control === "scope"}
        height={modal.scopeOptions.length * 2}
        onChange={modal.selectScope}
        onSelect={modal.confirmScope}
      />
      {modal.showRemotePicker ? (
        <SelectField
          id={DELETE_TAG_REMOTE_SELECT_ID}
          options={props.row.remotes.map((name) => ({ label: name, value: name }))}
          selectedIndex={Math.max(0, props.row.remotes.indexOf(modal.remote))}
          focused={modal.control === "remote"}
          height={Math.min(DELETE_TAG_REMOTE_MAX_ROWS, props.row.remotes.length * 2)}
          onChange={modal.selectRemote}
          onSelect={modal.confirmRemote}
        />
      ) : null}
      {modal.requiresRemote && props.row.remotes.length === 1 ? (
        <text fg={tokens.muted} wrapMode="none">
          {`Remote: ${props.row.remotes[0] ?? ""}`}
        </text>
      ) : null}
      {modal.remoteMissing ? (
        <text fg={tokens.warning} wrapMode="word">
          {`${ICONS.warning} ${DELETE_TAG_NOT_ON_REMOTE}`}
        </text>
      ) : (
        <text fg={tokens.muted} wrapMode="word">
          {modal.consequence}
        </text>
      )}
      <ModalActions actions={modal.actions} />
    </ModalFrame>
  );
}
