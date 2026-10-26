import { useCallback, useMemo, useRef } from "react";
import { useListCursor } from "@/app/hooks/useListCursor";
import type { DiffSection } from "@/domain/diff/diff.types";
import type { DiffFileView, DiffSectionView } from "@/domain/repository/repository.types";
import { buildRows } from "./diff.rows";
import type { DiffRow } from "./diffPanel.types";

/**
 * Derives the flattened diff rows and wires them to the shared list cursor.
 *
 * The cursor is the shared `diff` region cursor, so it survives a refresh that keeps the same row
 * id. Activation and double click both resolve the row at the given index, so the cursor, the
 * expansion toggles, and the keyboard handlers always target the same row.
 *
 * @param input - Rows' source state, expansion map, activation toggles, and the row handler.
 * @returns Rows, the cursor handle, and the selection and activation helpers.
 */
export function useDiffRows(input: {
  readonly readOnly: boolean;
  readonly readOnlyFiles: readonly DiffFileView[];
  readonly sections: readonly DiffSectionView[];
  readonly expandedSections: Readonly<Record<DiffSection, boolean>>;
  readonly toggleSection: (section: DiffSection) => void;
  readonly toggleFile: (file: DiffFileView) => void;
  readonly expandSection: (section: DiffSection) => void;
  readonly collapseSection: (section: DiffSection) => void;
  readonly expandFile: (file: DiffFileView) => void;
  readonly collapseFile: (file: DiffFileView) => void;
}) {
  const {
    collapseFile,
    collapseSection,
    expandFile,
    expandSection,
    expandedSections,
    readOnly,
    readOnlyFiles,
    sections,
    toggleFile,
    toggleSection,
  } = input;
  const rows = useMemo(
    () =>
      buildRows({
        readOnly,
        readOnlyFiles,
        sections,
        expandedSections,
      }),
    [expandedSections, readOnly, readOnlyFiles, sections],
  );
  const cursorIndexRef = useRef(0);

  /** Runs the primary action for one row index. */
  const activateRow = useCallback(
    (index: number): void => {
      const row = rows[index];

      if (row === undefined) {
        return;
      }

      if (row.kind === "section") {
        toggleSection(row.section);
        return;
      }

      if (row.file !== null) {
        toggleFile(row.file);
      }
    },
    [rows, toggleFile, toggleSection],
  );

  const cursor = useListCursor({
    regionId: "diff",
    items: rows,
    onActivate: () => activateRow(cursorIndexRef.current),
    onDoubleClick: activateRow,
    enableFirstLast: false,
  });

  cursorIndexRef.current = cursor.index;

  /** Reads the row under the cursor. */
  const readSelectedRow = useCallback(
    (): DiffRow | null => rows[cursor.index] ?? null,
    [cursor.index, rows],
  );

  /** Expands the section or file at one row index. */
  const expandSelectedRow = useCallback(
    (index: number): void => {
      const row = rows[index];

      if (row?.kind === "section") {
        expandSection(row.section);
        return;
      }

      if (row?.file != null) {
        expandFile(row.file);
      }
    },
    [expandFile, expandSection, rows],
  );

  /** Collapses the section or file at one row index. */
  const collapseSelectedRow = useCallback(
    (index: number): void => {
      const row = rows[index];

      if (row?.kind === "section") {
        collapseSection(row.section);
        return;
      }

      if (row?.file != null) {
        collapseFile(row.file);
      }
    },
    [collapseFile, collapseSection, rows],
  );

  /** Toggles the selected row. */
  const toggleSelected = useCallback((): void => {
    activateRow(cursor.index);
  }, [activateRow, cursor.index]);

  /** Expands the selected row. */
  const expandSelected = useCallback((): void => {
    expandSelectedRow(cursor.index);
  }, [cursor.index, expandSelectedRow]);

  /** Collapses the selected row. */
  const collapseSelected = useCallback((): void => {
    collapseSelectedRow(cursor.index);
  }, [collapseSelectedRow, cursor.index]);

  /** Selects the row with one stable id. */
  const selectRow = useCallback(
    (id: string): void => {
      cursor.selectId(id);
    },
    [cursor],
  );

  /** Selects one row by its index, using the same double-click path as a mouse click. */
  const clickRow = useCallback(
    (id: string): void => {
      const index = rows.findIndex((row) => row.id === id);

      if (index >= 0) {
        cursor.handleRowClick(index);
      }
    },
    [cursor, rows],
  );

  return {
    rows,
    cursor,
    activateRow,
    readSelectedRow,
    expandSelectedRow,
    collapseSelectedRow,
    toggleSelected,
    expandSelected,
    collapseSelected,
    selectRow,
    clickRow,
  };
}
