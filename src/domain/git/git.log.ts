import type {
  GraphLogPageOptions,
  GraphLogParseError,
  GraphLogReadResult,
  GraphScope,
  GraphSearchPageOptions,
} from "@/domain/graph/graph.types";
import { classifyGitFailure } from "./git.errors";
import { createTruncatedOutputFailure, isTruncatedOutput } from "./git.remotes";
import type {
  CommitDetailsReadOptions,
  CommitDetailsReadResult,
  CommitDetailsRecord,
  CommitStatsReadOptions,
  CommitStatsReadResult,
  CommitStatsRecord,
  CommitTextReadResult,
  GitClient,
  GitFailure,
  GitReadOptions,
} from "./git.types";
import { parseLogRecords, splitDecorationEntries } from "./parsers/parse.log";

/**
 * Version of the log record format.
 *
 * The version is the first field of every record, so a future field change is rejected by
 * `parse.log.ts` instead of being misread by the current parser.
 */
export const GRAPH_LOG_FORMAT_VERSION = 1;

/** Field separator of the log record format. A message and a path can never contain it. */
export const GRAPH_LOG_FIELD_SEPARATOR = "\x00";

/** Record separator that starts and ends every log record. */
export const GRAPH_LOG_RECORD_SEPARATOR = "\x1e";

/**
 * Format string passed to `git log --format`.
 *
 * Git cannot receive a raw NUL in argv, so separators are written with git's `%x` escapes. The
 * parser reads back the same bytes.
 */
const GRAPH_LOG_FORMAT = `%x1e${GRAPH_LOG_FORMAT_VERSION}%x00%H%x00%P%x00%an%x00%ae%x00%aI%x00%ct%x00%D%x00%s%x00%b%x1e`;

/** Message shown when a log page read was truncated before it could be trusted. */
const LOG_TRUNCATED_MESSAGE = "git log output was truncated";

/**
 * Smallest log page the loader retries with before a truncated capture is reported as a failure.
 *
 * A page is bounded by commit count, but its capture size depends on how many files each commit
 * touched. An oversized capture is split by halving the page rather than failing the whole graph,
 * and the floor stops the split once a single record can no longer fit.
 */
const LOG_MIN_PAGE_LIMIT = 1;

/** Message shown when a search page read was truncated before it could be trusted. */
const SEARCH_TRUNCATED_MESSAGE = "git log search output was truncated";

/** Message shown when the HEAD message read was truncated. */
const MESSAGE_TRUNCATED_MESSAGE = "git log HEAD message output was truncated";

/** Message shown when the HEAD short-hash read was truncated. */
const SHORT_HASH_TRUNCATED_MESSAGE = "git log HEAD short hash output was truncated";

/** Scope arguments keyed by the configured graph scope. */
const GRAPH_SCOPE_ARGS: Readonly<Record<GraphScope, readonly string[]>> = Object.freeze({
  all: Object.freeze(["--branches", "--remotes", "HEAD"]),
  local: Object.freeze(["--branches", "HEAD"]),
  current: Object.freeze(["HEAD"]),
});

/**
 * Resolves the ref scope of one graph read.
 *
 * `all` covers local and remote branches, `local` covers local branches, and `current` covers HEAD.
 * `HEAD` is explicit in `all` and `local` so a commit made while detached stays visible in the
 * graph; git de-duplicates commits reachable from more than one ref.
 *
 * @param scope - Configured graph scope.
 * @returns The scope arguments as positive revisions.
 */
export function resolveGraphScopeArgs(scope: GraphScope): readonly string[] {
  return GRAPH_SCOPE_ARGS[scope];
}

/**
 * Builds one bounded `git log` page invocation.
 *
 * The versioned format carries every display field, while `--raw` supplies the real file list and
 * `--numstat` the line counts. `--diff-merges=first-parent` makes merge stats a real diff against
 * the first parent and `--root` gives the root commit a file list. The first page walks the scope;
 * a continuation request passes only the frontier as positive revisions. Repeating the scope on a
 * continuation would restart the walk at the newest ref and return page 1 again, so the two are
 * mutually exclusive. `--skip` is never produced.
 *
 * @param input - Scope arguments, page size, and cursor frontier.
 * @returns The git argument array without the executable.
 */
export function buildLogPageArgs(input: {
  readonly scopeArgs: readonly string[];
  readonly limit: number;
  readonly frontier?: readonly string[];
}): readonly string[] {
  const frontier = input.frontier ?? [];

  return Object.freeze([
    "log",
    "--topo-order",
    "--parents",
    "--decorate=full",
    "--raw",
    "--numstat",
    "-z",
    "--diff-merges=first-parent",
    "--root",
    `--max-count=${normalizeLimit(input.limit)}`,
    `--format=${GRAPH_LOG_FORMAT}`,
    ...(frontier.length > 0 ? frontier : input.scopeArgs),
  ]);
}

/**
 * Builds one bounded fixed-string search page invocation.
 *
 * Each term becomes its own `--grep`, and `--all-match` requires every term to match some part of
 * the full commit message, so matching is an AND over literal case-insensitive terms. The format,
 * raw, and numstat options are identical to a log page, which lets the search row show the subject,
 * body, refs, file count, author, and date without another read.
 *
 * Search results are append-only and are never trimmed, so the fixed scope plus query is stable
 * across pages. Continuation is therefore a documented search-only stable offset: the scope is
 * always passed and `--skip=<offset>` is added only when the offset is greater than zero. A
 * frontier is never combined with the scope, because that would restart the walk at page 1.
 *
 * @param input - Scope arguments, terms, page size, and stable result offset.
 * @returns The git argument array without the executable.
 */
export function buildSearchPageArgs(input: {
  readonly scopeArgs: readonly string[];
  readonly terms: readonly string[];
  readonly limit: number;
  readonly offset?: number;
}): readonly string[] {
  const offset = normalizeOffset(input.offset);

  return Object.freeze([
    "log",
    "--topo-order",
    "--decorate=full",
    "--raw",
    "--numstat",
    "-z",
    "--diff-merges=first-parent",
    "--root",
    "--fixed-strings",
    "-i",
    "--all-match",
    ...input.terms.flatMap((term) => ["--grep", term]),
    `--max-count=${normalizeLimit(input.limit)}`,
    ...(offset > 0 ? [`--skip=${offset}`] : []),
    `--format=${GRAPH_LOG_FORMAT}`,
    ...input.scopeArgs,
  ]);
}

/**
 * Reads one bounded page of history.
 *
 * The invocation is serialized against writes by the git client because `log --raw` observes the
 * index. The first page walks the configured scope; a continuation passes only the frontier as
 * positive revisions. A capture larger than the client output limit is retried with a halved page
 * size, so a repository whose commits touch many files still loads the newest history instead of
 * failing the graph; a single record that cannot fit still returns a classified failure. A git
 * failure, a malformed record, or a repeated OID returns a classified failure instead of throwing,
 * so the page error row can show the message with Retry while already loaded rows remain usable.
 *
 * @param client - Git client bound to the configured executable.
 * @param options - Scope, page size, cursor frontier, working directory, and signal.
 * @returns The parsed rows and end-of-history flag, or the classified failure.
 */
export async function readLogPage(
  client: GitClient,
  options: GraphLogPageOptions,
): Promise<GraphLogReadResult> {
  const scopeArgs = resolveGraphScopeArgs(options.scope);

  return readLogArguments(
    client,
    options,
    (limit) => buildLogPageArgs({ scopeArgs, limit, frontier: options.frontier }),
    options.limit,
    LOG_TRUNCATED_MESSAGE,
  );
}

/**
 * Reads one bounded page of commit-message matches.
 *
 * The search covers the subject and body of the full graph scope. An empty term list performs no
 * invocation and reports an exhausted page, because `--all-match` without a `--grep` would match
 * every commit. Continuation is the stable result offset described by `buildSearchPageArgs`. An
 * oversized capture is split exactly like a log page, keeping the same offset for every attempt.
 * Failures are classified exactly like a log page read.
 *
 * @param client - Git client bound to the configured executable.
 * @param options - Scope, terms, page size, result offset, working directory, and signal.
 * @returns The matching rows and end-of-results flag, or the classified failure.
 */
export async function readSearchPage(
  client: GitClient,
  options: GraphSearchPageOptions,
): Promise<GraphLogReadResult> {
  if (options.terms.length === 0) {
    return { ok: true, rows: [], done: true, failure: null };
  }

  const scopeArgs = resolveGraphScopeArgs(options.scope);

  return readLogArguments(
    client,
    options,
    (limit) =>
      buildSearchPageArgs({
        scopeArgs,
        terms: options.terms,
        limit,
        offset: options.offset,
      }),
    options.limit,
    SEARCH_TRUNCATED_MESSAGE,
  );
}

/**
 * Builds the read of HEAD's full commit message.
 *
 * `%B` is the raw subject and body, so the amend flow can offer the previous message for editing.
 *
 * @returns The git argument array without the executable.
 */
function buildMessageArgs(): readonly string[] {
  return Object.freeze(["log", "-1", "--format=%B", "HEAD"]);
}

/**
 * Builds the read of HEAD's abbreviated commit id.
 *
 * @returns The git argument array without the executable.
 */
function buildShortHashArgs(): readonly string[] {
  return Object.freeze(["log", "-1", "--format=%h", "HEAD"]);
}

/**
 * Version of the single-record commit details format.
 *
 * The version is the first field after the record marker, so a future field change is rejected
 * instead of being misread by the current parser.
 */
export const COMMIT_DETAILS_FORMAT_VERSION = 1;

/** Field separator of the commit details record. A commit message can never contain NUL. */
export const COMMIT_DETAILS_FIELD_SEPARATOR = "\x00";

/** Record separator that starts the commit details record. */
export const COMMIT_DETAILS_RECORD_SEPARATOR = "\x1e";

/**
 * Maximum `--numstat` entries the stats read sums before it stops and marks the result truncated.
 *
 * The cap bounds a commit that touches an enormous number of files. The totals then describe only
 * the entries that were read, which is why the row shows the `stats truncated` note.
 */
export const COMMIT_STATS_FILE_CAP = 200;

/**
 * Format string of the single-record commit details read.
 *
 * Every field comes from one commit, so a detail row can never mix values from two invocations. The
 * record marker and separators use git's `%x` escapes because raw NUL cannot be passed in argv.
 */
const COMMIT_DETAILS_FORMAT = `%x1e${COMMIT_DETAILS_FORMAT_VERSION}%x00%H%x00%h%x00%T%x00%P%x00%an%x00%ae%x00%aI%x00%cn%x00%ce%x00%cI%x00%D%x00%B`;

/** Number of NUL-separated fields after the format version. */
const COMMIT_DETAILS_FIELD_COUNT = 12;

/** Message shown when the details read was truncated before it could be trusted. */
const COMMIT_DETAILS_TRUNCATED_MESSAGE = "commit details output was truncated";

/** Message shown when the stats read was truncated before it could be trusted. */
const COMMIT_STATS_TRUNCATED_MESSAGE = "commit stats output was truncated";

/** Longest numeric `--numstat` column accepted before the value is treated as malformed. */
const MAX_STAT_DIGITS = 12;

/** Column value git prints for one side of a binary file. */
const NUMSTAT_BINARY = "-";

/** Tab that separates the three `--numstat` columns. */
const NUMSTAT_SEPARATOR = "\t";

/**
 * Builds the single-commit details read.
 *
 * `--decorate=full` makes `%D` emit fully qualified ref names, and `--end-of-options` keeps the
 * commit id out of option position even when a caller passes an unexpected value.
 *
 * @param oid - Commit id to read.
 * @returns The git argument array without the executable.
 */
export function buildCommitDetailsArgs(oid: string): readonly string[] {
  return Object.freeze([
    "log",
    "-1",
    "--decorate=full",
    `--format=${COMMIT_DETAILS_FORMAT}`,
    "--end-of-options",
    oid,
  ]);
}

/**
 * Builds the single-commit numstat read.
 *
 * `--format=` suppresses the commit header so the output is only stats, and
 * `--diff-merges=first-parent` makes a merge compare with its first parent instead of printing no
 * file entries.
 *
 * @param oid - Commit id to read.
 * @returns The git argument array without the executable.
 */
export function buildCommitStatsArgs(oid: string): readonly string[] {
  return Object.freeze([
    "log",
    "-1",
    "--numstat",
    "--format=",
    "--diff-merges=first-parent",
    "--end-of-options",
    oid,
  ]);
}

/**
 * Reads the full detail record of one commit.
 *
 * The versioned single-record format carries the hashes, tree, parents, author, committer,
 * decorations, and message. A git failure, a truncated read, or a record that does not match the
 * current format returns a classified failure instead of throwing, so the pane can keep the current
 * selection and offer Retry.
 *
 * @param client - Git client bound to the configured executable.
 * @param options - Commit id, working directory, and cancellation signal.
 * @returns The parsed details or the classified failure.
 */
export async function readCommitDetails(
  client: GitClient,
  options: CommitDetailsReadOptions,
): Promise<CommitDetailsReadResult> {
  const read = await invokeCommitRead(
    client,
    options,
    buildCommitDetailsArgs(options.oid),
    COMMIT_DETAILS_TRUNCATED_MESSAGE,
  );

  if (!read.ok) {
    return { ok: false, details: null, failure: read.failure };
  }

  const parsed = parseCommitDetails(read.stdout);

  if (!parsed.ok) {
    return { ok: false, details: null, failure: createFormatFailure(parsed.message) };
  }

  return { ok: true, details: parsed.details, failure: null };
}

/**
 * Reads and sums the `--numstat` stats of one commit.
 *
 * Files changed counts every numstat entry, insertions and deletions sum their numeric columns, and
 * a binary entry contributes no line counts. The read stops at `COMMIT_STATS_FILE_CAP` entries and
 * sets `truncated`, so one huge commit cannot grow the row without bound.
 *
 * @param client - Git client bound to the configured executable.
 * @param options - Commit id, working directory, and cancellation signal.
 * @returns The summed stats or the classified failure.
 */
export async function readCommitStats(
  client: GitClient,
  options: CommitStatsReadOptions,
): Promise<CommitStatsReadResult> {
  const read = await invokeCommitRead(
    client,
    options,
    buildCommitStatsArgs(options.oid),
    COMMIT_STATS_TRUNCATED_MESSAGE,
  );

  if (!read.ok) {
    return { ok: false, stats: null, failure: read.failure };
  }

  return { ok: true, stats: parseCommitStats(read.stdout), failure: null };
}

/**
 * Executes one single-commit read and applies the shared failure rules.
 *
 * @param client - Git client bound to the configured executable.
 * @param options - Working directory and cancellation signal.
 * @param args - Prepared argument array.
 * @param truncatedMessage - Message used when the captured output was truncated.
 * @returns The captured stdout or the classified failure.
 */
async function invokeCommitRead(
  client: GitClient,
  options: GitReadOptions,
  args: readonly string[],
  truncatedMessage: string,
): Promise<
  | { readonly ok: true; readonly stdout: string }
  | { readonly ok: false; readonly failure: GitFailure }
> {
  const result = await client.invoke({
    args,
    cwd: options.cwd,
    signal: options.signal,
    operationClass: "read",
  });

  if (!result.ok) {
    return { ok: false, failure: classifyGitFailure(result) };
  }

  if (isTruncatedOutput(result)) {
    return { ok: false, failure: createTruncatedOutputFailure(result, truncatedMessage) };
  }

  return { ok: true, stdout: result.stdout };
}

/**
 * Parses the versioned single-record commit details output.
 *
 * The record starts with the record separator, then the version, then twelve NUL-separated fields
 * whose last field is the raw message. The message cannot contain NUL, so splitting once after the
 * version is unambiguous; git's trailing newline is removed from the message.
 *
 * @param stdout - Captured `git log -1` output.
 * @returns The parsed details or a one-line format error.
 */
function parseCommitDetails(
  stdout: string,
):
  | { readonly ok: true; readonly details: CommitDetailsRecord }
  | { readonly ok: false; readonly message: string } {
  const payload = readDetailsPayload(stdout);

  if (!payload.ok) {
    return payload;
  }

  const details = decodeDetailsFields(payload.fields);

  if (details.oid.length === 0) {
    return { ok: false, message: "commit details output has no commit id" };
  }

  return { ok: true, details };
}

/**
 * Locates the record marker, version, and field payload of one details read.
 *
 * Every check returns the same one-line error the caller reports, so the caller only has to map the
 * decoded fields.
 *
 * @param stdout - Captured `git log -1` output.
 * @returns The twelve raw fields, or the format error.
 */
function readDetailsPayload(
  stdout: string,
):
  | { readonly ok: true; readonly fields: readonly string[] }
  | { readonly ok: false; readonly message: string } {
  const recordStart = stdout.indexOf(COMMIT_DETAILS_RECORD_SEPARATOR);

  if (recordStart < 0) {
    return { ok: false, message: "commit details output is missing its record marker" };
  }

  if (stdout.slice(0, recordStart).trim().length > 0) {
    return { ok: false, message: "commit details output does not start with its record marker" };
  }

  const versionStart = recordStart + 1;
  const versionEnd = stdout.indexOf(COMMIT_DETAILS_FIELD_SEPARATOR, versionStart);

  if (versionEnd < 0) {
    return { ok: false, message: "commit details output is missing its format version" };
  }

  const version = stdout.slice(versionStart, versionEnd);

  if (version !== String(COMMIT_DETAILS_FORMAT_VERSION)) {
    return { ok: false, message: `commit details output has unknown version ${version}` };
  }

  const fields = stdout.slice(versionEnd + 1).split(COMMIT_DETAILS_FIELD_SEPARATOR);

  if (fields.length !== COMMIT_DETAILS_FIELD_COUNT) {
    return {
      ok: false,
      message: `commit details output has ${fields.length} fields, expected ${COMMIT_DETAILS_FIELD_COUNT}`,
    };
  }

  return { ok: true, fields };
}

/**
 * Decodes the twelve versioned fields into the display record.
 *
 * The count is already validated, so destructuring defaults only satisfy the type checker; every
 * field is present in a valid record.
 *
 * @param fields - Twelve NUL-separated fields in format order.
 * @returns The decoded details, including an empty OID when the field is empty.
 */
function decodeDetailsFields(fields: readonly string[]): CommitDetailsRecord {
  const [
    oid = "",
    shortOid = "",
    treeOid = "",
    parents = "",
    authorName = "",
    authorEmail = "",
    authorDate = "",
    committerName = "",
    committerEmail = "",
    committerDate = "",
    decorations = "",
    message = "",
  ] = fields;

  return {
    oid,
    shortOid,
    treeOid,
    parents: splitParents(parents),
    authorName,
    authorEmail,
    authorDate,
    committerName,
    committerEmail,
    committerDate,
    decorations: splitDecorationEntries(decorations),
    message: trimCommitMessage(message),
  };
}

/**
 * Parses and sums `--numstat` output.
 *
 * A line is `<added>\t<removed>\t<path>`; only the first two columns are read, so a path that
 * contains a tab is irrelevant here. Blank and malformed lines are skipped. Parsing stops once the
 * cap is reached, and one extra entry marks the result truncated.
 *
 * @param stdout - Captured `git log -1 --numstat --format=` output.
 * @returns The summed stats.
 */
function parseCommitStats(stdout: string): CommitStatsRecord {
  let filesChanged = 0;
  let insertions = 0;
  let deletions = 0;
  let binaryFiles = 0;
  let truncated = false;

  for (const line of stdout.split("\n")) {
    if (line.length === 0) {
      continue;
    }

    if (filesChanged >= COMMIT_STATS_FILE_CAP) {
      truncated = true;
      break;
    }

    const addedEnd = line.indexOf(NUMSTAT_SEPARATOR);

    if (addedEnd < 0) {
      continue;
    }

    const removedEnd = line.indexOf(NUMSTAT_SEPARATOR, addedEnd + 1);

    if (removedEnd < 0) {
      continue;
    }

    const added = line.slice(0, addedEnd);
    const removed = line.slice(addedEnd + 1, removedEnd);

    filesChanged += 1;

    if (added === NUMSTAT_BINARY && removed === NUMSTAT_BINARY) {
      binaryFiles += 1;
      continue;
    }

    insertions += readStatCount(added);
    deletions += readStatCount(removed);
  }

  return { filesChanged, insertions, deletions, binaryFiles, truncated };
}

/**
 * Splits the space-separated parent field of one detail record.
 *
 * @param value - Raw `%P` value, empty for a root commit.
 * @returns Parent OIDs in git order.
 */
function splitParents(value: string | undefined): readonly string[] {
  if (value === undefined || value.length === 0) {
    return [];
  }

  return value.split(" ").filter((oid) => oid.length > 0);
}

/**
 * Removes the newline git appends to the raw `%B` value.
 *
 * @param value - Raw message field, possibly undefined on a malformed record.
 * @returns The message without trailing newlines.
 */
function trimCommitMessage(value: string | undefined): string {
  return (value ?? "").replace(/\n+$/u, "");
}

/**
 * Reads one numeric numstat column defensively.
 *
 * @param value - Raw column text.
 * @returns The count, or zero when the column is not a bounded decimal number.
 */
function readStatCount(value: string): number {
  if (value.length === 0 || value.length > MAX_STAT_DIGITS || !/^\d+$/u.test(value)) {
    return 0;
  }

  return Number.parseInt(value, 10);
}

/**
 * Builds a classified failure for output git produced but the reader cannot trust.
 *
 * @param message - Decisive one-line message.
 * @returns A failure that keeps the current selection and offers Retry.
 */
function createFormatFailure(message: string): GitFailure {
  return {
    kind: "unknown",
    exitCode: null,
    message,
    stderr: "",
    cancelled: false,
    timedOut: false,
  };
}

/**
 * Reads HEAD's full commit message for the amend flow.
 *
 * Trailing newlines are removed because git terminates `%B` with one; interior blank lines and the
 * body text stay as committed. A failure or a truncated read returns a classified failure rather
 * than an empty message, so the caller can keep the current draft and explain the problem.
 *
 * @param client - Git client bound to the configured executable.
 * @param options - Working directory and cancellation signal.
 * @returns The message or the classified failure.
 */
export async function readMessage(
  client: GitClient,
  options: GitReadOptions,
): Promise<CommitTextReadResult> {
  return await readCommitText(client, options, buildMessageArgs(), MESSAGE_TRUNCATED_MESSAGE);
}

/**
 * Reads HEAD's abbreviated commit id for the amend indicator.
 *
 * @param client - Git client bound to the configured executable.
 * @param options - Working directory and cancellation signal.
 * @returns The short hash or the classified failure.
 */
export async function readShortHash(
  client: GitClient,
  options: GitReadOptions,
): Promise<CommitTextReadResult> {
  return await readCommitText(client, options, buildShortHashArgs(), SHORT_HASH_TRUNCATED_MESSAGE);
}

/**
 * Executes one single-value commit metadata read.
 *
 * @param client - Git client bound to the configured executable.
 * @param options - Working directory and cancellation signal.
 * @param args - Prepared argument array.
 * @param truncatedMessage - Message used when the captured output was truncated.
 * @returns The trimmed value or the classified failure.
 */
async function readCommitText(
  client: GitClient,
  options: GitReadOptions,
  args: readonly string[],
  truncatedMessage: string,
): Promise<CommitTextReadResult> {
  const result = await client.invoke({
    args,
    cwd: options.cwd,
    signal: options.signal,
    operationClass: "read",
  });

  if (!result.ok) {
    return { ok: false, text: "", failure: classifyGitFailure(result) };
  }

  if (isTruncatedOutput(result)) {
    return {
      ok: false,
      text: "",
      failure: createTruncatedOutputFailure(result, truncatedMessage),
    };
  }

  return { ok: true, text: result.stdout.replace(/\n+$/u, ""), failure: null };
}

/**
 * Executes a bounded log read, halving an oversized page instead of failing it.
 *
 * The page size bounds commits, not capture size, so a page of commits that each touch many files
 * can exceed the client output limit even though the graph itself is fine. Each retry rebuilds the
 * arguments for the smaller page, keeping every other option such as the frontier or search offset
 * unchanged. A read is only reported as truncated when a single-record page still overflows.
 *
 * @param client - Git client bound to the configured executable.
 * @param options - Working directory and cancellation signal.
 * @param buildArgs - Builds the argument array for one page size.
 * @param requestedLimit - Caller page size, normalized before the first attempt.
 * @param truncatedMessage - Message used when even the smallest page was truncated.
 * @returns The parsed page or the classified failure.
 */
async function readLogArguments(
  client: GitClient,
  options: { readonly cwd: string; readonly signal: AbortSignal },
  buildArgs: (limit: number) => readonly string[],
  requestedLimit: number,
  truncatedMessage: string,
): Promise<GraphLogReadResult> {
  let limit = normalizeLimit(requestedLimit);

  while (true) {
    const result = await client.invoke({
      args: buildArgs(limit),
      cwd: options.cwd,
      signal: options.signal,
      operationClass: "read",
    });

    if (!result.ok) {
      return gitFailureResult(classifyGitFailure(result));
    }

    if (!isTruncatedOutput(result)) {
      return parseReadOutput(result.stdout, limit);
    }

    if (limit <= LOG_MIN_PAGE_LIMIT) {
      return gitFailureResult(createTruncatedOutputFailure(result, truncatedMessage));
    }

    limit = Math.max(LOG_MIN_PAGE_LIMIT, Math.floor(limit / 2));
  }
}

/**
 * Parses captured log output into a page result.
 *
 * @param stdout - Captured standard output.
 * @param limit - Requested page size.
 * @returns The parsed page or the typed parse failure.
 */
function parseReadOutput(stdout: string, limit: number): GraphLogReadResult {
  const parsed = parseLogRecords(stdout);

  if (!parsed.ok) {
    return parseFailureResult(parsed.error);
  }

  return {
    ok: true,
    rows: parsed.rows,
    done: parsed.rows.length < limit,
    failure: null,
  };
}

/**
 * Builds a classified git failure result.
 *
 * @param failure - Classified failure.
 * @returns A failed page result carrying the failure.
 */
function gitFailureResult(failure: GitFailure): GraphLogReadResult {
  return {
    ok: false,
    rows: [],
    done: false,
    failure: { kind: "git", message: failure.message, git: failure },
  };
}

/**
 * Builds a typed parse failure result.
 *
 * @param error - Typed parse error.
 * @returns A failed page result carrying the parse error.
 */
function parseFailureResult(error: GraphLogParseError): GraphLogReadResult {
  return {
    ok: false,
    rows: [],
    done: false,
    failure: { kind: "parse", message: error.message, parse: error },
  };
}

/**
 * Normalizes one requested page size.
 *
 * @param value - Requested limit.
 * @returns A positive integer.
 */
function normalizeLimit(value: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1;
}

/**
 * Normalizes one stable search offset.
 *
 * @param value - Requested offset, or undefined for the first page.
 * @returns A non-negative integer.
 */
function normalizeOffset(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}
