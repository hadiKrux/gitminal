import { useEffect, useMemo, useRef } from "react";
import { useConfig } from "@/app/hooks/useConfig";
import { useFocusRegion } from "@/app/hooks/useFocusRegion";
import { useRepository } from "@/app/hooks/useRepository";
import type { DiffSection } from "@/domain/diff/diff.types";
import { selectDiffSections } from "@/domain/repository/repository.selectors";
import { readCountsFor, readInProgressOperation, readRefreshRetry } from "./diff.rows";
import { SECTION_EMPTY_TEXT } from "./diffPanel.constants";
import { useDiffActions } from "./useDiffActions";
import { useDiffExpansion } from "./useDiffExpansion";
import { useDiffExpansionEffects } from "./useDiffExpansionEffects";
import { useDiffReadOnly } from "./useDiffReadOnly";
import { useDiffRows } from "./useDiffRows";
import { useFileDiff } from "./useFileDiff";

/**
 * Owns the diff panel's view state, cursor, commands, and read-only mode.
 *
 * Sections come from `selectDiffSections`, so the panel never recomputes status membership, rename
 * pairing, or path sets. Section and file expansion are local view state; the cursor is the shared
 * `diff` region cursor and therefore survives a refresh that keeps the same path. All three sections
 * start expanded, and the first Working Directory file expands only when `diff.expandFirstWorkingFile`
 * is on and the lazy read proves it has text content. Every mutation goes through
 * `useCommandRunner`; this hook never calls git. The component registers only the diff-scoped actions
 * F-11 names, never `app.refresh` or another global action.
 *
 * This hook is the composition point: expansion, row and cursor derivation, read-only views, and
 * command dispatch each live in their own feature-local hook.
 *
 * @returns Region state, rows, expansion, availability, and command callbacks for `DiffPanel`.
 */
export function useDiffPanel() {
  const repository = useRepository();
  const config = useConfig();
  const region = useFocusRegion("diff");
  const fileDiff = useFileDiff({
    client: repository.gitClient,
    cwd: repository.signals.repositoryRoot ?? repository.signals.cwd,
    generation: repository.generation,
    contextLines: config.config.diff.contextLines,
  });
  const readOnlyView = useDiffReadOnly({
    selection: repository.selection,
    snapshot: repository.snapshot,
    state: fileDiff.readOnly,
    load: fileDiff.loadReadOnly,
    retry: fileDiff.retryReadOnly,
  });
  const sections = useMemo(() => selectDiffSections(repository.snapshot), [repository.snapshot]);
  const firstWorkingFile = sections[0]?.files[0] ?? null;
  const expansion = useDiffExpansion(readOnlyView.readOnly);
  const rowState = useDiffRows({
    readOnly: readOnlyView.readOnly,
    readOnlyFiles: readOnlyView.files,
    sections,
    expandedSections: expansion.expandedSections,
    toggleSection: expansion.toggleSection,
    toggleFile: expansion.toggleFile,
    expandSection: expansion.expandSection,
    collapseSection: expansion.collapseSection,
    expandFile: expansion.expandFile,
    collapseFile: expansion.collapseFile,
  });

  useDiffExpansionEffects({
    readOnly: readOnlyView.readOnly,
    expandFirstWorkingFile: config.config.diff.expandFirstWorkingFile,
    rows: rowState.rows,
    sections,
    cursor: rowState.cursor,
    firstWorkingFile,
    expandedFiles: expansion.expandedFiles,
    fileState: fileDiff.fileState,
    requestFile: fileDiff.requestFile,
    expandFile: expansion.expandFile,
    collapseFile: expansion.collapseFile,
    refs: expansion,
  });

  const actions = useDiffActions({
    readOnly: readOnlyView.readOnly,
    readSelectedRow: rowState.readSelectedRow,
    sections,
    toggleSelected: rowState.toggleSelected,
    expandSelected: rowState.expandSelected,
    collapseSelected: rowState.collapseSelected,
  });

  useFocusRefresh(region.focused, repository.refreshStatus);

  const statusError = repository.lastRefreshError;

  return {
    region,
    loading:
      repository.snapshot === null &&
      repository.state.primary === "loading" &&
      statusError === null,
    error: statusError,
    busy: actions.busy,
    retry: readRefreshRetry(repository.refreshStatus),
    readOnly: readOnlyView.readOnly,
    readOnlyTitle: readOnlyView.title,
    readOnlyState: fileDiff.readOnly,
    readOnlyFiles: readOnlyView.files,
    conflictedFiles: repository.signals.conflictedPaths,
    operation: readInProgressOperation(repository.signals),
    sections,
    sectionEmptyText: readSectionEmptyText,
    rows: rowState.rows,
    selectedIndex: rowState.cursor.index,
    selectedId: rowState.cursor.activeId,
    expandedSections: expansion.expandedSections,
    isFileExpanded: expansion.isFileExpanded,
    toggleSection: expansion.toggleSection,
    toggleFile: expansion.toggleFile,
    fileActions: actions.fileActions,
    sectionActions: actions.sectionActions,
    fileState: fileDiff.fileState,
    readOnlyFileState: readOnlyView.fileState,
    countsFor: readCountsFor(readOnlyView.readOnly, fileDiff.fileState, readOnlyView.fileState),
    retryFile: fileDiff.retryFile,
    retryReadOnly: readOnlyView.retryReadOnly,
    selectRow: rowState.selectRow,
    clickRow: rowState.clickRow,
  };
}

/**
 * Reads the empty-state text of one section.
 *
 * @param section - Section name.
 * @returns The section's empty message.
 */
function readSectionEmptyText(section: DiffSection): string {
  return SECTION_EMPTY_TEXT[section];
}

/**
 * Refreshes the sections when the region gains focus.
 *
 * @param focused - True while the diff region or a descendant owns native focus.
 * @param refreshStatus - Repository status refresh owned by the provider.
 */
function useFocusRefresh(
  focused: boolean,
  refreshStatus: ReturnType<typeof useRepository>["refreshStatus"],
): void {
  const previousFocusRef = useRef(false);

  useEffect(() => {
    const wasFocused = previousFocusRef.current;

    previousFocusRef.current = focused;

    if (!focused || wasFocused) {
      return;
    }

    void refreshStatus();
  }, [focused, refreshStatus]);
}
