import type { WorktreeRecord } from "../git.types";
import type { MutableWorktree } from "./parse.worktrees.types";

/** Line prefix that starts a new worktree block. */
const WORKTREE_PREFIX = "worktree ";

/** Line prefix of the resolved HEAD id. */
const HEAD_PREFIX = "HEAD ";

/** Line prefix of the checked-out branch ref. */
const BRANCH_PREFIX = "branch ";

/** Single-line marker for a bare main worktree. */
const BARE_LINE = "bare";

/** Single-line marker for a detached HEAD. */
const DETACHED_LINE = "detached";

/** Line prefix and exact marker of a locked worktree. */
const LOCKED_MARKER = "locked";

/** Line prefix and exact marker of a prunable worktree. */
const PRUNABLE_MARKER = "prunable";

/** Prefix git uses for a local branch ref. */
const BRANCH_REF_PREFIX = "refs/heads/";

/**
 * Parses `git worktree list --porcelain` output.
 *
 * Porcelain output is one block per worktree separated by a blank line. A block starts with
 * `worktree <path>` and may then carry `HEAD`, `branch`, `bare`, `detached`, `locked`, and
 * `prunable` lines. A lock or prune line may be followed by a reason on the same line. The parser
 * returns the reported facts only; `current` and `dirty` stay false until the caller resolves them.
 *
 * @param stdout - Captured porcelain output.
 * @returns Worktrees in git order, with blocks that have no path skipped.
 */
export function parseWorktrees(stdout: string): readonly WorktreeRecord[] {
  const worktrees: WorktreeRecord[] = [];
  let current: MutableWorktree | null = null;

  for (const rawLine of stdout.split("\n")) {
    const line = rawLine.replace(/\r$/, "");

    if (line.length === 0) {
      current = flushWorktree(worktrees, current);

      continue;
    }

    if (line.startsWith(WORKTREE_PREFIX)) {
      current = flushWorktree(worktrees, current);

      current = {
        path: line.slice(WORKTREE_PREFIX.length),
        headOid: null,
        branch: null,
        detached: false,
        bare: false,
        locked: false,
        lockReason: null,
        prunable: false,
        pruneReason: null,
      };

      continue;
    }

    if (current !== null) {
      applyWorktreeLine(current, line);
    }
  }

  flushWorktree(worktrees, current);

  return worktrees;
}

/**
 * Appends one completed block and clears the accumulator.
 *
 * @param worktrees - Accumulated records.
 * @param current - Block being read, or null when no block is open.
 * @returns Always null, so the caller continues with a fresh block.
 */
function flushWorktree(
  worktrees: WorktreeRecord[],
  current: MutableWorktree | null,
): MutableWorktree | null {
  if (current === null) {
    return null;
  }

  if (current.path.length > 0) {
    worktrees.push({
      path: current.path,
      headOid: current.headOid,
      branch: current.branch,
      detached: current.detached,
      bare: current.bare,
      locked: current.locked,
      lockReason: current.lockReason,
      prunable: current.prunable,
      pruneReason: current.pruneReason,
      current: false,
      dirty: false,
    });
  }

  return null;
}

/**
 * Applies one porcelain line to the open block.
 *
 * @param current - Block being read.
 * @param line - Line without its line ending.
 */
function applyWorktreeLine(current: MutableWorktree, line: string): void {
  if (line.startsWith(HEAD_PREFIX)) {
    current.headOid = readValue(line, HEAD_PREFIX);

    return;
  }

  if (line.startsWith(BRANCH_PREFIX)) {
    current.branch = readBranchName(readValue(line, BRANCH_PREFIX));

    return;
  }

  if (line === BARE_LINE) {
    current.bare = true;

    return;
  }

  if (line === DETACHED_LINE) {
    current.detached = true;
    current.branch = null;

    return;
  }

  if (line === LOCKED_MARKER || line.startsWith(`${LOCKED_MARKER} `)) {
    current.locked = true;
    current.lockReason = readOptionalReason(line, LOCKED_MARKER);

    return;
  }

  if (line === PRUNABLE_MARKER || line.startsWith(`${PRUNABLE_MARKER} `)) {
    current.prunable = true;
    current.pruneReason = readOptionalReason(line, PRUNABLE_MARKER);
  }
}

/**
 * Reads the value after a line prefix.
 *
 * @param line - Full line.
 * @param prefix - Prefix to remove.
 * @returns The remaining value, trimmed; an empty string when the value is missing.
 */
function readValue(line: string, prefix: string): string {
  return line.slice(prefix.length).trim();
}

/**
 * Reads a branch ref as a short branch name.
 *
 * @param ref - Branch ref from the porcelain line.
 * @returns The short branch name, or null when no ref was reported.
 */
function readBranchName(ref: string): string | null {
  if (ref.length === 0) {
    return null;
  }

  return ref.startsWith(BRANCH_REF_PREFIX) ? ref.slice(BRANCH_REF_PREFIX.length) : ref;
}

/**
 * Reads the optional reason that follows a lock or prune marker.
 *
 * @param line - Full line.
 * @param marker - Marker without its trailing space.
 * @returns The trimmed reason, or null when the marker stands alone.
 */
function readOptionalReason(line: string, marker: string): string | null {
  const reason = line.slice(marker.length).trim();

  return reason.length === 0 ? null : reason;
}
