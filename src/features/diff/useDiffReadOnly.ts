import { useCallback, useEffect, useMemo } from "react";
import type { DiffLoadState } from "@/domain/diff/diff.types";
import { isReadOnlySelection, selectStashRows } from "@/domain/repository/repository.selectors";
import type {
  DiffFileView,
  RepositorySelection,
  RepositorySnapshot,
} from "@/domain/repository/repository.types";
import { readReadOnlyTitle, readStashSelector, toReadOnlyView } from "./diff.rows";
import type { ReadOnlyDiffState } from "./fileDiff.types";

/**
 * Derives the diff panel's read-only views and keeps the selected commit or stash read alive.
 *
 * Read-only mode is a projection of the right-pane selection: a commit or stash selection replaces
 * the section list with one flat file list. The hook owns only the derived views and the read
 * trigger; the lazy cache and the actual git read stay in `useFileDiff`.
 *
 * @param input - Right-pane selection and snapshot plus the read-only cache API.
 * @returns Read-only mode flags, derived views, and the load and retry callbacks.
 */
export function useDiffReadOnly(input: {
  readonly selection: RepositorySelection;
  readonly snapshot: RepositorySnapshot | null;
  readonly state: ReadOnlyDiffState;
  readonly load: (selection: RepositorySelection, stashSelector: string | null) => void;
  readonly retry: (selection: RepositorySelection, stashSelector: string | null) => void;
}) {
  const { load, retry, selection, snapshot, state } = input;
  const readOnly = isReadOnlySelection(selection);
  const stashSelector = useMemo(
    () => readStashSelector(selection, selectStashRows(snapshot)),
    [selection, snapshot],
  );
  const files = useMemo(() => state.files.map((entry) => toReadOnlyView(entry)), [state.files]);
  const stateByPath = useMemo(
    () => new Map(state.files.map((entry) => [entry.request.path, entry] as const)),
    [state.files],
  );

  /** Reads one read-only file's load state. */
  const fileState = useCallback(
    (file: DiffFileView): DiffLoadState | undefined => stateByPath.get(file.path),
    [stateByPath],
  );

  /** Retries the read-only whole-diff read. */
  const retryReadOnly = useCallback((): void => {
    retry(selection, stashSelector);
  }, [retry, selection, stashSelector]);

  useEffect(() => {
    if (!readOnly) {
      return;
    }

    load(selection, stashSelector);
  }, [load, readOnly, selection, stashSelector]);

  return {
    readOnly,
    state,
    files,
    fileState,
    title: readReadOnlyTitle(selection, snapshot),
    retryReadOnly,
  };
}
