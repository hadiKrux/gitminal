import type { ReactNode } from "react";
import type { BranchRecord } from "@/domain/git/git.types";
import {
  DELETE_BRANCH_CANCEL_ID,
  DELETE_BRANCH_CONFIRM_ID,
  DELETE_BRANCH_FORCE_ID,
  DELETE_BRANCH_MODAL_WIDTH,
  DELETE_BRANCH_SCOPE_ID,
  DELETE_BRANCH_SCOPE_LOCAL,
  DELETE_BRANCH_SCOPE_LOCAL_REMOTE,
} from "@/features/branches/DeleteBranchModal.constants";
import type {
  BranchRiskState,
  DeleteBranchLayout,
  DeleteControl,
  DeleteScope,
} from "@/features/branches/DeleteBranchModal.types";
import { DeleteBranchRiskSection } from "@/features/branches/DeleteBranchRiskSection";
import { readDeleteBranchFooterLabels } from "@/features/branches/deleteBranch.layout";
import { ICONS } from "@/theme/icons";
import { useTokens } from "@/theme/useTokens";
import { Checkbox } from "@/ui/Checkbox";
import { ModalActions } from "@/ui/ModalActions";
import { ModalFrame } from "@/ui/ModalFrame";
import { SelectField } from "@/ui/SelectField";
import { TruncatedText } from "@/ui/TruncatedText";

/**
 * Renders the Delete Branch modal body from a resolved view model.
 *
 * The controller owns the risk read, the force gate, the keyboard cycle, and the layout budgets;
 * this component only lays them out. Every dynamic line is truncated to the modal content width so
 * it occupies exactly one row, and it always keeps the force control, the acknowledgement line, the
 * disabled reason, and the footer below the bounded at-risk scrollbox. A long or capped commit list,
 * a long branch name, or a disabled reason therefore cannot push the destructive controls out of the
 * frame.
 *
 * @param props - Resolved branch, scope, risk, gate, and callback values.
 * @returns The composed modal.
 */
export function DeleteBranchModalBody(props: {
  readonly branch: BranchRecord;
  readonly scope: DeleteScope;
  readonly force: boolean;
  readonly control: DeleteControl;
  readonly risk: BranchRiskState;
  readonly layout: DeleteBranchLayout;
  readonly remote: { readonly remote: string; readonly branch: string } | null;
  readonly remoteReason: string | null;
  readonly remoteBlocked: boolean;
  readonly confirmLabel: string;
  readonly confirmDisabledReason: string | null;
  readonly acknowledgementLine: string | null;
  readonly showForceControl: boolean;
  readonly behindWarning: string | null;
  readonly scopeFocused: boolean;
  readonly onScopeChange: (value: string) => void;
  readonly onScopeSelect: (value: string) => void;
  readonly onToggleForce: () => void;
  readonly onConfirm: () => void;
  readonly onClose: () => void;
}): ReactNode {
  const tokens = useTokens();
  const contentWidth = props.layout.contentWidth;
  const footer = readDeleteBranchFooterLabels({
    contentWidth,
    confirmLabel: props.confirmLabel,
    cancelLabel: "Cancel",
  });

  return (
    <ModalFrame
      title="Delete branch"
      width={DELETE_BRANCH_MODAL_WIDTH}
      height={props.layout.modalHeight}
    >
      <TruncatedText
        text={`Branch: ${props.branch.name}`}
        maxWidth={contentWidth}
        fg={tokens.text}
      />
      <SelectField
        id={DELETE_BRANCH_SCOPE_ID}
        options={readScopeOptions(props.remote, props.remoteReason)}
        selectedIndex={props.scope === DELETE_BRANCH_SCOPE_LOCAL_REMOTE ? 1 : 0}
        focused={props.scopeFocused}
        height={4}
        onChange={props.onScopeChange}
        onSelect={props.onScopeSelect}
      />
      <TruncatedText
        text={readRemoteLine(props.remote, props.remoteReason)}
        maxWidth={contentWidth}
        fg={props.remoteBlocked ? tokens.warning : tokens.muted}
      />
      {props.behindWarning === null ? null : (
        <TruncatedText text={props.behindWarning} maxWidth={contentWidth} fg={tokens.warning} />
      )}
      <DeleteBranchRiskSection
        risk={props.risk}
        branchName={props.branch.name}
        listHeight={props.layout.listHeight}
        subjectWidth={props.layout.subjectWidth}
        contentWidth={contentWidth}
      />
      {props.showForceControl ? (
        <Checkbox
          id={DELETE_BRANCH_FORCE_ID}
          label="Force delete (branch -D) for an unmerged branch"
          checked={props.force}
          focused={props.control === "force"}
          onPress={props.onToggleForce}
        />
      ) : null}
      {props.acknowledgementLine === null ? null : (
        <TruncatedText text={props.acknowledgementLine} maxWidth={contentWidth} fg={tokens.dim} />
      )}
      {props.confirmDisabledReason === null ? null : (
        <TruncatedText
          text={`${ICONS.warning} ${props.confirmDisabledReason}`}
          maxWidth={contentWidth}
          fg={tokens.dim}
        />
      )}
      <box flexGrow={1} />
      <ModalActions
        actions={[
          {
            id: DELETE_BRANCH_CONFIRM_ID,
            label: footer.confirmLabel,
            focused: props.control === "confirm",
            disabled: props.confirmDisabledReason !== null,
            onPress: props.onConfirm,
          },
          {
            id: DELETE_BRANCH_CANCEL_ID,
            label: footer.cancelLabel,
            focused: props.control === "cancel",
            onPress: props.onClose,
          },
        ]}
      />
    </ModalFrame>
  );
}

/**
 * Builds the two scope options with their remote description.
 *
 * @param remote - Resolved remote branch, or null when nothing resolves.
 * @param remoteReason - Reason the remote scope is unavailable, or null.
 * @returns The labelled options in display order.
 */
function readScopeOptions(
  remote: { readonly remote: string; readonly branch: string } | null,
  remoteReason: string | null,
): readonly { readonly label: string; readonly description?: string; readonly value: string }[] {
  return [
    { label: "Delete local branch only", value: DELETE_BRANCH_SCOPE_LOCAL },
    {
      label: "Delete local and remote branch",
      description: readRemoteDescription(remote, remoteReason),
      value: DELETE_BRANCH_SCOPE_LOCAL_REMOTE,
    },
  ];
}

/**
 * Reads the one-line description of the remote half.
 *
 * @param remote - Resolved remote branch, or null.
 * @param remoteReason - Reason the remote scope is unavailable, or null.
 * @returns The remote ref, or the unavailable reason.
 */
function readRemoteDescription(
  remote: { readonly remote: string; readonly branch: string } | null,
  remoteReason: string | null,
): string {
  if (remote !== null) {
    return `${remote.remote}/${remote.branch}`;
  }

  return remoteReason ?? "no matching remote branch";
}

/**
 * Reads the resolved-remote line shown above the warning.
 *
 * @param remote - Resolved remote branch, or null.
 * @param remoteReason - Reason the remote scope is unavailable, or null.
 * @returns The resolved remote branch or the disabled reason.
 */
function readRemoteLine(
  remote: { readonly remote: string; readonly branch: string } | null,
  remoteReason: string | null,
): string {
  if (remote !== null) {
    return `Remote branch: ${remote.remote}/${remote.branch}`;
  }

  return `Remote branch: ${remoteReason ?? "no matching remote branch"}; only the local branch can be deleted`;
}
