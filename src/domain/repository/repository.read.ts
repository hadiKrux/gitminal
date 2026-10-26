import { redactText } from "@/domain/git/git.redact";
import { readRemotes } from "@/domain/git/git.remotes";
import {
  readGitIdentity,
  readHeadProbe,
  readHeadSubject,
  readOperationProbe,
  readRepositoryProbeDetail,
} from "@/domain/git/git.repo";
import { readStatus } from "@/domain/git/git.status";
import type {
  GitClient,
  GitFailure,
  GitFailureKind,
  GitIdentity,
  RemoteInfo,
  WorktreeRecord,
} from "@/domain/git/git.types";
import { NO_LIST_FAILURES, readSnapshotRefs } from "./repository.refs";
import type { SnapshotRefsRead } from "./repository.refs.types";
import { createRepositorySignals } from "./repository.states";
import type {
  RepositoryReadOptions,
  RepositoryReadResult,
  RepositorySignals,
  RepositorySnapshot,
  UpstreamCheck,
  UpstreamStatus,
} from "./repository.types";
import { readHasUpstreamBranches, readUpstreamStatus } from "./repository.upstream";

/** Identity used when the read cannot answer. */
const UNKNOWN_IDENTITY: GitIdentity = Object.freeze({ name: null, email: null });

/**
 * Reads one complete repository snapshot plus the signals that classify it.
 *
 * Discovery runs first so a directory that is not a repository, a bare repository, or a missing git
 * executable is reported without attempting deeper reads. For a work tree, head, operation markers,
 * status, remotes, and identity are read together; status and the remote list are the required deeper
 * reads, because every count, every remote-tracking ref, and every remote action depends on them.
 * Branches, remote-tracking branches, tags, stashes, and worktrees are read next in one parallel
 * batch, and each of those settled independently: a failed list still produces a snapshot with an
 * empty value for that list and a classified entry in `listFailures`, so a corrupt stash reflog never
 * freezes the branch, status, or working-tree facts.
 *
 * The function never throws for a git failure: it returns `ok: false` with a classified message and
 * the caller keeps its previous snapshot.
 *
 * @param client - Git client bound to the configured executable.
 * @param options - Working directory, signal, clock, and upstream evidence.
 * @returns The snapshot, signals, optional list failures, upstream status, and any classified error.
 */
export async function readRepositorySnapshot(
  client: GitClient,
  options: RepositoryReadOptions,
): Promise<RepositoryReadResult> {
  const detail = await readRepositoryProbeDetail(client, {
    cwd: options.cwd,
    signal: options.signal,
  });
  const gitFailure = readGitFailure(detail.insideFailure, detail.metaFailure);

  if (gitFailure !== null && gitFailure.kind !== "not-a-repository") {
    return createFailureResult(options.cwd, gitFailure, detail.probe.gitDir);
  }

  if (!detail.probe.insideWorkTree) {
    return createNonWorkTreeResult(options, detail.probe.bare, detail.probe.gitDir);
  }

  return await readWorkTreeSnapshot(client, options, detail.probe);
}

/**
 * Reads the deeper snapshot for a working tree.
 *
 * @param client - Git client bound to the configured executable.
 * @param options - Working directory, signal, clock, and evidence.
 * @param probe - Discovery signals for the working tree.
 * @returns The snapshot and signals, or a classified failure.
 */
async function readWorkTreeSnapshot(
  client: GitClient,
  options: RepositoryReadOptions,
  probe: { readonly root: string | null; readonly gitDir: string | null },
): Promise<RepositoryReadResult> {
  const repoOptions = { cwd: options.cwd, signal: options.signal };
  const [head, headSubject, operations, statusRead, remotesRead, identity] = await Promise.all([
    readHeadProbe(client, repoOptions),
    readHeadSubject(client, repoOptions),
    readOperationProbe(client, repoOptions),
    readStatus(client, repoOptions),
    readRemotes(client, repoOptions),
    readGitIdentity(client, repoOptions),
  ]);

  if (!statusRead.ok || statusRead.snapshot === null) {
    return createFailureResult(options.cwd, statusRead.failure, probe.gitDir);
  }

  // A truncated `git remote -v` can drop a remote from the middle of the output. Inferring a
  // no-remote state from incomplete evidence would silently disable every remote action, so the
  // read fails and the provider keeps its previous snapshot.
  if (!remotesRead.ok) {
    return createFailureResult(options.cwd, remotesRead.failure, probe.gitDir);
  }

  const refs = await readSnapshotRefs(client, options, remotesRead.remotes, probe.root);

  const status = statusRead.snapshot;
  const branch = head.branch ?? status.branch;
  const upstream = await readUpstreamStatus(client, {
    ...repoOptions,
    branch,
    evidence: options.evidence,
  });
  const snapshot = buildSnapshot({
    options,
    probe,
    status,
    head,
    headSubject,
    branch,
    remotes: remotesRead.remotes,
    refs,
    upstream: upstream.upstream ?? status.upstream,
    identity,
  });
  const signals = buildWorkTreeSignals({
    cwd: options.cwd,
    snapshot,
    status,
    head,
    operations,
    remotes: remotesRead.remotes,
    identity,
    upstreamStatus: upstream.status,
    upstreamRef: snapshot.upstream,
    hasUpstreamBranches:
      refs.branches.length > 0
        ? refs.branches.some((record) => record.upstream !== null)
        : await readHasUpstreamBranches(client, repoOptions),
    root: probe.root,
    gitDir: probe.gitDir,
  });

  return {
    ok: true,
    snapshot,
    signals,
    listFailures: refs.listFailures,
    upstreamStatus: upstream.status,
    gitAvailable: true,
    error: null,
    failureKind: null,
  };
}

/**
 * Builds the snapshot object for one successful working-tree read.
 *
 * @param input - Probe, head, status, remotes, ref lists, upstream ref, and identity.
 * @returns The frozen snapshot.
 */
function buildSnapshot(input: {
  readonly options: RepositoryReadOptions;
  readonly probe: { readonly root: string | null; readonly gitDir: string | null };
  readonly status: NonNullable<RepositorySnapshot["status"]>;
  readonly head: Awaited<ReturnType<typeof readHeadProbe>>;
  readonly headSubject: string | null;
  readonly branch: string | null;
  readonly remotes: readonly RemoteInfo[];
  readonly refs: SnapshotRefsRead;
  readonly upstream: string | null;
  readonly identity: GitIdentity;
}): RepositorySnapshot {
  return {
    cwd: input.options.cwd,
    root: input.probe.root,
    gitDir: input.probe.gitDir,
    branch: input.branch,
    headOid: input.status.headOid,
    headSubject: input.headSubject,
    shortHash: input.head.shortHash,
    detached: input.head.detached,
    bare: false,
    remotes: input.remotes,
    upstream: input.upstream,
    ahead: input.status.ahead,
    behind: input.status.behind,
    status: input.status,
    branches: input.refs.branches,
    remoteBranches: input.refs.remoteBranches,
    tags: input.refs.tags,
    stashes: input.refs.stashes,
    worktrees: input.refs.worktrees,
    currentWorktreePath: readCurrentWorktreePath(input.refs.worktrees),
    identity: input.identity,
    readAt: input.options.now(),
  };
}

/**
 * Reads the absolute path of the worktree that contains this session's repository root.
 *
 * @param worktrees - Worktrees read in the same snapshot.
 * @returns The current worktree path, or null when git reported none.
 */
function readCurrentWorktreePath(worktrees: readonly WorktreeRecord[]): string | null {
  return worktrees.find((worktree) => worktree.current)?.path ?? null;
}

/**
 * Builds the signal set for a readable working tree.
 *
 * @param input - Values read for the snapshot.
 * @returns A complete frozen signal set.
 */
function buildWorkTreeSignals(input: {
  readonly cwd: string;
  readonly snapshot: RepositorySnapshot;
  readonly status: NonNullable<RepositorySnapshot["status"]>;
  readonly head: Awaited<ReturnType<typeof readHeadProbe>>;
  readonly operations: Awaited<ReturnType<typeof readOperationProbe>>;
  readonly remotes: readonly RemoteInfo[];
  readonly identity: GitIdentity;
  readonly upstreamStatus: UpstreamStatus;
  readonly upstreamRef: string | null;
  readonly hasUpstreamBranches: boolean;
  readonly root: string | null;
  readonly gitDir: string | null;
}): RepositorySignals {
  return createRepositorySignals({
    cwd: input.cwd,
    loaded: true,
    gitAvailable: true,
    insideWorkTree: true,
    bare: false,
    repositoryRoot: input.root,
    gitDir: input.gitDir,
    headExists: input.status.headOid !== null,
    branch: input.snapshot.branch,
    detached: input.head.detached,
    shortHash: input.head.shortHash,
    remotes: input.remotes.map((remote) => remote.name),
    upstream: input.upstreamRef,
    upstreamExists: input.upstreamStatus === "healthy",
    upstreamCheck: toUpstreamCheck(input.upstreamStatus),
    hasUpstreamBranches: input.hasUpstreamBranches,
    mergeInProgress: input.operations.mergeInProgress,
    rebaseInProgress: input.operations.rebaseInProgress,
    cherryPickInProgress: input.operations.cherryPickInProgress,
    conflictedPaths: input.status.conflictedPaths,
    stagedCount: input.status.stagedCount,
    unstagedCount: input.status.unstagedCount,
    untrackedCount: input.status.untrackedCount,
    identity: input.identity,
    notARepository: false,
  });
}

/**
 * Maps an upstream classification to the coarse signal flag.
 *
 * @param status - Upstream classification.
 * @returns `none`, `checked`, or `unknown`.
 */
function toUpstreamCheck(status: UpstreamStatus): UpstreamCheck {
  if (status === "none") {
    return "none";
  }

  return status === "unknown" ? "unknown" : "checked";
}

/**
 * Builds the result for a directory that is not a work tree.
 *
 * A bare repository and a plain directory are valid observable states, not failures.
 *
 * @param options - Read options.
 * @param bare - True for a bare repository.
 * @param gitDir - Absolute git directory, when one was reported.
 * @returns A successful result with no snapshot.
 */
function createNonWorkTreeResult(
  options: RepositoryReadOptions,
  bare: boolean,
  gitDir: string | null,
): RepositoryReadResult {
  return {
    ok: true,
    snapshot: null,
    signals: createRepositorySignals({
      cwd: options.cwd,
      loaded: true,
      gitAvailable: true,
      bare,
      gitDir,
      notARepository: !bare,
      identity: UNKNOWN_IDENTITY,
    }),
    listFailures: NO_LIST_FAILURES,
    upstreamStatus: "none",
    gitAvailable: true,
    error: null,
    failureKind: null,
  };
}

/**
 * Builds a failure result that still explains the environment.
 *
 * Transient and unresolved failures keep `loaded: false` so the provider keeps its previous
 * snapshot instead of reporting an empty, missing, or non-repository state. A missing executable and
 * a permission failure are genuine environment states and are mapped as such.
 *
 * @param cwd - Launch directory.
 * @param failure - Classified git failure, or null when the failure is unknown.
 * @param gitDir - Absolute git directory, when known.
 * @returns A failed read with a redacted message the provider can surface.
 */
function createFailureResult(
  cwd: string,
  failure: GitFailure | null,
  gitDir: string | null,
): RepositoryReadResult {
  const kind = failure?.kind ?? "unknown";
  const missingGit = kind === "missing-git";
  const permissionError = kind === "permission";
  const environmentFailure = missingGit || permissionError || kind === "not-a-repository";

  return {
    ok: false,
    snapshot: null,
    signals: createRepositorySignals({
      cwd,
      loaded: environmentFailure,
      gitAvailable: !missingGit,
      gitDir,
      permissionError,
      notARepository: kind === "not-a-repository",
      identity: UNKNOWN_IDENTITY,
    }),
    listFailures: NO_LIST_FAILURES,
    upstreamStatus: "none",
    gitAvailable: !missingGit,
    error: redactText(failure?.message ?? "repository read failed"),
    failureKind: kind,
  };
}

/**
 * Selects the failure that decides the read outcome.
 *
 * A real environment failure wins over an ordinary "not a repository" message, because no
 * repository can be classified when git could not run, was killed, or could not read the directory.
 * Only a bare not-a-repository classification is allowed to become an observable repository state.
 *
 * @param insideFailure - Failure of the inside-work-tree probe.
 * @param metaFailure - Failure of the bare and git-directory probe.
 * @returns The decisive failure, or null when both probes succeeded.
 */
function readGitFailure(
  insideFailure: GitFailure | null,
  metaFailure: GitFailure | null,
): GitFailure | null {
  const failures = [insideFailure, metaFailure].filter(
    (failure): failure is GitFailure => failure !== null,
  );

  for (const kind of FAILURE_PRIORITY) {
    const match = failures.find((failure) => failure.kind === kind);

    if (match !== undefined) {
      return match;
    }
  }

  return null;
}

/** Failure kinds in the order that decides the read outcome. */
const FAILURE_PRIORITY: readonly GitFailureKind[] = Object.freeze([
  "missing-git",
  "permission",
  "auth-network",
  "cancelled",
  "timed-out",
  "unknown",
  "not-a-repository",
]);
