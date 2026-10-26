import { classifyGitFailure } from "./git.errors";
import { planGitArgs, planGitError } from "./git.plan";
import { createTruncatedOutputFailure, isSafeGitName, isTruncatedOutput } from "./git.remotes";
import type { RemoteTagCheckInput, TagNameRun } from "./git.tags.types";
import type {
  GitArgPlan,
  GitClient,
  GitFailure,
  GitReadOptions,
  LocalTagReadResult,
  RemoteTagReadResult,
  TagRecord,
  TagRowRecord,
  TagScopeState,
} from "./git.types";
import { parseLocalTags, parseLsRemoteTags } from "./parsers/parse.refs";

/**
 * Atoms read for every local tag.
 *
 * The peeled atoms are read next to the direct ones so the parser can pick the commit subject for an
 * annotated tag instead of its tag message. NUL separates the fields.
 */
const LOCAL_TAG_FORMAT =
  "%(refname:short)%00%(objecttype)%00%(*objectname)%00%(objectname)" +
  "%00%(*subject)%00%(subject)";

/** Pattern that splits a tag name into alternating numeric and non-numeric runs. */
const TAG_RUN_PATTERN = /\d+|\D+/g;

/**
 * Builds the read of every local tag.
 *
 * @returns The argument array, without the executable.
 */
export function buildListLocalTagsArgs(): readonly string[] {
  return Object.freeze(["for-each-ref", `--format=${LOCAL_TAG_FORMAT}`, "refs/tags"]);
}

/**
 * Builds the read of every tag a remote advertises.
 *
 * `git ls-remote --tags` is the only network read that may confirm a tag is absent, so its result
 * must be treated as incomplete evidence when the invocation fails or its output is truncated.
 *
 * @param remote - Configured remote name.
 * @returns The argument array, or null when the remote name is unsafe.
 */
export function buildLsRemoteTagsArgs(remote: string): readonly string[] | null {
  if (!isSafeGitName(remote)) {
    return null;
  }

  return Object.freeze(["ls-remote", "--tags", "--", remote]);
}

/**
 * Reads every local tag with `git for-each-ref refs/tags`.
 *
 * @param client - Git client bound to the configured executable.
 * @param options - Working directory and cancellation signal.
 * @returns The parsed local tags or the classified failure.
 */
export async function readLocalTags(
  client: GitClient,
  options: GitReadOptions,
): Promise<LocalTagReadResult> {
  const result = await client.invoke({
    args: buildListLocalTagsArgs(),
    cwd: options.cwd,
    signal: options.signal,
    operationClass: "read",
  });

  if (!result.ok) {
    return { ok: false, tags: [], failure: classifyGitFailure(result) };
  }

  if (isTruncatedOutput(result)) {
    return {
      ok: false,
      tags: [],
      failure: createTruncatedOutputFailure(
        result,
        "git for-each-ref refs/tags output was truncated",
      ),
    };
  }

  return { ok: true, tags: parseLocalTags(result.stdout), failure: null };
}

/**
 * Reads the tag names one remote advertises with `git ls-remote --tags`.
 *
 * Only a clean, complete result may update remote tag knowledge. A failed, cancelled, timed-out,
 * truncated, or malformed read reports `ok: false`, so the caller keeps its previous names and marks
 * the attempt failed instead of inferring that a tag is absent.
 *
 * @param client - Git client bound to the configured executable.
 * @param options - Working directory and cancellation signal.
 * @param remote - Configured remote name.
 * @returns The advertised tag names or the classified failure.
 */
export async function readRemoteTags(
  client: GitClient,
  options: GitReadOptions,
  remote: string,
): Promise<RemoteTagReadResult> {
  const args = buildLsRemoteTagsArgs(remote);

  if (args === null) {
    return {
      ok: false,
      names: [],
      failure: createInvalidRemoteFailure(remote),
    };
  }

  const result = await client.invoke({
    args,
    cwd: options.cwd,
    signal: options.signal,
    operationClass: "network",
  });

  if (!result.ok) {
    return { ok: false, names: [], failure: classifyGitFailure(result) };
  }

  if (isTruncatedOutput(result)) {
    return {
      ok: false,
      names: [],
      failure: createTruncatedOutputFailure(result, "git ls-remote --tags output was truncated"),
    };
  }

  return { ok: true, names: parseLsRemoteTags(result.stdout), failure: null };
}

/**
 * Builds the failure reported for an unusable remote name.
 *
 * The value never reaches git, so the failure kind is `unknown` and the message names the rejected
 * argument.
 *
 * @param remote - Rejected remote name.
 * @returns The classified failure.
 */
function createInvalidRemoteFailure(remote: string): GitFailure {
  return {
    kind: "unknown",
    exitCode: null,
    message: `invalid remote name "${remote}"`,
    stderr: "",
    cancelled: false,
    timedOut: false,
  };
}

/**
 * Merges local tags and remote tag knowledge into one logical row per tag name.
 *
 * A remote whose last check failed keeps its previous names and reports `failed`, so a tag is never
 * called unpushed from missing knowledge. `local only` is used when no remote is configured, `both`
 * when a local tag is known on at least one remote, `unpushed` when every configured remote's last
 * known set says the tag is absent, `unknown` when a needed check never succeeded, and `remote` for
 * a tag that exists only in remote knowledge. A remote-only row has no local object facts, so its
 * object type is `commit`, its target is empty, and its subject is empty.
 *
 * @param localTags - Local tags read from git.
 * @param remoteChecks - Last known tag set per configured remote, keyed by remote name.
 * @returns One row per logical tag, locals first and then remote-only names in check order.
 */
export function mergeTagScopes(
  localTags: readonly TagRecord[],
  remoteChecks: Readonly<
    Record<
      string,
      {
        readonly names: readonly string[];
        readonly status: "known" | "neverChecked" | "failed";
      }
    >
  >,
): readonly TagRowRecord[] {
  const localByName = new Map<string, TagRecord>();
  const order: string[] = [];
  const seen = new Set<string>();

  for (const tag of localTags) {
    if (!seen.has(tag.name)) {
      seen.add(tag.name);
      order.push(tag.name);
    }

    localByName.set(tag.name, tag);
  }

  const remotesByTag = collectRemotesByTag(remoteChecks);

  for (const name of remotesByTag.keys()) {
    if (!seen.has(name)) {
      seen.add(name);
      order.push(name);
    }
  }

  return order.map((name) => {
    const tag = localByName.get(name) ?? null;
    const remotes = remotesByTag.get(name) ?? [];

    return buildTagRow(name, tag, remotes, remoteChecks);
  });
}

/**
 * Maps every known tag name to the remotes whose last known set contains it.
 *
 * @param remoteChecks - Last known tag set per configured remote.
 * @returns Tag names with sorted distinct remote names.
 */
function collectRemotesByTag(
  remoteChecks: Readonly<Record<string, RemoteTagCheckInput>>,
): Map<string, readonly string[]> {
  const collected = new Map<string, string[]>();

  for (const [remote, check] of Object.entries(remoteChecks)) {
    for (const name of check.names) {
      const remotes = collected.get(name) ?? [];

      if (!remotes.includes(remote)) {
        remotes.push(remote);
      }

      collected.set(name, remotes);
    }
  }

  const sorted = new Map<string, readonly string[]>();

  for (const [name, remotes] of collected) {
    sorted.set(name, [...remotes].sort(compareText));
  }

  return sorted;
}

/**
 * Builds one logical tag row.
 *
 * @param name - Tag name.
 * @param tag - Local tag record, or null for a remote-only tag.
 * @param remotes - Remotes whose last known set contains the tag.
 * @param remoteChecks - Last known tag set per configured remote.
 * @returns The merged row.
 */
function buildTagRow(
  name: string,
  tag: TagRecord | null,
  remotes: readonly string[],
  remoteChecks: Readonly<Record<string, RemoteTagCheckInput>>,
): TagRowRecord {
  const state = resolveTagScopeState(tag !== null, remotes, remoteChecks);

  if (tag === null) {
    return {
      name,
      objectType: "commit",
      targetOid: "",
      subject: "",
      local: false,
      remotes,
      state,
    };
  }

  return { ...tag, local: true, remotes, state };
}

/**
 * Resolves the scope indicator for one row.
 *
 * @param isLocal - True when the tag exists locally.
 * @param remotes - Remotes whose last known set contains the tag.
 * @param remoteChecks - Last known tag set per configured remote.
 * @returns The scope indicator.
 */
function resolveTagScopeState(
  isLocal: boolean,
  remotes: readonly string[],
  remoteChecks: Readonly<Record<string, RemoteTagCheckInput>>,
): TagScopeState {
  const remoteNames = Object.keys(remoteChecks);

  if (!isLocal) {
    // A row is built only for a name that exists locally or in a remote's last known set, so the
    // fallback is unreachable; it stays to cover the contract's complete state matrix.
    return remotes.length > 0 ? "remote" : "local";
  }

  if (remoteNames.length === 0) {
    return "local-only";
  }

  if (remotes.length > 0) {
    return "both";
  }

  const everyRemoteKnown = remoteNames.every((remote) => remoteChecks[remote]?.status === "known");

  return everyRemoteKnown ? "unpushed" : "unknown";
}

/**
 * Sorts tag rows by version-aware descending order.
 *
 * Each name is split into numeric and non-numeric runs. Numeric runs compare by value and
 * non-numeric runs compare by string, so `v1.2.10` sorts above `v1.2.9`. When the runs are equal the
 * raw names are compared in reverse, which keeps `v1` above `v01`. The result is deterministic and
 * stable across refreshes.
 *
 * @param rows - Rows or tags with a name.
 * @returns A new array sorted descending.
 */
export function sortTagsVersionDesc<T extends { readonly name: string }>(
  rows: readonly T[],
): readonly T[] {
  return [...rows].sort((left, right) => {
    const ascending = compareTagNames(left.name, right.name);

    if (ascending !== 0) {
      return -ascending;
    }

    return compareText(right.name, left.name);
  });
}

/**
 * Compares two tag names by numeric-aware ascending order.
 *
 * @param left - First tag name.
 * @param right - Second tag name.
 * @returns Negative when the left name sorts first, positive when the right does, zero on a tie.
 */
function compareTagNames(left: string, right: string): number {
  const leftRuns = splitTagRuns(left);
  const rightRuns = splitTagRuns(right);
  const shared = Math.min(leftRuns.length, rightRuns.length);

  for (let index = 0; index < shared; index += 1) {
    const leftRun = leftRuns[index];
    const rightRun = rightRuns[index];

    if (leftRun === undefined || rightRun === undefined) {
      break;
    }

    const comparison = compareTagRuns(leftRun, rightRun);

    if (comparison !== 0) {
      return comparison;
    }
  }

  return leftRuns.length - rightRuns.length;
}

/**
 * Splits a tag name into alternating numeric and non-numeric runs.
 *
 * @param name - Tag name.
 * @returns The runs in name order.
 */
function splitTagRuns(name: string): readonly TagNameRun[] {
  const matches = name.match(TAG_RUN_PATTERN) ?? [];

  return matches.map((value) => ({ numeric: /^\d+$/.test(value), value }));
}

/**
 * Compares two runs of a tag name.
 *
 * Two numeric runs compare by numeric value and two non-numeric runs compare as strings. When the
 * kinds differ, the numeric run sorts after the non-numeric run so mixed names such as `release` and
 * `1.0` still have one stable order.
 *
 * @param left - First run.
 * @param right - Second run.
 * @returns Negative when the left run sorts first, positive when the right does, zero on a tie.
 */
function compareTagRuns(left: TagNameRun, right: TagNameRun): number {
  if (left.numeric && right.numeric) {
    return compareNumericRuns(left.value, right.value);
  }

  if (!left.numeric && !right.numeric) {
    return compareText(left.value, right.value);
  }

  return left.numeric ? 1 : -1;
}

/**
 * Compares two digit runs by numeric value.
 *
 * Leading zeros are stripped before the comparison, and lengths are compared first so an arbitrarily
 * long run never loses precision to a floating-point conversion.
 *
 * @param left - First digit run.
 * @param right - Second digit run.
 * @returns Negative when the left value is smaller, positive when it is larger, zero when equal.
 */
function compareNumericRuns(left: string, right: string): number {
  const leftDigits = stripLeadingZeros(left);
  const rightDigits = stripLeadingZeros(right);

  if (leftDigits.length !== rightDigits.length) {
    return leftDigits.length - rightDigits.length;
  }

  return compareText(leftDigits, rightDigits);
}

/**
 * Removes leading zeros from a digit run.
 *
 * @param value - Digit run.
 * @returns The value without leading zeros, or `0` when every digit was a zero.
 */
function stripLeadingZeros(value: string): string {
  const stripped = value.replace(/^0+/, "");

  return stripped.length === 0 ? "0" : stripped;
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
 * Plans creating a tag.
 *
 * A non-empty message creates an annotated tag and records that message; an empty or null message
 * creates a lightweight tag. An empty target means the documented default, `HEAD`. The name and
 * target must be safe single argv values, and the target is a commit id, tag, branch, or `HEAD`,
 * never a revision expression the planner would have to expand.
 *
 * @param input - Tag name, target commit-ish, and optional annotation message.
 * @returns The planned argument array, or the reason the plan cannot run.
 */
export function planCreateTag(input: {
  readonly name: string;
  readonly target: string;
  readonly message: string | null;
}): GitArgPlan {
  if (!isSafeGitName(input.name)) {
    return planGitError(`invalid tag name "${input.name}"`);
  }

  const target = input.target.length === 0 ? "HEAD" : input.target;

  if (!isSafeGitName(target)) {
    return planGitError(`invalid tag target "${input.target}"`);
  }

  const message = input.message ?? "";

  if (message.length > 0) {
    return planGitArgs(["tag", "-a", input.name, target, "-m", message]);
  }

  return planGitArgs(["tag", input.name, target]);
}

/**
 * Plans pushing one tag to a remote.
 *
 * The explicit `refs/tags/<name>` refspec keeps a push from matching unrelated refs, and the option
 * stays before `--` so neither the remote nor the refspec can be parsed as an option.
 *
 * @param remote - Configured remote name.
 * @param name - Tag name.
 * @returns The planned argument array, or the reason the plan cannot run.
 */
export function planPushTag(remote: string, name: string): GitArgPlan {
  if (!isSafeGitName(remote)) {
    return planGitError(`invalid remote name "${remote}"`);
  }

  if (!isSafeGitName(name)) {
    return planGitError(`invalid tag name "${name}"`);
  }

  return planGitArgs(["push", "--progress", "--", remote, `refs/tags/${name}`]);
}

/**
 * Plans deleting one local tag.
 *
 * @param name - Tag name.
 * @returns The planned argument array, or the reason the plan cannot run.
 */
export function planDeleteLocalTag(name: string): GitArgPlan {
  if (!isSafeGitName(name)) {
    return planGitError(`invalid tag name "${name}"`);
  }

  return planGitArgs(["tag", "-d", name]);
}

/**
 * Plans deleting one tag from a remote.
 *
 * @param remote - Configured remote name.
 * @param name - Tag name.
 * @returns The planned argument array, or the reason the plan cannot run.
 */
export function planDeleteRemoteTag(remote: string, name: string): GitArgPlan {
  if (!isSafeGitName(remote)) {
    return planGitError(`invalid remote name "${remote}"`);
  }

  if (!isSafeGitName(name)) {
    return planGitError(`invalid tag name "${name}"`);
  }

  return planGitArgs(["push", "--progress", "--delete", "--", remote, `refs/tags/${name}`]);
}
