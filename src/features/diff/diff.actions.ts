import type { ActionBatchRegistration } from "@/app/hooks/useAction.types";
import { describeCommandReason } from "@/domain/commands/commands.reasons";
import type { CommandAvailability } from "@/domain/commands/commands.types";
import type { DiffFileView, DiffSectionView } from "@/domain/repository/repository.types";
import { toFileTarget } from "./diff.rows";
import { BULK_LABELS } from "./diffPanel.constants";
import type {
  BulkActionHandlers,
  DiffActionView,
  DiffCommandHandlers,
  DiffRow,
  FileActionHandlers,
} from "./diffPanel.types";

/**
 * Builds the diff-scoped action registrations.
 *
 * `S` keeps its selected-section scope, while the global `A` stages the combined working and
 * untracked path set panel-wide and ignores the cursor.
 *
 * @param input - Latest handlers and the state they read.
 * @returns Batch registrations for `useActions`.
 */
export function buildActionRegistrations(input: {
  readonly readOnly: boolean;
  readonly readSelectedRow: () => DiffRow | null;
  readonly sections: readonly DiffSectionView[];
  readonly runFileAction: (commandId: string, file: DiffSectionView["files"][number]) => void;
  readonly runBulkAction: (commandId: string, view: DiffSectionView) => void;
  readonly runStageAll: () => void;
  readonly confirmFileAction: (
    commandId: "diff.discard" | "diff.deleteUntracked",
    file: DiffSectionView["files"][number],
  ) => void;
  readonly confirmBulkAction: (
    commandId: "diff.discardAll" | "diff.deleteAllUntracked",
    view: DiffSectionView,
  ) => void;
  readonly toggleSelected: () => void;
  readonly expandSelected: () => void;
  readonly collapseSelected: () => void;
  readonly reportReason: (reason: string) => void;
}): readonly ActionBatchRegistration[] {
  const scope = { scope: "diff" } as const;
  const fileScope = { scope: "diff", targetKind: "diffFile" } as const;

  /** Reports read-only mode when every diff action is unavailable. */
  const refuseReadOnly = (): boolean => {
    if (!input.readOnly) {
      return false;
    }

    input.reportReason(describeCommandReason("read-only"));

    return true;
  };

  /** Reads the selected file row, reporting a missing target when the row is not a file. */
  const readFile = (): DiffSectionView["files"][number] | null => {
    const row = input.readSelectedRow();

    if (row?.kind === "file" && row.file !== null) {
      return row.file;
    }

    input.reportReason(describeCommandReason("missing-target"));

    return null;
  };

  /** Reads the section of the selected row, reporting a missing target when there is none. */
  const readSection = (): DiffSectionView | null => {
    const row = input.readSelectedRow();

    if (row === null) {
      input.reportReason(describeCommandReason("missing-target"));

      return null;
    }

    return input.sections.find((section) => section.section === row.section) ?? null;
  };

  return [
    { actionId: "nav.expand", options: scope, handler: input.expandSelected },
    { actionId: "nav.collapse", options: scope, handler: input.collapseSelected },
    { actionId: "diff.toggle", options: scope, handler: input.toggleSelected },
    {
      actionId: "diff.stage",
      options: fileScope,
      handler: () => {
        if (refuseReadOnly()) {
          return;
        }

        const file = readFile();

        if (file !== null) {
          input.runFileAction("diff.stage", file);
        }
      },
    },
    {
      actionId: "diff.unstage",
      options: fileScope,
      handler: () => {
        if (refuseReadOnly()) {
          return;
        }

        const file = readFile();

        if (file !== null) {
          input.runFileAction("diff.unstage", file);
        }
      },
    },
    {
      actionId: "diff.discard",
      options: fileScope,
      handler: () => {
        if (refuseReadOnly()) {
          return;
        }

        const file = readFile();

        if (file === null) {
          return;
        }

        if (file.section === "untracked") {
          input.confirmFileAction("diff.deleteUntracked", file);
          return;
        }

        input.confirmFileAction("diff.discard", file);
      },
    },
    {
      actionId: "diff.deleteUntracked",
      options: fileScope,
      handler: () => {
        if (refuseReadOnly()) {
          return;
        }

        const file = readFile();

        if (file !== null) {
          input.confirmFileAction("diff.deleteUntracked", file);
        }
      },
    },
    {
      actionId: "diff.stageAll",
      options: scope,
      handler: () => {
        if (refuseReadOnly()) {
          return;
        }

        const section = readSection();

        if (section !== null) {
          input.runBulkAction("diff.stageAll", section);
        }
      },
    },
    {
      actionId: "diff.stageAllUnstaged",
      options: { scope: "global", owner: "diff" },
      handler: () => {
        if (refuseReadOnly()) {
          return;
        }

        input.runStageAll();
      },
    },
    {
      actionId: "diff.unstageAll",
      options: scope,
      handler: () => {
        if (refuseReadOnly()) {
          return;
        }

        const section = readSection();

        if (section !== null) {
          input.runBulkAction("diff.unstageAll", section);
        }
      },
    },
    {
      actionId: "diff.discardAll",
      options: scope,
      handler: () => {
        if (refuseReadOnly()) {
          return;
        }

        const section = readSection();

        if (section === null) {
          return;
        }

        if (section.section === "untracked") {
          input.confirmBulkAction("diff.deleteAllUntracked", section);
          return;
        }

        input.confirmBulkAction("diff.discardAll", section);
      },
    },
    {
      actionId: "diff.deleteAllUntracked",
      options: scope,
      handler: () => {
        if (refuseReadOnly()) {
          return;
        }

        const section = readSection();

        if (section !== null) {
          input.confirmBulkAction("diff.deleteAllUntracked", section);
        }
      },
    },
  ];
}

/**
 * Runs one per-file action after an availability check.
 *
 * @param commandId - Stage, unstage, discard, or delete command.
 * @param file - File row the action targets.
 * @param handlers - Availability reader, reporter, and dispatch callback.
 */
export function runFileCommand(
  commandId: string,
  file: DiffFileView,
  handlers: DiffCommandHandlers,
): void {
  const availability = handlers.readFileAvailability(commandId, file);

  if (!availability.available) {
    handlers.reportAvailability(availability);
    return;
  }

  handlers.dispatch(commandId, toFileTarget(file));
}

/**
 * Runs one bulk action against exactly one section's path set.
 *
 * @param commandId - Bulk command id.
 * @param view - Section the action is scoped to.
 * @param handlers - Availability reader, reporter, and dispatch callback.
 */
export function runBulkCommand(
  commandId: string,
  view: DiffSectionView,
  handlers: DiffCommandHandlers,
): void {
  const availability = handlers.readSectionAvailability(commandId, view);

  if (!availability.available) {
    handlers.reportAvailability(availability);
    return;
  }

  handlers.dispatch(commandId, { kind: "none" }, { section: view.section, paths: view.paths });
}

/**
 * Builds the inline actions of one file row, empty in read-only mode.
 *
 * @param readOnly - True in commit or stash mode.
 * @param file - File row.
 * @param handlers - Availability reader and action callbacks.
 * @returns The actions in F-11 order.
 */
export function readFileActions(
  readOnly: boolean,
  file: DiffFileView,
  handlers: FileActionHandlers,
): readonly DiffActionView[] {
  return readOnly ? [] : buildFileActionViews(file, handlers);
}

/**
 * Builds the bulk actions of one section header, empty in read-only mode.
 *
 * @param readOnly - True in commit or stash mode.
 * @param view - Section view.
 * @param handlers - Availability reader and action callbacks.
 * @returns The actions in F-11 order.
 */
export function readSectionActions(
  readOnly: boolean,
  view: DiffSectionView,
  handlers: BulkActionHandlers,
): readonly DiffActionView[] {
  return readOnly ? [] : buildSectionActionViews(view, handlers);
}

/**
 * Builds one file row's inline actions.
 *
 * @param file - File row.
 * @param handlers - Availability reader and action callbacks.
 * @returns Actions in section order.
 */
function buildFileActionViews(
  file: DiffSectionView["files"][number],
  handlers: FileActionHandlers,
): readonly DiffActionView[] {
  if (file.section === "staged") {
    return [makeFileAction("diff.unstage", "Unstage", "run", file, handlers)];
  }

  if (file.section === "untracked") {
    return [
      makeFileAction("diff.stage", "Stage", "run", file, handlers),
      makeFileAction("diff.deleteUntracked", "Delete", "confirm", file, handlers),
    ];
  }

  return [
    makeFileAction("diff.stage", "Stage", "run", file, handlers),
    makeFileAction("diff.discard", "Discard", "confirm", file, handlers),
  ];
}

/**
 * Builds one file action with its availability state.
 *
 * @param commandId - Command id.
 * @param label - Visible label.
 * @param mode - Run immediately or open the destructive confirmation.
 * @param file - File the action targets.
 * @param handlers - Availability reader and action callbacks.
 * @returns The action view.
 */
function makeFileAction(
  commandId: string,
  label: string,
  mode: "run" | "confirm",
  file: DiffSectionView["files"][number],
  handlers: FileActionHandlers,
): DiffActionView {
  const availability = handlers.readFileAvailability(commandId, file);

  return {
    id: commandId,
    label,
    disabled: !availability.available,
    reason: availability.available
      ? undefined
      : describeCommandReason(availability.reason ?? "command-not-implemented"),
    onPress: () => {
      if (mode === "run") {
        handlers.runFileAction(commandId, file);
        return;
      }

      handlers.confirmFileAction(
        commandId === "diff.deleteUntracked" ? "diff.deleteUntracked" : "diff.discard",
        file,
      );
    },
  };
}

/**
 * Builds one section header's bulk actions.
 *
 * @param view - Section view.
 * @param handlers - Availability reader and action callbacks.
 * @returns Actions in section order.
 */
function buildSectionActionViews(
  view: DiffSectionView,
  handlers: BulkActionHandlers,
): readonly DiffActionView[] {
  if (view.section === "staged") {
    return [makeBulkAction("diff.unstageAll", BULK_LABELS.unstageAll, "run", view, handlers)];
  }

  if (view.section === "untracked") {
    return [
      makeBulkAction("diff.stageAll", BULK_LABELS.stageAll, "run", view, handlers),
      makeBulkAction("diff.deleteAllUntracked", BULK_LABELS.deleteAll, "confirm", view, handlers),
    ];
  }

  return [
    makeBulkAction("diff.stageAll", BULK_LABELS.stageAll, "run", view, handlers),
    makeBulkAction("diff.discardAll", BULK_LABELS.discardAll, "confirm", view, handlers),
  ];
}

/**
 * Builds one bulk action with its availability state.
 *
 * @param commandId - Command id.
 * @param label - Visible label.
 * @param mode - Run immediately or open the destructive confirmation.
 * @param view - Section the action targets.
 * @param handlers - Availability reader and action callbacks.
 * @returns The action view.
 */
function makeBulkAction(
  commandId: string,
  label: string,
  mode: "run" | "confirm",
  view: DiffSectionView,
  handlers: BulkActionHandlers,
): DiffActionView {
  const availability: CommandAvailability = handlers.readSectionAvailability(commandId, view);

  return {
    id: commandId,
    label,
    disabled: !availability.available,
    reason: availability.available
      ? undefined
      : describeCommandReason(availability.reason ?? "command-not-implemented"),
    onPress: () => {
      if (mode === "run") {
        handlers.runBulkAction(commandId, view);
        return;
      }

      handlers.confirmBulkAction(
        commandId === "diff.deleteAllUntracked" ? "diff.deleteAllUntracked" : "diff.discardAll",
        view,
      );
    },
  };
}
