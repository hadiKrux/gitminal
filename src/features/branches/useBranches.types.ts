import type { ReactNode } from "react";
import type { useRepository } from "@/app/hooks/useRepository";
import type { BranchRecord } from "@/domain/git/git.types";

/** Branch target used by every availability call for the selected row. */
export type BranchTarget = { readonly kind: "branch"; readonly name: string };

/** Resolved remote half of a delete and the reason it is unavailable. */
export interface DeleteRemoteResolution {
  /** Remote and branch a local-and-remote delete would remove, or null. */
  readonly remote: { readonly remote: string; readonly branch: string } | null;
  /** Display reason the remote scope is unavailable, or null when it resolves. */
  readonly reason: string | null;
}

/** Shape of the repository context the branches hooks read. */
export type BranchesRepository = ReturnType<typeof useRepository>;

/** One rendered branch row: the stable row id plus its record. */
export interface BranchRowItem {
  /** Stable row id, equal to the branch name. */
  readonly id: string;
  /** Branch record behind the row. */
  readonly branch: BranchRecord;
}

/** Input the panel hands to the New Branch modal renderer. */
export interface NewBranchModalInput {
  /** Stable id of the name input. */
  readonly nameFieldId: string;
  /** Read-only start point label. */
  readonly startPointLabel: string;
  /** Local branch names from the snapshot, for the duplicate check. */
  readonly existingBranchNames: readonly string[];
  /** Availability reason that blocks creation, or null. */
  readonly blockedReason: string | null;
  /** Closes the modal. */
  readonly onClose: () => void;
  /** Submits the create form. */
  readonly onCreate: (input: { readonly name: string; readonly checkout: boolean }) => void;
}

/** Input the panel hands to the Delete Branch modal renderer. */
export interface DeleteBranchModalInput {
  /** Branch being deleted. */
  readonly branch: BranchRecord;
  /** Availability reason that blocks deletion, or null. */
  readonly blockedReason: string | null;
  /** Resolved remote half, or null when the scope is unavailable. */
  readonly remote: { readonly remote: string; readonly branch: string } | null;
  /** Reason the remote scope is unavailable, or null when it resolves. */
  readonly remoteReason: string | null;
  /** Closes the modal. */
  readonly onClose: () => void;
  /** Submits the delete form. */
  readonly onDelete: (input: {
    readonly scope: "local" | "local-remote";
    readonly force: boolean;
  }) => void;
}

/** Renderers the branches panel supplies to the hook. */
export interface UseBranchesOptions {
  /** Renders the New Branch modal from the panel state. */
  readonly renderNewBranchModal: (input: NewBranchModalInput) => ReactNode;
  /** Renders the Delete Branch modal from the panel state. */
  readonly renderDeleteBranchModal: (input: DeleteBranchModalInput) => ReactNode;
}

/** Rows and cursor state owned by `useBranchRows`. */
export interface BranchRowsHandle {
  /** Rendered rows after the soft cap. */
  readonly items: readonly BranchRowItem[];
  /** Full branch count before the cap. */
  readonly totalCount: number;
  /** Rows omitted by the soft cap. */
  readonly hiddenCount: number;
  /** Renderable id of the selected row, or null for an empty list. */
  readonly activeRowId: string | null;
  /** Selected branch record, or null for an empty list. */
  readonly selected: BranchRecord | null;
  /** Selected row index. */
  readonly selectedIndex: number;
  /** Selects the row at one index and records the click for double-click detection. */
  handleRowClick(index: number): void;
  /** Selects one row id once it exists, used after a successful create. */
  selectId(id: string): void;
}

/** Action and availability state owned by `useBranchActions`. */
export interface BranchActionsHandle {
  /** Availability reason for `branch.create`, or null. */
  readonly createReason: string | null;
  /**
   * Availability reason for deleting the selected branch, or null when delete is available or the
   * current branch is selected. The Delete modal states the current-branch reason on demand.
   */
  readonly selectedDeleteReason: string | null;
  /** Opens the New Branch modal. */
  readonly openCreate: () => void;
  /** Opens the Delete Branch modal for the selected row. */
  readonly openDelete: () => void;
  /** Refreshes the repository after a failed read. */
  readonly retry: () => void;
}

/** Public handle returned by `useBranches`. */
export interface BranchesHandle extends Omit<BranchRowsHandle, "selectId">, BranchActionsHandle {
  /** True while the first read is in flight. */
  readonly loading: boolean;
  /** Read error for the branch list or the whole refresh, or null. */
  readonly error: string | null;
  /** True when the repository is readable and holds no branches. */
  readonly empty: boolean;
  /** Hint shown with the empty state. */
  readonly emptyHint: string;
  /** True when the branches region owns native focus. */
  readonly focused: boolean;
}
