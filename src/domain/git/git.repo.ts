import { classifyGitFailure } from "./git.errors";
import { isTruncatedOutput } from "./git.remotes";
import type {
  GitClient,
  GitIdentity,
  GitReadOptions,
  HeadProbe,
  OperationProbe,
  RepositoryProbe,
  RepositoryProbeDetail,
} from "./git.types";

/**
 * Reads the repository discovery signals with `git rev-parse`.
 *
 * The probe runs outside a repository without throwing: a failing `rev-parse` yields
 * `insideWorkTree: false`, `bare: false`, and null paths, which the state machine maps to
 * `not-a-repository`. A bare repository reports `insideWorkTree: false` and `bare: true` with its
 * absolute git directory, so the shell can render the bare-repository screen.
 *
 * @param client - Git client bound to the configured executable.
 * @param options - Working directory and cancellation signal.
 * @returns Discovery signals for the working directory.
 */
export async function readRepositoryProbe(
  client: GitClient,
  options: GitReadOptions,
): Promise<RepositoryProbe> {
  const detail = await readRepositoryProbeDetail(client, options);

  return detail.probe;
}

/**
 * Reads the repository discovery signals together with the failures that produced them.
 *
 * The repository provider uses the failures to distinguish a missing git executable from a
 * directory that is merely not a repository.
 *
 * @param client - Git client bound to the configured executable.
 * @param options - Working directory and cancellation signal.
 * @returns Discovery signals and the classified probe failures.
 */
export async function readRepositoryProbeDetail(
  client: GitClient,
  options: GitReadOptions,
): Promise<RepositoryProbeDetail> {
  const [insideResult, metaResult] = await Promise.all([
    client.invoke({
      args: ["rev-parse", "--is-inside-work-tree"],
      cwd: options.cwd,
      signal: options.signal,
      operationClass: "read",
    }),
    client.invoke({
      args: ["rev-parse", "--is-bare-repository", "--absolute-git-dir"],
      cwd: options.cwd,
      signal: options.signal,
      operationClass: "read",
    }),
  ]);

  return {
    probe: await buildRepositoryProbe(client, options, insideResult, metaResult),
    insideFailure: insideResult.ok ? null : classifyGitFailure(insideResult),
    metaFailure: metaResult.ok ? null : classifyGitFailure(metaResult),
  };
}

/**
 * Builds discovery signals from the two probe results.
 *
 * @param client - Git client bound to the configured executable.
 * @param options - Working directory and cancellation signal.
 * @param insideResult - Result of the inside-work-tree probe.
 * @param metaResult - Result of the bare and git-directory probe.
 * @returns Discovery signals for the working directory.
 */
async function buildRepositoryProbe(
  client: GitClient,
  options: GitReadOptions,
  insideResult: { readonly ok: boolean; readonly stdout: string },
  metaResult: { readonly ok: boolean; readonly stdout: string },
): Promise<RepositoryProbe> {
  const insideWorkTree = insideResult.ok && insideResult.stdout.trim() === "true";
  const meta = metaResult.ok ? readLines(metaResult.stdout) : [];
  const bare = meta[0] === "true";
  const gitDir = meta[1] ?? null;
  const root = insideWorkTree && !bare ? await readTopLevel(client, options) : null;

  return {
    insideWorkTree: insideWorkTree && !bare,
    bare,
    root,
    gitDir,
  };
}

/**
 * Reads the absolute work-tree root.
 *
 * @param client - Git client bound to the configured executable.
 * @param options - Working directory and cancellation signal.
 * @returns The root path, or null when git cannot report one.
 */
async function readTopLevel(client: GitClient, options: GitReadOptions): Promise<string | null> {
  const result = await client.invoke({
    args: ["rev-parse", "--show-toplevel"],
    cwd: options.cwd,
    signal: options.signal,
    operationClass: "read",
  });

  return result.ok ? result.stdout.trim() || null : null;
}

/**
 * Reads the HEAD signals used to detect empty and detached repositories.
 *
 * `symbolic-ref --short HEAD` succeeds on an unborn branch, so an empty repository reports its
 * branch name with `exists: false`. A failing `symbolic-ref` on an existing HEAD means detached,
 * and the short hash is read for the top bar.
 *
 * @param client - Git client bound to the configured executable.
 * @param options - Working directory and cancellation signal.
 * @returns HEAD existence, branch, and detached information.
 */
export async function readHeadProbe(
  client: GitClient,
  options: GitReadOptions,
): Promise<HeadProbe> {
  const [verifyResult, symbolicResult] = await Promise.all([
    client.invoke({
      args: ["rev-parse", "--verify", "HEAD"],
      cwd: options.cwd,
      signal: options.signal,
      operationClass: "read",
    }),
    client.invoke({
      args: ["symbolic-ref", "-q", "--short", "HEAD"],
      cwd: options.cwd,
      signal: options.signal,
      operationClass: "read",
    }),
  ]);

  const exists = verifyResult.ok && verifyResult.stdout.trim().length > 0;
  const branch = symbolicResult.ok ? symbolicResult.stdout.trim() || null : null;
  const detached = exists && branch === null;
  const shortHash = detached ? await readShortHash(client, options) : null;

  return { exists, branch, detached, shortHash };
}

/**
 * Reads the subject of the HEAD commit.
 *
 * One bounded `git log -1 --format=%s` invocation supplies the subject the stash prefill needs. The
 * subject is display data, so a failed, truncated, or empty read returns null instead of failing the
 * snapshot.
 *
 * @param client - Git client bound to the configured executable.
 * @param options - Working directory and cancellation signal.
 * @returns The first subject line, or null when HEAD is unborn or the read did not complete.
 */
export async function readHeadSubject(
  client: GitClient,
  options: GitReadOptions,
): Promise<string | null> {
  const result = await client.invoke({
    args: ["log", "-1", "--format=%s"],
    cwd: options.cwd,
    signal: options.signal,
    operationClass: "read",
  });

  if (!result.ok || isTruncatedOutput(result)) {
    return null;
  }

  return firstLine(result.stdout) || null;
}

/**
 * Reads the abbreviated HEAD commit id.
 *
 * @param client - Git client bound to the configured executable.
 * @param options - Working directory and cancellation signal.
 * @returns The short hash, or null when it cannot be read.
 */
async function readShortHash(client: GitClient, options: GitReadOptions): Promise<string | null> {
  const result = await client.invoke({
    args: ["rev-parse", "--short", "HEAD"],
    cwd: options.cwd,
    signal: options.signal,
    operationClass: "read",
  });

  return result.ok ? result.stdout.trim() || null : null;
}

/**
 * Reads merge, rebase, and cherry-pick markers.
 *
 * Merge and cherry-pick are detected from their pseudo refs. Rebase markers are directories rather
 * than refs, and this domain module has no filesystem builtin allowance, so a paused rebase is read
 * from `git rebase --show-current-patch`, with `REBASE_HEAD` as a fallback for states where no patch
 * is currently shown. Both backends are covered while paused.
 *
 * @param client - Git client bound to the configured executable.
 * @param options - Working directory and cancellation signal.
 * @returns The in-progress operation flags.
 */
export async function readOperationProbe(
  client: GitClient,
  options: GitReadOptions,
): Promise<OperationProbe> {
  const [merge, rebase, cherryPick] = await Promise.all([
    hasPseudoRef(client, options, "MERGE_HEAD"),
    isRebaseInProgress(client, options),
    hasPseudoRef(client, options, "CHERRY_PICK_HEAD"),
  ]);

  return {
    mergeInProgress: merge,
    rebaseInProgress: rebase,
    cherryPickInProgress: cherryPick,
  };
}

/**
 * Reports whether a rebase is paused.
 *
 * `git rebase --show-current-patch` exits zero only while a rebase is in progress and covers the
 * merge and apply backends. `REBASE_HEAD` is checked second because a rebase that has not written
 * it yet still has to be detected.
 *
 * @param client - Git client bound to the configured executable.
 * @param options - Working directory and cancellation signal.
 * @returns True when a rebase is in progress.
 */
async function isRebaseInProgress(client: GitClient, options: GitReadOptions): Promise<boolean> {
  const currentPatch = await client.invoke({
    args: ["rebase", "--show-current-patch"],
    cwd: options.cwd,
    signal: options.signal,
    operationClass: "read",
  });

  return currentPatch.ok || (await hasPseudoRef(client, options, "REBASE_HEAD"));
}

/**
 * Reports whether a pseudo ref resolves to an object.
 *
 * @param client - Git client bound to the configured executable.
 * @param options - Working directory and cancellation signal.
 * @param ref - Pseudo ref name such as `MERGE_HEAD`.
 * @returns True when the ref exists.
 */
async function hasPseudoRef(
  client: GitClient,
  options: GitReadOptions,
  ref: string,
): Promise<boolean> {
  const result = await client.invoke({
    args: ["rev-parse", "--verify", "--quiet", ref],
    cwd: options.cwd,
    signal: options.signal,
    operationClass: "read",
  });

  return result.ok && result.stdout.trim().length > 0;
}

/**
 * Reads the configured commit identity.
 *
 * A missing value is reported as null rather than an error, so the composer can name exactly which
 * value is missing.
 *
 * @param client - Git client bound to the configured executable.
 * @param options - Working directory and cancellation signal.
 * @returns Configured user name and email, each null when unset.
 */
export async function readGitIdentity(
  client: GitClient,
  options: GitReadOptions,
): Promise<GitIdentity> {
  const [nameResult, emailResult] = await Promise.all([
    client.invoke({
      args: ["config", "user.name"],
      cwd: options.cwd,
      signal: options.signal,
      operationClass: "read",
    }),
    client.invoke({
      args: ["config", "user.email"],
      cwd: options.cwd,
      signal: options.signal,
      operationClass: "read",
    }),
  ]);

  return {
    name: nameResult.ok ? nameResult.stdout.trim() || null : null,
    email: emailResult.ok ? emailResult.stdout.trim() || null : null,
  };
}

/**
 * Splits stdout into trimmed, non-empty lines.
 *
 * @param stdout - Captured standard output.
 * @returns The non-empty trimmed lines.
 */
function readLines(stdout: string): string[] {
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * Reads the first non-empty line of captured output.
 *
 * @param stdout - Captured standard output.
 * @returns The trimmed first line, or an empty string when the output is blank.
 */
function firstLine(stdout: string): string {
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();

    if (trimmed.length > 0) {
      return trimmed;
    }
  }

  return "";
}
