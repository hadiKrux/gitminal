import { describeCommandReason } from "@/domain/commands/commands.reasons";
import type { CommandAvailability } from "@/domain/commands/commands.types";
import { CONFIRM_LABELS, formatDeleteAllUntrackedLabel } from "@/domain/commands/confirm.labels";
import type { DiffFileView, DiffSectionView } from "@/domain/repository/repository.types";
import { toFileTarget } from "./diff.rows";
import type { ConfirmationOverlay, DiffCommandHandlers } from "./diffPanel.types";

/**
 * Opens the destructive confirmation for one file.
 *
 * @param commandId - Discard or delete command being confirmed.
 * @param file - File the command targets.
 * @param handlers - Availability reader and dispatch callback.
 * @param overlay - Overlay writer that owns the modal entry.
 */
export function confirmFileChange(
  commandId: "diff.discard" | "diff.deleteUntracked",
  file: DiffFileView,
  handlers: DiffCommandHandlers,
  overlay: ConfirmationOverlay,
): void {
  const availability = handlers.readFileAvailability(commandId, file);

  if (!availability.available) {
    handlers.reportAvailability(availability);
    return;
  }

  const deleting = commandId === "diff.deleteUntracked";

  overlay.confirm({
    title: deleting ? "Delete untracked file" : "Discard changes",
    description: deleting
      ? `${file.path} is removed from disk. The file is untracked, so git cannot restore it.`
      : `Discard changes in ${file.path}. The working copy returns to the index version.`,
    confirmLabel: deleting ? CONFIRM_LABELS.deleteUntrackedFile : CONFIRM_LABELS.discardChanges,
    destructive: true,
    onConfirm: () => {
      handlers.dispatch(commandId, toFileTarget(file));
    },
  });
}

/**
 * Opens the destructive confirmation for one section.
 *
 * @param commandId - Discard-all or delete-all command being confirmed.
 * @param view - Section the command is scoped to.
 * @param handlers - Availability reader and dispatch callback.
 * @param overlay - Overlay writer that owns the modal entry.
 */
export function confirmBulkChange(
  commandId: "diff.discardAll" | "diff.deleteAllUntracked",
  view: DiffSectionView,
  handlers: DiffCommandHandlers,
  overlay: ConfirmationOverlay,
): void {
  const availability = handlers.readSectionAvailability(commandId, view);

  if (!availability.available) {
    handlers.reportAvailability(availability);
    return;
  }

  const deleting = commandId === "diff.deleteAllUntracked";
  const count = view.files.length;

  overlay.confirm({
    title: deleting ? "Delete all untracked files" : "Discard changes",
    description: deleting
      ? `${count} untracked files are removed from disk. They cannot be restored from git.`
      : `${count} tracked files in ${view.title} return to their index version.`,
    confirmLabel: deleting ? formatDeleteAllUntrackedLabel(count) : CONFIRM_LABELS.discardChanges,
    destructive: true,
    onConfirm: () => {
      handlers.dispatch(commandId, { kind: "none" }, { section: view.section, paths: view.paths });
    },
  });
}

/**
 * Reads a blocked availability reason as user-facing text.
 *
 * @param availability - Blocked availability result.
 * @returns The reason text.
 */
export function readAvailabilityReason(availability: CommandAvailability): string {
  return describeCommandReason(availability.reason ?? "command-not-implemented");
}
