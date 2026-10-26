import { type MutableRefObject, useCallback, useEffect, useRef, useState } from "react";
import type { GitClient } from "@/domain/git/git.types";
import type { RepositorySelection } from "@/domain/repository/repository.types";
import { loadReadOnlyDiff, readReadOnlyTarget } from "./fileDiff.load";
import type { DiffRequestEnqueue, ReadOnlyDiffState } from "./fileDiff.types";

/** Empty read-only state. */
const IDLE_READ_ONLY: ReadOnlyDiffState = Object.freeze({
  key: null,
  status: "idle",
  files: [],
  message: null,
});

/**
 * Owns the read-only commit and stash diff read.
 *
 * A selection is read once and kept across repository generation bumps because a commit and a stash
 * are immutable for a fixed target. The settled diff and the active key are cleared when the
 * selection target changes, when the client, root, or context lines change, or on Retry; an
 * in-flight read is still discarded when the generation moves so a stale result cannot land. A
 * target that disappears without a selection change is not revalidated until the target changes or
 * Retry runs. An error leaves the selection key active so the panel must call `retryReadOnly` to
 * try again.
 *
 * @param input - Git client, root, context lines, generation, generation ref, and the read queue.
 * @returns The read-only list state plus its load and retry entry points.
 */
export function useReadOnlyDiff(input: {
  readonly client: GitClient;
  readonly cwd: string;
  readonly generation: number;
  readonly contextLines: number;
  readonly generationRef: MutableRefObject<number>;
  readonly enqueue: DiffRequestEnqueue;
}) {
  const { client, contextLines, cwd, enqueue, generation, generationRef } = input;
  const [readOnly, setReadOnly] = useState<ReadOnlyDiffState>(IDLE_READ_ONLY);
  const readOnlyVersionRef = useRef(0);
  const activeReadOnlyKeyRef = useRef<string | null>(null);
  const statusRef = useRef<ReadOnlyDiffState["status"]>("idle");

  statusRef.current = readOnly.status;

  useEffect(() => {
    // A settled commit or stash diff is immutable for its target, so only the read identity resets
    // it. The generation stays a discard check for a read that is still in flight.
    void client;
    void contextLines;
    void cwd;
    activeReadOnlyKeyRef.current = null;
    readOnlyVersionRef.current += 1;
    setReadOnly(IDLE_READ_ONLY);
  }, [client, contextLines, cwd]);

  useEffect(() => {
    void generation;

    if (statusRef.current !== "loading") {
      return;
    }

    // The generation moved while this target was still loading. Discard the attempt and let the
    // new generation issue a fresh read instead of leaving the panel on a loading row.
    activeReadOnlyKeyRef.current = null;
    readOnlyVersionRef.current += 1;
    setReadOnly(IDLE_READ_ONLY);
  }, [generation]);

  /**
   * Reports whether a read-only read is still current.
   *
   * @param version - Version captured when the read started.
   * @param capturedGeneration - Generation captured when the read started.
   * @returns True when the settled state may be stored.
   */
  const isCurrentReadOnly = useCallback(
    (version: number, capturedGeneration: number): boolean =>
      version === readOnlyVersionRef.current && capturedGeneration === generationRef.current,
    [generationRef],
  );

  /**
   * Reads the whole diff of the selected commit or stash.
   *
   * @param selection - Right-pane selection.
   * @param stashSelector - Current `stash@{n}` selector for a stash selection, or null.
   */
  const loadReadOnly = useCallback(
    (selection: RepositorySelection, stashSelector: string | null): void => {
      const target = readReadOnlyTarget(selection, stashSelector);

      if (target === null) {
        activeReadOnlyKeyRef.current = null;
        setReadOnly(IDLE_READ_ONLY);
        return;
      }

      if (activeReadOnlyKeyRef.current === target.key) {
        return;
      }

      const version = readOnlyVersionRef.current + 1;
      const capturedGeneration = generation;

      readOnlyVersionRef.current = version;
      activeReadOnlyKeyRef.current = target.key;
      setReadOnly({ key: target.key, status: "loading", files: [], message: null });
      enqueue(async (signal) => {
        if (!isCurrentReadOnly(version, capturedGeneration)) {
          return;
        }

        const state = await loadReadOnlyDiff({
          client,
          cwd,
          contextLines,
          generation: capturedGeneration,
          signal,
          target,
        });

        if (!isCurrentReadOnly(version, capturedGeneration)) {
          return;
        }

        setReadOnly(state);
      });
    },
    [client, contextLines, cwd, enqueue, generation, isCurrentReadOnly],
  );

  /**
   * Re-runs the current read-only selection after an error.
   *
   * @param selection - Right-pane selection.
   * @param stashSelector - Current selector for a stash selection, or null.
   */
  const retryReadOnly = useCallback(
    (selection: RepositorySelection, stashSelector: string | null): void => {
      activeReadOnlyKeyRef.current = null;
      loadReadOnly(selection, stashSelector);
    },
    [loadReadOnly],
  );

  return { readOnly, loadReadOnly, retryReadOnly };
}
