import { classifyGitFailure } from "./git.errors";
import { planGitArgs, planGitError } from "./git.plan";
import { createTruncatedOutputFailure, isSafeGitName, isTruncatedOutput } from "./git.remotes";
import { STATUS_ARGS } from "./git.status";
import type {
  GitArgPlan,
  GitClient,
  GitFailure,
  GitReadOptions,
  NewWorktreeValidationFacts,
  NewWorktreeValidationInput,
  WorktreeDirtyReadResult,
  WorktreeForceLevel,
  WorktreeReadResult,
  WorktreeRecord,
} from "./git.types";
import { parseWorktrees } from "./parsers/parse.worktrees";

/** Mode of the worktree creation form. */
const NEW_BRANCH_MODE = "new";
const EXISTING_BRANCH_MODE = "existing";

/**
 * Builds the read of every worktree.
 *
 * @returns The argument array, without the executable.
 */
export function buildListWorktreesArgs(): readonly string[] {
  return Object.freeze(["worktree", "list", "--porcelain"]);
}

/**
 * Reads every worktree with `git worktree list --porcelain`.
 *
 * The current worktree is resolved against the repository root in the same call, so branch rows and
 * the worktrees panel read one consistent list. A failed or truncated read returns the classified
 * failure instead of throwing.
 *
 * @param client - Git client bound to the configured executable.
 * @param options - Working directory and cancellation signal.
 * @param root - Absolute work-tree root of this session.
 * @returns The parsed worktrees or the classified failure.
 */
export async function readWorktrees(
  client: GitClient,
  options: GitReadOptions,
  root: string | null,
): Promise<WorktreeReadResult> {
  const result = await client.invoke({
    args: buildListWorktreesArgs(),
    cwd: options.cwd,
    signal: options.signal,
    operationClass: "read",
  });

  if (!result.ok) {
    return { ok: false, worktrees: [], failure: classifyGitFailure(result) };
  }

  if (isTruncatedOutput(result)) {
    return {
      ok: false,
      worktrees: [],
      failure: createTruncatedOutputFailure(
        result,
        "git worktree list --porcelain output was truncated",
      ),
    };
  }

  return {
    ok: true,
    worktrees: markCurrentWorktree(parseWorktrees(result.stdout), root),
    failure: null,
  };
}

/**
 * Marks the worktree that contains the repository root of this session.
 *
 * Both values come from git and are absolute, so a trailing separator is the only difference worth
 * normalizing. A null root marks nothing, which keeps a bare or unreadable repository from claiming
 * a current worktree.
 *
 * @param worktrees - Parsed worktrees.
 * @param root - Absolute work-tree root of this session.
 * @returns New records with the `current` flag resolved.
 */
export function markCurrentWorktree(
  worktrees: readonly WorktreeRecord[],
  root: string | null,
): readonly WorktreeRecord[] {
  if (root === null) {
    return worktrees.map((worktree) => ({ ...worktree, current: false }));
  }

  const target = normalizeWorktreePath(root);

  return worktrees.map((worktree) => ({
    ...worktree,
    current: normalizeWorktreePath(worktree.path) === target,
  }));
}

/**
 * Normalizes a worktree path for comparison.
 *
 * @param value - Absolute path from git.
 * @returns The path without trailing separators.
 */
function normalizeWorktreePath(value: string): string {
  return value.replace(/[\\/]+$/, "");
}

/**
 * Builds the branch-to-worktree map consumed by the branches panel.
 *
 * Only a worktree with a reported branch contributes, so a detached or bare entry cannot overwrite a
 * real branch location. The value is the full record so the caller can explain a locked or dirty
 * worktree without another read.
 *
 * @param worktrees - Parsed worktrees.
 * @returns A map from branch name to the worktree that has it checked out.
 */
export function buildWorktreeBranchMap(
  worktrees: readonly WorktreeRecord[],
): ReadonlyMap<string, WorktreeRecord> {
  const map = new Map<string, WorktreeRecord>();

  for (const worktree of worktrees) {
    if (worktree.branch !== null && !map.has(worktree.branch)) {
      map.set(worktree.branch, worktree);
    }
  }

  return map;
}

/**
 * Reads the dirty state of one worktree.
 *
 * The canonical status arguments run with the worktree path as the working directory, so the read
 * observes that worktree's index and working tree. The path is never an argv element. Only a
 * completed read reports a state; a failure leaves the caller with no claim about the worktree.
 *
 * @param client - Git client bound to the configured executable.
 * @param options - Cancellation signal; the worktree read uses `path` as its working directory.
 * @param path - Absolute worktree path.
 * @returns The dirty flag or the classified failure.
 */
export async function readWorktreeDirty(
  client: GitClient,
  options: GitReadOptions,
  path: string,
): Promise<WorktreeDirtyReadResult> {
  if (!isSafeWorktreePath(path)) {
    return { ok: false, dirty: false, failure: createInvalidPathFailure(path) };
  }

  const result = await client.invoke({
    args: STATUS_ARGS,
    cwd: path,
    signal: options.signal,
    operationClass: "read",
    touchesIndex: true,
  });

  if (!result.ok) {
    return { ok: false, dirty: false, failure: classifyGitFailure(result) };
  }

  if (isTruncatedOutput(result)) {
    return {
      ok: false,
      dirty: false,
      failure: createTruncatedOutputFailure(
        result,
        "git status in the worktree output was truncated",
      ),
    };
  }

  return { ok: true, dirty: hasStatusEntry(result.stdout), failure: null };
}

/**
 * Reports whether canonical status output contains at least one change.
 *
 * The canonical invocation uses NUL record separators, with a newline split kept as a defensive
 * fallback. Branch headers start with `# ` and are not changes, and an empty trailing record is not
 * a change either.
 *
 * @param stdout - Captured canonical status output.
 * @returns True when the worktree has any status entry.
 */
function hasStatusEntry(stdout: string): boolean {
  const records = stdout.includes("\0") ? stdout.split("\0") : stdout.split("\n");

  return records
    .map((record) => record.replace(/^\n+/, ""))
    .some((record) => record.length > 0 && !record.startsWith("# "));
}

/**
 * Builds the failure reported for an unusable worktree path.
 *
 * @param path - Rejected path.
 * @returns The classified failure.
 */
function createInvalidPathFailure(path: string): GitFailure {
  return {
    kind: "unknown",
    exitCode: null,
    message: `invalid worktree path "${path}"`,
    stderr: "",
    cancelled: false,
    timedOut: false,
  };
}

/**
 * Validates a worktree creation form against the current snapshot.
 *
 * The function is pure: the caller supplies `pathExists` from the bounded filesystem check, so no
 * filesystem access happens here. It checks, in order, that the path is usable and absent, that the
 * branch name is a safe ref value, that the branch exists or does not exist according to the mode,
 * and that the branch is not already checked out in another worktree.
 *
 * @param input - Path, branch mode, and branch name from the form.
 * @param existing - Known branches, known worktrees, and the path-existence answer.
 * @returns A reason string for the inline form error, or null when the form may run.
 */
export function validateNewWorktree(
  input: NewWorktreeValidationInput,
  existing: NewWorktreeValidationFacts,
): string | null {
  if (input.path.length === 0) {
    return "path is required";
  }

  if (!isSafeWorktreePath(input.path)) {
    return "invalid path";
  }

  if (existing.pathExists) {
    return "path already exists";
  }

  if (!isSafeGitName(input.branch)) {
    return "invalid branch name";
  }

  const branches = readBranchNames(existing.branches);

  if (input.mode === NEW_BRANCH_MODE && branches.has(input.branch)) {
    return "branch already exists";
  }

  if (input.mode === EXISTING_BRANCH_MODE && !branches.has(input.branch)) {
    return "branch does not exist";
  }

  const checkedOut = existing.worktrees.some(
    (worktree) => worktree.branch !== null && worktree.branch === input.branch,
  );

  return checkedOut ? "branch is checked out in another worktree" : null;
}

/**
 * Reads distinct branch names from names or branch records.
 *
 * @param branches - Known local branches.
 * @returns The distinct non-empty branch names.
 */
function readBranchNames(
  branches: readonly (string | { readonly name: string })[],
): ReadonlySet<string> {
  const names = new Set<string>();

  for (const branch of branches) {
    const name = typeof branch === "string" ? branch : branch.name;

    if (name.length > 0) {
      names.add(name);
    }
  }

  return names;
}

/**
 * Reports whether a path is usable as a single git argument.
 *
 * The path is non-empty, does not start with a dash so it cannot be parsed as an option, and has no
 * control characters or NUL that argv cannot represent.
 *
 * @param value - Candidate worktree path.
 * @returns True when the path is safe.
 */
function isSafeWorktreePath(value: string): boolean {
  if (value.length === 0 || value.startsWith("-")) {
    return false;
  }

  for (const character of value) {
    const code = character.charCodeAt(0);

    if (code <= 0x1f || code === 0x7f) {
      return false;
    }
  }

  return true;
}

/**
 * Plans adding a worktree with a new branch from HEAD.
 *
 * @param input - Absolute worktree path and the new branch name.
 * @returns The planned argument array, or the reason the plan cannot run.
 */
export function planAddWorktreeNewBranch(input: {
  readonly path: string;
  readonly branch: string;
}): GitArgPlan {
  if (!isSafeWorktreePath(input.path)) {
    return planGitError(`invalid worktree path "${input.path}"`);
  }

  if (!isSafeGitName(input.branch)) {
    return planGitError(`invalid branch name "${input.branch}"`);
  }

  return planGitArgs(["worktree", "add", "-b", input.branch, input.path, "HEAD"]);
}

/**
 * Plans adding a worktree that checks out an existing branch.
 *
 * @param input - Absolute worktree path and the existing branch name.
 * @returns The planned argument array, or the reason the plan cannot run.
 */
export function planAddWorktreeExistingBranch(input: {
  readonly path: string;
  readonly branch: string;
}): GitArgPlan {
  if (!isSafeWorktreePath(input.path)) {
    return planGitError(`invalid worktree path "${input.path}"`);
  }

  if (!isSafeGitName(input.branch)) {
    return planGitError(`invalid branch name "${input.branch}"`);
  }

  return planGitArgs(["worktree", "add", input.path, input.branch]);
}

/**
 * Plans removing one worktree.
 *
 * The flag set is computed from the worktree state by the caller, never from raw user input. No flag
 * removes a clean worktree, one `--force` removes a dirty one, and two `-f` flags remove a locked one
 * because git refuses a locked worktree with a single force.
 *
 * @param path - Absolute worktree path.
 * @param options - Number of force flags, from 0 to 2.
 * @returns The planned argument array, or the reason the plan cannot run.
 */
export function planRemoveWorktree(
  path: string,
  options: { readonly force: WorktreeForceLevel },
): GitArgPlan {
  if (!isSafeWorktreePath(path)) {
    return planGitError(`invalid worktree path "${path}"`);
  }

  const flags = options.force === 2 ? ["-f", "-f"] : options.force === 1 ? ["--force"] : [];

  return planGitArgs(["worktree", "remove", ...flags, path]);
}
