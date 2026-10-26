import type { DiffFilesReadResult } from "@/domain/diff/diff.types";
import { resolveDiffReadContextLines } from "./git.diff";
import { classifyGitFailure } from "./git.errors";
import { planGitArgs, planGitError } from "./git.plan";
import { createTruncatedOutputFailure, isTruncatedOutput } from "./git.remotes";
import type {
  GitArgPlan,
  GitClient,
  GitReadOptions,
  StashReadResult,
  StashRecord,
  StashRefResolution,
  StatusSnapshot,
} from "./git.types";
import { parseDiff } from "./parsers/parse.diff";
import { parseSourceBranch, parseStashes } from "./parsers/parse.stash";

/**
 * Re-exported so the stash module owns the parsing surface its consumers import.
 *
 * `parseSourceBranch` lives with the parser because the parser has no read dependency and a parse
 * module may not import the read module without creating a cycle.
 */
export { parseSourceBranch, parseStashes };

/** Format of the stash list read, with NUL-separated fields. */
const STASH_LIST_FORMAT = "--format=%gd%x00%H%x00%gs%x00%ct";

/** A stash selector as git reports it through `%gd`. */
const STASH_REF_PATTERN = /^stash@\{[0-9]+\}$/;

/** Selector pattern used to read the numeric position of a stash index. */
const STASH_INDEX_PATTERN = /^stash@\{([0-9]+)\}$/;

/**
 * Builds the read of the stash list.
 *
 * Each line carries the display selector, the immutable stash commit, the reflog subject, and the
 * commit timestamp, so one invocation provides the row identity, the message, the source branch, and
 * the relative age.
 *
 * @returns The argument array, without the executable.
 */
export function buildListStashesArgs(): readonly string[] {
  return Object.freeze(["stash", "list", STASH_LIST_FORMAT]);
}

/**
 * Reads the stash list with `git stash list`.
 *
 * @param client - Git client bound to the configured executable.
 * @param options - Working directory and cancellation signal.
 * @returns The parsed stashes or the classified failure.
 */
export async function readStashes(
  client: GitClient,
  options: GitReadOptions,
): Promise<StashReadResult> {
  const result = await client.invoke({
    args: buildListStashesArgs(),
    cwd: options.cwd,
    signal: options.signal,
    operationClass: "read",
  });

  if (!result.ok) {
    return { ok: false, stashes: [], failure: classifyGitFailure(result) };
  }

  if (isTruncatedOutput(result)) {
    return {
      ok: false,
      stashes: [],
      failure: createTruncatedOutputFailure(result, "git stash list output was truncated"),
    };
  }

  return { ok: true, stashes: parseStashes(result.stdout), failure: null };
}

/**
 * Sorts stashes newest first.
 *
 * Git numbers the newest stash `stash@{0}`, so the ascending numeric selector is the newest-first
 * order and the list position is derived from the selector alone. The immutable object name breaks
 * a tie, including for a malformed selector that has no numeric position, so the order never
 * depends on input order.
 *
 * @param stashes - Stashes in any order.
 * @returns A new array with the newest stash first.
 */
export function sortStashesNewestFirst(stashes: readonly StashRecord[]): readonly StashRecord[] {
  return [...stashes].sort((left, right) => {
    const position = readStashPosition(left) - readStashPosition(right);

    if (position !== 0) {
      return position;
    }

    return compareText(left.objectName, right.objectName);
  });
}

/**
 * Reads the numeric position of a stash selector.
 *
 * @param stash - Stash record.
 * @returns The position, or a value below every real position when the selector is malformed.
 */
function readStashPosition(stash: StashRecord): number {
  const match = STASH_INDEX_PATTERN.exec(stash.index);

  if (match === null) {
    return -1;
  }

  return Number.parseInt(match[1] ?? "-1", 10);
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
 * Resolves a stash target to the selector that currently holds it.
 *
 * The target is the immutable object name captured when the row was selected, so an external
 * `git stash push` or `git stash drop` cannot redirect the action. A selector-shaped target is
 * detected separately: if that position exists, its stash necessarily differs from the selector
 * string, so the result is `changed` instead of acting on a different stash.
 *
 * @param stashes - Fresh stash list read immediately before the action.
 * @param target - Immutable object name, or a display selector captured by mistake.
 * @returns The current selector, `missing`, or `changed`.
 */
export function resolveStashRef(
  stashes: readonly StashRecord[],
  target: string,
): StashRefResolution {
  const matched = stashes.find((stash) => stash.objectName === target);

  if (matched !== undefined) {
    return { status: "found", index: matched.index };
  }

  const reused = stashes.find((stash) => stash.index === target);

  return reused === undefined ? { status: "missing" } : { status: "changed" };
}

/**
 * Reports why creating a stash is unavailable.
 *
 * The check runs against the canonical status snapshot, never a spawn. An empty repository has no
 * commit to stash against. With no staged, unstaged, or untracked change there is nothing to stash.
 * When the only changes are untracked and untracked files are not included, `git stash push` would
 * exit successfully without creating a stash, so the reason names the checkbox as the remedy. A
 * missing snapshot is not evidence of an empty working tree, so it reports no reason.
 *
 * @param status - Canonical status snapshot, or null before the first read.
 * @param includeUntracked - Whether the form includes untracked files.
 * @returns The blocking reason, or null when the create may run.
 */
export function getStashCreateAvailability(
  status: StatusSnapshot | null,
  includeUntracked: boolean,
): "no-commits-yet" | "nothing-to-stash" | "only-untracked-changes" | null {
  if (status === null) {
    return null;
  }

  if (status.headOid === null) {
    return "no-commits-yet";
  }

  if (status.stagedCount === 0 && status.unstagedCount === 0 && status.untrackedCount === 0) {
    return "nothing-to-stash";
  }

  if (status.stagedCount === 0 && status.unstagedCount === 0 && !includeUntracked) {
    return "only-untracked-changes";
  }

  return null;
}

/**
 * Plans creating a stash.
 *
 * The message is required so every row has a readable identity, and `-m` keeps it a single argv
 * value even when it contains spaces. `-u` is added only when untracked files are included.
 *
 * @param message - Stash message.
 * @param includeUntracked - Whether to include untracked files.
 * @returns The planned argument array, or the reason the plan cannot run.
 */
export function planCreateStash(message: string, includeUntracked: boolean): GitArgPlan {
  if (!isValidMessage(message)) {
    return planGitError("stash message is required");
  }

  return includeUntracked
    ? planGitArgs(["stash", "push", "-u", "-m", message])
    : planGitArgs(["stash", "push", "-m", message]);
}

/**
 * Plans applying one stash and keeping it.
 *
 * @param index - Current stash selector such as `stash@{0}`.
 * @returns The planned argument array, or the reason the plan cannot run.
 */
export function planApplyStash(index: string): GitArgPlan {
  return planStashCommand("apply", index);
}

/**
 * Plans popping one stash.
 *
 * `git stash pop` drops the stash only when the apply succeeds, so a conflict leaves it in place and
 * the app never needs a separate drop.
 *
 * @param index - Current stash selector such as `stash@{0}`.
 * @returns The planned argument array, or the reason the plan cannot run.
 */
export function planPopStash(index: string): GitArgPlan {
  return planStashCommand("pop", index);
}

/**
 * Plans dropping one stash.
 *
 * @param index - Current stash selector such as `stash@{0}`.
 * @returns The planned argument array, or the reason the plan cannot run.
 */
export function planDropStash(index: string): GitArgPlan {
  return planStashCommand("drop", index);
}

/**
 * Plans the read-only diff of one stash.
 *
 * The diff is rendered by the diff panel, so the plan disables color and keeps the patch in one
 * invocation.
 *
 * @param index - Current stash selector such as `stash@{0}`.
 * @returns The planned argument array, or the reason the plan cannot run.
 */
export function buildShowStashArgs(index: string): GitArgPlan {
  if (!isStashRef(index)) {
    return planGitError(`invalid stash selector "${index}"`);
  }

  return planGitArgs(["stash", "show", "-p", "--no-color", index]);
}

/**
 * Plans the read-only diff of one stash with the collapse read window.
 *
 * `buildStashDiffArgs` uses the same read window as every other text diff so a long unchanged run
 * exists in the patch, and the panel then collapses it to `diff.contextLines`.
 *
 * @param index - Current stash selector such as `stash@{0}`.
 * @param contextLines - Configured context lines.
 * @returns The planned argument array, or the reason the plan cannot run.
 */
export function buildStashDiffArgs(index: string, contextLines: number): GitArgPlan {
  if (!isStashRef(index)) {
    return planGitError(`invalid stash selector "${index}"`);
  }

  return planGitArgs([
    "stash",
    "show",
    "-p",
    "--no-color",
    `-U${resolveDiffReadContextLines(contextLines)}`,
    index,
  ]);
}

/**
 * Reads the read-only diff of one stash and parses every changed file.
 *
 * @param client - Git client bound to the configured executable.
 * @param options - Stash selector, context lines, working directory, and cancellation signal.
 * @returns Parsed files or the classified failure. Never throws.
 */
export async function readStashDiff(
  client: GitClient,
  options: {
    readonly stashRef: string;
    readonly contextLines: number;
    readonly cwd: string;
    readonly signal: AbortSignal;
  },
): Promise<DiffFilesReadResult> {
  const plan = buildStashDiffArgs(options.stashRef, options.contextLines);

  if (!plan.ok) {
    return {
      ok: false,
      files: [],
      failure: {
        kind: "unknown",
        exitCode: null,
        message: plan.error,
        stderr: "",
        cancelled: false,
        timedOut: false,
      },
    };
  }

  const result = await client.invoke({
    args: plan.args,
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
      failure: createTruncatedOutputFailure(result, "git stash show output was truncated"),
    };
  }

  const parsed = parseDiff(result.stdout);

  if (!parsed.ok) {
    return {
      ok: false,
      files: parsed.files,
      failure: {
        kind: "unknown",
        exitCode: null,
        message: parsed.error.message,
        stderr: "",
        cancelled: false,
        timedOut: false,
      },
    };
  }

  return { ok: true, files: parsed.files, failure: null };
}

/**
 * Plans one stash subcommand that takes a selector.
 *
 * @param command - `apply`, `pop`, or `drop`.
 * @param index - Current stash selector.
 * @returns The planned argument array, or the reason the plan cannot run.
 */
function planStashCommand(command: "apply" | "pop" | "drop", index: string): GitArgPlan {
  if (!isStashRef(index)) {
    return planGitError(`invalid stash selector "${index}"`);
  }

  return planGitArgs(["stash", command, index]);
}

/**
 * Reports whether a value is a stash selector git accepts.
 *
 * @param value - Candidate selector.
 * @returns True for `stash@{<digits>}` only.
 */
function isStashRef(value: string): boolean {
  return STASH_REF_PATTERN.test(value);
}

/**
 * Reports whether a value is usable as a single stash message argument.
 *
 * The message follows `-m`, so it can never be parsed as an option; it only has to be non-empty and
 * free of a NUL, which no argv element can contain.
 *
 * @param value - Candidate message.
 * @returns True when the message is non-empty and has no NUL.
 */
function isValidMessage(value: string): boolean {
  return value.length > 0 && !value.includes("\0");
}
