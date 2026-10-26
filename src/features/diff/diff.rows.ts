import type { CommandFormValues, CommandTarget } from "@/domain/commands/commands.types";
import type { DiffFileRequest, DiffLoadState, DiffSection } from "@/domain/diff/diff.types";
import type {
  DiffFileView,
  DiffSectionView,
  DiffStatusLetter,
  RepositorySelection,
  RepositorySignals,
  RepositorySnapshot,
} from "@/domain/repository/repository.types";
import type { DiffRow } from "./diffPanel.types";

/**
 * Builds the flattened rows the cursor addresses.
 *
 * @param input - Read-only mode, read-only files, sections, and expansion maps.
 * @returns Section headers and visible file rows in render order.
 */
export function buildRows(input: {
  readonly readOnly: boolean;
  readonly readOnlyFiles: readonly DiffFileView[];
  readonly sections: readonly DiffSectionView[];
  readonly expandedSections: Readonly<Record<DiffSection, boolean>>;
}): readonly DiffRow[] {
  if (input.readOnly) {
    return input.readOnlyFiles.map((file) => ({
      id: file.id,
      kind: "file" as const,
      section: file.section,
      file,
    }));
  }

  const rows: DiffRow[] = [];

  for (const section of input.sections) {
    rows.push({
      id: `section::${section.section}`,
      kind: "section",
      section: section.section,
      file: null,
    });

    if (!input.expandedSections[section.section]) {
      continue;
    }

    for (const file of section.files) {
      rows.push({ id: file.id, kind: "file", section: section.section, file });
    }
  }

  return rows;
}

/**
 * Builds the explicit per-file target of one row.
 *
 * @param file - File row.
 * @returns The command target.
 */
export function toFileTarget(file: DiffFileView): CommandTarget {
  return {
    kind: "diffFile",
    section: file.section,
    path: file.path,
    ...(file.oldPath === null ? {} : { oldPath: file.oldPath }),
  };
}

/**
 * Builds the cache request of one row.
 *
 * @param file - File row.
 * @returns The request.
 */
export function toFileRequest(file: DiffFileView): DiffFileRequest {
  return { section: file.section, path: file.path, oldPath: file.oldPath };
}

/**
 * Builds the read-only form values.
 *
 * @param readOnly - True in commit or stash mode.
 * @returns Form values carrying the read-only flag.
 */
export function readOnlyFormValues(readOnly: boolean): CommandFormValues {
  return readOnly ? { readOnly: true } : {};
}

/**
 * Builds the view model for one read-only file.
 *
 * @param state - Loaded cache entry.
 * @returns The file row model.
 */
export function toReadOnlyView(state: DiffLoadState): DiffFileView {
  const status = state.file?.status ?? "modified";

  return {
    id: `readonly::${state.request.path}`,
    section: "staged",
    statusLetter: readStatusLetter(status),
    status,
    path: state.request.path,
    oldPath: state.request.oldPath,
    conflicted: state.file?.conflict === true,
  };
}

/**
 * Maps a parsed file status to a row letter.
 *
 * @param status - Parsed file status.
 * @returns The row letter.
 */
export function readStatusLetter(status: DiffFileView["status"]): DiffStatusLetter {
  switch (status) {
    case "conflicted":
      return "U";
    case "renamed":
      return "R";
    case "copied":
      return "C";
    case "added":
      return "A";
    case "deleted":
      return "D";
    case "modified":
      return "M";
  }
}

/**
 * Counts added and removed lines in one loaded file.
 *
 * @param state - File load state.
 * @returns The counts, or null until a text diff has loaded.
 */
export function countDiffLines(
  state: DiffLoadState | undefined,
): { readonly add: number; readonly remove: number } | null {
  if (state?.status !== "loaded" || state.file === null) {
    return null;
  }

  let add = 0;
  let remove = 0;

  for (const hunk of state.file.hunks) {
    for (const line of hunk.lines) {
      if (line.kind === "add") {
        add += 1;
      } else if (line.kind === "remove") {
        remove += 1;
      }
    }
  }

  return { add, remove };
}

/**
 * Reports whether the automatic first-file reveal may still collapse itself.
 *
 * @param input - Read-only flag, first file, the expanded id, and the pending flag.
 * @returns True when the collapse check should run.
 */
export function isAutoCollapseCandidate(input: {
  readonly readOnly: boolean;
  readonly file: DiffFileView | null;
  readonly expandedId: string | null;
  readonly pending: boolean;
}): boolean {
  if (input.readOnly || input.file === null || !input.pending) {
    return false;
  }

  return input.expandedId === input.file.id;
}

/**
 * Reports whether a loaded first file should collapse instead of staying open.
 *
 * @param state - Lazy load state, or undefined before the first request.
 * @returns True for a binary, oversized, or entirely empty text diff.
 */
export function shouldAutoCollapseDiff(state: DiffLoadState | undefined): boolean {
  if (state?.status === "binary" || state?.status === "oversized") {
    return true;
  }

  return state?.status === "loaded" && state.file === null;
}

/**
 * Builds the retry callback that refreshes the repository without surfacing a result.
 *
 * @param refreshStatus - Repository status refresh owned by the provider.
 * @returns A void callback for the panel's retry affordance.
 */
export function readRefreshRetry(refreshStatus: () => Promise<unknown>): () => void {
  return () => {
    void refreshStatus();
  };
}

/**
 * Builds the counts reader for one panel mode.
 *
 * @param readOnly - True in commit or stash mode.
 * @param fileState - Pending-file load state reader.
 * @param readOnlyFileState - Read-only-file load state reader.
 * @returns A reader for one file's added and removed counts.
 */
export function readCountsFor(
  readOnly: boolean,
  fileState: (file: DiffFileView) => DiffLoadState | undefined,
  readOnlyFileState: (file: DiffFileView) => DiffLoadState | undefined,
): (file: DiffFileView) => { readonly add: number; readonly remove: number } | null {
  return (file) => countDiffLines(readOnly ? readOnlyFileState(file) : fileState(file));
}

/**
 * Reads the in-progress operation the conflict banner names.
 *
 * @param signals - Current repository signals.
 * @returns The operation, or null when none is in progress.
 */
export function readInProgressOperation(
  signals: RepositorySignals,
): "merge" | "rebase" | "cherry-pick" | null {
  if (signals.mergeInProgress) {
    return "merge";
  }

  if (signals.rebaseInProgress) {
    return "rebase";
  }

  return signals.cherryPickInProgress ? "cherry-pick" : null;
}

/**
 * Reads the current stash selector for a stash selection.
 *
 * @param selection - Right-pane selection.
 * @param stashes - Stash rows from the snapshot.
 * @returns The current `stash@{n}` selector, or null.
 */
export function readStashSelector(
  selection: RepositorySelection,
  stashes: readonly { readonly objectName: string; readonly index: string }[],
): string | null {
  if (selection.kind !== "stash") {
    return null;
  }

  return stashes.find((stash) => stash.objectName === selection.objectName)?.index ?? null;
}

/**
 * Builds the read-only panel title.
 *
 * @param selection - Right-pane selection.
 * @param snapshot - Current snapshot.
 * @returns The title naming the selected commit or stash.
 */
export function readReadOnlyTitle(
  selection: RepositorySelection,
  snapshot: RepositorySnapshot | null,
): string {
  if (selection.kind === "commit") {
    return `Commit ${selection.oid.slice(0, 7)}`;
  }

  if (selection.kind !== "stash") {
    return "Diffs";
  }

  const stash = snapshot?.stashes.find(
    (candidate) => candidate.objectName === selection.objectName,
  );

  return `Stash ${stash?.subject ?? selection.objectName.slice(0, 7)}`;
}
