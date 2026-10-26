import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDebouncedValue } from "@/app/hooks/useDebouncedValue";
import { useFocusRegion } from "@/app/hooks/useFocusRegion";
import { useInternalCommands } from "@/app/hooks/useInternalCommands";
import { useListCursor } from "@/app/hooks/useListCursor";
import { useRepository } from "@/app/hooks/useRepository";
import { readCommitDetails, readCommitStats } from "@/domain/git/git.log";
import type { CommitDetailsRecord, GitClient } from "@/domain/git/git.types";
import { selectCommitRefs } from "@/domain/repository/repository.selectors";
import type { CommitBundleResult, CommitReadState } from "./commit-details.types";

/** Region owned by the commit details pane. */
const COMMIT_DETAILS_REGION_ID = "right-pane";

/** Quiet interval before a moving selection starts its details read. */
const COMMIT_DETAILS_DEBOUNCE_MS = 120;

/** Lines of the commit message shown while the body is collapsed. */
export const COMMIT_MESSAGE_COLLAPSED_LINES = 8;

/** Parent rows the nested parent list shows before it scrolls. */
export const COMMIT_PARENT_LIST_MAX_ROWS = 4;

/** Narrowest metadata budget, so a tiny terminal still shows a usable row. */
export const COMMIT_META_MIN_BUDGET = 24;

/** Width reserved for a metadata label such as `Committer`. */
export const COMMIT_META_LABEL_WIDTH = 11;

/** Character budget of one ref badge label. */
export const COMMIT_REF_BADGE_MAX_LENGTH = 28;

/** Badges rendered before the overflow marker replaces the rest. */
export const COMMIT_REF_BADGE_CAP = 12;

/** Longest parent subject rendered in one row. */
export const COMMIT_PARENT_SUBJECT_MAX_LENGTH = 64;

/** Characters of a parent OID shown when no abbreviated form is available. */
export const COMMIT_SHORT_OID_LENGTH = 7;

/** Loading label while the debounced details read is in flight. */
export const COMMIT_DETAILS_LOADING_LABEL = "Loading commit details...";

/** Loading label while a parent commit is loaded through the graph navigator. */
export const COMMIT_DETAILS_LOADING_PARENT_LABEL = "Loading parent commit...";

/** Persistent error message for a failed details read. */
export const COMMIT_DETAILS_ERROR_MESSAGE = "Could not load commit details";

/** Empty parent state for a root commit. */
export const COMMIT_DETAILS_NO_PARENTS = "No parents";

/** Empty ref state, so the refs row is never blank. */
export const COMMIT_DETAILS_NO_REFS = "No refs";

/** Read-only notice shown in the header. */
export const COMMIT_DETAILS_READ_ONLY = "read-only";

/** Note shown when the stats read stopped at its file cap. */
export const COMMIT_DETAILS_STATS_TRUNCATED = "stats truncated";

/** Bounded-miss message when the parent is outside the loaded history. */
export const COMMIT_DETAILS_BOUNDED_MISS = "Parent commit is not within the loaded history";

/** Label of the message expand toggle while the body is collapsed. */
export const COMMIT_DETAILS_SHOW_MORE = "Show full message";

/** Label of the message expand toggle while the body is expanded. */
export const COMMIT_DETAILS_SHOW_LESS = "Show less";

/** Stable renderable id of the message expand toggle. */
export const COMMIT_DETAILS_MESSAGE_TOGGLE_ID = "commit-message-toggle";

/** Stable id of the retry button. */
export const COMMIT_DETAILS_RETRY_ID = "commit-details-retry";

/** Stable id prefix of one parent row. */
export const COMMIT_PARENT_ROW_ID_PREFIX = "commit-parent-";

/** Stable identity used when a commit has no parents. */
const EMPTY_PARENTS: readonly string[] = Object.freeze([]);

/** Stable identity used when no decorations are loaded. */
const EMPTY_DECORATIONS: readonly string[] = Object.freeze([]);

/** Initial read state before any selection. */
const INITIAL_READ_STATE: CommitReadState = Object.freeze({
  status: "idle",
  loaded: null,
  error: null,
});

/**
 * Owns the commit details read, parent cursor, and parent selection.
 *
 * The selected OID is read from `RepositoryProvider` and never copied into hook state. The read is
 * debounced, serialized to one in-flight pair of invocations, and cancelled when the selection,
 * repository generation, or working directory changes; a settled result whose version is stale is
 * discarded before it can replace the visible commit. The previous details stay visible while the
 * next read runs, so fast graph navigation does not flash an empty pane.
 *
 * Parent rows show the short hash only. The loaded graph window belongs to the graph feature and a
 * feature cannot import another feature, so reading every parent subject would add one invocation
 * per parent to a pane that must stay responsive. The capture stays single-flight by never walking
 * history and never reading outside the internal `graph.selectCommit` command, which performs the
 * bounded `ensureLoaded` walk and changes the selection only when the parent is loaded.
 *
 * @returns The region handle, loaded values, read state, refs, parent cursor, and retry callback.
 */
export function useCommitDetails() {
  const repository = useRepository();
  const region = useFocusRegion(COMMIT_DETAILS_REGION_ID);
  const selection = repository.selection;
  const selectedOid = selection.kind === "commit" ? selection.oid : null;
  const cwd =
    repository.snapshot?.root ?? repository.signals.repositoryRoot ?? repository.signals.cwd;
  const read = useCommitRead({
    client: repository.gitClient,
    cwd,
    oid: selectedOid,
    generation: repository.generation,
  });
  const details = read.loaded?.details ?? null;
  const stats = read.loaded?.stats ?? null;
  const parents = details?.parents ?? EMPTY_PARENTS;
  const parentNavigation = useParentNavigation({ parents });
  const [expandedForOid, setExpandedForOid] = useState<string | null>(null);
  const messageExpanded = details !== null && expandedForOid === details.oid;

  const refs = useMemo(
    () =>
      selectCommitRefs(
        repository.snapshot,
        details?.oid ?? "",
        details?.decorations ?? EMPTY_DECORATIONS,
      ),
    [details, repository.snapshot],
  );

  /** Toggles the collapsed message body of the visible commit. */
  const toggleMessage = useCallback(() => {
    const oid = details?.oid ?? "";

    setExpandedForOid((current) => (current === oid ? null : oid));
  }, [details?.oid]);

  return {
    region,
    selectedOid,
    details,
    stats,
    refs,
    committerDiffers: details === null ? false : isCommitterDifferent(details),
    status: read.status,
    isLoading: read.status === "loading",
    error: read.error,
    retry: read.retry,
    parents,
    parentIndex: parentNavigation.parentIndex,
    activeParentId: parentNavigation.activeParentId,
    boundedMiss: parentNavigation.boundedMiss,
    isLoadingParent: parentNavigation.isLoadingParent,
    handleParentMouseDown: parentNavigation.handleParentMouseDown,
    messageExpanded,
    toggleMessage,
    title: details === null ? "Commit" : `Commit ${details.shortOid}`,
  };
}

/**
 * Reports whether the committer row belongs on the pane.
 *
 * Git keeps the author fields unchanged through a rebase, amend, or cherry-pick while the committer
 * fields record the rewrite. The row is shown when the name, the email, or the strict ISO date
 * differs, so a rewrite with the same identity is still explained by its changed date.
 *
 * @param details - Parsed commit details.
 * @returns True when any author or committer field differs.
 */
function isCommitterDifferent(
  details: Pick<
    CommitDetailsRecord,
    | "authorName"
    | "authorEmail"
    | "authorDate"
    | "committerName"
    | "committerEmail"
    | "committerDate"
  >,
): boolean {
  return (
    details.authorName !== details.committerName ||
    details.authorEmail !== details.committerEmail ||
    details.authorDate !== details.committerDate
  );
}

/**
 * Debounces and runs the details read for one selection.
 *
 * A request key combines the debounced OID, the retry count, the repository generation, and the
 * working directory, so a settled read is never repeated for the same inputs while a new selection,
 * refresh, or Retry produces exactly one new attempt. The previous pair stays visible while a newer
 * read is in flight, and a settled failure clears it so stale details never display beside the new
 * selection's title and diff.
 *
 * @param input - Git client, working directory, selected OID, and repository generation.
 * @returns The read state and the retry callback.
 */
function useCommitRead(input: {
  readonly client: GitClient;
  readonly cwd: string;
  readonly oid: string | null;
  readonly generation: number;
}) {
  const debouncedOid = useDebouncedValue(input.oid, COMMIT_DETAILS_DEBOUNCE_MS);
  const [state, setState] = useState<CommitReadState>(INITIAL_READ_STATE);
  const [retryCount, setRetryCount] = useState(0);
  const versionRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const requestRef = useRef({
    client: input.client,
    cwd: input.cwd,
    oid: debouncedOid,
  });
  const requestKey =
    debouncedOid === null ? null : `${debouncedOid}|${retryCount}|${input.generation}|${input.cwd}`;

  requestRef.current = { client: input.client, cwd: input.cwd, oid: debouncedOid };

  useEffect(() => {
    const request = requestRef.current;
    const key = requestKey;

    if (key === null || request.oid === null) {
      versionRef.current += 1;
      abortRef.current?.abort();
      abortRef.current = null;
      setState(INITIAL_READ_STATE);
      return;
    }

    const version = versionRef.current + 1;
    const controller = new AbortController();

    versionRef.current = version;
    abortRef.current?.abort();
    abortRef.current = controller;
    setState((current) => ({ status: "loading", loaded: current.loaded, error: null }));

    void readCommitBundle({
      client: request.client,
      cwd: request.cwd,
      oid: request.oid,
      signal: controller.signal,
    }).then((result) => {
      if (versionRef.current !== version) {
        return;
      }

      abortRef.current = null;

      setState((current) => ({
        status: result.error === null ? "loaded" : "error",
        // Keep the previous commit only while a newer read is in flight. A settled error clears it,
        // because stale hashes beside the new selection and its diff would describe two commits.
        loaded: result.error === null ? (result.loaded ?? current.loaded) : null,
        error: result.error,
      }));
    });

    return () => {
      versionRef.current += 1;
      controller.abort();
    };
  }, [requestKey]);

  /** Discards the failed attempt and reads the current selection again. */
  const retry = useCallback(() => {
    setRetryCount((current) => current + 1);
  }, []);

  return { ...state, retry };
}

/**
 * Reads the details and stats of one commit.
 *
 * The two invocations run in order on the same signal, so the pair is one logical read. A failure
 * in either invocation reports a message and no pair, which keeps the previous commit visible.
 *
 * @param input - Client, working directory, commit id, and cancellation signal.
 * @returns The loaded pair or the failure message.
 */
async function readCommitBundle(input: {
  readonly client: GitClient;
  readonly cwd: string;
  readonly oid: string;
  readonly signal: AbortSignal;
}): Promise<CommitBundleResult> {
  const details = await readCommitDetails(input.client, {
    cwd: input.cwd,
    signal: input.signal,
    oid: input.oid,
  });

  if (!details.ok || details.details === null) {
    return {
      loaded: null,
      error: details.failure?.message ?? COMMIT_DETAILS_ERROR_MESSAGE,
    };
  }

  const stats = await readCommitStats(input.client, {
    cwd: input.cwd,
    signal: input.signal,
    oid: input.oid,
  });

  if (!stats.ok || stats.stats === null) {
    return {
      loaded: null,
      error: stats.failure?.message ?? COMMIT_DETAILS_ERROR_MESSAGE,
    };
  }

  return { loaded: { details: details.details, stats: stats.stats }, error: null };
}

/**
 * Owns the parent cursor and the parent selection request.
 *
 * The cursor is the shared `right-pane` cursor registered by `useListCursor` with only `nav.up`,
 * `nav.down`, and `nav.activate`; no first, last, page, or global action is registered. Activation
 * dispatches the internal `graph.selectCommit` command, which loads the parent through the graph's
 * bounded navigator and changes the selection only on success. A `notFound` or `exceeded` result
 * shows the bounded-miss message and leaves the selection unchanged, while a `cancelled` walk caused
 * by a refresh or an `error` from a failed page read stays neutral. Re-entry is rejected while one
 * parent load is in flight, so a double click cannot start a second walk.
 *
 * @param input - Parent OIDs in git order.
 * @returns Cursor state, parent loading state, the bounded-miss flag, and the row click handler.
 */
function useParentNavigation(input: { readonly parents: readonly string[] }) {
  const { selectCommit } = useInternalCommands();
  const parentsKey = input.parents.join(" ");
  const [missedParentsKey, setMissedParentsKey] = useState<string | null>(null);
  const [isLoadingParent, setIsLoadingParent] = useState(false);
  const loadingRef = useRef(false);
  const cursorIndexRef = useRef(0);
  const items = useMemo(() => input.parents.map((oid) => ({ id: oid })), [input.parents]);
  const { parents } = input;
  const boundedMiss = missedParentsKey !== null && missedParentsKey === parentsKey;

  const activate = useCallback(
    (index: number): void => {
      const oid = parents[index];

      if (oid === undefined || loadingRef.current) {
        return;
      }

      const requestedParentsKey = parents.join(" ");

      loadingRef.current = true;
      setIsLoadingParent(true);
      setMissedParentsKey(null);

      void (async () => {
        try {
          const outcome = await selectCommit(oid);

          if (outcome === "notFound" || outcome === "exceeded") {
            setMissedParentsKey(requestedParentsKey);
          }
        } finally {
          loadingRef.current = false;
          setIsLoadingParent(false);
        }
      })();
    },
    [parents, selectCommit],
  );

  const cursor = useListCursor({
    regionId: COMMIT_DETAILS_REGION_ID,
    items,
    onActivate: () => {
      activate(cursorIndexRef.current);
    },
    onDoubleClick: activate,
    enableFirstLast: false,
  });

  cursorIndexRef.current = cursor.index;

  return {
    parentIndex: cursor.index,
    activeParentId: cursor.activeId,
    boundedMiss,
    isLoadingParent,
    handleParentMouseDown: cursor.handleRowClick,
  };
}
