import { classifyGitFailure } from "./git.errors";
import { planGitError } from "./git.plan";
import type { RemoteBranchFields, RemoteBranchGroup } from "./git.remote-branches.types";
import { createTruncatedOutputFailure, isSafeGitName, isTruncatedOutput } from "./git.remotes";
import type {
  GitArgPlan,
  GitClient,
  GitReadOptions,
  RemoteBranchReadResult,
  RemoteBranchRecord,
  RemoteInfo,
} from "./git.types";

/** Prefix every remote-tracking ref shares. */
const REMOTE_TRACKING_REF_PREFIX = "refs/remotes/";

/** Atoms read for every remote-tracking branch. */
const REMOTE_BRANCH_FORMAT =
  "%(refname)%00%(objectname)%00%(committerdate:iso-strict)%00%(subject)%00%(symref)";

/** Number of atoms in the remote-tracking branch format. */
const REMOTE_BRANCH_FIELD_COUNT = 5;

/**
 * Builds the read of every remote-tracking branch.
 *
 * The full ref name, the tip object, the committer date, the subject, and the symbolic ref atom are
 * separated by NUL so a subject that contains tabs cannot shift a column. The symbolic ref atom is
 * what lets the parser drop `origin/HEAD`, whose short name would otherwise look like a branch.
 *
 * @returns The argument array, without the executable.
 */
export function buildListRemoteBranchesArgs(): readonly string[] {
  return Object.freeze(["for-each-ref", `--format=${REMOTE_BRANCH_FORMAT}`, "refs/remotes"]);
}

/**
 * Reads every remote-tracking branch with `git for-each-ref refs/remotes`.
 *
 * The parse needs the configured remote names so a remote whose name contains a slash is attributed
 * correctly. A failed or truncated read returns the classified failure instead of throwing, so the
 * caller keeps its previous snapshot rather than dropping rows from incomplete evidence.
 *
 * @param client - Git client bound to the configured executable.
 * @param options - Working directory and cancellation signal.
 * @param remotes - Configured remotes, as names or remote records.
 * @returns The parsed remote-tracking branches or the classified failure.
 */
export async function readRemoteBranches(
  client: GitClient,
  options: GitReadOptions,
  remotes: readonly (string | RemoteInfo)[],
): Promise<RemoteBranchReadResult> {
  const result = await client.invoke({
    args: buildListRemoteBranchesArgs(),
    cwd: options.cwd,
    signal: options.signal,
    operationClass: "read",
  });

  if (!result.ok) {
    return { ok: false, remoteBranches: [], failure: classifyGitFailure(result) };
  }

  if (isTruncatedOutput(result)) {
    return {
      ok: false,
      remoteBranches: [],
      failure: createTruncatedOutputFailure(
        result,
        "git for-each-ref refs/remotes output was truncated",
      ),
    };
  }

  return {
    ok: true,
    remoteBranches: parseRemoteBranches(result.stdout, remotes),
    failure: null,
  };
}

/**
 * Parses `for-each-ref refs/remotes` output into remote branch records.
 *
 * Each line is `refs/remotes/<remote>/<branch>` followed by the tip object, committer date, subject,
 * and symbolic ref. The remote is resolved against the configured names, longest first, so a remote
 * named `team/upstream` wins over `team`. Symbolic refs such as `origin/HEAD` are dropped because
 * they are not branches. A ref that matches no configured remote is skipped rather than being split
 * at the first slash.
 *
 * @param stdout - Captured `for-each-ref refs/remotes` output.
 * @param remotes - Configured remotes, as names or remote records.
 * @returns Remote branches in git order, with malformed and symbolic refs skipped.
 */
export function parseRemoteBranches(
  stdout: string,
  remotes: readonly (string | RemoteInfo)[],
): readonly RemoteBranchRecord[] {
  const remoteNames = readRemoteNames(remotes);
  const records: RemoteBranchRecord[] = [];

  for (const line of stdout.split("\n")) {
    const record = parseRemoteBranchRecord(line, remoteNames);

    if (record !== null) {
      records.push(record);
    }
  }

  return records;
}

/**
 * Parses one NUL-separated remote-tracking branch record.
 *
 * @param line - Raw output line, possibly ending in a carriage return.
 * @param remoteNames - Configured remote names, longest first.
 * @returns The record, or null for a malformed, symbolic, or unattributed ref.
 */
function parseRemoteBranchRecord(
  line: string,
  remoteNames: readonly string[],
): RemoteBranchRecord | null {
  const fields = readRemoteBranchFields(line);

  if (fields === null) {
    return null;
  }

  const rest = fields.ref.slice(REMOTE_TRACKING_REF_PREFIX.length);
  const remote = findOwningRemote(rest, remoteNames);

  if (remote === null) {
    return null;
  }

  const branch = rest.slice(remote.length + 1);

  if (branch.length === 0) {
    return null;
  }

  return {
    ref: fields.ref,
    remote,
    branch,
    tipOid: fields.tipOid,
    committerDate: fields.committerDate,
    subject: fields.subject,
  };
}

/**
 * Splits and validates the atoms of one remote-tracking branch line.
 *
 * Symbolic refs such as `origin/HEAD` and refs outside `refs/remotes` are rejected here, so the
 * caller only has to attribute a well-formed remote-tracking ref.
 *
 * @param line - Raw output line, possibly ending in a carriage return.
 * @returns The validated fields, or null when the line is malformed or symbolic.
 */
function readRemoteBranchFields(line: string): RemoteBranchFields | null {
  const columns = line.replace(/\r$/, "").split("\0");

  if (!isRemoteBranchLine(columns)) {
    return null;
  }

  const [, tipOid, committerDate, subject] = columns;

  return {
    ref: columns[0],
    tipOid,
    committerDate: committerDate.length === 0 ? null : committerDate,
    subject,
  };
}

/**
 * Confirms that one split line is a usable non-symbolic remote-tracking ref.
 *
 * @param columns - NUL-separated columns of one output line.
 * @returns True when the columns form a remote-tracking ref line.
 */
function isRemoteBranchLine(
  columns: readonly string[],
): columns is readonly [string, string, string, string, string] {
  if (columns.length !== REMOTE_BRANCH_FIELD_COUNT) {
    return false;
  }

  const [ref, tipOid, , , symref] = columns;

  if (ref === undefined || tipOid === undefined || tipOid.length === 0) {
    return false;
  }

  if (symref !== undefined && symref.length > 0) {
    return false;
  }

  return ref.startsWith(REMOTE_TRACKING_REF_PREFIX);
}

/**
 * Reads distinct configured remote names, longest first.
 *
 * Longest-first order is what lets a slash-named remote claim its own refs before a shorter remote
 * with the same prefix does. Equal lengths are ordered by name so the result is deterministic.
 *
 * @param remotes - Configured remotes, as names or remote records.
 * @returns Distinct non-empty remote names.
 */
function readRemoteNames(remotes: readonly (string | RemoteInfo)[]): readonly string[] {
  const names = new Set<string>();

  for (const remote of remotes) {
    const name = typeof remote === "string" ? remote : remote.name;

    if (name.length > 0) {
      names.add(name);
    }
  }

  return [...names].sort((left, right) => {
    if (left.length !== right.length) {
      return right.length - left.length;
    }

    return compareText(left, right);
  });
}

/**
 * Finds the configured remote that owns a remote-tracking ref.
 *
 * @param refWithoutPrefix - Ref path after `refs/remotes/`.
 * @param remoteNames - Configured remote names, longest first.
 * @returns The owning remote name, or null when no configured remote matches.
 */
function findOwningRemote(refWithoutPrefix: string, remoteNames: readonly string[]): string | null {
  for (const remote of remoteNames) {
    if (refWithoutPrefix.startsWith(`${remote}/`)) {
      return remote;
    }
  }

  return null;
}

/**
 * Groups remote branches by remote and sorts both levels.
 *
 * Groups retain remote-name order. Within each group, tip commit committer dates sort newest first,
 * with branch names as the deterministic tie-breaker. Missing or invalid dates sort last by name.
 * This uses commit time, never branch creation or ref-update time. Parsed identities remain intact.
 *
 * @param records - Remote branch records, in any order.
 * @returns Groups sorted by remote, each with branches sorted by descending tip commit date then name.
 */
export function groupByRemote(
  records: readonly RemoteBranchRecord[],
): readonly RemoteBranchGroup[] {
  const grouped = new Map<string, RemoteBranchRecord[]>();

  for (const record of records) {
    const branches = grouped.get(record.remote) ?? [];

    branches.push(record);
    grouped.set(record.remote, branches);
  }

  return [...grouped.entries()]
    .sort(([left], [right]) => compareText(left, right))
    .map(([remote, branches]) => ({
      remote,
      branches: [...branches].sort(compareRemoteBranchCommits),
    }));
}

/**
 * Orders remote tips by their actual commit timestamp, using branch names for equal/unknown dates.
 * @param left - First remote branch record.
 * @param right - Second remote branch record in the same group.
 * @returns Negative when the left branch belongs first, positive when right does, or zero on a tie.
 */
function compareRemoteBranchCommits(left: RemoteBranchRecord, right: RemoteBranchRecord): number {
  const leftTime = readRemoteCommitTime(left.committerDate);
  const rightTime = readRemoteCommitTime(right.committerDate);

  if (leftTime !== rightTime) {
    return leftTime > rightTime ? -1 : 1;
  }

  return compareText(left.branch, right.branch);
}

/**
 * Normalizes an ISO commit date for chronological comparison across time zones.
 * @param date - Parsed tip committer date, or null when git supplies none.
 * @returns Epoch milliseconds, or negative infinity for a missing or invalid timestamp.
 */
function readRemoteCommitTime(date: string | null): number {
  const timestamp = date === null ? Number.NaN : Date.parse(date);
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
}

/**
 * Compares two strings by UTF-16 code unit.
 *
 * @param left - First value.
 * @param right - Second value.
 * @returns Negative when the left value sorts first, positive when the right does, zero on a tie.
 */
function compareText(left: string, right: string): number {
  if (left < right) {
    return -1;
  }

  return left > right ? 1 : 0;
}

/**
 * Plans creating a local branch from a remote-tracking ref.
 *
 * With checkout the plan is one atomic `switch -c`, so a failed checkout cannot leave an orphan
 * branch. Without it the plan is a plain `branch` invocation. Both values must be safe single argv
 * values; a remote ref is a short ref such as `origin/main` or a full ref, never a revision
 * expression.
 *
 * @param input - Local branch name, base remote ref, and whether to check the branch out.
 * @returns The planned argument array, or the reason the plan cannot run.
 */
export function planCreateLocalBranchFromRemote(input: {
  readonly name: string;
  readonly remoteRef: string;
  readonly checkout: boolean;
}): GitArgPlan {
  if (!isSafeGitName(input.name)) {
    return planGitError(`invalid branch name "${input.name}"`);
  }

  if (!isSafeGitName(input.remoteRef)) {
    return planGitError(`invalid remote ref "${input.remoteRef}"`);
  }

  return Object.freeze({
    ok: true,
    args: Object.freeze(
      input.checkout
        ? ["switch", "-c", input.name, input.remoteRef]
        : ["branch", input.name, input.remoteRef],
    ),
  });
}
