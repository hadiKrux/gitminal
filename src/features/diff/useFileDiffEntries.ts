import { type MutableRefObject, useCallback, useEffect, useRef, useState } from "react";
import type { DiffFileRequest, DiffLoadState } from "@/domain/diff/diff.types";
import type { GitClient } from "@/domain/git/git.types";
import type { DiffFileView } from "@/domain/repository/repository.types";
import { toFileRequest } from "./diff.rows";
import { loadFile, readCacheKey } from "./fileDiff.load";
import type { DiffRequestEnqueue } from "./fileDiff.types";

/**
 * Owns the lazy per-file diff cache for one repository generation.
 *
 * A file diff is read only when its row expands. The shared queue passed in serializes the reads, so
 * at most one request is in flight; a newer request bumps the key's version and every older result is
 * discarded before it can touch the cache. Loaded entries are kept per section, path, and old path
 * until the repository generation changes. Probe order is size, then binary, then the patch, so an
 * oversized or binary file never reaches the parser.
 *
 * @param input - Git client, root, context lines, generation, generation ref, and the read queue.
 * @returns The cached readers plus the request and retry entry points.
 */
export function useFileDiffEntries(input: {
  readonly client: GitClient;
  readonly cwd: string;
  readonly generation: number;
  readonly contextLines: number;
  readonly generationRef: MutableRefObject<number>;
  readonly enqueue: DiffRequestEnqueue;
}) {
  const { client, contextLines, cwd, enqueue, generation, generationRef } = input;
  const cacheRef = useRef(new Map<string, DiffLoadState>());
  const [entries, setEntries] = useState<Readonly<Record<string, DiffLoadState>>>({});
  const versionsRef = useRef(new Map<string, number>());

  /** Stores one settled entry in the cache and the render state. */
  const storeEntry = useCallback((key: string, state: DiffLoadState): void => {
    cacheRef.current.set(key, state);
    setEntries((current) => ({ ...current, [key]: state }));
  }, []);

  useEffect(() => {
    // The generation is the reset trigger; the caches hold no copy of it.
    void generation;
    cacheRef.current.clear();
    versionsRef.current.clear();
    setEntries({});
  }, [generation]);

  /**
   * Reports whether a request is still the newest one for its key and generation.
   *
   * @param key - Cache key.
   * @param version - Version captured when the request started.
   * @param capturedGeneration - Generation captured when the request started.
   * @returns True when the settled result may be stored.
   */
  const isCurrentRequest = useCallback(
    (key: string, version: number, capturedGeneration: number): boolean =>
      version === versionsRef.current.get(key) && capturedGeneration === generationRef.current,
    [generationRef],
  );

  /**
   * Requests one file diff unless a current-generation entry exists.
   *
   * Every request is queued, so exactly one read is in flight. A newer request for the same key
   * bumps that key's version, which discards the earlier result instead of letting it overwrite the
   * newer state.
   *
   * @param request - Section, path, and pre-rename path.
   * @param conflicted - True when the row is unmerged and needs the synthetic conflict patch.
   */
  const request = useCallback(
    (fileRequest: DiffFileRequest, conflicted: boolean): void => {
      const key = readCacheKey(fileRequest);

      if (cacheRef.current.get(key)?.generation === generation) {
        return;
      }

      const version = (versionsRef.current.get(key) ?? 0) + 1;
      const capturedGeneration = generation;

      versionsRef.current.set(key, version);
      storeEntry(key, {
        request: fileRequest,
        status: "loading",
        generation: capturedGeneration,
        file: null,
        segments: [],
        limits: null,
        message: null,
        sizeBytes: null,
      });
      enqueue(async (signal) => {
        if (!isCurrentRequest(key, version, capturedGeneration)) {
          return;
        }

        const state = await loadFile({
          client,
          cwd,
          contextLines,
          generation: capturedGeneration,
          request: fileRequest,
          conflicted,
          signal,
        });

        if (!isCurrentRequest(key, version, capturedGeneration)) {
          return;
        }

        storeEntry(key, state);
      });
    },
    [client, contextLines, cwd, enqueue, generation, isCurrentRequest, storeEntry],
  );

  /**
   * Discards one entry and reads it again.
   *
   * @param fileRequest - Section, path, and pre-rename path.
   * @param conflicted - True for an unmerged row.
   */
  const retry = useCallback(
    (fileRequest: DiffFileRequest, conflicted: boolean): void => {
      cacheRef.current.delete(readCacheKey(fileRequest));
      setEntries((current) => {
        const next = { ...current };

        delete next[readCacheKey(fileRequest)];

        return next;
      });
      request(fileRequest, conflicted);
    },
    [request],
  );

  /** Reads one cached file state. */
  const get = useCallback(
    (fileRequest: DiffFileRequest): DiffLoadState | undefined => entries[readCacheKey(fileRequest)],
    [entries],
  );

  /** Reads one row's cached state. */
  const fileState = useCallback(
    (file: DiffFileView): DiffLoadState | undefined => entries[readCacheKey(toFileRequest(file))],
    [entries],
  );

  /** Requests one expanded row's diff. */
  const requestFile = useCallback(
    (file: DiffFileView): void => {
      request(toFileRequest(file), file.conflicted);
    },
    [request],
  );

  /** Discards and re-reads one row's diff. */
  const retryFile = useCallback(
    (file: DiffFileView): void => {
      retry(toFileRequest(file), file.conflicted);
    },
    [retry],
  );

  return { get, fileState, request, requestFile, retry, retryFile };
}
