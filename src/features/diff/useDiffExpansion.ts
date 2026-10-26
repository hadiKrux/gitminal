import { useCallback, useRef, useState } from "react";
import type { DiffSection } from "@/domain/diff/diff.types";
import type { DiffFileView } from "@/domain/repository/repository.types";
import { INITIAL_SECTION_EXPANSION } from "./diffPanel.constants";
import type { DiffExpansionRefs, RememberedFile } from "./diffPanel.types";

/**
 * Owns section and file expansion state and its toggles.
 *
 * All three sections start expanded. Collapsing a section remembers the file row that was selected
 * inside it, and expanding the section again marks that row for restore after the new rows render.
 * The effects that read the rows and cursor live in `useDiffExpansionEffects`, so this hook stays a
 * pure view-state owner.
 *
 * @param readOnly - True in commit or stash mode, where files start expanded.
 * @returns Expansion state, its toggles, the file expansion predicate, and shared refs.
 */
export function useDiffExpansion(readOnly: boolean): DiffExpansionRefs & {
  readonly expandedSections: Record<DiffSection, boolean>;
  readonly expandedFiles: Readonly<Record<string, boolean>>;
  readonly isFileExpanded: (file: DiffFileView) => boolean;
  readonly toggleSection: (section: DiffSection) => void;
  readonly expandSection: (section: DiffSection) => void;
  readonly collapseSection: (section: DiffSection) => void;
  readonly toggleFile: (file: DiffFileView) => void;
  readonly expandFile: (file: DiffFileView) => void;
  readonly collapseFile: (file: DiffFileView) => void;
} {
  const [expandedSections, setExpandedSections] = useState<Record<DiffSection, boolean>>({
    ...INITIAL_SECTION_EXPANSION,
  });
  const [expandedFiles, setExpandedFiles] = useState<Readonly<Record<string, boolean>>>({});
  const rememberedFileRef = useRef<RememberedFile | null>(null);
  const pendingRestoreRef = useRef<string | null>(null);
  const autoExpandRef = useRef<string | null>(null);
  const autoCollapsePendingRef = useRef(false);

  /** Expands one section. */
  const expandSection = useCallback((section: DiffSection): void => {
    setExpandedSections((current) =>
      current[section] ? current : { ...current, [section]: true },
    );
  }, []);

  /** Collapses one section, keeping the remembered file for the next expansion. */
  const collapseSection = useCallback((section: DiffSection): void => {
    const remembered = rememberedFileRef.current;

    if (remembered !== null && remembered.section === section) {
      pendingRestoreRef.current = remembered.id;
    }

    setExpandedSections((current) =>
      current[section] ? { ...current, [section]: false } : current,
    );
  }, []);

  /** Toggles one section and restores its remembered file when it expands again. */
  const toggleSection = useCallback(
    (section: DiffSection): void => {
      if (expandedSections[section]) {
        collapseSection(section);
        return;
      }

      const remembered = rememberedFileRef.current;

      pendingRestoreRef.current = remembered?.section === section ? remembered.id : null;
      expandSection(section);
    },
    [collapseSection, expandSection, expandedSections],
  );

  /** Expands one file and starts its lazy read. */
  const expandFile = useCallback((file: DiffFileView): void => {
    setExpandedFiles((current) =>
      current[file.id] === true ? current : { ...current, [file.id]: true },
    );
  }, []);

  /** Collapses one file without dropping its cached diff. */
  const collapseFile = useCallback((file: DiffFileView): void => {
    setExpandedFiles((current) =>
      current[file.id] === false ? current : { ...current, [file.id]: false },
    );
  }, []);

  /** Reports whether one file row is expanded for the current mode. */
  const isFileExpanded = useCallback(
    (file: DiffFileView): boolean =>
      readOnly ? expandedFiles[file.id] !== false : expandedFiles[file.id] === true,
    [expandedFiles, readOnly],
  );

  /** Toggles one file row. */
  const toggleFile = useCallback(
    (file: DiffFileView): void => {
      autoCollapsePendingRef.current = false;

      if (isFileExpanded(file)) {
        collapseFile(file);
        return;
      }

      expandFile(file);
    },
    [collapseFile, expandFile, isFileExpanded],
  );

  return {
    expandedSections,
    expandedFiles,
    isFileExpanded,
    toggleSection,
    expandSection,
    collapseSection,
    toggleFile,
    expandFile,
    collapseFile,
    rememberedFileRef,
    pendingRestoreRef,
    autoExpandRef,
    autoCollapsePendingRef,
  };
}
