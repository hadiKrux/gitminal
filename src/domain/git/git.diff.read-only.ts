import type {
  CommitDiffReadOptions,
  DiffChangedFile,
  DiffFileStatus,
  DiffFilesReadResult,
  FileDiff,
} from "@/domain/diff/diff.types";
import {
  buildCommitDiffArgs,
  buildCommitFileDiffArgs,
  buildCommitFileListArgs,
  readSingleFile,
} from "./git.diff";
import type {
  ChangedFileListRead,
  StashDiffReadOptions,
  WholePatchRead,
} from "./git.diff.read-only.types";
import { classifyGitFailure } from "./git.errors";
import { createTruncatedOutputFailure, isTruncatedOutput } from "./git.remotes";
import { buildStashDiffArgs, buildStashFileDiffArgs, buildStashFileListArgs } from "./git.stashes";
import type {
  GitArgPlan,
  GitClient,
  GitFailure,
  GitInvocationResult,
  GitReadOptions,
} from "./git.types";
import { parseDiff } from "./parsers/parse.diff";

/** Separator git uses between `--name-status -z` records and their paths. */
const NAME_STATUS_SEPARATOR = "\0";

/** Message used when a commit patch read lost its middle. */
const COMMIT_DIFF_TRUNCATED_MESSAGE = "diff output was truncated";

/** Message used when a stash patch read lost its middle. */
const STASH_DIFF_TRUNCATED_MESSAGE = "git stash show output was truncated";

/** Message used when a commit file-list read lost its middle. */
const COMMIT_FILE_LIST_TRUNCATED_MESSAGE = "commit file list output was truncated";

/** Message used when a stash file-list read lost its middle. */
const STASH_FILE_LIST_TRUNCATED_MESSAGE = "stash file list output was truncated";

/**
 * Reads the diff of one commit as a multi-file patch.
 *
 * The whole patch is one invocation, which keeps an ordinary commit to a single git process. When
 * that output exceeds the client capture limit, as a commit touching many files can, the read falls
 * back to one bounded invocation per changed file instead of failing the whole diff.
 *
 * @param client - Git client bound to the configured executable.
 * @param options - Commit id, context lines, working directory, and signal.
 * @returns Every parsed file or the classified failure. Never throws.
 */
export async function readCommitDiff(
  client: GitClient,
  options: CommitDiffReadOptions,
): Promise<DiffFilesReadResult> {
  const plan = buildCommitDiffArgs(options.sha, options.contextLines);

  if (!plan.ok) {
    return { ok: false, files: [], failure: createSyntheticFailure(plan.error) };
  }

  const whole = await readWholePatch(client, options, plan.args, COMMIT_DIFF_TRUNCATED_MESSAGE);

  if (whole.truncated) {
    return await readCommitDiffPerFile(client, options);
  }

  return parseWholePatch(whole);
}

/**
 * Reads the diff of one stash as a multi-file patch.
 *
 * The whole patch is one `git stash show` invocation. When its output exceeds the client capture
 * limit, the read falls back to a changed-file list plus one bounded invocation per file.
 *
 * @param client - Git client bound to the configured executable.
 * @param options - Stash selector, context lines, working directory, and signal.
 * @returns Every parsed file or the classified failure. Never throws.
 */
export async function readStashDiff(
  client: GitClient,
  options: StashDiffReadOptions,
): Promise<DiffFilesReadResult> {
  const plan = buildStashDiffArgs(options.stashRef, options.contextLines);

  if (!plan.ok) {
    return { ok: false, files: [], failure: createSyntheticFailure(plan.error) };
  }

  const whole = await readWholePatch(client, options, plan.args, STASH_DIFF_TRUNCATED_MESSAGE);

  if (whole.truncated) {
    return await readStashDiffPerFile(client, options);
  }

  return parseWholePatch(whole);
}

/**
 * Parses one complete multi-file patch.
 *
 * @param whole - Settled whole-patch read.
 * @returns The parsed files or the classified failure.
 */
function parseWholePatch(whole: WholePatchRead): DiffFilesReadResult {
  if (!whole.ok) {
    return { ok: false, files: [], failure: whole.failure };
  }

  const parsed = parseDiff(whole.text);

  if (!parsed.ok) {
    return {
      ok: false,
      files: parsed.files,
      failure: createSyntheticFailure(parsed.error.message),
    };
  }

  return { ok: true, files: parsed.files, failure: null };
}

/**
 * Runs one whole-patch read and distinguishes truncation from a real failure.
 *
 * @param client - Git client bound to the configured executable.
 * @param options - Working directory and signal.
 * @param args - Planned diff arguments.
 * @param truncatedMessage - Message used when the output lost its middle.
 * @returns The captured text, the truncation flag, or the classified failure.
 */
async function readWholePatch(
  client: GitClient,
  options: GitReadOptions,
  args: readonly string[],
  truncatedMessage: string,
): Promise<WholePatchRead> {
  const result = await client.invoke({
    args,
    cwd: options.cwd,
    signal: options.signal,
    operationClass: "read",
  });

  if (!result.ok) {
    return { ok: false, text: "", truncated: false, failure: classifyGitFailure(result) };
  }

  if (isTruncatedOutput(result)) {
    return {
      ok: false,
      text: "",
      truncated: true,
      failure: createTruncatedOutputFailure(result, truncatedMessage),
    };
  }

  return { ok: true, text: result.stdout, truncated: false, failure: null };
}

/**
 * Reads a truncated commit diff one file per invocation.
 *
 * The changed-file list is small compared with the patch, so it is read first. Each later
 * invocation carries one path, including both rename paths, and therefore stays under the client
 * output limit for an ordinary file even when the whole commit patch does not.
 *
 * @param client - Git client bound to the configured executable.
 * @param options - Commit id, context lines, working directory, and signal.
 * @returns The parsed files in git order or the classified failure.
 */
async function readCommitDiffPerFile(
  client: GitClient,
  options: CommitDiffReadOptions,
): Promise<DiffFilesReadResult> {
  const plan = buildCommitFileListArgs(options.sha);

  if (!plan.ok) {
    return { ok: false, files: [], failure: createSyntheticFailure(plan.error) };
  }

  const list = await readChangedFiles(
    client,
    options,
    plan.args,
    COMMIT_FILE_LIST_TRUNCATED_MESSAGE,
  );

  if (!list.ok) {
    return { ok: false, files: [], failure: list.failure };
  }

  return await readFilesIndividually(client, options, list.files, (file) =>
    buildCommitFileDiffArgs(options.sha, file, options.contextLines),
  );
}

/**
 * Reads a truncated stash diff one file per invocation.
 *
 * @param client - Git client bound to the configured executable.
 * @param options - Stash selector, context lines, working directory, and signal.
 * @returns The parsed files in git order or the classified failure.
 */
async function readStashDiffPerFile(
  client: GitClient,
  options: StashDiffReadOptions,
): Promise<DiffFilesReadResult> {
  const plan = buildStashFileListArgs(options.stashRef);

  if (!plan.ok) {
    return { ok: false, files: [], failure: createSyntheticFailure(plan.error) };
  }

  const list = await readChangedFiles(
    client,
    options,
    plan.args,
    STASH_FILE_LIST_TRUNCATED_MESSAGE,
  );

  if (!list.ok) {
    return { ok: false, files: [], failure: list.failure };
  }

  return await readFilesIndividually(client, options, list.files, (file) =>
    buildStashFileDiffArgs(options.stashRef, file, options.contextLines),
  );
}

/**
 * Reads and parses one patch per changed file.
 *
 * One failure fails the whole diff, because a partial file list would silently hide changes the
 * user selected to inspect. The reads stay sequential so a commit touching hundreds of files does
 * not spawn hundreds of processes at once.
 *
 * @param client - Git client bound to the configured executable.
 * @param options - Working directory, signal, and configured context lines.
 * @param entries - Changed files in git order.
 * @param buildPlan - Builds the single-file patch plan for one entry.
 * @returns The parsed files in git order or the classified failure.
 */
async function readFilesIndividually(
  client: GitClient,
  options: {
    readonly cwd: string;
    readonly signal: AbortSignal;
    readonly contextLines: number;
  },
  entries: readonly DiffChangedFile[],
  buildPlan: (file: DiffChangedFile) => GitArgPlan,
): Promise<DiffFilesReadResult> {
  const files: FileDiff[] = [];

  for (const entry of entries) {
    const plan = buildPlan(entry);

    if (!plan.ok) {
      return { ok: false, files: [], failure: createSyntheticFailure(plan.error) };
    }

    const read = await readSingleFile(
      client,
      {
        cwd: options.cwd,
        signal: options.signal,
        contextLines: options.contextLines,
        path: entry.path,
        oldPath: entry.oldPath,
      },
      plan,
    );

    if (!read.ok) {
      return { ok: false, files: [], failure: read.failure };
    }

    files.push(read.file ?? createListedFile(entry));
  }

  return { ok: true, files, failure: null };
}

/**
 * Reads a `--name-status -z` changed-file list.
 *
 * @param client - Git client bound to the configured executable.
 * @param options - Working directory and signal.
 * @param args - Planned list arguments.
 * @param truncatedMessage - Message used when the output lost its middle.
 * @returns The changed files or the classified failure.
 */
async function readChangedFiles(
  client: GitClient,
  options: GitReadOptions,
  args: readonly string[],
  truncatedMessage: string,
): Promise<ChangedFileListRead> {
  const result = await client.invoke({
    args,
    cwd: options.cwd,
    signal: options.signal,
    operationClass: "read",
  });

  if (!result.ok) {
    return { ok: false, files: [], failure: classifyGitFailure(result) };
  }

  if (isTruncatedOutput(result)) {
    return {
      ok: false,
      files: [],
      failure: createTruncatedOutputFailure(result, truncatedMessage),
    };
  }

  const files = parseNameStatus(result);

  return files === null
    ? { ok: false, files: [], failure: createSyntheticFailure("malformed name-status output") }
    : { ok: true, files, failure: null };
}

/**
 * Parses NUL-separated `--name-status -z` output.
 *
 * Each record is a status token followed by one path, or by the old and new paths for a rename or
 * copy. A trailing separator is normal and produces no record. A record with a missing path is
 * malformed, so the caller treats the whole list as untrustworthy rather than hiding a change.
 *
 * @param result - Settled list invocation.
 * @returns The changed files in git order, or null when a record is malformed.
 */
function parseNameStatus(result: GitInvocationResult): readonly DiffChangedFile[] | null {
  const tokens = result.stdout.split(NAME_STATUS_SEPARATOR);
  const files: DiffChangedFile[] = [];
  let index = 0;

  while (index < tokens.length) {
    const record = readNameStatusRecord(tokens, index);

    if (record === null) {
      return null;
    }

    if (record.file !== null) {
      files.push(record.file);
    }

    index = record.nextIndex;
  }

  return files;
}

/**
 * Reads one `--name-status` record, including a record that only skips a trailing separator.
 *
 * @param tokens - NUL-separated output fields.
 * @param start - Index of the status token.
 * @returns The record and the index after it, or null when a path is missing.
 */
function readNameStatusRecord(
  tokens: readonly string[],
  start: number,
): { readonly file: DiffChangedFile | null; readonly nextIndex: number } | null {
  const token = tokens[start];

  if (token === undefined || token.length === 0) {
    return { file: null, nextIndex: start + 1 };
  }

  const status = readNameStatus(token);

  return status === "renamed" || status === "copied"
    ? readPathPairRecord(tokens, start, status)
    : readSinglePathRecord(tokens, start, status);
}

/**
 * Reads a record that carries one path.
 *
 * @param tokens - NUL-separated output fields.
 * @param start - Index of the status token.
 * @param status - Parsed status for the record.
 * @returns The record and the index after it, or null when the path is missing.
 */
function readSinglePathRecord(
  tokens: readonly string[],
  start: number,
  status: DiffFileStatus,
): { readonly file: DiffChangedFile; readonly nextIndex: number } | null {
  const path = tokens[start + 1];

  return path === undefined || path.length === 0
    ? null
    : { file: { path, oldPath: null, status }, nextIndex: start + 2 };
}

/**
 * Reads a rename or copy record that carries the pre-change and current paths.
 *
 * @param tokens - NUL-separated output fields.
 * @param start - Index of the status token.
 * @param status - Parsed rename or copy status.
 * @returns The record and the index after it, or null when a path is missing.
 */
function readPathPairRecord(
  tokens: readonly string[],
  start: number,
  status: DiffFileStatus,
): { readonly file: DiffChangedFile; readonly nextIndex: number } | null {
  const oldPath = tokens[start + 1];
  const path = tokens[start + 2];

  return oldPath === undefined || path === undefined || oldPath.length === 0 || path.length === 0
    ? null
    : { file: { path, oldPath, status }, nextIndex: start + 3 };
}

/**
 * Maps one `--name-status` token to the parsed diff status.
 *
 * The token can carry a similarity score after the letter, such as `R100`, so only the first
 * character decides the category.
 *
 * @param token - Status token from git.
 * @returns The changed-file status, falling back to `modified` for an unknown letter.
 */
function readNameStatus(token: string): DiffFileStatus {
  switch (token[0]) {
    case "A":
      return "added";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    case "C":
      return "copied";
    case "U":
      return "conflicted";
    default:
      return "modified";
  }
}

/**
 * Builds the minimal parsed file for a listed change whose patch read produced no file.
 *
 * @param entry - Changed file from the list read.
 * @returns A file with the original path and status and no hunks.
 */
function createListedFile(entry: DiffChangedFile): FileDiff {
  const header = `diff --git a/${entry.path} b/${entry.path}`;

  return {
    path: entry.path,
    oldPath: entry.oldPath,
    status: entry.status,
    headerLines: [header],
    hunks: [],
    binary: false,
    modeOnly: false,
    conflict: false,
    hasNoNewlineMarker: false,
    raw: `${header}\n`,
  };
}

/**
 * Builds a classified failure for a planning or parse problem git did not report.
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
