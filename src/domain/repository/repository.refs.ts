import { readLocalBranches } from "@/domain/git/git.branches";
import { redactText } from "@/domain/git/git.redact";
import { readRemoteBranches } from "@/domain/git/git.remote-branches";
import { readStashes } from "@/domain/git/git.stashes";
import { readLocalTags } from "@/domain/git/git.tags";
import type {
  BranchRecord,
  GitClient,
  GitFailure,
  LocalBranchReadResult,
  RemoteBranchReadResult,
  RemoteInfo,
  WorktreeRecord,
} from "@/domain/git/git.types";
import {
  buildWorktreeBranchMap,
  readWorktreeDirty,
  readWorktrees,
} from "@/domain/git/git.worktrees";
import type { SnapshotRefsRead, SnapshotRefsReadOptions } from "./repository.refs.types";
import type {
  RepositoryListFailures,
  RepositoryListName,
  UpstreamEvidence,
} from "./repository.types";
import { classifyBranchUpstreams } from "./repository.upstream";

/** Maximum number of worktree dirty reads in flight at once. */
const WORKTREE_DIRTY_CONCURRENCY = 4;

/** Failure message used when an optional list failure carries no message. */
const UNKNOWN_LIST_FAILURE = "read failed";

/** Optional lists in a stable order, so failure collection never depends on object keys. */
const OPTIONAL_LIST_NAMES: readonly RepositoryListName[] = Object.freeze([
  "branches",
  "remoteBranches",
  "tags",
  "stashes",
  "worktrees",
]);

/** Successful read with no optional list failure. */
export const NO_LIST_FAILURES: RepositoryListFailures = Object.freeze({});

/**
 * Reads every ref list the snapshot exposes and settles each one independently.
 *
 * Worktrees are read in the same batch and merged afterwards, so branch rows carry their worktree
 * attribution without a second pass over git. Their dirty state is then read with bounded
 * concurrency. A failed list contributes an empty value plus one entry in the returned failure map,
 * and every other list still reaches the snapshot. Merge state is deliberately absent: only the
 * delete confirmation needs it, so it is read lazily for the selected branch instead of costing one
 * `for-each-ref --merged` process per distinct base on every refresh.
 *
 * Remote-tracking refs are required evidence for upstream classification: when that read fails, the
 * parsed `unknown` upstream placeholder is kept instead of classifying every tracked branch as
 * missing, because failed knowledge is never absence.
 *
 * @param client - Git client bound to the configured executable.
 * @param options - Working directory, signal, and evidence.
 * @param remotes - Configured remotes, needed to attribute remote-tracking refs.
 * @param root - Absolute work-tree root of this session.
 * @returns The ref lists and the per-list failures.
 */
export async function readSnapshotRefs(
  client: GitClient,
  options: SnapshotRefsReadOptions,
  remotes: readonly RemoteInfo[],
  root: string | null,
): Promise<SnapshotRefsRead> {
  const repoOptions = { cwd: options.cwd, signal: options.signal };
  const [branchesRead, remoteBranchesRead, tagsRead, stashesRead, worktreesRead] =
    await Promise.all([
      readLocalBranches(client, repoOptions),
      readRemoteBranches(client, repoOptions, remotes),
      readLocalTags(client, repoOptions),
      readStashes(client, repoOptions),
      readWorktrees(client, repoOptions, root),
    ]);
  const listFailures = collectListFailures({
    branches: branchesRead.failure,
    remoteBranches: remoteBranchesRead.failure,
    tags: tagsRead.failure,
    stashes: stashesRead.failure,
    worktrees: worktreesRead.failure,
  });
  const worktrees = await readWorktreeDirtyStates(client, repoOptions, worktreesRead.worktrees);
  const branches = buildBranchRows({
    branchesRead,
    remoteBranchesRead,
    worktrees,
    evidence: options.evidence,
  });

  return {
    branches,
    remoteBranches: remoteBranchesRead.remoteBranches,
    tags: tagsRead.tags,
    stashes: stashesRead.stashes,
    worktrees,
    listFailures,
  };
}

/**
 * Builds the redacted failure message for every optional list that did not read.
 *
 * @param failures - Classified failure per optional list, or null when the list read succeeded.
 * @returns A frozen map that carries only the failed lists.
 */
function collectListFailures(
  failures: Readonly<Partial<Record<RepositoryListName, GitFailure | null>>>,
): RepositoryListFailures {
  const result: Partial<Record<RepositoryListName, string>> = {};
  let failed = false;

  for (const name of OPTIONAL_LIST_NAMES) {
    const failure = failures[name];

    if (failure !== null && failure !== undefined) {
      result[name] = redactText(failure.message) || UNKNOWN_LIST_FAILURE;
      failed = true;
    }
  }

  return failed ? Object.freeze(result) : NO_LIST_FAILURES;
}

/**
 * Builds the branch rows for one snapshot from the branch, remote-branch, and worktree reads.
 *
 * A failed branch read yields no rows. A failed remote-branch read keeps the parsed upstream
 * placeholder, so no branch claims its upstream is missing because of an unread list.
 *
 * @param input - The settled reads plus session evidence.
 * @returns Branch rows with worktree paths and upstream classification applied.
 */
function buildBranchRows(input: {
  readonly branchesRead: LocalBranchReadResult;
  readonly remoteBranchesRead: RemoteBranchReadResult;
  readonly worktrees: readonly WorktreeRecord[];
  readonly evidence: UpstreamEvidence;
}): readonly BranchRecord[] {
  if (!input.branchesRead.ok) {
    return [];
  }

  const classified = input.remoteBranchesRead.ok
    ? classifyBranchUpstreams(
        input.branchesRead.branches,
        input.remoteBranchesRead.remoteBranches,
        input.evidence,
      )
    : input.branchesRead.branches;

  return applyWorktreePaths(classified, input.worktrees);
}

/**
 * Reads the dirty state of every eligible worktree with bounded concurrency.
 *
 * The current worktree and a prunable worktree are never probed: the current one is excluded
 * because its state is already the repository status, and a prunable one may no longer be
 * readable. A failed probe keeps `dirty` false, because unknown is not dirty and the snapshot must
 * not fail over an optional observation.
 *
 * @param client - Git client bound to the configured executable.
 * @param options - Working directory and cancellation signal.
 * @param worktrees - Worktrees read in this snapshot, with the current one already marked.
 * @returns Worktrees with every readable dirty state applied.
 */
async function readWorktreeDirtyStates(
  client: GitClient,
  options: { readonly cwd: string; readonly signal: AbortSignal },
  worktrees: readonly WorktreeRecord[],
): Promise<readonly WorktreeRecord[]> {
  return await mapWithConcurrency(worktrees, WORKTREE_DIRTY_CONCURRENCY, async (worktree) => {
    if (worktree.current || worktree.prunable) {
      return worktree;
    }

    const dirtyRead = await readWorktreeDirty(client, options, worktree.path);

    return dirtyRead.ok ? { ...worktree, dirty: dirtyRead.dirty } : worktree;
  });
}

/**
 * Maps every item through an async mapper while limiting the number in flight.
 *
 * Results keep input order. The helper is pure apart from calling the supplied mapper, so the
 * repository read can bound process concurrency without duplicating a worker loop.
 *
 * @param items - Items to map.
 * @param limit - Maximum number of mapper calls in flight.
 * @param mapper - Async mapper receiving one item.
 * @returns The mapped values in input order.
 */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  mapper: (item: T) => Promise<R>,
): Promise<readonly R[]> {
  const results: R[] = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(limit, 1), items.length);

  const worker = async (): Promise<void> => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;

      const item = items[index];

      if (item === undefined) {
        continue;
      }

      results[index] = await mapper(item);
    }
  };

  await Promise.all(Array.from({ length: workerCount }, worker));

  return results;
}

/**
 * Merges the worktree map into branch rows.
 *
 * A branch checked out in this worktree keeps a null `worktreePath`, because the row's current
 * marker already says where it is. Only another worktree's location is recorded, which is exactly
 * what the branches panel needs for its `+` marker and its delete guard.
 *
 * The helper is pure and is also the recovery path for a partial read: when the worktree list fails
 * but the store retains its previous value, the caller re-derives the branch worktree paths from
 * those retained worktrees so the marker, the selected-row detail, and the delete guard stay
 * consistent with the rows the Worktrees panel still shows.
 *
 * @param branches - Classified local branches.
 * @param worktrees - Worktrees the branch attribution must use.
 * @returns New branch records with `worktreePath` resolved.
 */
export function applyWorktreePaths(
  branches: readonly BranchRecord[],
  worktrees: readonly WorktreeRecord[],
): readonly BranchRecord[] {
  const map = buildWorktreeBranchMap(worktrees);

  return branches.map((branch) => {
    const worktree = map.get(branch.name);

    return worktree === undefined || worktree.current
      ? branch
      : { ...branch, worktreePath: worktree.path };
  });
}
