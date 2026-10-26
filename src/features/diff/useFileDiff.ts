import { useCallback, useEffect, useRef } from "react";
import type { GitClient } from "@/domain/git/git.types";
import type { DiffRequestEnqueue } from "./fileDiff.types";
import { useFileDiffEntries } from "./useFileDiffEntries";
import { useReadOnlyDiff } from "./useReadOnlyDiff";

/**
 * Owns the lazy per-file diff cache and the read-only commit and stash read.
 *
 * This hook is the composition point. `useFileDiffEntries` owns the per-file cache, `useReadOnlyDiff`
 * owns the whole-diff read, and this hook owns the single serialized queue and the abort controller
 * both share. A newer request bumps the key's version, and a generation change clears both caches
 * and aborts the in-flight read before either store can be touched again.
 *
 * @param options - Git client, repository root, repository generation, and configured context lines.
 * @returns Cache readers, the request and retry entry points, and the read-only list state.
 */
export function useFileDiff(options: {
  readonly client: GitClient;
  readonly cwd: string;
  readonly generation: number;
  readonly contextLines: number;
}) {
  const { client, contextLines, cwd, generation } = options;
  const generationRef = useRef(generation);
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    generationRef.current = generation;
    abortRef.current?.abort();
    abortRef.current = null;
  }, [generation]);

  useEffect(
    () => () => {
      generationRef.current += 1;
      abortRef.current?.abort();
    },
    [],
  );

  /** Enqueues one read behind every earlier read and owns its abort controller. */
  const enqueue: DiffRequestEnqueue = useCallback((run): void => {
    queueRef.current = queueRef.current
      .then(async () => {
        const controller = new AbortController();

        abortRef.current = controller;
        await run(controller.signal);
      })
      .catch(() => {});
  }, []);

  const entries = useFileDiffEntries({
    client,
    cwd,
    contextLines,
    generation,
    generationRef,
    enqueue,
  });
  const readOnly = useReadOnlyDiff({
    client,
    cwd,
    contextLines,
    generation,
    generationRef,
    enqueue,
  });

  return {
    get: entries.get,
    fileState: entries.fileState,
    request: entries.request,
    requestFile: entries.requestFile,
    retry: entries.retry,
    retryFile: entries.retryFile,
    readOnly: readOnly.readOnly,
    loadReadOnly: readOnly.loadReadOnly,
    retryReadOnly: readOnly.retryReadOnly,
  };
}
