import type {
  BranchRecord,
  BranchUpstreamStatus,
  GitClient,
  GitInvocationResult,
  RemoteBranchRecord,
} from "@/domain/git/git.types";
import type {
  RemoteBranchCheck,
  UpstreamClassificationInput,
  UpstreamDescriptor,
  UpstreamEvidence,
  UpstreamReadResult,
  UpstreamStatus,
} from "./repository.types";

/** Prefix of the branch ref returned by `%(upstream:remoteref)`. */
const UPSTREAM_BRANCH_REF_PREFIX = "refs/heads/";

/** Evidence that never claims a deletion. */
export const EMPTY_UPSTREAM_EVIDENCE: UpstreamEvidence = Object.freeze({
  prunedRefs: Object.freeze([]),
  appDeletedRefs: Object.freeze([]),
  unknownRefs: Object.freeze([]),
});

/**
 * Formats the human-readable upstream ref for an explicit remote and branch.
 *
 * The display ref is always derived from the two configured values, never parsed back into them.
 * A remote name may legally contain a slash, so the display string is ambiguous by design and must
 * never be split to route a git command.
 *
 * @param remote - Remote name from the configured upstream.
 * @param branch - Branch name inside that remote.
 * @returns The display ref such as `origin/main`.
 */
export function formatUpstreamRef(remote: string, branch: string): string {
  return `${remote}/${branch}`;
}

/**
 * Parses the two tab-separated upstream atoms git reports for one branch.
 *
 * The input is `%(upstream:remotename)%09%(upstream:remoteref)`. The bulk `refs/heads` read adds a
 * leading local-ref column, which the caller removes before calling this. Git's dedicated atoms
 * keep a slash-named remote intact while `%(upstream:short)` splits it at the first slash. Ref and
 * remote names cannot contain tabs, so tabs are safe separators.
 *
 * @param atoms - One line carrying exactly the remote name and the remote branch ref.
 * @returns The descriptor, or null when either half is missing or the ref is not a branch.
 */
export function parseUpstreamAtoms(atoms: string): UpstreamDescriptor | null {
  const columns = atoms.replace(/\r$/, "").split("\t");

  if (columns.length !== 2) {
    return null;
  }

  const remote = (columns[0] ?? "").trim();
  const remoteRef = (columns[1] ?? "").trim();

  if (remote.length === 0 || !remoteRef.startsWith(UPSTREAM_BRANCH_REF_PREFIX)) {
    return null;
  }

  const branch = remoteRef.slice(UPSTREAM_BRANCH_REF_PREFIX.length);

  if (branch.length === 0) {
    return null;
  }

  return { ref: formatUpstreamRef(remote, branch), remote, branch };
}

/**
 * Splits a short upstream ref such as `origin/main` into its remote and branch.
 *
 * Display-only and ambiguous: a legal remote name may contain a slash, so `a/b/main` is read as
 * remote `a` and branch `b/main`. Never use the result to route a git command; read
 * `%(upstream:remotename)` and `%(upstream:remoteref)` through `parseUpstreamAtoms` instead.
 *
 * @param ref - Short upstream ref from `%(upstream:short)`.
 * @returns The parsed descriptor, or null when it has no remote or branch part.
 */
export function parseUpstreamRef(ref: string): UpstreamDescriptor | null {
  const separator = ref.indexOf("/");

  if (separator <= 0 || separator === ref.length - 1) {
    return null;
  }

  return {
    ref,
    remote: ref.slice(0, separator),
    branch: ref.slice(separator + 1),
  };
}

/**
 * Classifies the configured upstream from local existence and session evidence.
 *
 * A missing ref is never called deleted from the absence alone. The order is deliberate:
 * app-initiated deletion wins because it is the strongest evidence, a successful prune is next,
 * then a failed remote check reports `unknown`, and only then does a plain missing ref become
 * `gone`. Commit dates are never an input, so an old ref object cannot look stale or deleted.
 *
 * @param input - Configured ref, local existence, and evidence.
 * @returns The upstream classification.
 */
export function classifyUpstream(input: UpstreamClassificationInput): UpstreamStatus {
  const ref = input.configuredRef;

  if (ref === null) {
    return "none";
  }

  if (input.refExists) {
    return "healthy";
  }

  if (input.evidence.appDeletedRefs.includes(ref)) {
    return "deleted-after-app-deletion";
  }

  if (input.evidence.prunedRefs.includes(ref)) {
    return "deleted-after-prune";
  }

  if (input.evidence.unknownRefs.includes(ref)) {
    return "unknown";
  }

  return "gone";
}

/**
 * Classifies every local branch's configured upstream from one batched read.
 *
 * Existence comes from the remote-tracking refs read in the same snapshot rather than one
 * `rev-parse` per branch, so a repository with hundreds of branches still costs one branch read and
 * one remote-tracking read. Session evidence is applied through the same `classifyUpstream` rules the
 * current branch uses, so a confirmed prune or app deletion marks every branch that tracked the ref.
 *
 * @param branches - Local branches as parsed, with a placeholder `upstreamStatus`.
 * @param remoteBranches - Remote-tracking branches read in the same snapshot.
 * @param evidence - Upstream deletion and failure evidence from this session.
 * @returns New branch records with the real classification.
 */
export function classifyBranchUpstreams(
  branches: readonly BranchRecord[],
  remoteBranches: readonly RemoteBranchRecord[],
  evidence: UpstreamEvidence,
): readonly BranchRecord[] {
  const existingRefs = new Set(
    remoteBranches.map((record) => formatUpstreamRef(record.remote, record.branch)),
  );

  return branches.map((branch) => ({
    ...branch,
    upstreamStatus: classifyBranchUpstream(branch, existingRefs, evidence),
  }));
}

/**
 * Classifies one branch against the refs and evidence of the snapshot read.
 *
 * @param branch - Local branch record.
 * @param existingRefs - Remote-tracking refs read in the same snapshot.
 * @param evidence - Upstream deletion and failure evidence from this session.
 * @returns The branch-level upstream status.
 */
function classifyBranchUpstream(
  branch: BranchRecord,
  existingRefs: ReadonlySet<string>,
  evidence: UpstreamEvidence,
): BranchUpstreamStatus {
  const status = classifyUpstream({
    configuredRef: branch.upstream,
    refExists: branch.upstream !== null && existingRefs.has(branch.upstream),
    evidence,
  });

  return toBranchUpstreamStatus(status);
}

/**
 * Maps the repository-level upstream classification to the branch-row classification.
 *
 * @param status - Repository-level classification.
 * @returns The branch-row status.
 */
function toBranchUpstreamStatus(status: UpstreamStatus): BranchUpstreamStatus {
  switch (status) {
    case "none":
      return "none";
    case "healthy":
      return "tracked";
    case "gone":
      return "notFound";
    case "deleted-after-prune":
    case "deleted-after-app-deletion":
      return "deleted";
    case "unknown":
      return "unknown";
  }
}

/**
 * Adds a prune confirmation for one upstream ref.
 *
 * @param evidence - Existing evidence.
 * @param ref - Upstream ref a successful prune confirmed absent.
 * @returns New evidence without duplicates.
 */
export function withPruneConfirmation(evidence: UpstreamEvidence, ref: string): UpstreamEvidence {
  return {
    ...evidence,
    prunedRefs: addUnique(evidence.prunedRefs, ref),
    unknownRefs: evidence.unknownRefs.filter((candidate) => candidate !== ref),
  };
}

/**
 * Adds an app-initiated remote branch deletion for one upstream ref.
 *
 * @param evidence - Existing evidence.
 * @param ref - Upstream ref the app deleted remotely.
 * @returns New evidence without duplicates.
 */
export function withAppDeletion(evidence: UpstreamEvidence, ref: string): UpstreamEvidence {
  return {
    ...evidence,
    appDeletedRefs: addUnique(evidence.appDeletedRefs, ref),
    unknownRefs: evidence.unknownRefs.filter((candidate) => candidate !== ref),
  };
}

/**
 * Records that the most recent remote check for a ref failed or timed out.
 *
 * @param evidence - Existing evidence.
 * @param ref - Upstream ref whose check failed.
 * @returns New evidence that classifies the ref as unknown.
 */
export function withUnknownCheck(evidence: UpstreamEvidence, ref: string): UpstreamEvidence {
  if (
    evidence.appDeletedRefs.includes(ref) ||
    evidence.prunedRefs.includes(ref) ||
    evidence.unknownRefs.includes(ref)
  ) {
    return evidence;
  }

  return { ...evidence, unknownRefs: [...evidence.unknownRefs, ref] };
}

/**
 * Drops deletion evidence for refs a successful read observed present again.
 *
 * Prune and app-deletion evidence describes one interval: the ref was confirmed absent, so the next
 * successful read that sees it is proof the remote advertises it again. Keeping the old evidence
 * would let a later external removal be classified as a confirmed deletion the app never witnessed.
 * Failed checks are left alone, because a failed check does not prove presence either way.
 *
 * @param evidence - Existing evidence.
 * @param presentRefs - Upstream refs the successful read observed as remote-tracking refs.
 * @returns The evidence with re-observed refs removed from both deletion sets.
 */
export function clearConfirmedPresence(
  evidence: UpstreamEvidence,
  presentRefs: Iterable<string>,
): UpstreamEvidence {
  if (evidence.prunedRefs.length === 0 && evidence.appDeletedRefs.length === 0) {
    return evidence;
  }

  const present = new Set(presentRefs);
  const prunedRefs = evidence.prunedRefs.filter((ref) => !present.has(ref));
  const appDeletedRefs = evidence.appDeletedRefs.filter((ref) => !present.has(ref));

  if (
    prunedRefs.length === evidence.prunedRefs.length &&
    appDeletedRefs.length === evidence.appDeletedRefs.length
  ) {
    return evidence;
  }

  return { ...evidence, prunedRefs, appDeletedRefs };
}

/**
 * Reads whether any local branch has a configured upstream.
 *
 * The scoped Fetch command fetches exactly these upstream refs, so an empty set means Fetch has
 * nothing to do and must be blocked with the documented reason rather than reporting a no-op
 * success. A failed read returns true on purpose: an incomplete read must not disable Fetch, and
 * the fetch executor independently refuses a zero-upstream scope.
 *
 * @param client - Git client bound to the configured executable.
 * @param options - Working directory and cancellation signal.
 * @returns True when at least one local branch reports a non-empty upstream.
 */
export async function readHasUpstreamBranches(
  client: GitClient,
  options: { readonly cwd: string; readonly signal: AbortSignal },
): Promise<boolean> {
  const result = await client.invoke({
    args: ["for-each-ref", "--format=%(upstream:short)", "refs/heads"],
    cwd: options.cwd,
    signal: options.signal,
    operationClass: "read",
  });

  if (!result.ok) {
    return true;
  }

  return result.stdout.split("\n").some((line) => line.trim().length > 0);
}

/**
 * Reads the configured upstream ref and classifies its local state.
 *
 * The configured ref is read from branch configuration with `git for-each-ref`, not from `@{u}`,
 * because `@{u}` fails once the remote-tracking ref disappears. That keeps a deleted upstream
 * distinguishable from a branch that never configured one. The read uses git's explicit
 * `%(upstream:remotename)` and `%(upstream:remoteref)` atoms because `%(upstream:short)` is
 * ambiguous for a remote whose name contains a slash. Existence is then checked against the full
 * `refs/remotes/<remote>/<branch>` path, never the ambiguous short ref.
 *
 * @param client - Git client bound to the configured executable.
 * @param options - Working directory, cancellation signal, branch, and evidence.
 * @returns The configured ref and its classification.
 */
export async function readUpstreamStatus(
  client: GitClient,
  options: {
    readonly cwd: string;
    readonly signal: AbortSignal;
    readonly branch: string | null;
    readonly evidence: UpstreamEvidence;
  },
): Promise<UpstreamReadResult> {
  if (options.branch === null) {
    return { status: "none", upstream: null, descriptor: null };
  }

  const configured = await client.invoke({
    args: [
      "for-each-ref",
      "--format=%(upstream:remotename)%09%(upstream:remoteref)",
      `refs/heads/${options.branch}`,
    ],
    cwd: options.cwd,
    signal: options.signal,
    operationClass: "read",
  });

  if (!configured.ok) {
    return { status: "unknown", upstream: null, descriptor: null };
  }

  const atoms = firstLine(configured.stdout);

  if (atoms === null) {
    return { status: "none", upstream: null, descriptor: null };
  }

  const descriptor = parseUpstreamAtoms(atoms);

  if (descriptor === null) {
    return { status: "unknown", upstream: null, descriptor: null };
  }

  const exists = await refExists(
    client,
    options.cwd,
    options.signal,
    `refs/remotes/${descriptor.remote}/${descriptor.branch}`,
  );
  const status = classifyUpstream({
    configuredRef: descriptor.ref,
    refExists: exists,
    evidence: options.evidence,
  });

  return { status, upstream: descriptor.ref, descriptor };
}

/**
 * Confirms whether a remote still advertises one head.
 *
 * `git ls-remote --heads <remote> refs/heads/<branch>` is the only network read that may confirm
 * absence. A non-zero exit, a timeout, a cancellation, or unparsable output is reported as
 * `unknown`, so no caller can turn a failed check into a deletion claim.
 *
 * @param client - Git client bound to the configured executable.
 * @param options - Working directory and cancellation signal.
 * @param descriptor - Upstream ref to confirm.
 * @returns `present`, `absent`, or `unknown`.
 */
export async function confirmRemoteBranch(
  client: GitClient,
  options: { readonly cwd: string; readonly signal: AbortSignal },
  descriptor: UpstreamDescriptor,
): Promise<RemoteBranchCheck> {
  const result = await client.invoke({
    args: ["ls-remote", "--heads", descriptor.remote, `refs/heads/${descriptor.branch}`],
    cwd: options.cwd,
    signal: options.signal,
    operationClass: "network",
  });

  return readRemoteBranchCheck(result);
}

/**
 * Reads the confirmation outcome from one `ls-remote` result.
 *
 * @param result - Settled network invocation.
 * @returns `present` when a head is advertised, `absent` on a clean empty response, else `unknown`.
 */
function readRemoteBranchCheck(result: GitInvocationResult): RemoteBranchCheck {
  if (!result.ok) {
    return "unknown";
  }

  const lines = result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  return lines.length > 0 ? "present" : "absent";
}

/**
 * Checks whether a remote-tracking ref exists locally.
 *
 * @param client - Git client bound to the configured executable.
 * @param cwd - Working directory.
 * @param signal - Cancellation signal.
 * @param ref - Full or short ref name.
 * @returns True when the ref resolves to an object.
 */
async function refExists(
  client: GitClient,
  cwd: string,
  signal: AbortSignal,
  ref: string,
): Promise<boolean> {
  const result = await client.invoke({
    args: ["rev-parse", "--verify", "--quiet", ref],
    cwd,
    signal,
    operationClass: "read",
  });

  return result.ok && result.stdout.trim().length > 0;
}

/**
 * Reads the first non-empty line of captured output.
 *
 * @param stdout - Captured output.
 * @returns The trimmed first line, or null when the output is blank.
 */
function firstLine(stdout: string): string | null {
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();

    if (trimmed.length > 0) {
      return trimmed;
    }
  }

  return null;
}

/**
 * Appends a value to a list unless it is already present.
 *
 * @param values - Existing values.
 * @param value - Candidate value.
 * @returns A new list that contains the value once.
 */
function addUnique(values: readonly string[], value: string): readonly string[] {
  return values.includes(value) ? values : [...values, value];
}
