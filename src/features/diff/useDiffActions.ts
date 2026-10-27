import { useActions } from "@/app/hooks/useAction";
import { useCommandRunner } from "@/app/hooks/useCommandRunner";
import { useOverlay } from "@/app/hooks/useOverlay";
import { useRepository } from "@/app/hooks/useRepository";
import { useStatus } from "@/app/hooks/useStatus";
import type {
  CommandAvailability,
  CommandFormValues,
  CommandTarget,
} from "@/domain/commands/commands.types";
import type { DiffFileView, DiffSectionView } from "@/domain/repository/repository.types";
import {
  buildActionRegistrations,
  readFileActions,
  readSectionActions,
  runBulkCommand,
  runFileCommand,
} from "./diff.actions";
import { confirmBulkChange, confirmFileChange, readAvailabilityReason } from "./diff.confirmations";
import { readOnlyFormValues, toFileTarget } from "./diff.rows";
import type { DiffActionView, DiffRow } from "./diffPanel.types";

/**
 * Owns the diff panel's availability reads, command dispatch, and confirmations.
 *
 * Every mutation goes through `useCommandRunner`; the hook never calls git. The same shared
 * availability rule decides the inline action state, the destructive confirmation, and the
 * read-only refusal, so the panel, footer, and palette cannot disagree. Callbacks are plain
 * functions because `useActions` reads the latest batch through a ref.
 *
 * @param input - Read-only flag, selected-row reader, sections, and the expansion toggles.
 * @returns Per-file and per-section action views, the busy flag, and the registered diff actions.
 */
export function useDiffActions(input: {
  readonly readOnly: boolean;
  readonly readSelectedRow: () => DiffRow | null;
  readonly sections: readonly DiffSectionView[];
  readonly toggleSelected: () => void;
  readonly expandSelected: () => void;
  readonly collapseSelected: () => void;
}) {
  const repository = useRepository();
  const overlay = useOverlay();
  const { operation, setStatus } = useStatus();
  const { runCommand } = useCommandRunner();
  const { collapseSelected, expandSelected, readOnly, readSelectedRow, sections, toggleSelected } =
    input;

  /** Reports an availability reason or a plain warning. */
  function reportReason(reason: string): void {
    setStatus({ kind: "warning", message: reason });
  }

  /** Reports a blocked availability result. */
  function reportAvailability(availability: CommandAvailability): void {
    reportReason(readAvailabilityReason(availability));
  }

  /** Reads one file's availability with read-only mode passed through the form values. */
  function readFileAvailability(commandId: string, file: DiffFileView): CommandAvailability {
    return repository.getAvailability(
      commandId,
      toFileTarget(file),
      "diff",
      readOnlyFormValues(readOnly),
    );
  }

  /** Reads one bulk action's availability for a section. */
  function readSectionAvailability(commandId: string, view: DiffSectionView): CommandAvailability {
    return repository.getAvailability(commandId, { kind: "none" }, "diff", {
      section: view.section,
      paths: view.paths,
      ...readOnlyFormValues(readOnly),
    });
  }

  /** Sends one request to the command runner. */
  function dispatch(
    commandId: string,
    target: CommandTarget,
    formValues?: CommandFormValues,
  ): void {
    void runCommand({ commandId, target, formValues }).catch(() => null);
  }

  /** Runs one per-file action after an availability check. */
  function runFileAction(commandId: string, file: DiffFileView): void {
    runFileCommand(commandId, file, {
      readFileAvailability,
      readSectionAvailability,
      reportAvailability,
      dispatch,
    });
  }

  /** Runs one bulk action against exactly one section's path set. */
  function runBulkAction(commandId: string, view: DiffSectionView): void {
    runBulkCommand(commandId, view, {
      readFileAvailability,
      readSectionAvailability,
      reportAvailability,
      dispatch,
    });
  }

  /**
   * Stages the deduplicated working and untracked path sets, independent of the cursor.
   *
   * Serves the global `diff.stageAllUnstaged` action (`A`), so the combined path set is sent with
   * no section. The inline section buttons and the diff-scoped `S` keep their own section scope.
   *
   * @returns Nothing; dispatches one guarded mutation or reports its unavailable reason.
   */
  function runStageAll(): void {
    const paths = [
      ...new Set(
        sections.filter((view) => view.section !== "staged").flatMap((view) => view.paths),
      ),
    ];
    const formValues = { paths, ...readOnlyFormValues(readOnly) };
    const availability = repository.getAvailability(
      "diff.stageAll",
      { kind: "none" },
      "diff",
      formValues,
    );

    if (!availability.available) {
      reportAvailability(availability);
      return;
    }

    dispatch("diff.stageAll", { kind: "none" }, formValues);
  }

  /** Opens the destructive confirmation for one file. */
  function confirmFileAction(
    commandId: "diff.discard" | "diff.deleteUntracked",
    file: DiffFileView,
  ): void {
    confirmFileChange(
      commandId,
      file,
      { readFileAvailability, readSectionAvailability, reportAvailability, dispatch },
      overlay,
    );
  }

  /** Opens the destructive confirmation for one section. */
  function confirmBulkAction(
    commandId: "diff.discardAll" | "diff.deleteAllUntracked",
    view: DiffSectionView,
  ): void {
    confirmBulkChange(
      commandId,
      view,
      { readFileAvailability, readSectionAvailability, reportAvailability, dispatch },
      overlay,
    );
  }

  /** Builds the inline actions of one file row. */
  function fileActions(file: DiffFileView): readonly DiffActionView[] {
    return readFileActions(readOnly, file, {
      readFileAvailability,
      runFileAction,
      confirmFileAction,
    });
  }

  /** Builds the bulk actions of one section header. */
  function sectionActions(view: DiffSectionView): readonly DiffActionView[] {
    return readSectionActions(readOnly, view, {
      readSectionAvailability,
      runBulkAction,
      confirmBulkAction,
    });
  }

  useActions(
    buildActionRegistrations({
      readOnly,
      readSelectedRow,
      sections,
      runFileAction,
      runBulkAction,
      runStageAll,
      confirmFileAction,
      confirmBulkAction,
      toggleSelected,
      expandSelected,
      collapseSelected,
      reportReason,
    }),
  );

  return { fileActions, sectionActions, busy: operation !== null };
}
