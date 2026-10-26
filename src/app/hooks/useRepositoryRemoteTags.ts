import { useCallback, useEffect, useMemo, useRef } from "react";
import type {
  RepositoryRemoteTags,
  RepositoryRemoteTagsInput,
} from "@/app/hooks/useRepositoryRemoteTags.types";
import { readRemoteTags } from "@/domain/git/git.tags";
import type { GitClient } from "@/domain/git/git.types";
import type { RemoteTagCheck, RemoteTagChecks } from "@/domain/repository/repository.types";

/**
 * Maximum number of remote tag reads in flight at once.
 *
 * Each read is a network invocation, so the bound keeps a repository with many remotes from opening
 * every connection at once while still finishing a normal two- or three-remote setup in one round.
 */
const TAG_CHECK_CONCURRENCY = 3;

/**
 * Owns remote tag knowledge: the last known advertised tag names per remote.
 *
 * The snapshot read deliberately carries local tags only, because remote tag names require network
 * invocations that must not slow down every refresh. This hook performs those reads on demand, keeps
 * the previous names when a read fails, and never refreshes the repository snapshot. A tag is only
 * provably absent after a successful read, so a failed read keeps its names and reports `failed`
 * instead of pretending the set is empty.
 *
 * Calls are coalesced without losing a mutation: a caller that arrives while a check is in flight
 * queues exactly one follow-up full check and resolves after that follow-up settles. A tag push or
 * delete that lands inside the in-flight window is therefore always observed by a read that started
 * after it.
 *
 * @param input - Client, launch directory, store writer, mount state, and clock.
 * @returns The tag refresh operation.
 */
export function useRepositoryRemoteTags(input: RepositoryRemoteTagsInput): RepositoryRemoteTags {
  const { client, cwd, mountedRef, now, setStore, storeRef } = input;
  const activeRef = useRef<Promise<void> | null>(null);
  const queuedRef = useRef<Promise<void> | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      controllerRef.current?.abort();
    },
    [],
  );

  /** Runs one full check against the configured remotes and stores its result. */
  const runCheck = useCallback(async (): Promise<void> => {
    const remotes = (storeRef.current.snapshot?.remotes ?? []).map((remote) => remote.name);

    if (remotes.length === 0) {
      return;
    }

    const controller = new AbortController();
    controllerRef.current = controller;

    try {
      await runRefresh({
        client,
        cwd,
        signal: controller.signal,
        remotes,
        previous: storeRef.current.remoteTagChecks,
        now,
        mountedRef,
        setStore,
      });
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
      }
    }
  }, [client, cwd, mountedRef, now, setStore, storeRef]);

  /** Starts one check and keeps it registered as the active check until it settles. */
  const startCheck = useCallback((): Promise<void> => {
    const task = runCheck().finally(() => {
      if (activeRef.current === task) {
        activeRef.current = null;
      }
    });

    activeRef.current = task;

    return task;
  }, [runCheck]);

  /**
   * Queues exactly one check behind the given one.
   *
   * The queue slot is released as soon as the follow-up becomes the active check, so a caller that
   * arrives during the follow-up queues its own single follow-up instead of joining a read that
   * already started before its mutation.
   */
  const queueFollowUp = useCallback(
    (preceding: Promise<void>): Promise<void> => {
      const task = preceding
        .catch(() => undefined)
        .then(async () => {
          if (queuedRef.current === task) {
            queuedRef.current = null;
          }

          await startCheck();
        });

      return task;
    },
    [startCheck],
  );

  /** Re-reads every configured remote's tags and stores the result. */
  const refreshRemoteTags = useCallback(async (): Promise<void> => {
    if (activeRef.current !== null) {
      queuedRef.current ??= queueFollowUp(activeRef.current);
    }

    // A queued check that has not started yet already reflects every mutation this caller can see,
    // so joining it is enough. The active read is never awaited directly: its result predates the
    // caller's mutation.
    const pending = queuedRef.current;

    if (pending !== null) {
      await pending;

      return;
    }

    await startCheck();
  }, [queueFollowUp, startCheck]);

  return useMemo(() => ({ refreshRemoteTags }), [refreshRemoteTags]);
}

/**
 * Reads every remote's tags and writes the merged knowledge once.
 *
 * @param input - Client, working directory, signal, remotes, previous knowledge, clock, and store.
 * @returns A promise that settles after the write, or immediately after unmount.
 */
async function runRefresh(input: {
  readonly client: GitClient;
  readonly cwd: string;
  readonly signal: AbortSignal;
  readonly remotes: readonly string[];
  readonly previous: RemoteTagChecks;
  readonly now: () => number;
  readonly mountedRef: { readonly current: boolean };
  readonly setStore: RepositoryRemoteTagsInput["setStore"];
}): Promise<void> {
  const checks = await collectRemoteTagChecks(input.client, {
    cwd: input.cwd,
    signal: input.signal,
    remotes: input.remotes,
    previous: input.previous,
    now: input.now,
  });

  if (!input.mountedRef.current) {
    return;
  }

  input.setStore((store) => ({
    ...store,
    remoteTagChecks: { ...store.remoteTagChecks, ...checks },
  }));
}

/**
 * Reads every remote's advertised tags with bounded concurrency.
 *
 * A successful read replaces that remote's names, its check time, and its `known` status. A failed,
 * cancelled, timed-out, or truncated read keeps the previous names and check time and reports
 * `failed`, so no caller can turn a failed check into an absent tag.
 *
 * @param client - Git client bound to the configured executable.
 * @param options - Working directory, signal, remotes, previous knowledge, and clock.
 * @returns The new tag knowledge per remote.
 */
export async function collectRemoteTagChecks(
  client: GitClient,
  options: {
    readonly cwd: string;
    readonly signal: AbortSignal;
    readonly remotes: readonly string[];
    readonly previous: RemoteTagChecks;
    readonly now: () => number;
  },
): Promise<RemoteTagChecks> {
  const checks: Record<string, RemoteTagCheck> = {};

  for (const group of chunk(options.remotes, TAG_CHECK_CONCURRENCY)) {
    const results = await Promise.all(
      group.map(async (remote) => {
        const read = await readRemoteTags(
          client,
          { cwd: options.cwd, signal: options.signal },
          remote,
        );

        return [remote, read] as const;
      }),
    );

    for (const [remote, read] of results) {
      checks[remote] = read.ok
        ? { names: read.names, checkedAt: options.now(), status: "known" }
        : failedTagCheck(options.previous[remote]);
    }
  }

  return checks;
}

/**
 * Builds the knowledge kept after a failed read.
 *
 * @param previous - Knowledge from the last successful read, when any.
 * @returns The previous names with a failed status.
 */
function failedTagCheck(previous: RemoteTagCheck | undefined): RemoteTagCheck {
  return previous === undefined
    ? { names: [], checkedAt: null, status: "failed" }
    : { ...previous, status: "failed" };
}

/**
 * Splits a list into fixed-size groups.
 *
 * @param values - Values to split.
 * @param size - Maximum group size.
 * @returns The groups in order.
 */
function chunk<T>(values: readonly T[], size: number): readonly (readonly T[])[] {
  const groups: T[][] = [];

  for (let index = 0; index < values.length; index += size) {
    groups.push(values.slice(index, index + size));
  }

  return groups;
}
