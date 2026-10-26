import type { BranchRiskCommit } from "@/domain/repository/repository.types";

/** One focusable control of the Delete Branch modal. */
export type DeleteControl = "scope" | "force" | "cancel" | "confirm";

/** Delete scope chosen in the Delete Branch modal. */
export type DeleteScope = "local" | "local-remote";

/** At-risk commit read state for the branch being deleted. */
export type BranchRiskState =
  | { readonly status: "loading" }
  | {
      readonly status: "ready";
      readonly commits: readonly BranchRiskCommit[];
      readonly merged: boolean | null;
      readonly hasMore: boolean;
      readonly error: string | null;
    };

/** Force controls the current risk read allows. */
export interface DeleteBranchForceState {
  /** True while the at-risk read is still in flight. */
  readonly loading: boolean;
  /** True when the user must acknowledge a force delete before confirming. */
  readonly requiresAcknowledgement: boolean;
}

/** Confirm gates derived from the risk read, the acknowledgement, and availability. */
export interface DeleteBranchGates {
  /** Reason confirm is disabled, or null when it may run. */
  readonly confirmDisabledReason: string | null;
}

/** One at-risk commit budget derived from the risk read. */
export interface DeleteBranchCommitBudget {
  /** Number of commits the read will display. */
  readonly commitCount: number;
  /** True when the read found more commits than it displays. */
  readonly hasMore: boolean;
}

/** Sizes the modal frame and the bounded at-risk list need. */
export interface DeleteBranchLayout {
  /** Requested modal height after the terminal clamp. */
  readonly modalHeight: number;
  /** Height of the at-risk scrollbox. */
  readonly listHeight: number;
  /** Columns kept for one commit subject. */
  readonly subjectWidth: number;
  /** Drawable columns inside the modal border. */
  readonly contentWidth: number;
}
