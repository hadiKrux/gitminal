import type { UpstreamDescriptor } from "@/domain/repository/repository.types";
import { parseUpstreamAtoms } from "@/domain/repository/repository.upstream";
import { classifyGitFailure } from "./git.errors";
import type {
  PrunePlan,
  PushMode,
  PushPlanInput,
  PushPlanResult,
  ReadUpstreamGroupsOptions,
  RemoteFetchGroup,
} from "./git.remotes.types";
import type {
  GitClient,
  GitFailure,
  GitInvocationResult,
  GitReadOptions,
  RemoteInfo,
  RemoteReadResult,
} from "./git.types";

/** Arguments for a normal pull of the current branch and its upstream. */
const PULL_ARGS: readonly string[] = Object.freeze(["pull", "--progress", "--no-edit"]);

/** Prefix of an advertised branch ref returned by `git ls-remote --heads`. */
const REMOTE_HEAD_PREFIX = "refs/heads/";

/** Remote used when Push auto-creates an upstream. */
export const PUSH_AUTO_CREATE_REMOTE = "origin";

/** Reason a force variant cannot run without a configured upstream. */
const NO_UPSTREAM_ERROR = "no upstream; use Push to create it first.";

/** Variant flags appended to a push invocation. */
const PUSH_MODE_FLAGS: Readonly<Record<PushMode, readonly string[]>> = Object.freeze({
  push: Object.freeze([]),
  forceSafe: Object.freeze(["--force-with-lease"]),
  forceOverwrite: Object.freeze(["--force"]),
  noVerify: Object.freeze(["--no-verify"]),
});

/** Push variants that must never fall back to creating an upstream. */
const UPSTREAM_REQUIRED_MODES: ReadonlySet<PushMode> = new Set(["forceSafe", "forceOverwrite"]);

/**
 * Ref-syntax metacharacters that are not safe in one remote or branch argv value.
 *
 * Whitespace is handled separately, and control characters are rejected by code point so no control
 * character appears in a regular expression.
 */
const UNSAFE_ARG_NAME_PATTERN = /[\s~^:?*[\\]/;

/**
 * Reports whether a remote or branch name is safe as a single git argument.
 *
 * @param value - Remote or branch name from configuration.
 * @returns True when the value is non-empty, not option-like, and free of unsafe characters.
 */
export function isSafeGitName(value: string): boolean {
  return (
    value.length > 0 &&
    !value.startsWith("-") &&
    !value.includes("..") &&
    !UNSAFE_ARG_NAME_PATTERN.test(value) &&
    !hasControlCharacter(value)
  );
}

/**
 * Reports whether a string contains a control character.
 *
 * @param value - Candidate name.
 * @returns True for any C0 control or DEL character.
 */
function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);

    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }

  return false;
}

/**
 * Reports whether a captured output stream lost its middle to the client output limit.
 *
 * A truncated parse is incomplete evidence. Callers that infer absence from output must treat it as
 * unknown rather than a confirmed result.
 *
 * @param result - Settled git invocation.
 * @returns True when stdout or stderr was truncated.
 */
export function isTruncatedOutput(result: GitInvocationResult): boolean {
  return result.stdoutTruncated === true || result.stderrTruncated === true;
}

/**
 * Builds the classified failure for a read whose captured output was truncated.
 *
 * A truncated stream is incomplete evidence, so a caller that infers absence or completeness from
 * output must keep its previous state instead. The kind is `unknown` because truncation is not one
 * of git's own failure categories.
 *
 * @param result - Settled invocation whose output was truncated.
 * @param message - One-line decisive message naming the truncated read.
 * @returns The classified failure.
 */
export function createTruncatedOutputFailure(
  result: GitInvocationResult,
  message: string,
): GitFailure {
  return {
    kind: "unknown",
    exitCode: result.exitCode,
    message,
    stderr: result.stderr,
    cancelled: result.cancelled,
    timedOut: result.timedOut,
  };
}

/**
 * Builds the shared `for-each-ref` read of every local branch upstream.
 *
 * The tab-separated `remotename` and `remoteref` atoms replace `%(upstream:short)`, which is
 * ambiguous when a remote name contains a slash. Tabs are safe because git ref and remote names
 * cannot contain them.
 *
 * @returns The argument array, without the executable.
 */
export function buildUpstreamGroupsArgs(): readonly string[] {
  return Object.freeze([
    "for-each-ref",
    "--format=%(refname:short)%09%(upstream:remotename)%09%(upstream:remoteref)",
    "refs/heads",
  ]);
}

/**
 * Reads the configured remotes with `git remote -v`.
 *
 * An empty list is a valid result and maps to the `no-remote` repository state. The read never
 * throws for a git failure; it returns the classified failure so the caller can surface it.
 *
 * @param client - Git client bound to the configured executable.
 * @param options - Working directory and cancellation signal.
 * @returns Configured remotes or the classified failure.
 */
export async function readRemotes(
  client: GitClient,
  options: GitReadOptions,
): Promise<RemoteReadResult> {
  const result = await client.invoke({
    args: ["remote", "-v"],
    cwd: options.cwd,
    signal: options.signal,
    operationClass: "read",
  });

  if (!result.ok) {
    return { ok: false, remotes: [], failure: classifyGitFailure(result) };
  }

  if (isTruncatedOutput(result)) {
    return { ok: false, remotes: [], failure: createTruncatedRemoteFailure(result) };
  }

  return { ok: true, remotes: parseRemoteVerbose(result.stdout), failure: null };
}

/**
 * Builds the classified failure for a truncated `git remote -v` read.
 *
 * A truncated read can drop a remote from the middle of the output, so the caller must keep the
 * previous snapshot instead of inferring a no-remote state from incomplete evidence.
 *
 * @param result - Successful invocation whose output was truncated.
 * @returns The classified failure naming the truncated read.
 */
function createTruncatedRemoteFailure(result: GitInvocationResult): GitFailure {
  return createTruncatedOutputFailure(result, "git remote -v output was truncated");
}

/**
 * Parses `git remote -v` output into remote records.
 *
 * Each line is `<name>\t<url> (fetch|push)`. A URL can contain spaces, so only the trailing
 * `(fetch)` or `(push)` marker is stripped. The push URL is reported as null when it matches the
 * fetch URL, which keeps a single-URL remote from looking like two configurations.
 *
 * @param stdout - Captured `git remote -v` output.
 * @returns Remotes in first-seen order.
 */
export function parseRemoteVerbose(stdout: string): readonly RemoteInfo[] {
  const remotes = new Map<string, { fetchUrl: string | null; pushUrl: string | null }>();

  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();

    if (trimmed.length === 0) {
      continue;
    }

    const separator = trimmed.indexOf("\t");

    if (separator < 0) {
      continue;
    }

    const name = trimmed.slice(0, separator);
    const target = trimmed.slice(separator + 1);
    const kind = readRemoteUrlKind(target);

    if (name.length === 0 || kind === null) {
      continue;
    }

    const current = remotes.get(name) ?? { fetchUrl: null, pushUrl: null };

    if (kind.kind === "fetch") {
      current.fetchUrl = kind.url;
    } else {
      current.pushUrl = kind.url;
    }

    remotes.set(name, current);
  }

  return [...remotes.entries()].map(([name, urls]) => ({
    name,
    fetchUrl: urls.fetchUrl,
    pushUrl: urls.pushUrl !== null && urls.pushUrl !== urls.fetchUrl ? urls.pushUrl : null,
  }));
}

/**
 * Reads the URL and direction from one `git remote -v` target.
 *
 * @param target - Text after the remote name.
 * @returns The URL and direction, or null for an unrecognized line.
 */
function readRemoteUrlKind(target: string): { url: string; kind: "fetch" | "push" } | null {
  const fetchSuffix = " (fetch)";
  const pushSuffix = " (push)";

  if (target.endsWith(fetchSuffix)) {
    return { url: target.slice(0, -fetchSuffix.length), kind: "fetch" };
  }

  if (target.endsWith(pushSuffix)) {
    return { url: target.slice(0, -pushSuffix.length), kind: "push" };
  }

  return null;
}

/**
 * Builds the arguments for a normal pull.
 *
 * `--no-edit` keeps a merge pull from opening an editor, and `--progress` lets the client stream
 * phases to the status strip. The user's configured pull strategy still applies, so the app never
 * forces merge or rebase.
 *
 * @returns The pull argument array, without the executable.
 */
export function buildPullArgs(): readonly string[] {
  return PULL_ARGS;
}

/**
 * Plans one push invocation from the branch, its upstream, and the configured remotes.
 *
 * The plan always names the remote and an explicit refspec. Delegating scope to `push.default` would
 * let `matching` update unrelated branches and would fail when the configured upstream branch has a
 * different name from the local branch, so the captured local branch is addressed directly with
 * `refs/heads/<branch>:refs/heads/<upstream.branch>`. The capture, rather than `HEAD`, keeps a stale
 * provider snapshot plus an external checkout from pushing a branch the user did not confirm.
 *
 * Auto-creation is limited to `origin`, because the product spec forbids guessing another remote.
 * Force variants require a configured upstream: they must never fall back to creating one. The
 * planner is pure and returns a plan error instead of a failed step for those cases, so the executor
 * can still surface a normal failure through the runner.
 *
 * @param input - Push mode, branch, upstream descriptor, and configured remote names.
 * @returns The planned argument array, or the reason the plan cannot run.
 */
export function buildPushArgs(input: PushPlanInput): PushPlanResult {
  if (!isSafeGitName(input.branch)) {
    return planError(`invalid branch name "${input.branch}"`);
  }

  const flags = PUSH_MODE_FLAGS[input.mode];

  if (input.upstream === null) {
    return UPSTREAM_REQUIRED_MODES.has(input.mode)
      ? planError(NO_UPSTREAM_ERROR)
      : planAutoCreate(input, flags);
  }

  if (!isSafeGitName(input.upstream.remote) || !isSafeGitName(input.upstream.branch)) {
    return planError(`invalid upstream "${input.upstream.ref}"`);
  }

  return planArgs([
    "push",
    "--progress",
    ...flags,
    "--",
    input.upstream.remote,
    `refs/heads/${input.branch}:refs/heads/${input.upstream.branch}`,
  ]);
}

/**
 * Plans a push that creates `origin/<branch>` and sets it as the upstream.
 *
 * @param input - Push input carrying the branch and configured remotes.
 * @param extraFlags - Variant flags such as `--no-verify`.
 * @returns The planned argument array, or the no-origin error.
 */
function planAutoCreate(input: PushPlanInput, extraFlags: readonly string[]): PushPlanResult {
  if (!input.remotes.includes(PUSH_AUTO_CREATE_REMOTE)) {
    return planError(buildNoOriginError(input.remotes));
  }

  const refspec = `refs/heads/${input.branch}:refs/heads/${input.branch}`;

  return planArgs([
    "push",
    "--progress",
    ...extraFlags,
    "--set-upstream",
    PUSH_AUTO_CREATE_REMOTE,
    refspec,
  ]);
}

/**
 * Builds the no-origin error that names every configured remote.
 *
 * @param remotes - Configured remote names.
 * @returns The user-facing error message.
 */
function buildNoOriginError(remotes: readonly string[]): string {
  const configured = remotes.length === 0 ? "none" : remotes.join(", ");

  return `No origin remote. Configured remotes: ${configured}.`;
}

/**
 * Wraps a planned argument array in a frozen success result.
 *
 * @param args - Planned arguments.
 * @returns The frozen plan.
 */
function planArgs(args: readonly string[]): PushPlanResult {
  return Object.freeze({ ok: true, args: Object.freeze([...args]) });
}

/**
 * Wraps a planning error in a frozen failure result.
 *
 * @param error - User-facing error text.
 * @returns The frozen plan.
 */
function planError(error: string): PushPlanResult {
  return Object.freeze({ ok: false, error });
}

/**
 * Builds a fetch that mirrors one remote branch into its remote-tracking ref.
 *
 * The forced-update prefix keeps the tracking ref equal to the remote after an amend, rebase, or
 * force-push. The destination is never a local branch. `--` ends option parsing so a remote or ref
 * that resembles an option cannot be parsed as one.
 *
 * @param remote - Remote name.
 * @param branch - Branch name inside that remote.
 * @returns The fetch argument array, or null when either name is unsafe.
 */
export function buildFetchTrackingRefArgs(
  remote: string,
  branch: string,
): readonly string[] | null {
  if (!isSafeGitName(remote) || !isSafeGitName(branch)) {
    return null;
  }

  return Object.freeze([
    "fetch",
    "--progress",
    "--",
    remote,
    `+refs/heads/${branch}:refs/remotes/${remote}/${branch}`,
  ]);
}

/**
 * Builds a read of every head a remote advertises.
 *
 * @param remote - Remote name.
 * @returns The argument array, or null when the remote name is unsafe.
 */
export function buildLsRemoteHeadsArgs(remote: string): readonly string[] | null {
  if (!isSafeGitName(remote)) {
    return null;
  }

  return Object.freeze(["ls-remote", "--heads", "--", remote]);
}

/**
 * Builds the deletion of one remote-tracking ref.
 *
 * `--` follows `-d`, because git stops parsing options at `--` and would otherwise treat `-d` as the
 * refname.
 *
 * @param remote - Remote name.
 * @param branch - Branch name inside that remote.
 * @returns The argument array, or null when either name is unsafe.
 */
export function buildDeleteTrackingRefArgs(
  remote: string,
  branch: string,
): readonly string[] | null {
  if (!isSafeGitName(remote) || !isSafeGitName(branch)) {
    return null;
  }

  return Object.freeze(["update-ref", "-d", "--", `refs/remotes/${remote}/${branch}`]);
}

/**
 * Builds the removal of every stale remote-tracking ref of one remote.
 *
 * `git remote prune` compares the remote with the configured fetch refspecs and deletes only the
 * tracking refs whose source ref is gone, so a ref that maps to a still-existing namespace such as
 * `refs/pull/<n>/head` is kept. `--` keeps an option-like remote name from being parsed as a flag.
 *
 * @param remote - Remote name.
 * @returns The argument array, or null when the name is unsafe.
 */
export function buildRemotePruneArgs(remote: string): readonly string[] | null {
  if (!isSafeGitName(remote)) {
    return null;
  }

  return Object.freeze(["remote", "prune", "--", remote]);
}

/**
 * Parses advertised branch names from `git ls-remote --heads` output.
 *
 * Each line is `<oid>\trefs/heads/<branch>`. Malformed lines, refs outside `refs/heads`, and blank
 * branches are ignored, and duplicate names are reported once.
 *
 * @param stdout - Captured `ls-remote --heads` output.
 * @returns Advertised branch names in first-seen order.
 */
export function parseLsRemoteHeads(stdout: string): readonly string[] {
  const branches = new Set<string>();

  for (const line of stdout.split("\n")) {
    const branch = readAdvertisedBranch(line);

    if (branch !== null) {
      branches.add(branch);
    }
  }

  return [...branches];
}

/**
 * Reads the branch name from one `ls-remote --heads` line.
 *
 * @param line - Raw output line.
 * @returns The branch name, or null for a malformed line or another ref namespace.
 */
function readAdvertisedBranch(line: string): string | null {
  const trimmed = line.trim();

  if (trimmed.length === 0) {
    return null;
  }

  const separator = trimmed.indexOf("\t");

  if (separator <= 0) {
    return null;
  }

  const ref = trimmed.slice(separator + 1).trim();

  if (!ref.startsWith(REMOTE_HEAD_PREFIX)) {
    return null;
  }

  const branch = ref.slice(REMOTE_HEAD_PREFIX.length).trim();

  return branch.length === 0 ? null : branch;
}

/**
 * Groups configured upstream refs by remote.
 *
 * The input is the captured tab-separated `for-each-ref` output for `refs/heads`: the local ref,
 * the upstream remote name, and the upstream branch ref. Malformed lines, lines without an
 * upstream, and unsafe names are skipped. A `localBranch` option keeps only the exact local ref
 * named, so the scoped Fetch and Fetch --prune can narrow to the checked-out branch without a
 * prefix match. Refs are deduped by remote and branch and sorted by display ref, so every run
 * produces a stable argv. The group key is the exact remote name, so a remote such as `a/b` is
 * never split.
 *
 * @param stdout - Captured `for-each-ref` output.
 * @param options - Optional exact local-branch filter.
 * @returns Remote groups in first-seen order with distinct sorted refs.
 */
export function readUpstreamGroups(
  stdout: string,
  options: ReadUpstreamGroupsOptions = {},
): readonly RemoteFetchGroup[] {
  const grouped = new Map<string, Map<string, UpstreamDescriptor>>();
  const localBranch = options.localBranch ?? null;

  for (const line of stdout.split("\n")) {
    const separator = line.indexOf("\t");

    if (separator < 0) {
      continue;
    }

    if (localBranch !== null && line.slice(0, separator) !== localBranch) {
      continue;
    }

    const descriptor = parseUpstreamAtoms(line.slice(separator + 1));

    if (
      descriptor === null ||
      !isSafeGitName(descriptor.remote) ||
      !isSafeGitName(descriptor.branch)
    ) {
      continue;
    }

    const refs = grouped.get(descriptor.remote) ?? new Map<string, UpstreamDescriptor>();
    refs.set(`${descriptor.remote}\t${descriptor.branch}`, descriptor);
    grouped.set(descriptor.remote, refs);
  }

  return [...grouped.entries()].map(([remote, refs]) => ({
    remote,
    refs: sortDescriptors([...refs.values()]),
  }));
}

/**
 * Sorts upstream descriptors by their display ref.
 *
 * @param descriptors - Descriptors to sort.
 * @returns A new sorted array with a stable plain-string comparison.
 */
function sortDescriptors(
  descriptors: readonly UpstreamDescriptor[],
): readonly UpstreamDescriptor[] {
  return [...descriptors].sort((left, right) => {
    if (left.ref < right.ref) {
      return -1;
    }

    return left.ref > right.ref ? 1 : 0;
  });
}

/**
 * Splits in-scope upstream refs into fetched and pruned sets from a confirmed head list.
 *
 * A ref whose branch is still advertised is fetched, and one that is absent is deleted. The
 * descriptor's exact remote and branch decide both scope and routing, so a slash-named remote is
 * never re-parsed from a short ref. Refs that belong to another remote are never returned, so a
 * caller cannot delete an out-of-scope tracking ref through this plan.
 *
 * @param remote - Remote whose heads were confirmed.
 * @param refs - Configured upstream descriptors for that remote.
 * @param advertisedBranches - Branch names the remote advertised.
 * @returns Sorted in-scope fetch and delete descriptors.
 */
export function planPruneDeletions(
  remote: string,
  refs: readonly UpstreamDescriptor[],
  advertisedBranches: readonly string[],
): PrunePlan {
  const advertised = new Set(advertisedBranches);
  const fetchRefs = new Map<string, UpstreamDescriptor>();
  const deleteRefs = new Map<string, UpstreamDescriptor>();

  for (const descriptor of refs) {
    if (
      descriptor.remote !== remote ||
      !isSafeGitName(descriptor.remote) ||
      !isSafeGitName(descriptor.branch)
    ) {
      continue;
    }

    const target = advertised.has(descriptor.branch) ? fetchRefs : deleteRefs;

    target.set(descriptor.ref, descriptor);
  }

  return Object.freeze({
    fetchRefs: Object.freeze(sortDescriptors([...fetchRefs.values()])),
    deleteRefs: Object.freeze(sortDescriptors([...deleteRefs.values()])),
  });
}
