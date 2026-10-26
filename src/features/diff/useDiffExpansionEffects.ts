import { useEffect } from "react";
import type { ListCursorHandle } from "@/app/hooks/useListCursor.types";
import type { DiffLoadState } from "@/domain/diff/diff.types";
import type { DiffFileView, DiffSectionView } from "@/domain/repository/repository.types";
import { isAutoCollapseCandidate, shouldAutoCollapseDiff } from "./diff.rows";
import type { DiffExpansionRefs, DiffRow } from "./diffPanel.types";

/**
 * Runs the expansion effects that need the derived rows and the cursor.
 *
 * The restore and remember effects run after render so the cursor sees the rows a toggle produced.
 * The automatic first-working-file reveal runs once per file id and collapses itself again when the
 * lazy read proves the file is binary, oversized, or empty. The request effect keeps every expanded
 * file's cache warm after a repository refresh.
 *
 * @param input - Rows, cursor, sections, expansion refs, lazy state, and expansion callbacks.
 */
export function useDiffExpansionEffects(input: {
  readonly readOnly: boolean;
  readonly expandFirstWorkingFile: boolean;
  readonly rows: readonly DiffRow[];
  readonly sections: readonly DiffSectionView[];
  readonly cursor: ListCursorHandle;
  readonly firstWorkingFile: DiffFileView | null;
  readonly expandedFiles: Readonly<Record<string, boolean>>;
  readonly fileState: (file: DiffFileView) => DiffLoadState | undefined;
  readonly requestFile: (file: DiffFileView) => void;
  readonly expandFile: (file: DiffFileView) => void;
  readonly collapseFile: (file: DiffFileView) => void;
  readonly refs: DiffExpansionRefs;
}): void {
  const {
    collapseFile,
    cursor,
    expandFile,
    expandFirstWorkingFile,
    expandedFiles,
    fileState,
    firstWorkingFile,
    readOnly,
    refs,
    requestFile,
    rows,
    sections,
  } = input;

  useEffect(() => {
    const pending = refs.pendingRestoreRef.current;

    if (pending === null || !rows.some((row) => row.id === pending)) {
      return;
    }

    refs.pendingRestoreRef.current = null;
    cursor.selectId(pending);
  }, [cursor, refs.pendingRestoreRef, rows]);

  useEffect(() => {
    const selected = rows[cursor.index];

    if (selected?.kind === "file") {
      refs.rememberedFileRef.current = { section: selected.section, id: selected.id };
    }
  }, [cursor.index, refs.rememberedFileRef, rows]);

  useEffect(() => {
    if (readOnly || !expandFirstWorkingFile || firstWorkingFile === null) {
      return;
    }

    if (refs.autoExpandRef.current === firstWorkingFile.id) {
      return;
    }

    refs.autoExpandRef.current = firstWorkingFile.id;
    refs.autoCollapsePendingRef.current = true;
    expandFile(firstWorkingFile);
  }, [expandFile, expandFirstWorkingFile, firstWorkingFile, readOnly, refs]);

  useEffect(() => {
    const candidate = isAutoCollapseCandidate({
      readOnly,
      file: firstWorkingFile,
      expandedId: refs.autoExpandRef.current,
      pending: refs.autoCollapsePendingRef.current,
    });

    if (!candidate || firstWorkingFile === null) {
      return;
    }

    if (!shouldAutoCollapseDiff(fileState(firstWorkingFile))) {
      return;
    }

    refs.autoCollapsePendingRef.current = false;
    collapseFile(firstWorkingFile);
  }, [collapseFile, fileState, firstWorkingFile, readOnly, refs]);

  useEffect(() => {
    if (readOnly) {
      return;
    }

    for (const section of sections) {
      for (const file of section.files) {
        if (expandedFiles[file.id] === true) {
          requestFile(file);
        }
      }
    }
  }, [expandedFiles, readOnly, requestFile, sections]);
}
