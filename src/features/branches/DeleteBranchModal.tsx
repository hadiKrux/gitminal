import { useTerminalDimensions } from "@opentui/react";
import { type ReactNode, useCallback, useState } from "react";
import { useAction } from "@/app/hooks/useAction";
import { useFocusState } from "@/app/hooks/useFocusState";
import { useModalControlCycle } from "@/app/hooks/useModalControlCycle";
import type {
  ModalControlResolution,
  ModalHorizontalInput,
} from "@/app/hooks/useModalControlCycle.types";
import { useRepository } from "@/app/hooks/useRepository";
import type { BranchRecord } from "@/domain/git/git.types";
import {
  DELETE_BRANCH_CONTROL_ORDER,
  DELETE_BRANCH_MERGED_CONTROL_ORDER,
  DELETE_BRANCH_SCOPE_ID,
  DELETE_BRANCH_SCOPE_LOCAL,
  DELETE_BRANCH_SCOPE_LOCAL_REMOTE,
} from "@/features/branches/DeleteBranchModal.constants";
import type { DeleteControl, DeleteScope } from "@/features/branches/DeleteBranchModal.types";
import { DeleteBranchModalBody } from "@/features/branches/DeleteBranchModalBody";
import {
  readDeleteBranchCommitBudget,
  readDeleteBranchLayout,
} from "@/features/branches/deleteBranch.layout";
import {
  readAcknowledgementLine,
  readBehindWarning,
  readDeleteBranchBlockingReason,
  readDeleteBranchConfirmLabel,
  readDeleteBranchForceState,
  readDeleteBranchGates,
} from "@/features/branches/deleteBranch.risk";
import { useDeleteBranchRisk } from "@/features/branches/useDeleteBranchRisk";
import { MODAL_FRAME_ID } from "@/ui/ModalFrame.constants";

/**
 * Renders the Delete Branch modal.
 *
 * The modal always presents both scopes. The local-and-remote option describes the resolved remote
 * branch, or the reason it is unavailable, in the same order the feature documents: the configured
 * upstream first, then `origin/<branch>` when that remote-tracking ref exists. When the remote scope
 * is unavailable the body states that only the local branch can be deleted. The scope select is the
 * default focus so Up and Down change the scope immediately, the confirm label names the exact scope,
 * and the confirm action is disabled with the availability reason for the current branch or a branch
 * checked out in another worktree. Delete is never the default focus.
 *
 * Merge state is read lazily when the modal opens, against `<upstream-or-HEAD>`, so the snapshot
 * does not pay a merged read per branch. The at-risk list names each commit by short id and a
 * truncated subject, inside a bounded scrollbox; the confirm action cannot run until the
 * acknowledgement is checked. An unreadable read keeps the force path available with an unknown
 * merge state, because a failed read must never silently remove it.
 *
 * This component is the controller: it owns the risk read, the force gate, the keyboard cycle, and
 * the layout budget, and hands the resolved values to `DeleteBranchModalBody` for rendering.
 *
 * @param props - Selected branch, availability reason, remote resolution, and close and delete callbacks.
 * @returns The composed modal.
 */
export function DeleteBranchModal(props: {
  readonly branch: BranchRecord;
  readonly blockedReason: string | null;
  readonly remote: { readonly remote: string; readonly branch: string } | null;
  readonly remoteReason: string | null;
  readonly onClose: () => void;
  readonly onDelete: (input: { readonly scope: DeleteScope; readonly force: boolean }) => void;
}): ReactNode {
  const repository = useRepository();
  const { focusRenderable } = useFocusState();
  const dimensions = useTerminalDimensions();
  const [scope, setScope] = useState<DeleteScope>(DELETE_BRANCH_SCOPE_LOCAL);
  const [force, setForce] = useState(false);
  const risk = useDeleteBranchRisk(props.branch.name, repository.readBranchRisk);
  const forceState = readDeleteBranchForceState(risk);
  const budget = readDeleteBranchCommitBudget(risk);
  const layout = readDeleteBranchLayout({
    terminalWidth: dimensions.width,
    terminalHeight: dimensions.height,
    commitCount: budget.commitCount,
    hasMore: budget.hasMore,
  });
  const controlOrder = forceState.requiresAcknowledgement
    ? DELETE_BRANCH_CONTROL_ORDER
    : DELETE_BRANCH_MERGED_CONTROL_ORDER;
  const cycle = useModalControlCycle<DeleteControl>({
    order: controlOrder,
    initial: "scope",
    onHorizontal: readHorizontalResolution,
    onControlChange: (next) => {
      focusRenderable(next === "scope" ? DELETE_BRANCH_SCOPE_ID : MODAL_FRAME_ID);
    },
  });
  const remoteBlocked = scope === DELETE_BRANCH_SCOPE_LOCAL_REMOTE && props.remote === null;
  const blockedReason = readDeleteBranchBlockingReason({
    branchReason: props.blockedReason,
    remoteBlocked,
    remoteReason: props.remoteReason,
  });
  const gates = readDeleteBranchGates({ risk, force, blockedReason });

  /** Runs the confirm action when every gate allows it. */
  const confirm = useCallback((): void => {
    if (gates.confirmDisabledReason !== null) {
      return;
    }

    props.onDelete({
      scope,
      force: forceState.requiresAcknowledgement ? force : false,
    });
  }, [force, forceState.requiresAcknowledgement, gates.confirmDisabledReason, props, scope]);

  /** Runs the focused control. */
  const activate = useCallback((): void => {
    activateControl({
      control: cycle.control,
      focusScope: () => {
        focusRenderable(DELETE_BRANCH_SCOPE_ID);
      },
      toggleForce: () => {
        setForce((current) => !current);
      },
      onCancel: props.onClose,
      onConfirm: confirm,
    });
  }, [confirm, cycle.control, focusRenderable, props.onClose]);

  /** Applies a scope value reported by native navigation. */
  const selectScope = useCallback((value: string): void => {
    setScope(readScope(value));
  }, []);

  /** Applies a confirmed scope value and moves focus to the primary action. */
  const confirmScope = useCallback(
    (value: string): void => {
      setScope(readScope(value));
      focusRenderable(MODAL_FRAME_ID);
      cycle.focusControl("confirm");
    },
    [cycle, focusRenderable],
  );

  useAction("nav.activate", { scope: "overlay" }, activate);
  useAction("form.submit", { scope: "overlay" }, confirm);

  return (
    <DeleteBranchModalBody
      branch={props.branch}
      scope={scope}
      force={force}
      control={cycle.control}
      risk={risk}
      layout={layout}
      remote={props.remote}
      remoteReason={props.remoteReason}
      remoteBlocked={remoteBlocked}
      confirmLabel={readDeleteBranchConfirmLabel(scope)}
      confirmDisabledReason={gates.confirmDisabledReason}
      acknowledgementLine={readAcknowledgementLine(risk)}
      showForceControl={forceState.requiresAcknowledgement}
      behindWarning={readBehindWarning({ scope, behind: props.branch.behind })}
      scopeFocused={cycle.control === "scope"}
      onScopeChange={selectScope}
      onScopeSelect={confirmScope}
      onToggleForce={() => {
        setForce((current) => !current);
      }}
      onConfirm={confirm}
      onClose={props.onClose}
    />
  );
}

/**
 * Reads one raw select value as a delete scope.
 *
 * @param value - Raw value reported by the scope select.
 * @returns The matching scope, with local as the safe fallback.
 */
function readScope(value: string): DeleteScope {
  return value === DELETE_BRANCH_SCOPE_LOCAL_REMOTE
    ? DELETE_BRANCH_SCOPE_LOCAL_REMOTE
    : DELETE_BRANCH_SCOPE_LOCAL;
}

/**
 * Applies the modal's left and right rule.
 *
 * Right always focuses confirm; left returns from confirm to Cancel and leaves every other control
 * where it is. This preserves the per-modal rule the extracted cycle must not guess.
 *
 * @param input - Focused control and requested direction.
 * @returns The control to focus, or a no-op resolution.
 */
function readHorizontalResolution(
  input: ModalHorizontalInput<DeleteControl>,
): ModalControlResolution<DeleteControl> {
  if (input.direction === "right") {
    return { kind: "focus", control: "confirm" };
  }

  return input.control === "confirm" ? { kind: "focus", control: "cancel" } : { kind: "none" };
}

/**
 * Runs the focused modal control.
 *
 * @param input - Focused control and the four control handlers.
 */
function activateControl(input: {
  readonly control: DeleteControl;
  readonly focusScope: () => void;
  readonly toggleForce: () => void;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}): void {
  switch (input.control) {
    case "scope":
      input.focusScope();

      return;
    case "force":
      input.toggleForce();

      return;
    case "cancel":
      input.onCancel();

      return;
    case "confirm":
      input.onConfirm();
  }
}
