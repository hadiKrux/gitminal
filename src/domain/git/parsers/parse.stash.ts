import type { StashRecord } from "../git.types";

/** NUL field separator used by the recorded stash format. */
const FIELD_SEPARATOR = "\0";

/** Number of atoms in the stash list format. */
const FIELD_COUNT = 4;

/** Reflog prefix git writes for an automatic stash. */
const WIP_PREFIX = "WIP on ";

/** Reflog prefix git writes for a stash created with an explicit message. */
const ON_PREFIX = "On ";

/** Branch names cannot contain a colon, so the first colon ends the source branch. */
const BRANCH_TERMINATOR = ":";

/** Pseudo branch git records for a stash created on a detached HEAD. */
const DETACHED_BRANCH = "(no branch)";

/**
 * Parses `git stash list --format=%gd%x00%H%x00%gs%x00%ct` output.
 *
 * Each line carries the display index, the immutable stash commit id, the reflog subject, and the
 * commit timestamp. The object name is the row identity because the index can change after an
 * external stash operation. The source branch is parsed from the subject so the row can show it,
 * and a line that is missing its index or object name is skipped rather than fabricating a row.
 *
 * @param stdout - Captured stash list output.
 * @returns Stashes in git order, newest first.
 */
export function parseStashes(stdout: string): readonly StashRecord[] {
  const stashes: StashRecord[] = [];

  for (const line of stdout.split("\n")) {
    const stash = parseStashRecord(line);

    if (stash !== null) {
      stashes.push(stash);
    }
  }

  return stashes;
}

/**
 * Parses one NUL-separated stash record.
 *
 * @param line - Raw output line, possibly ending in a carriage return.
 * @returns The stash record, or null when the index or object name is missing.
 */
function parseStashRecord(line: string): StashRecord | null {
  const columns = line.replace(/\r$/, "").split(FIELD_SEPARATOR);

  if (columns.length !== FIELD_COUNT) {
    return null;
  }

  const [index, objectName, subject, committedAt] = columns;

  if (index === undefined || index.length === 0 || objectName === undefined) {
    return null;
  }

  if (objectName.length === 0) {
    return null;
  }

  const rawSubject = subject ?? "";

  return {
    index,
    objectName,
    subject: rawSubject,
    sourceBranch: parseSourceBranch(rawSubject),
    committedAt: parseCommittedAt(committedAt),
  };
}

/**
 * Reads the commit timestamp from a stash record.
 *
 * @param value - Raw `%ct` value.
 * @returns The timestamp in seconds, or zero on a missing or unparsable value.
 */
function parseCommittedAt(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "", 10);

  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Extracts the source branch from a stash reflog subject.
 *
 * Git writes `WIP on <branch>: <short hash> <subject>` for an automatic stash and
 * `On <branch>: <message>` for a stash created with an explicit message. A stash created on a
 * detached HEAD records `(no branch)`, which is not a branch and is reported as null. The first
 * colon ends the branch because git ref names cannot contain one.
 *
 * @param subject - Raw stash reflog subject.
 * @returns The source branch name, or null when the subject has no recorded branch.
 */
export function parseSourceBranch(subject: string): string | null {
  if (subject.startsWith(WIP_PREFIX)) {
    return readBranchBeforeTerminator(subject.slice(WIP_PREFIX.length));
  }

  if (subject.startsWith(ON_PREFIX)) {
    return readBranchBeforeTerminator(subject.slice(ON_PREFIX.length));
  }

  return null;
}

/**
 * Reads the branch name that precedes the terminator of a stash subject.
 *
 * @param remainder - Subject after its prefix.
 * @returns The branch name, or null when it is missing, empty, or the detached pseudo branch.
 */
function readBranchBeforeTerminator(remainder: string): string | null {
  const terminator = remainder.indexOf(BRANCH_TERMINATOR);

  if (terminator <= 0) {
    return null;
  }

  const branch = remainder.slice(0, terminator).trim();

  if (branch.length === 0 || branch === DETACHED_BRANCH) {
    return null;
  }

  return branch;
}
