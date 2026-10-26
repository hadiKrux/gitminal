import { CONFIRM_LABELS } from "@/domain/commands/confirm.labels";
import { DELETE_BRANCH_SCOPE_LOCAL_REMOTE } from "@/features/branches/DeleteBranchModal.constants";
import type {
  BranchRiskState,
  DeleteBranchForceState,
  DeleteBranchGates,
  DeleteScope,
} from "@/features/branches/DeleteBranchModal.types";
import { ICONS } from "@/theme/icons";

/**
 * Reads the force controls the current risk read allows.
 *
 * A loading read offers no force control yet. A merged branch offers none because `git branch -d`
 * already succeeds. An unmerged branch with commits, and an unreadable branch whose merge state is
 * unknown, both offer the acknowledgement: a failed read must never silently drop the force path.
 *
 * @param risk - Current at-risk read state.
 * @returns The loading flag and whether the acknowledgement is required.
 */
export function readDeleteBranchForceState(risk: BranchRiskState): DeleteBranchForceState {
  if (risk.status === "loading") {
    return { loading: true, requiresAcknowledgement: false };
  }

  return { loading: false, requiresAcknowledgement: requiresForceAcknowledgement(risk) };
}

/**
 * Reports whether one ready risk read requires the force acknowledgement.
 *
 * @param risk - Ready risk state.
 * @returns True for an unmerged branch or an unreadable merge state.
 */
function requiresForceAcknowledgement(
  risk: Extract<BranchRiskState, { readonly status: "ready" }>,
): boolean {
  return risk.merged === null || risk.commits.length > 0;
}

/**
 * Reads the explanatory line under the force control.
 *
 * @param risk - Current at-risk read state.
 * @returns The line that explains the current confirm rule, or null while the read is loading.
 */
export function readAcknowledgementLine(risk: BranchRiskState): string | null {
  if (risk.status === "loading") {
    return null;
  }

  if (risk.merged === true) {
    return "The branch is merged; it deletes with branch -d.";
  }

  if (risk.error !== null) {
    return "The at-risk list could not be read; acknowledge to force branch -D and discard commits that may exist.";
  }

  if (risk.commits.length === 0) {
    return "No commits are at risk; the branch deletes with branch -d and force is submitted as false.";
  }

  return "Acknowledge to force branch -D and discard the commits listed above.";
}

/**
 * Reads the confirm-disable reason for the current gates.
 *
 * @param input - Blocking reason, loading flag, and acknowledgement state.
 * @returns The reason text, or null when confirm may run.
 */
function readConfirmDisabledReason(input: {
  readonly blockedReason: string | null;
  readonly loading: boolean;
  readonly acknowledgementMissing: boolean;
}): string | null {
  if (input.blockedReason !== null) {
    return input.blockedReason;
  }

  if (input.loading) {
    return "Reading commits at risk";
  }

  if (input.acknowledgementMissing) {
    return "Acknowledge the force delete to continue";
  }

  return null;
}

/**
 * Reads the acknowledgement gate for the current risk read and checkbox.
 *
 * @param input - Current risk state, checkbox value, and branch blocking reason.
 * @returns The acknowledgement state and the confirm-disable reason.
 */
export function readDeleteBranchGates(input: {
  readonly risk: BranchRiskState;
  readonly force: boolean;
  readonly blockedReason: string | null;
}): DeleteBranchGates {
  const forceState = readDeleteBranchForceState(input.risk);
  const acknowledgementMissing = forceState.requiresAcknowledgement && !input.force;

  return {
    confirmDisabledReason: readConfirmDisabledReason({
      blockedReason: input.blockedReason,
      loading: forceState.loading,
      acknowledgementMissing,
    }),
  };
}

/**
 * Combines the branch blocking reason with the remote-scope reason.
 *
 * @param input - Branch reason, whether the remote scope is blocked, and the remote reason.
 * @returns The reason that disables confirm, or null.
 */
export function readDeleteBranchBlockingReason(input: {
  readonly branchReason: string | null;
  readonly remoteBlocked: boolean;
  readonly remoteReason: string | null;
}): string | null {
  if (input.branchReason !== null) {
    return input.branchReason;
  }

  return input.remoteBlocked ? input.remoteReason : null;
}

/**
 * Reads the stronger behind-remote warning for the local-and-remote scope.
 *
 * @param input - Selected scope and how many remote commits are missing locally.
 * @returns The warning text, or null when the scope or count does not need it.
 */
export function readBehindWarning(input: {
  readonly scope: DeleteScope;
  readonly behind: number;
}): string | null {
  if (input.scope !== DELETE_BRANCH_SCOPE_LOCAL_REMOTE || input.behind <= 0) {
    return null;
  }

  return `${ICONS.warning} the remote branch has ${input.behind} commit(s) not present locally`;
}

/**
 * Reads the confirm label for the selected scope.
 *
 * @param scope - Selected delete scope.
 * @returns The label that names the exact scope.
 */
export function readDeleteBranchConfirmLabel(scope: DeleteScope): string {
  return scope === DELETE_BRANCH_SCOPE_LOCAL_REMOTE
    ? CONFIRM_LABELS.deleteLocalAndRemoteBranch
    : CONFIRM_LABELS.deleteLocalBranch;
}
