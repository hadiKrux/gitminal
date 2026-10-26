import { stat } from "node:fs/promises";
import path from "node:path";
import type {
  DiffBinaryProbeResult,
  DiffChangedFile,
  DiffFileActionOptions,
  DiffFileActionReason,
  DiffFileActionResult,
  DiffPathPair,
  DiffProbeOptions,
  DiffReadOptions,
  DiffSection,
  DiffSizeProbeResult,
  DiffTextReadResult,
  FileDiffReadResult,
} from "@/domain/diff/diff.types";
import { classifyGitFailure } from "./git.errors";
import { planGitArgs, planGitError } from "./git.plan";
import { createTruncatedOutputFailure, isTruncatedOutput } from "./git.remotes";
import { readStatus } from "./git.status";
import type {
  GitArgPlan,
  GitClient,
  GitFailure,
  GitInvocationResult,
  GitReadOptions,
  StatusSnapshot,
} from "./git.types";
import { parseFileDiff } from "./parsers/parse.diff";

/** Prefix that makes a git path argument a literal pathspec. */
const LITERAL_PATHSPEC_PREFIX = ":(literal)";

/** Device path git compares an untracked file against. */
const DEV_NULL_PATH = "/dev/null";

/** Exit codes `git diff --no-index` uses: 0 for no difference, 1 for a difference. */
const NO_INDEX_EXIT_CODES: readonly number[] = Object.freeze([0, 1]);

/** Highest context count accepted from configuration. */
const MAX_CONTEXT_LINES = 1000;

/**
 * Context window read from git so long unchanged runs exist and can be collapsed.
 *
 * `git diff -U<n>` never emits a context run longer than `2 * n`, while
 * `diff.collapse.ts` only hides a run longer than `2 * diff.contextLines + 1`. Reading with
 * exactly the configured count would therefore make the "N unchanged lines" marker unreachable,
 * including at the documented maximum of 20 where the longest run is 40 and the threshold is 41.
 * Every text diff is read with `max(DIFF_READ_CONTEXT_LINES, configured + 1)`, and the panel then
 * collapses it to `diff.contextLines`; a larger configured count is preserved rather than
 * truncated. A configured count of 0 stays `-U0`.
 */
const DIFF_READ_CONTEXT_LINES = 20;

/** Shape of a commit id accepted by the commit diff read. */
const COMMIT_ID_PATTERN = /^[0-9a-f]{4,64}$/i;

/**
 * Wraps one repository-relative path as a literal git pathspec.
 *
 * Git then treats brackets, stars, and question marks as ordinary characters, so a file named
 * `a[1].txt` can never stage, discard, or diff `a1.txt`.
 *
 * @param path - Repository-relative path from the status parser.
 * @returns The literal pathspec argument.
 */
export function literalPathspec(path: string): string {
  return `${LITERAL_PATHSPEC_PREFIX}${path}`;
}

/**
 * Reports whether a path is safe to pass as one argv value.
 *
 * @param path - Candidate path.
 * @returns A message when the path is unusable, or null when it is valid.
 */
function validatePath(path: string): string | null {
  if (path.length === 0) {
    return "path is empty";
  }

  return path.includes("\0") ? "path contains a NUL" : null;
}

/**
 * Builds the literal pathspec arguments for a set of targets.
 *
 * A rename contributes both paths. Duplicates are removed while order is preserved. Exported for
 * the stash read builders, which plan a path-filtered read of their own.
 *
 * @param targets - Path pairs from the status snapshot.
 * @param includeOldPaths - True to pass the pre-rename path as well.
 * @returns The pathspec arguments, or the planning error.
 */
export function buildPathspecArgs(
  targets: readonly DiffPathPair[],
  includeOldPaths: boolean,
): GitArgPlan {
  const values: string[] = [];

  for (const target of targets) {
    const candidates = includeOldPaths ? [target.oldPath, target.path] : [target.path];

    for (const candidate of candidates) {
      if (candidate === null) {
        continue;
      }

      const error = validatePath(candidate);

      if (error !== null) {
        return planGitError(error);
      }

      const pathspec = literalPathspec(candidate);

      if (!values.includes(pathspec)) {
        values.push(pathspec);
      }
    }
  }

  return values.length === 0 ? planGitError("no paths") : planGitArgs(values);
}

/**
 * Clamps a configured context line count to a bounded, non-negative integer.
 *
 * @param contextLines - Requested context lines.
 * @returns The context count to pass to git.
 */
function resolveContextLines(contextLines: number): number {
  if (!Number.isFinite(contextLines)) {
    return 0;
  }

  return Math.min(MAX_CONTEXT_LINES, Math.max(0, Math.floor(contextLines)));
}

/**
 * Resolves the context window one text diff is read with.
 *
 * A configured count of 0 keeps a `-U0` read, because the panel never collapses that read and the
 * user asked for no context. Any other count reads at least `DIFF_READ_CONTEXT_LINES` and always
 * one more than the configured count, so a run longer than `2 * configured + 1` can exist in git's
 * output at every configured value in the documented 0 to 20 range, including the maximum. A larger
 * configured count is preserved. The result is capped by `MAX_CONTEXT_LINES` so `-U` is never
 * unbounded.
 *
 * @param contextLines - Configured `diff.contextLines`.
 * @returns The context count to pass to git.
 */
export function resolveDiffReadContextLines(contextLines: number): number {
  const configured = resolveContextLines(contextLines);

  return configured === 0
    ? 0
    : Math.min(MAX_CONTEXT_LINES, Math.max(DIFF_READ_CONTEXT_LINES, configured + 1));
}

/**
 * Builds the `-U<n>` argument for one read.
 *
 * @param contextLines - Context lines to request from git.
 * @returns The unified-diff context flag.
 */
function unifiedFlag(contextLines: number): string {
  return `-U${resolveContextLines(contextLines)}`;
}

/**
 * Reports whether a target is a rename that needs both paths.
 *
 * @param target - Path pair.
 * @returns True when the old path differs from the current path.
 */
function isRename(target: DiffPathPair): boolean {
  return target.oldPath !== null && target.oldPath !== target.path;
}

/**
 * Builds the working-tree diff of one file.
 *
 * Rename detection is enabled only when the caller passes both paths, because a single-path diff
 * cannot pair the old and new names.
 *
 * @param target - Current and pre-rename paths.
 * @param contextLines - Configured context lines; the read uses a larger collapse window.
 * @returns The planned argument array, or the planning error.
 */
export function buildWorkingDiffArgs(target: DiffPathPair, contextLines: number): GitArgPlan {
  const paths = buildPathspecArgs([target], true);

  if (!paths.ok) {
    return paths;
  }

  return planGitArgs([
    "diff",
    ...(isRename(target) ? ["-M"] : []),
    "--no-color",
    unifiedFlag(resolveDiffReadContextLines(contextLines)),
    "--",
    ...paths.args,
  ]);
}

/**
 * Builds the staged diff of one file.
 *
 * @param target - Current and pre-rename paths.
 * @param contextLines - Configured context lines; the read uses a larger collapse window.
 * @returns The planned argument array, or the planning error.
 */
export function buildStagedDiffArgs(target: DiffPathPair, contextLines: number): GitArgPlan {
  const paths = buildPathspecArgs([target], true);

  if (!paths.ok) {
    return paths;
  }

  return planGitArgs([
    "diff",
    "--cached",
    ...(isRename(target) ? ["-M"] : []),
    "--no-color",
    unifiedFlag(resolveDiffReadContextLines(contextLines)),
    "--",
    ...paths.args,
  ]);
}

/**
 * Builds the bounded read of one untracked file.
 *
 * The file is not in the object database or the index, so the read uses
 * `git diff --no-index -- /dev/null <path>`. The path is a filesystem path here, not a pathspec, so
 * it is passed literally after `--` rather than wrapped in `:(literal)`. Git exits 1 because the
 * file always differs from `/dev/null`.
 *
 * @param path - Repository-relative working-tree path.
 * @param contextLines - Configured context lines; the read uses a larger collapse window.
 * @returns The planned argument array, or the planning error.
 */
export function buildUntrackedContentArgs(path: string, contextLines: number): GitArgPlan {
  const error =
    validatePath(path) ?? (path.startsWith("/") ? "untracked path must be relative" : null);

  if (error !== null) {
    return planGitError(error);
  }

  return planGitArgs([
    "diff",
    "--no-index",
    "--no-color",
    unifiedFlag(resolveDiffReadContextLines(contextLines)),
    "--",
    DEV_NULL_PATH,
    path,
  ]);
}

/**
 * Builds the read-only diff of one commit.
 *
 * `--format=` suppresses the commit header and `--diff-merges=first-parent` keeps a merge commit
 * readable against its first parent, so the output is a plain multi-file unified patch.
 *
 * @param sha - Commit id the caller already resolved.
 * @param contextLines - Configured context lines; the read uses a larger collapse window.
 * @returns The planned argument array, or the planning error.
 */
export function buildCommitDiffArgs(sha: string, contextLines: number): GitArgPlan {
  if (!COMMIT_ID_PATTERN.test(sha)) {
    return planGitError(`invalid commit id "${sha}"`);
  }

  return planGitArgs([
    "show",
    "--no-color",
    unifiedFlag(resolveDiffReadContextLines(contextLines)),
    "--format=",
    "--diff-merges=first-parent",
    sha,
  ]);
}

/**
 * Builds the changed-file list read for one commit.
 *
 * The read is small compared with the patch even for a commit that touches many files, so it is the
 * bounded first step when a whole-patch read exceeds the client output limit. `-z` keeps paths with
 * tabs or newlines unambiguous, and `-M` makes rename entries carry both paths.
 *
 * @param sha - Commit id the caller already resolved.
 * @returns The planned argument array, or the planning error.
 */
export function buildCommitFileListArgs(sha: string): GitArgPlan {
  if (!COMMIT_ID_PATTERN.test(sha)) {
    return planGitError(`invalid commit id "${sha}"`);
  }

  return planGitArgs([
    "show",
    "--no-color",
    "-M",
    "--name-status",
    "-z",
    "--format=",
    "--diff-merges=first-parent",
    sha,
  ]);
}

/**
 * Builds the single-file patch read for one commit.
 *
 * Reading one file at a time keeps each invocation under the client output limit even when the
 * whole commit patch would exceed it. A rename or copy passes both paths so `-M` can pair them.
 *
 * @param sha - Commit id the caller already resolved.
 * @param file - Changed file from the name-status read.
 * @param contextLines - Configured context lines; the read uses a larger collapse window.
 * @returns The planned argument array, or the planning error.
 */
export function buildCommitFileDiffArgs(
  sha: string,
  file: DiffChangedFile,
  contextLines: number,
): GitArgPlan {
  if (!COMMIT_ID_PATTERN.test(sha)) {
    return planGitError(`invalid commit id "${sha}"`);
  }

  const paths = buildPathspecArgs([file], true);

  if (!paths.ok) {
    return paths;
  }

  return planGitArgs([
    "show",
    "--no-color",
    "-M",
    unifiedFlag(resolveDiffReadContextLines(contextLines)),
    "--format=",
    "--diff-merges=first-parent",
    sha,
    "--",
    ...paths.args,
  ]);
}

/**
 * Builds the binary probe for one file.
 *
 * `--numstat` reports `-` `-` for a binary file. The untracked section uses the same no-index
 * comparison the content read uses.
 *
 * @param section - Section whose comparison must be probed.
 * @param path - Repository-relative path.
 * @returns The planned argument array, or the planning error.
 */
export function buildBinaryProbeArgs(section: DiffSection, path: string): GitArgPlan {
  const error = validatePath(path);

  if (error !== null) {
    return planGitError(error);
  }

  if (section === "untracked") {
    return path.startsWith("/")
      ? planGitError("untracked path must be relative")
      : planGitArgs(["diff", "--no-index", "--numstat", "--", DEV_NULL_PATH, path]);
  }

  return planGitArgs([
    "diff",
    ...(section === "staged" ? ["--cached"] : []),
    "--numstat",
    "--no-color",
    "--",
    literalPathspec(path),
  ]);
}

/**
 * Builds the staged size probe for one file.
 *
 * Only the staged section is measured through git, because only it has a stage-0 index blob whose
 * size is the content the panel would render. The read asks for that blob through the literal
 * index-path expression, and git applies no glob to it, so brackets are safe. A staged deletion has
 * no blob, which the probe reports as an unknown size instead of a failure. Working-tree and
 * untracked files are measured on disk by `probeSize` instead.
 *
 * @param path - Repository-relative path.
 * @returns The planned argument array, or the planning error.
 */
export function buildSizeProbeArgs(path: string): GitArgPlan {
  const error = validatePath(path);

  return error === null ? planGitArgs(["cat-file", "-s", `:0:${path}`]) : planGitError(error);
}

/**
 * Builds the stage command for one or more files.
 *
 * A rename contributes both its old and new paths.
 *
 * @param targets - Path pairs to stage.
 * @returns The planned `git add` argument array, or the planning error.
 */
export function buildStageArgs(targets: readonly DiffPathPair[]): GitArgPlan {
  const paths = buildPathspecArgs(targets, true);

  return paths.ok ? planGitArgs(["add", "--", ...paths.args]) : paths;
}

/**
 * Builds the unstage command for one or more files.
 *
 * `git restore --staged` is used instead of `git reset`, and the explicit `--` keeps every path out
 * of option position.
 *
 * @param targets - Path pairs to unstage.
 * @returns The planned `git restore --staged` argument array, or the planning error.
 */
export function buildUnstageArgs(targets: readonly DiffPathPair[]): GitArgPlan {
  const paths = buildPathspecArgs(targets, true);

  return paths.ok ? planGitArgs(["restore", "--staged", "--", ...paths.args]) : paths;
}

/**
 * Builds the discard command for already-resolved tracked paths.
 *
 * The executor resolves a rename to its old path before calling this builder, so a new path that is
 * not tracked in the index is never passed to `git restore`.
 *
 * @param paths - Repository-relative tracked paths.
 * @returns The planned `git restore` argument array, or the planning error.
 */
function buildDiscardArgs(paths: readonly string[]): GitArgPlan {
  const targets = paths.map((path) => ({ path, oldPath: null }));
  const pathspecs = buildPathspecArgs(targets, false);

  return pathspecs.ok ? planGitArgs(["restore", "--", ...pathspecs.args]) : pathspecs;
}

/**
 * Builds the delete command for untracked files.
 *
 * `-d` is added for a bulk delete so an untracked directory entry is removed too. `-x` and wildcard
 * pathspecs are never used.
 *
 * @param paths - Repository-relative untracked paths.
 * @param recursive - True to allow removing untracked directories.
 * @returns The planned `git clean` argument array, or the planning error.
 */
export function buildDeleteUntrackedArgs(paths: readonly string[], recursive: boolean): GitArgPlan {
  const targets = paths.map((path) => ({ path, oldPath: null }));
  const pathspecs = buildPathspecArgs(targets, false);

  if (!pathspecs.ok) {
    return pathspecs;
  }

  return planGitArgs(["clean", "-f", ...(recursive ? ["-d"] : []), "--", ...pathspecs.args]);
}

/**
 * Reads the working-tree diff of one file.
 *
 * @param client - Git client bound to the configured executable.
 * @param options - Path, old path, context lines, working directory, and signal.
 * @returns The parsed file or the classified failure. Never throws.
 */
export async function readWorkingDiff(
  client: GitClient,
  options: DiffReadOptions,
): Promise<FileDiffReadResult> {
  return await readSingleFile(
    client,
    options,
    buildWorkingDiffArgs(toTarget(options), options.contextLines),
  );
}

/**
 * Reads the staged diff of one file.
 *
 * @param client - Git client bound to the configured executable.
 * @param options - Path, old path, context lines, working directory, and signal.
 * @returns The parsed file or the classified failure. Never throws.
 */
export async function readStagedDiff(
  client: GitClient,
  options: DiffReadOptions,
): Promise<FileDiffReadResult> {
  return await readSingleFile(
    client,
    options,
    buildStagedDiffArgs(toTarget(options), options.contextLines),
  );
}

/**
 * Reads the full working-tree content of one untracked file as an added-lines patch.
 *
 * `git diff --no-index` exits 1 whenever the file differs from `/dev/null`, which is every
 * non-empty file, so exit 1 is treated as a successful read. The captured patch goes through the
 * same limiter and parser as a tracked diff.
 *
 * @param client - Git client bound to the configured executable.
 * @param options - Path, context lines, working directory, and signal.
 * @returns The parsed file or the classified failure. Never throws.
 */
export async function readUntrackedContent(
  client: GitClient,
  options: DiffReadOptions,
): Promise<FileDiffReadResult> {
  return await readSingleFile(
    client,
    options,
    buildUntrackedContentArgs(options.path, options.contextLines),
    NO_INDEX_EXIT_CODES,
  );
}

/**
 * Reads a conflicted file as a synthetic unified patch.
 *
 * The working-tree bytes are read through the same bounded no-index read the untracked section uses,
 * then every line is re-emitted as context in a patch with recomputed `@@ -1,N +1,N @@` headers.
 * Conflict markers therefore stay visible as ordinary text and the renderer receives real hunks.
 * `git diff --cc` and `git show --cc` are never invoked.
 *
 * @param client - Git client bound to the configured executable.
 * @param options - Path, working directory, and signal.
 * @returns The synthetic conflict patch or the classified failure. Never throws.
 */
export async function readConflictDiff(
  client: GitClient,
  options: DiffReadOptions,
): Promise<FileDiffReadResult> {
  const plan = buildUntrackedContentArgs(options.path, 0);

  if (!plan.ok) {
    return { ok: false, file: null, failure: createSyntheticFailure(plan.error) };
  }

  const content = await readDiffText(client, options, plan.args, NO_INDEX_EXIT_CODES);

  if (!content.ok) {
    return { ok: false, file: null, failure: content.failure };
  }

  const source = parseFileDiff(content.text, { path: options.path });

  if (!source.ok) {
    return { ok: false, file: null, failure: createSyntheticFailure(source.error.message) };
  }

  if (source.file?.binary === true) {
    return {
      ok: true,
      file: { ...source.file, status: "conflicted", conflict: true },
      failure: null,
    };
  }

  const contentLines = readAddedContentLines(source.file);
  const patch = buildConflictPatch(
    options.path,
    contentLines,
    source.file?.hasNoNewlineMarker === true,
  );
  const parsed = parseFileDiff(patch, { path: options.path, status: "conflicted" });

  if (!parsed.ok) {
    return { ok: false, file: null, failure: createSyntheticFailure(parsed.error.message) };
  }

  return { ok: true, file: parsed.file, failure: null };
}

/**
 * Probes whether one file is binary.
 *
 * @param client - Git client bound to the configured executable.
 * @param options - Path, section, working directory, and signal.
 * @returns The binary classification or the classified failure. Never throws.
 */
export async function probeBinary(
  client: GitClient,
  options: DiffProbeOptions,
): Promise<DiffBinaryProbeResult> {
  const plan = buildBinaryProbeArgs(options.section, options.path);

  if (!plan.ok) {
    return { ok: false, binary: false, failure: createSyntheticFailure(plan.error) };
  }

  const result = await client.invoke({
    args: plan.args,
    cwd: options.cwd,
    signal: options.signal,
    operationClass: "read",
    touchesIndex: options.section !== "untracked",
  });
  const accepted = options.section === "untracked" ? NO_INDEX_EXIT_CODES : [0];

  if (!isAcceptedResult(result, accepted)) {
    return { ok: false, binary: false, failure: classifyGitFailure(result) };
  }

  return { ok: true, binary: containsBinaryNumstat(result.stdout), failure: null };
}

/** Reads the byte size of one absolute working-tree path, or null when it is missing. */
type DiffFileSizeReader = (absolutePath: string) => Promise<number | null>;

/**
 * Probes the size of one file from the source the section actually renders.
 *
 * The staged section is measured from its stage-0 index blob through `buildSizeProbeArgs`: a
 * non-zero `git cat-file` exit without a spawn, cancel, or timeout failure means git has no blob for
 * the path, which happens for a staged deletion, so the probe reports an unknown size instead of
 * inventing an error. Working-tree and untracked files are measured with a bounded `stat` of the
 * working copy, because their index blob (when one exists at all) is not what the panel shows. A
 * missing working file, such as a deleted working-tree entry, is reported as an unknown size rather
 * than as oversized, so the caller keeps the bounded read.
 *
 * @param client - Git client bound to the configured executable.
 * @param options - Path, section, working directory, and signal.
 * @param readFileSize - Injected filesystem size reader, defaulting to `stat` through `node:fs`.
 * @returns The measured size, an unknown size, or the classified failure. Never throws.
 */
export async function probeSize(
  client: GitClient,
  options: DiffProbeOptions,
  readFileSize: DiffFileSizeReader = readWorkingTreeFileSize,
): Promise<DiffSizeProbeResult> {
  return options.section === "staged"
    ? await probeIndexBlobSize(client, options)
    : await probeWorkingTreeSize(options, readFileSize);
}

/**
 * Measures one staged file from its stage-0 index blob.
 *
 * @param client - Git client bound to the configured executable.
 * @param options - Path, section, working directory, and signal.
 * @returns The measured size, an unknown size, or the classified failure.
 */
async function probeIndexBlobSize(
  client: GitClient,
  options: DiffProbeOptions,
): Promise<DiffSizeProbeResult> {
  const plan = buildSizeProbeArgs(options.path);

  if (!plan.ok) {
    return { ok: false, sizeBytes: null, failure: createSyntheticFailure(plan.error) };
  }

  const result = await client.invoke({
    args: plan.args,
    cwd: options.cwd,
    signal: options.signal,
    operationClass: "read",
    touchesIndex: true,
  });

  if (result.cancelled || result.timedOut || result.spawnError !== null) {
    return { ok: false, sizeBytes: null, failure: classifyGitFailure(result) };
  }

  if (!result.ok) {
    const failure = classifyGitFailure(result);

    return isEnvironmentFailure(failure)
      ? { ok: false, sizeBytes: null, failure }
      : { ok: true, sizeBytes: null, failure: null };
  }

  const sizeBytes = Number.parseInt(result.stdout.trim(), 10);

  return Number.isFinite(sizeBytes) && sizeBytes >= 0
    ? { ok: true, sizeBytes, failure: null }
    : {
        ok: false,
        sizeBytes: null,
        failure: createSyntheticFailure("could not read the file size from git cat-file"),
      };
}

/**
 * Measures one working-tree or untracked file through the size reader.
 *
 * @param options - Path, section, working directory, and signal.
 * @param readFileSize - Filesystem size reader.
 * @returns The measured size, an unknown size, or the classified failure.
 */
async function probeWorkingTreeSize(
  options: DiffProbeOptions,
  readFileSize: DiffFileSizeReader,
): Promise<DiffSizeProbeResult> {
  const error = validatePath(options.path);

  if (error !== null) {
    return { ok: false, sizeBytes: null, failure: createSyntheticFailure(error) };
  }

  const absolutePath = resolveInsideRoot(options.cwd, options.path);

  if (absolutePath === null) {
    return {
      ok: false,
      sizeBytes: null,
      failure: createSyntheticFailure("working-tree path escapes the repository root"),
    };
  }

  try {
    return { ok: true, sizeBytes: await readFileSize(absolutePath), failure: null };
  } catch {
    return {
      ok: false,
      sizeBytes: null,
      failure: createSyntheticFailure("could not read the working-tree file size"),
    };
  }
}

/**
 * Resolves a repository-relative path inside its root.
 *
 * @param root - Repository root used as the working directory.
 * @param relativePath - Repository-relative path from the status snapshot.
 * @returns The absolute path, or null when it is absolute or escapes the root.
 */
function resolveInsideRoot(root: string, relativePath: string): string | null {
  if (path.isAbsolute(relativePath)) {
    return null;
  }

  const target = path.resolve(root, relativePath);
  const relative = path.relative(root, target);

  return relative.length === 0 || relative.startsWith("..") || path.isAbsolute(relative)
    ? null
    : target;
}

/**
 * Reads the byte size of one working-tree file.
 *
 * Only a regular file has a preview size; a directory or a special file reports an unknown size. A
 * path that no longer exists is unknown rather than an error, because a deleted working-tree entry
 * is an ordinary diff state.
 *
 * @param absolutePath - Absolute working-tree path inside the repository root.
 * @returns The size in bytes, or null when the file is missing or not a regular file.
 */
async function readWorkingTreeFileSize(absolutePath: string): Promise<number | null> {
  try {
    const info = await stat(absolutePath);

    return info.isFile() ? info.size : null;
  } catch (error) {
    const code = readErrorCode(error);

    if (code === "ENOENT" || code === "ENOTDIR") {
      return null;
    }

    throw error;
  }
}

/**
 * Reads an error code defensively from an unknown thrown value.
 *
 * @param error - Thrown value.
 * @returns The string `code` field, or null when there is none.
 */
function readErrorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return null;
  }

  const code = (error as { readonly code?: unknown }).code;

  return typeof code === "string" ? code : null;
}

/**
 * Stages one file.
 *
 * @param client - Git client bound to the configured executable.
 * @param options - Targets, working directory, and signal.
 * @returns The action result. Never throws.
 */
export async function stageFile(
  client: GitClient,
  options: DiffFileActionOptions,
): Promise<DiffFileActionResult> {
  return await stagePaths(client, options);
}

/**
 * Unstages one file.
 *
 * @param client - Git client bound to the configured executable.
 * @param options - Targets, working directory, and signal.
 * @returns The action result. Never throws.
 */
export async function unstageFile(
  client: GitClient,
  options: DiffFileActionOptions,
): Promise<DiffFileActionResult> {
  return await unstagePaths(client, options);
}

/**
 * Discards the working-tree change of one tracked file, applying the rename rule.
 *
 * @param client - Git client bound to the configured executable.
 * @param options - Targets, working directory, and signal.
 * @returns The action result, including a partial rename discard. Never throws.
 */
export async function discardFile(
  client: GitClient,
  options: DiffFileActionOptions,
): Promise<DiffFileActionResult> {
  return await discardPaths(client, options);
}

/**
 * Deletes one untracked file.
 *
 * @param client - Git client bound to the configured executable.
 * @param options - Targets, working directory, and signal.
 * @returns The action result. Never throws.
 */
export async function deleteUntrackedFile(
  client: GitClient,
  options: DiffFileActionOptions,
): Promise<DiffFileActionResult> {
  return await deleteUntracked(client, options, false);
}

/**
 * Deletes every untracked file in one section path set.
 *
 * @param client - Git client bound to the configured executable.
 * @param options - Targets, working directory, and signal.
 * @returns The action result. Never throws.
 */
export async function deleteAllUntracked(
  client: GitClient,
  options: DiffFileActionOptions,
): Promise<DiffFileActionResult> {
  return await deleteUntracked(client, options, true);
}

/**
 * Stages one section's path set in a single `git add` invocation.
 *
 * @param client - Git client bound to the configured executable.
 * @param options - Targets, working directory, and signal.
 * @returns The action result. Never throws.
 */
export async function stagePaths(
  client: GitClient,
  options: DiffFileActionOptions,
): Promise<DiffFileActionResult> {
  return await runWritePlan(
    client,
    options,
    buildStageArgs(options.targets),
    options.targets.length === 0 ? "no-paths" : "invalid-path",
  );
}

/**
 * Unstages one section's path set in a single `git restore --staged` invocation.
 *
 * @param client - Git client bound to the configured executable.
 * @param options - Targets, working directory, and signal.
 * @returns The action result. Never throws.
 */
export async function unstagePaths(
  client: GitClient,
  options: DiffFileActionOptions,
): Promise<DiffFileActionResult> {
  return await runWritePlan(
    client,
    options,
    buildUnstageArgs(options.targets),
    options.targets.length === 0 ? "no-paths" : "invalid-path",
  );
}

/**
 * Discards one section's tracked working-tree changes, including rename pairs.
 *
 * Every plain path and every rename's old path is restored in one `git restore` invocation. When the
 * set contains a rename, a status read then confirms whether each new path is untracked; only those
 * confirmed untracked are removed with one scoped `git clean -f`. A new path that is tracked or
 * whose status could not be read is left in place and reported through `partial` and `warnings`.
 *
 * @param client - Git client bound to the configured executable.
 * @param options - Targets, working directory, and signal.
 * @returns The action result. Never throws.
 */
export async function discardPaths(
  client: GitClient,
  options: DiffFileActionOptions,
): Promise<DiffFileActionResult> {
  const targets = options.targets;

  if (targets.length === 0) {
    return blockedResult("no-paths");
  }

  const restorePaths: string[] = [];
  const renames: DiffPathPair[] = [];

  for (const target of targets) {
    if (validatePath(target.path) !== null) {
      return blockedResult("invalid-path");
    }

    if (isRename(target) && target.oldPath !== null) {
      if (validatePath(target.oldPath) !== null) {
        return blockedResult("invalid-path");
      }

      renames.push(target);
      restorePaths.push(target.oldPath);
      continue;
    }

    restorePaths.push(target.path);
  }

  const plan = buildDiscardArgs(restorePaths);

  if (!plan.ok) {
    return blockedResult("invalid-path");
  }

  const restoreStep = await invokeWrite(client, options, plan.args);

  if (!restoreStep.ok) {
    return failedResult(restoreStep);
  }

  if (renames.length === 0) {
    return successResult([restoreStep], false, []);
  }

  return await removeDiscardedRenames(client, options, restoreStep, renames);
}

/**
 * Restores the old path of every rename and removes the new path only when it is untracked.
 *
 * @param client - Git client bound to the configured executable.
 * @param options - Targets, working directory, and signal.
 * @param restoreStep - The completed restore invocation.
 * @param renames - Rename targets whose old path was restored.
 * @returns The final action result.
 */
async function removeDiscardedRenames(
  client: GitClient,
  options: DiffFileActionOptions,
  restoreStep: GitInvocationResult,
  renames: readonly DiffPathPair[],
): Promise<DiffFileActionResult> {
  const status = await readStatus(client, options);
  const snapshot = status.snapshot;

  if (!status.ok || snapshot === null) {
    return successResult([restoreStep], true, [
      `could not confirm the new path is untracked; left ${formatPaths(renames)} in place`,
    ]);
  }

  const untracked = renames.filter((target) => isUntrackedPath(snapshot, target.path));
  const kept = renames.filter((target) => !isUntrackedPath(snapshot, target.path));

  if (untracked.length === 0) {
    return successResult(
      [restoreStep],
      true,
      kept.map((target) => `left ${target.path} in place: path is not untracked`),
    );
  }

  const cleanPlan = buildDeleteUntrackedArgs(
    untracked.map((target) => target.path),
    false,
  );

  if (!cleanPlan.ok) {
    return successResult([restoreStep], true, [
      `could not remove the untracked new path: ${cleanPlan.error}`,
    ]);
  }

  const cleanStep = await invokeWrite(client, options, cleanPlan.args);

  if (!cleanStep.ok) {
    return {
      ok: false,
      failure: classifyGitFailure(cleanStep),
      steps: [restoreStep, cleanStep],
      partial: true,
      warnings: kept.map((target) => `left ${target.path} in place: path is not untracked`),
      reason: null,
    };
  }

  return successResult(
    [restoreStep, cleanStep],
    kept.length > 0,
    kept.map((target) => `left ${target.path} in place: path is not untracked`),
  );
}

/**
 * Deletes untracked paths through one scoped `git clean`.
 *
 * @param client - Git client bound to the configured executable.
 * @param options - Targets, working directory, and signal.
 * @param recursive - True for the bulk delete, which also removes untracked directories.
 * @returns The action result. Never throws.
 */
async function deleteUntracked(
  client: GitClient,
  options: DiffFileActionOptions,
  recursive: boolean,
): Promise<DiffFileActionResult> {
  const paths = options.targets.map((target) => target.path);

  return await runWritePlan(
    client,
    options,
    buildDeleteUntrackedArgs(paths, recursive),
    paths.length === 0 ? "no-paths" : "invalid-path",
  );
}

/**
 * Runs one write plan and converts its settled invocation into an action result.
 *
 * @param client - Git client bound to the configured executable.
 * @param options - Targets, working directory, and signal.
 * @param plan - Planned argument array.
 * @param rejectionReason - Reason reported when the plan itself is invalid.
 * @returns The action result.
 */
async function runWritePlan(
  client: GitClient,
  options: DiffFileActionOptions,
  plan: GitArgPlan,
  rejectionReason: DiffFileActionReason,
): Promise<DiffFileActionResult> {
  if (!plan.ok) {
    return blockedResult(rejectionReason);
  }

  const step = await invokeWrite(client, options, plan.args);

  return step.ok ? successResult([step], false, []) : failedResult(step);
}

/**
 * Runs one write invocation through the injected client.
 *
 * @param client - Git client bound to the configured executable.
 * @param options - Working directory and signal.
 * @param args - Planned arguments.
 * @returns The settled invocation result.
 */
async function invokeWrite(
  client: GitClient,
  options: GitReadOptions,
  args: readonly string[],
): Promise<GitInvocationResult> {
  return await client.invoke({
    args,
    cwd: options.cwd,
    signal: options.signal,
    operationClass: "write",
  });
}

/**
 * Builds a successful action result.
 *
 * @param steps - Completed invocations.
 * @param partial - True when part of the request was deliberately left in place.
 * @param warnings - Notes for the partial result.
 * @returns The action result.
 */
function successResult(
  steps: readonly GitInvocationResult[],
  partial: boolean,
  warnings: readonly string[],
): DiffFileActionResult {
  return { ok: true, failure: null, steps, partial, warnings, reason: null };
}

/**
 * Builds a failed action result from a settled invocation.
 *
 * @param step - Failed invocation.
 * @returns The action result.
 */
function failedResult(step: GitInvocationResult): DiffFileActionResult {
  return {
    ok: false,
    failure: classifyGitFailure(step),
    steps: [step],
    partial: false,
    warnings: [],
    reason: null,
  };
}

/**
 * Builds a rejected action result.
 *
 * @param reason - Machine-readable rejection reason.
 * @returns The action result with no steps.
 */
function blockedResult(reason: DiffFileActionReason): DiffFileActionResult {
  return { ok: false, failure: null, steps: [], partial: false, warnings: [], reason };
}

/**
 * Formats rename paths for one warning line.
 *
 * @param renames - Rename targets.
 * @returns Comma-separated current paths.
 */
function formatPaths(renames: readonly DiffPathPair[]): string {
  return renames.map((target) => target.path).join(", ");
}

/**
 * Reports whether a status snapshot lists a path as untracked.
 *
 * @param snapshot - Canonical status snapshot.
 * @param path - Repository-relative path.
 * @returns True when the path is an untracked entry.
 */
function isUntrackedPath(snapshot: StatusSnapshot, path: string): boolean {
  return snapshot.entries.some(
    (entry) =>
      entry.path === path && (entry.kind === "untracked" || entry.worktree === "untracked"),
  );
}

/**
 * Reads and parses one file's patch.
 *
 * Exported for the read-only commit and stash reader, which uses it to keep each file's patch
 * inside its own invocation when a whole multi-file patch exceeds the client output limit.
 *
 * @param client - Git client bound to the configured executable.
 * @param options - Path, old path, working directory, and signal.
 * @param plan - Planned diff arguments.
 * @param acceptedExitCodes - Exit codes that still carry a usable patch.
 * @returns The parsed file or the classified failure.
 */
export async function readSingleFile(
  client: GitClient,
  options: DiffReadOptions,
  plan: GitArgPlan,
  acceptedExitCodes: readonly number[] = [0],
): Promise<FileDiffReadResult> {
  if (!plan.ok) {
    return { ok: false, file: null, failure: createSyntheticFailure(plan.error) };
  }

  const text = await readDiffText(client, options, plan.args, acceptedExitCodes);

  if (!text.ok) {
    return { ok: false, file: null, failure: text.failure };
  }

  const parsed = parseFileDiff(text.text, {
    path: options.path,
    oldPath: options.oldPath ?? null,
  });

  if (!parsed.ok) {
    return { ok: false, file: null, failure: createSyntheticFailure(parsed.error.message) };
  }

  return { ok: true, file: parsed.file, failure: null };
}

/**
 * Runs one diff read and returns its text or the classified failure.
 *
 * @param client - Git client bound to the configured executable.
 * @param options - Working directory and signal.
 * @param args - Planned diff arguments.
 * @param acceptedExitCodes - Exit codes that still carry a usable patch.
 * @returns The captured patch text or the classified failure.
 */
async function readDiffText(
  client: GitClient,
  options: GitReadOptions,
  args: readonly string[],
  acceptedExitCodes: readonly number[],
): Promise<DiffTextReadResult> {
  const result = await client.invoke({
    args,
    cwd: options.cwd,
    signal: options.signal,
    operationClass: "read",
  });

  if (!isAcceptedResult(result, acceptedExitCodes)) {
    return { ok: false, text: "", failure: classifyGitFailure(result) };
  }

  if (isTruncatedOutput(result)) {
    return {
      ok: false,
      text: "",
      failure: createTruncatedOutputFailure(result, "diff output was truncated"),
    };
  }

  return { ok: true, text: result.stdout, failure: null };
}

/**
 * Reports whether an invocation result carries a usable patch.
 *
 * A documented non-zero exit such as `git diff --no-index`'s difference status is accepted only when
 * the child was not cancelled, did not time out, and did not fail to spawn.
 *
 * @param result - Settled invocation.
 * @param acceptedExitCodes - Exit codes that still carry output.
 * @returns True when the output is usable.
 */
function isAcceptedResult(
  result: GitInvocationResult,
  acceptedExitCodes: readonly number[],
): boolean {
  if (result.cancelled || result.timedOut || result.spawnError !== null) {
    return false;
  }

  if (result.ok) {
    return true;
  }

  return result.exitCode !== null && acceptedExitCodes.includes(result.exitCode);
}

/**
 * Reports whether `--numstat` output marks the file binary.
 *
 * @param stdout - Captured numstat output.
 * @returns True when a line starts with `-` `-`.
 */
function containsBinaryNumstat(stdout: string): boolean {
  return stdout.split("\n").some((line) => {
    const fields = line.split("\t");

    return fields[0] === "-" && fields[1] === "-";
  });
}

/**
 * Builds a path pair from read options.
 *
 * @param options - Read options.
 * @returns The target path pair.
 */
function toTarget(options: DiffReadOptions): DiffPathPair {
  return { path: options.path, oldPath: options.oldPath ?? null };
}

/**
 * Extracts the raw content lines from an all-added patch.
 *
 * @param file - Parsed no-index patch, or null for an empty read.
 * @returns Content lines without their `+` prefix.
 */
function readAddedContentLines(file: FileDiffReadResult["file"]): readonly string[] {
  if (file === null) {
    return [];
  }

  return file.hunks.flatMap((hunk) =>
    hunk.lines.filter((line) => line.kind === "add").map((line) => line.text.slice(1)),
  );
}

/**
 * Builds the synthetic unified patch for one conflicted file.
 *
 * @param path - Repository-relative path.
 * @param lines - Working-tree content lines.
 * @param noNewline - True when the file has no trailing newline.
 * @returns A unified patch whose lines are all context.
 */
function buildConflictPatch(path: string, lines: readonly string[], noNewline: boolean): string {
  const header = [`diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`];

  if (lines.length === 0) {
    return `${header.join("\n")}\n`;
  }

  const body = lines.map((line) => ` ${line}`);

  if (noNewline) {
    body.push("\\ No newline at end of file");
  }

  const hunkHeader = `@@ -1,${lines.length} +1,${lines.length} @@`;

  return `${[...header, hunkHeader, ...body].join("\n")}\n`;
}

/**
 * Reports whether a failure describes the environment rather than a missing object.
 *
 * The size probe treats "no blob for this path" as an unknown size, but a missing executable, an
 * unreadable repository, or a permissions problem must still reach the caller as a failure.
 *
 * @param failure - Classified git failure.
 * @returns True when the failure is environmental.
 */
function isEnvironmentFailure(failure: GitFailure): boolean {
  return (
    failure.kind === "missing-git" ||
    failure.kind === "not-a-repository" ||
    failure.kind === "permission" ||
    failure.kind === "auth-network"
  );
}

/**
 * Builds a classified failure for a path or parse problem git did not report.
 *
 * @param message - Decisive one-line message.
 * @returns The classified failure.
 */
function createSyntheticFailure(message: string): GitFailure {
  return {
    kind: "unknown",
    exitCode: null,
    message,
    stderr: "",
    cancelled: false,
    timedOut: false,
  };
}
