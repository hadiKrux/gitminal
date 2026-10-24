import type { GitClient, GitInvocationResult } from "@/domain/git/git.types";
import type {
  RemoteBranchCheck,
  UpstreamClassificationInput,
  UpstreamDescriptor,
  UpstreamEvidence,
  UpstreamReadResult,
  UpstreamStatus,
} from "./repository.types";

/** Evidence that never claims a deletion. */
export const EMPTY_UPSTREAM_EVIDENCE: UpstreamEvidence = Object.freeze({
  prunedRefs: Object.freeze([]),
  appDeletedRefs: Object.freeze([]),
  unknownRefs: Object.freeze([]),
});

/**
 * Splits a short upstream ref such as `origin/main` into its remote and branch.
 *
 * @param ref - Configured upstream ref.
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
 * distinguishable from a branch that never configured one. Existence is then checked with
 * `git rev-parse --verify`.
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
    args: ["for-each-ref", "--format=%(upstream:short)", `refs/heads/${options.branch}`],
    cwd: options.cwd,
    signal: options.signal,
    operationClass: "read",
  });

  if (!configured.ok) {
    return { status: "unknown", upstream: null, descriptor: null };
  }

  const upstream = firstLine(configured.stdout);

  if (upstream === null) {
    return { status: "none", upstream: null, descriptor: null };
  }

  const exists = await refExists(client, options.cwd, options.signal, upstream);
  const status = classifyUpstream({
    configuredRef: upstream,
    refExists: exists,
    evidence: options.evidence,
  });

  return { status, upstream, descriptor: parseUpstreamRef(upstream) };
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
