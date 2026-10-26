/**
 * The exact confirm labels from F-15.
 *
 * This is the single source for destructive confirmation wording. The overlay provider validates a
 * confirmation when it is created, `ConfirmModal` renders the labelled warning when a caller passes
 * a label outside this table, and the top bar reads its force-push labels from here, so the product
 * contract cannot drift between surfaces.
 */
export const CONFIRM_LABELS = Object.freeze({
  discardChanges: "Discard changes",
  deleteUntrackedFile: "Delete untracked file",
  deleteLocalBranch: "Delete local branch",
  deleteLocalAndRemoteBranch: "Delete local and remote branch",
  dropStash: "Drop stash",
  deleteTag: "Delete tag",
  deleteWorktree: "Delete worktree",
  forcePushSafely: "Force push safely",
  overwriteRemote: "Overwrite remote",
});

/** Warning shown when a destructive confirmation uses a label outside the F-15 table. */
export const CONFIRM_LABEL_WARNING =
  "Destructive action does not use an exact F-15 confirmation label.";

/** Short reason rendered on the disabled primary action that uses a non-exact destructive label. */
export const CONFIRM_LABEL_DISABLED_REASON = "exact F-15 label required";

/**
 * Builds the exact bulk label for deleting all untracked files, naming the count.
 *
 * @param count - Number of untracked files the confirmation covers.
 * @returns The count-naming label from the F-11 untracked-delete flow.
 */
export function formatDeleteAllUntrackedLabel(count: number): string {
  const safeCount = Math.max(1, Math.trunc(count));

  return `Delete ${safeCount} untracked ${safeCount === 1 ? "file" : "files"}`;
}

/**
 * Reports whether a label is one of the exact F-15 destructive labels.
 *
 * The bulk untracked delete label names its count, so it is accepted by its documented shape rather
 * than as one fixed string.
 *
 * @param label - Candidate confirm label.
 * @returns True when the label belongs to the destructive label table.
 */
export function isExactConfirmLabel(label: string): boolean {
  const trimmed = label.trim();
  const exactLabels: readonly string[] = Object.values(CONFIRM_LABELS);

  return exactLabels.includes(trimmed) || isBulkUntrackedLabel(trimmed);
}

/**
 * Reports whether one label names a bulk untracked deletion with a positive count.
 *
 * @param label - Trimmed candidate label.
 * @returns True when the label matches `Delete <N> untracked file(s)`.
 */
function isBulkUntrackedLabel(label: string): boolean {
  return /^Delete [1-9]\d* untracked (?:file|files)$/.test(label);
}

/**
 * Reads the visible warning for a confirmation that is missing a specific label.
 *
 * A destructive confirmation must name what it will change. The caller is not rejected with an
 * exception during render; the confirmation opens with the supplied label and this warning, and the
 * primary action is disabled with `CONFIRM_LABEL_DISABLED_REASON` so the generic action cannot run.
 *
 * @param destructive - Whether the confirmation can lose data.
 * @param confirmLabel - Label supplied by the caller.
 * @returns The warning text, or null when the label is acceptable.
 */
export function readConfirmLabelWarning(destructive: boolean, confirmLabel: string): string | null {
  if (!destructive || isExactConfirmLabel(confirmLabel)) {
    return null;
  }

  return CONFIRM_LABEL_WARNING;
}
