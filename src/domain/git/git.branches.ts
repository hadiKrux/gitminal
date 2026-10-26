import type { BranchRiskCommit, BranchRiskRead } from "@/domain/repository/repository.types";
import { classifyGitFailure } from "./git.errors";
import { planGitArgs, planGitError } from "./git.plan";
import { redactText } from "./git.redact";
import { createTruncatedOutputFailure, isSafeGitName, isTruncatedOutput } from "./git.remotes";
import type {
  BranchRecord,
  GitArgPlan,
  GitClient,
  GitReadOptions,
  LocalBranchReadResult,
  RemoteBranchRecord,
} from "./git.types";

/**
 * Atoms read for every local branch.
 *
 * The dedicated `%(upstream:remotename)` and `%(upstream:remoteref)` atoms replace
 * `%(upstream:short)`, which is ambiguous when a remote name contains a slash. NUL separates the
 * fields so a committer date or ref can never shift a column, and `%(upstream:track)` supplies the
 * ahead/behind counts in the same read.
 */
const LOCAL_BRANCH_FORMAT =
  "%(refname:short)%00%(objectname)%00%(HEAD)%00%(committerdate:iso-strict)" +
  "%00%(upstream:remotename)%00%(upstream:remoteref)%00%(upstream:track)";

/** Number of atoms in the local branch format. */
const LOCAL_BRANCH_FIELD_COUNT = 7;

/** Prefix of the ref returned by `%(upstream:remoteref)`. */
const UPSTREAM_BRANCH_REF_PREFIX = "refs/heads/";

/** Marker `%(HEAD)` reports for the branch checked out in this worktree. */
const HEAD_MARKER = "*";

/** Ahead and behind counts inside `%(upstream:track)`. */
const AHEAD_PATTERN = /ahead (\d+)/;
const BEHIND_PATTERN = /behind (\d+)/;

/** Ref a branch is compared against when it has no configured upstream. */
const HEAD_BASE = "HEAD";

/** Name git reserves for the current tip, so a branch can never carry it. */
const RESERVED_HEAD_NAME = "HEAD";

/**
 * Maximum number of commits the unmerged-branch acknowledgement lists.
 *
 * The list is evidence for one destructive action, not a history view, so it stays bounded and the
 * caller reports the cap instead of reading an unbounded log.
 */
const BRANCH_RISK_COMMIT_LIMIT = 20;

/**
 * Commit count requested from git, one above the display cap.
 *
 * The extra row is never displayed; it is the only evidence that the cap hid older commits, so the
 * caller can report the hidden risk instead of implying the short list is the whole set.
 */
const BRANCH_RISK_READ_COUNT = BRANCH_RISK_COMMIT_LIMIT + 1;

/** Field separator of one branch-risk commit line. */
const BRANCH_RISK_SEPARATOR = "\0";

/** Format of one branch-risk commit line: full id and subject. */
const BRANCH_RISK_FORMAT = "--format=%H%x00%s";

/**
 * Builds the single read of every local branch.
 *
 * One `for-each-ref refs/heads` invocation returns the name, tip, HEAD marker, committer date,
 * configured upstream, and ahead/behind counts, so listing branches never costs one process per
 * branch.
 *
 * @returns The argument array, without the executable.
 */
export function buildListLocalBranchesArgs(): readonly string[] {
  return Object.freeze(["for-each-ref", `--format=${LOCAL_BRANCH_FORMAT}`, "refs/heads"]);
}

/**
 * Reads every local branch with `git for-each-ref refs/heads`.
 *
 * A failed or truncated read returns the classified failure instead of throwing, so the caller can
 * keep the previous snapshot. Worktree attribution and the final upstream classification are filled
 * in later by the repository read, which owns the worktree map and the session evidence.
 *
 * @param client - Git client bound to the configured executable.
 * @param options - Working directory and cancellation signal.
 * @returns The parsed branches or the classified failure.
 */
export async function readLocalBranches(
  client: GitClient,
  options: GitReadOptions,
): Promise<LocalBranchReadResult> {
  const result = await client.invoke({
    args: buildListLocalBranchesArgs(),
    cwd: options.cwd,
    signal: options.signal,
    operationClass: "read",
  });

  if (!result.ok) {
    return { ok: false, branches: [], failure: classifyGitFailure(result) };
  }

  if (isTruncatedOutput(result)) {
    return {
      ok: false,
      branches: [],
      failure: createTruncatedOutputFailure(
        result,
        "git for-each-ref refs/heads output was truncated",
      ),
    };
  }

  return { ok: true, branches: parseLocalBranches(result.stdout), failure: null };
}

/**
 * Resolves the ref the delete confirmation compares one branch against.
 *
 * The base is the branch's configured upstream only while that remote-tracking ref is present in
 * the snapshot. A configured upstream whose ref is missing cannot answer a merge or log query, so
 * the base is HEAD instead, exactly like a branch with no upstream. A branch with no record falls
 * back to the snapshot's current upstream under the same existence rule, and to HEAD otherwise.
 *
 * @param input - Branch record, remote-tracking refs from the snapshot, and the fallback upstream.
 * @returns The commit-ish used for merge and at-risk reads.
 */
export function resolveBranchMergeTarget(input: {
  readonly branch: BranchRecord | null;
  readonly remoteBranches: readonly RemoteBranchRecord[];
  readonly fallbackUpstream: string | null;
}): string {
  const upstreamRef = readConfiguredUpstreamRef(input.branch, input.fallbackUpstream);

  if (upstreamRef === null) {
    return HEAD_BASE;
  }

  return input.remoteBranches.some((record) => record.ref === upstreamRef)
    ? upstreamRef
    : HEAD_BASE;
}

/**
 * Reads the full remote-tracking ref of a configured upstream.
 *
 * @param branch - Branch record, or null when the snapshot has no record for it.
 * @param fallbackUpstream - Upstream ref such as `origin/main` to use without a record.
 * @returns The full `refs/remotes/...` ref, or null when no upstream is configured.
 */
function readConfiguredUpstreamRef(
  branch: BranchRecord | null,
  fallbackUpstream: string | null,
): string | null {
  if (branch !== null && branch.upstreamRemote !== null && branch.upstreamBranch !== null) {
    return `refs/remotes/${branch.upstreamRemote}/${branch.upstreamBranch}`;
  }

  return fallbackUpstream === null ? null : `refs/remotes/${fallbackUpstream}`;
}

/**
 * Builds the capped at-risk commit read for one branch.
 *
 * The range is `<base>..<branch>`, so only commits the base does not contain are listed. The cap is
 * part of the plan, so the caller cannot accidentally ask for an unbounded log.
 *
 * @param base - Commit-ish the branch is compared against.
 * @param branch - Branch whose missing commits are read.
 * @returns The argument array, without the executable.
 */
export function buildBranchRiskArgs(base: string, branch: string): readonly string[] {
  return Object.freeze([
    "log",
    BRANCH_RISK_FORMAT,
    `--max-count=${BRANCH_RISK_READ_COUNT}`,
    `${base}..${branch}`,
  ]);
}

/**
 * Parses one branch-risk commit list.
 *
 * @param stdout - Captured `git log` output with NUL between id and subject.
 * @returns The commits in output order, with malformed lines skipped.
 */
export function parseBranchRiskCommits(stdout: string): readonly BranchRiskCommit[] {
  const commits: BranchRiskCommit[] = [];

  for (const line of stdout.split("\n")) {
    const columns = line.replace(/\r$/, "").split(BRANCH_RISK_SEPARATOR);
    const oid = columns[0] ?? "";

    if (oid.length === 0) {
      continue;
    }

    commits.push({ oid, subject: columns.slice(1).join(BRANCH_RISK_SEPARATOR) });
  }

  return commits;
}

/**
 * Reads the capped commits a branch holds that its merge base does not.
 *
 * This is the evidence behind the unmerged-branch acknowledgement, so it never throws and never
 * invents a merge state: a failure returns an empty list, `merged: null`, and a classified message.
 * An empty successful list means the base already contains the branch, so the branch is merged.
 * One extra row is requested so `hasMore` proves whether the cap hid older commits. The branch name
 * must be a legal ref and the base a safe single argv value, because both become argv values.
 *
 * @param client - Git client bound to the configured executable.
 * @param options - Working directory and cancellation signal.
 * @param input - Branch name and the base resolved by the caller.
 * @returns The at-risk commits, the merge state, the cap indicator, and any classified error.
 */
export async function readBranchRisk(
  client: GitClient,
  options: GitReadOptions,
  input: { readonly name: string; readonly base: string },
): Promise<BranchRiskRead> {
  if (!isValidBranchName(input.name)) {
    return riskFailure(`invalid branch name "${input.name}"`);
  }

  if (!isSafeGitName(input.base)) {
    return riskFailure(`invalid branch base "${input.base}"`);
  }

  const result = await client.invoke({
    args: buildBranchRiskArgs(input.base, input.name),
    cwd: options.cwd,
    signal: options.signal,
    operationClass: "read",
  });

  if (!result.ok) {
    return riskFailure(redactText(classifyGitFailure(result).message));
  }

  if (isTruncatedOutput(result)) {
    return riskFailure(
      createTruncatedOutputFailure(result, "git log output was truncated").message,
    );
  }

  return buildBranchRiskRead(parseBranchRiskCommits(result.stdout));
}

/**
 * Builds one successful branch-risk result from the parsed commits.
 *
 * @param commits - Parsed commits, possibly one above the display cap.
 * @returns The capped commits, merge state, and cap indicator.
 */
function buildBranchRiskRead(commits: readonly BranchRiskCommit[]): BranchRiskRead {
  return {
    commits: commits.slice(0, BRANCH_RISK_COMMIT_LIMIT),
    merged: commits.length === 0,
    hasMore: commits.length > BRANCH_RISK_COMMIT_LIMIT,
    error: null,
  };
}

/**
 * Builds one unreadable branch-risk result.
 *
 * @param error - Classified error message.
 * @returns The empty list with an unknown merge state.
 */
function riskFailure(error: string): BranchRiskRead {
  return { commits: [], merged: null, hasMore: false, error };
}

/**
 * Reports whether a name is a legal git branch name.
 *
 * The rules follow `git check-ref-format --branch`: a non-empty name that is not the reserved
 * `HEAD`, does not start with a dash, contains no whitespace, control character, `~`, `^`, `:`,
 * `?`, `*`, `[`, or backslash, no `..` and no `@{`, is not the single character `@`, does not start
 * or end with `/`, has no empty component, has no component starting with `.` or ending with
 * `.lock`, and does not end with `.`. The result is advisory validation for forms; every planner
 * still guards its own argv values.
 *
 * @param name - Candidate branch name.
 * @returns True when git would accept the name as a branch.
 */
export function isValidBranchName(name: string): boolean {
  if (
    !isSafeGitName(name) ||
    name === RESERVED_HEAD_NAME ||
    name === "@" ||
    name.includes("@{") ||
    name.endsWith(".")
  ) {
    return false;
  }

  return name.split("/").every(isValidBranchNameComponent);
}

/**
 * Reports whether one slash-separated ref component is legal.
 *
 * @param component - One component of a slash-separated branch name.
 * @returns True when the component is non-empty, does not start with `.`, and does not end `.lock`.
 */
function isValidBranchNameComponent(component: string): boolean {
  return component.length > 0 && !component.startsWith(".") && !component.endsWith(".lock");
}

/**
 * Parses `for-each-ref refs/heads` output into branch records.
 *
 * `%(upstream:track)` reports an empty value for an up-to-date tracked branch, `[ahead N]`,
 * `[behind N]`, `[ahead N, behind M]`, or `[gone]`. A gone upstream keeps zero counts because the
 * branch and its upstream have diverged from a ref that no longer exists. The record leaves
 * `worktreePath` null and sets `upstreamStatus` to `none` when no upstream is configured or
 * `unknown` otherwise; the repository read replaces those placeholders. Merge state is not part of
 * the snapshot; the delete confirmation derives it lazily from a bounded log read.
 *
 * @param stdout - Captured `for-each-ref refs/heads` output.
 * @returns Local branches in git order, with malformed lines skipped.
 */
export function parseLocalBranches(stdout: string): readonly BranchRecord[] {
  const branches: BranchRecord[] = [];

  for (const line of stdout.split("\n")) {
    const branch = parseLocalBranchRecord(line);

    if (branch !== null) {
      branches.push(branch);
    }
  }

  return branches;
}

/**
 * Parses one NUL-separated local branch record.
 *
 * @param line - Raw output line, possibly ending in a carriage return.
 * @returns The branch record, or null for a malformed line.
 */
function parseLocalBranchRecord(line: string): BranchRecord | null {
  const columns = line.replace(/\r$/, "").split("\0");

  return columns.length === LOCAL_BRANCH_FIELD_COUNT ? buildLocalBranchRecord(columns) : null;
}

/**
 * Builds one branch record from validated atom columns.
 *
 * @param columns - Seven atom columns in `LOCAL_BRANCH_FORMAT` order.
 * @returns The branch record, or null when the name or tip is empty.
 */
function buildLocalBranchRecord(columns: readonly string[]): BranchRecord | null {
  const name = columns[0] ?? "";
  const tipOid = columns[1] ?? "";

  if (name.length === 0 || tipOid.length === 0) {
    return null;
  }

  const upstream = readUpstream(columns[4], columns[5]);
  const counts = readUpstreamTrack(columns[6]);

  return {
    name,
    head: columns[2] === HEAD_MARKER,
    tipOid,
    committerDate: readOptionalText(columns[3]),
    upstream: upstream === null ? null : upstream.ref,
    upstreamRemote: upstream === null ? null : upstream.remote,
    upstreamBranch: upstream === null ? null : upstream.branch,
    ahead: counts.ahead,
    behind: counts.behind,
    worktreePath: null,
    upstreamStatus: upstream === null ? "none" : "unknown",
  };
}

/**
 * Reads an optional text atom.
 *
 * @param value - Raw atom value, possibly missing.
 * @returns The text, or null when the atom is absent or empty.
 */
function readOptionalText(value: string | undefined): string | null {
  return value === undefined || value.length === 0 ? null : value;
}

/**
 * Builds the configured upstream ref from the two dedicated atoms.
 *
 * @param remote - Raw `%(upstream:remotename)` value.
 * @param branchRef - Raw `%(upstream:remoteref)` value.
 * @returns The upstream halves, or null when no upstream is configured or the ref is not a branch.
 */
function readUpstream(
  remote: string | undefined,
  branchRef: string | undefined,
): { ref: string; remote: string; branch: string } | null {
  if (remote === undefined || remote.length === 0) {
    return null;
  }

  if (branchRef === undefined || !branchRef.startsWith(UPSTREAM_BRANCH_REF_PREFIX)) {
    return null;
  }

  const branch = branchRef.slice(UPSTREAM_BRANCH_REF_PREFIX.length);

  if (branch.length === 0) {
    return null;
  }

  return { ref: `${remote}/${branch}`, remote, branch };
}

/**
 * Reads the ahead and behind counts from `%(upstream:track)`.
 *
 * The values are matched by name instead of splitting on punctuation, so `[ahead N, behind M]`,
 * `[behind M]`, `[ahead N]`, `[gone]`, and an empty value all parse without a branch on order.
 *
 * @param track - Raw track atom.
 * @returns The ahead and behind counts, zero when the atom reports none.
 */
function readUpstreamTrack(track: string | undefined): { ahead: number; behind: number } {
  const value = track ?? "";
  const ahead = AHEAD_PATTERN.exec(value);
  const behind = BEHIND_PATTERN.exec(value);

  return {
    ahead: ahead === null ? 0 : Number.parseInt(ahead[1] ?? "0", 10),
    behind: behind === null ? 0 : Number.parseInt(behind[1] ?? "0", 10),
  };
}

/**
 * Plans checking out one local branch.
 *
 * The branch name must be a safe single argv value; a leading dash would otherwise be read as an
 * option.
 *
 * @param name - Branch to check out.
 * @returns The planned argument array, or the reason the plan cannot run.
 */
export function planCheckoutBranch(name: string): GitArgPlan {
  if (!isSafeGitName(name)) {
    return planGitError(`invalid branch name "${name}"`);
  }

  return planGitArgs(["checkout", name]);
}

/**
 * Plans creating a branch, optionally checking it out in the same invocation.
 *
 * With checkout the plan is one atomic `switch -c`, so a failed checkout cannot leave an orphan
 * branch. An empty start point means the documented default, `HEAD`. The start point must be a safe
 * single argv value; revision expressions such as `HEAD~2` are rejected and must be resolved to an
 * object id by the caller.
 *
 * @param input - Branch name, start point, and whether to check the branch out.
 * @returns The planned argument array, or the reason the plan cannot run.
 */
export function planCreateBranch(input: {
  readonly name: string;
  readonly startPoint: string;
  readonly checkout: boolean;
}): GitArgPlan {
  if (!isSafeGitName(input.name)) {
    return planGitError(`invalid branch name "${input.name}"`);
  }

  const startPoint = input.startPoint.length === 0 ? "HEAD" : input.startPoint;

  if (!isSafeGitName(startPoint)) {
    return planGitError(`invalid start point "${input.startPoint}"`);
  }

  return input.checkout
    ? planGitArgs(["switch", "-c", input.name, startPoint])
    : planGitArgs(["branch", input.name, startPoint]);
}

/**
 * Plans deleting one local branch.
 *
 * `-d` refuses an unmerged branch, and `-D` is the force form chosen by the modal's acknowledgement.
 * The planner never merges the two: the caller decides from the acknowledgement.
 *
 * @param name - Branch to delete.
 * @param force - True for the force form.
 * @returns The planned argument array, or the reason the plan cannot run.
 */
export function planDeleteLocalBranch(name: string, force: boolean): GitArgPlan {
  if (!isSafeGitName(name)) {
    return planGitError(`invalid branch name "${name}"`);
  }

  return planGitArgs(["branch", force ? "-D" : "-d", name]);
}

/**
 * Plans deleting one remote branch.
 *
 * The invocation names the remote and the branch separately. Options stay before `--`, so the
 * branch can never be parsed as an option, and `--progress` keeps the status strip informative.
 *
 * @param remote - Configured remote name.
 * @param branch - Branch name inside that remote.
 * @returns The planned argument array, or the reason the plan cannot run.
 */
export function planDeleteRemoteBranch(remote: string, branch: string): GitArgPlan {
  if (!isSafeGitName(remote)) {
    return planGitError(`invalid remote name "${remote}"`);
  }

  if (!isSafeGitName(branch)) {
    return planGitError(`invalid branch name "${branch}"`);
  }

  return planGitArgs(["push", "--progress", "--delete", "--", remote, branch]);
}
