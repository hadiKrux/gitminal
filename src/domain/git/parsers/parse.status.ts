import type { FileChangeKind, StatusEntry, StatusEntryKind, StatusSnapshot } from "../git.types";
import type { MutableStatus } from "./parse.status.types";

/** Field count before the path in an ordinary `1` record. */
const ORDINARY_METADATA_FIELDS = 7;

/** Field count before the path in a rename or copy `2` record. */
const RENAME_METADATA_FIELDS = 8;

/** Field count before the path in an unmerged `u` record. */
const UNMERGED_METADATA_FIELDS = 9;

/**
 * Parses canonical `git status --porcelain=v2 --branch -z --untracked-files=all` output.
 *
 * The `-z` form separates records with NUL, and a rename or copy record carries its original path
 * as the next record. Branch headers carry the OID, short branch, upstream, and ahead/behind
 * counts. Unmerged `u` records become conflicted entries so conflict detection adds no extra git
 * call. Every parsed value is defensive: an unknown or short record is skipped rather than
 * producing a fabricated entry.
 *
 * @param stdout - Captured canonical status output.
 * @returns The parsed snapshot, with zeroed counts for an empty status.
 */
export function parseStatus(stdout: string): StatusSnapshot {
  const state: MutableStatus = {
    headOid: null,
    branch: null,
    detached: false,
    upstream: null,
    ahead: 0,
    behind: 0,
    entries: [],
    conflictedPaths: [],
    stagedCount: 0,
    unstagedCount: 0,
    untrackedCount: 0,
  };
  const records = splitRecords(stdout);

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];

    if (record === undefined || record.length === 0) {
      continue;
    }

    if (record.startsWith("# ")) {
      applyBranchHeader(state, record);
      continue;
    }

    const kind = readRecordKind(record);

    if (kind === null) {
      continue;
    }

    if (kind === "renamed") {
      const originalPath = records[index + 1] ?? null;

      if (originalPath !== null) {
        index += 1;
      }

      applyRenameRecord(state, record, originalPath);
      continue;
    }

    applySimpleRecord(state, record, kind);
  }

  return {
    headOid: state.headOid,
    branch: state.branch,
    detached: state.detached,
    upstream: state.upstream,
    ahead: state.ahead,
    behind: state.behind,
    entries: state.entries,
    conflictedPaths: state.conflictedPaths,
    stagedCount: state.stagedCount,
    unstagedCount: state.unstagedCount,
    untrackedCount: state.untrackedCount,
  };
}

/**
 * Splits status output into records.
 *
 * The canonical invocation uses NUL record separators. A newline split is kept as a defensive
 * fallback so a recorded fixture without NUL still parses.
 *
 * @param stdout - Captured status output.
 * @returns Records without their separator.
 */
function splitRecords(stdout: string): string[] {
  if (stdout.includes("\0")) {
    return stdout.split("\0").map(stripLeadingNewlines);
  }

  return stdout.split("\n");
}

/**
 * Removes leading newline characters that can precede a record.
 *
 * @param record - Raw record.
 * @returns The record without leading newlines.
 */
function stripLeadingNewlines(record: string): string {
  return record.replace(/^\n+/, "");
}

/**
 * Reads the entry kind encoded by the record prefix.
 *
 * @param record - Raw status record.
 * @returns The record kind, or null for an unknown prefix.
 */
function readRecordKind(record: string): StatusEntryKind | null {
  if (record.length < 2 || record[1] !== " ") {
    return null;
  }

  switch (record[0]) {
    case "1":
      return "ordinary";
    case "2":
      return "renamed";
    case "u":
      return "unmerged";
    case "?":
      return "untracked";
    case "!":
      return "ignored";
    default:
      return null;
  }
}

/**
 * Applies one `# branch.*` header line to the accumulator.
 *
 * @param state - Mutable parse accumulator.
 * @param record - Header line including the `# ` prefix.
 */
function applyBranchHeader(state: MutableStatus, record: string): void {
  const [key, ...rest] = record.slice(2).split(" ");
  const value = rest.join(" ").trim();

  if (key === "branch.oid") {
    state.headOid = value === "(initial)" || value.length === 0 ? null : value;

    return;
  }

  if (key === "branch.head") {
    state.detached = value === "(detached)";
    state.branch = state.detached || value.length === 0 ? null : value;

    return;
  }

  applyBranchTrackingHeader(state, key, rest);
}

/**
 * Applies an upstream or ahead/behind header line.
 *
 * @param state - Mutable parse accumulator.
 * @param key - Header key.
 * @param values - Split header values.
 */
function applyBranchTrackingHeader(
  state: MutableStatus,
  key: string | undefined,
  values: readonly string[],
): void {
  if (key === "branch.upstream") {
    const upstream = values.join(" ").trim();
    state.upstream = upstream.length === 0 ? null : upstream;

    return;
  }

  if (key === "branch.ab") {
    applyAheadBehind(state, values);
  }
}

/**
 * Parses the `+N -M` ahead and behind header values.
 *
 * @param state - Mutable parse accumulator.
 * @param values - Split header values.
 */
function applyAheadBehind(state: MutableStatus, values: readonly string[]): void {
  for (const value of values) {
    const count = Number.parseInt(value.slice(1), 10);

    if (!Number.isFinite(count)) {
      continue;
    }

    if (value.startsWith("+")) {
      state.ahead = count;
    } else if (value.startsWith("-")) {
      state.behind = count;
    }
  }
}

/**
 * Applies an ordinary, unmerged, untracked, or ignored record.
 *
 * @param state - Mutable parse accumulator.
 * @param record - Raw status record.
 * @param kind - Record kind.
 */
function applySimpleRecord(state: MutableStatus, record: string, kind: StatusEntryKind): void {
  if (kind === "untracked" || kind === "ignored") {
    applyUnversionedRecord(state, record, kind);

    return;
  }

  const fieldCount = kind === "unmerged" ? UNMERGED_METADATA_FIELDS : ORDINARY_METADATA_FIELDS;
  const parsed = takeFields(record.slice(2), fieldCount);

  if (parsed === null || parsed.rest.length === 0) {
    return;
  }

  const status = parsed.fields[0] ?? "..";
  const entry =
    kind === "unmerged"
      ? createConflictEntry(parsed.rest)
      : createOrdinaryEntry(parsed.rest, status);

  state.entries.push(entry);
  countEntry(state, entry);
}

/**
 * Applies an untracked or ignored record.
 *
 * @param state - Mutable parse accumulator.
 * @param record - Raw status record.
 * @param kind - Untracked or ignored kind.
 */
function applyUnversionedRecord(
  state: MutableStatus,
  record: string,
  kind: "untracked" | "ignored",
): void {
  const path = record.slice(2);

  if (path.length === 0) {
    return;
  }

  state.entries.push({
    path,
    originalPath: null,
    kind,
    index: "unmodified",
    worktree: kind === "untracked" ? "untracked" : "ignored",
  });

  if (kind === "untracked") {
    state.untrackedCount += 1;
  }
}

/**
 * Applies a rename or copy record and its original-path companion.
 *
 * @param state - Mutable parse accumulator.
 * @param record - Raw rename or copy record.
 * @param originalPath - Original path from the following record.
 */
function applyRenameRecord(
  state: MutableStatus,
  record: string,
  originalPath: string | null,
): void {
  const parsed = takeFields(record.slice(2), RENAME_METADATA_FIELDS);

  if (parsed === null || parsed.rest.length === 0) {
    return;
  }

  const status = parsed.fields[0] ?? "..";
  const entry: StatusEntry = {
    path: parsed.rest,
    originalPath,
    kind: status[0] === "C" ? "copied" : "renamed",
    index: toChangeKind(status[0]),
    worktree: toChangeKind(status[1]),
  };

  state.entries.push(entry);
  countEntry(state, entry);
}

/**
 * Builds an ordinary working-tree entry.
 *
 * @param path - Root-relative path.
 * @param status - Two-character `XY` status.
 * @returns The parsed entry.
 */
function createOrdinaryEntry(path: string, status: string): StatusEntry {
  return {
    path,
    originalPath: null,
    kind: "ordinary",
    index: toChangeKind(status[0]),
    worktree: toChangeKind(status[1]),
  };
}

/**
 * Builds a conflicted entry from an unmerged record.
 *
 * @param path - Root-relative path.
 * @returns The conflicted entry.
 */
function createConflictEntry(path: string): StatusEntry {
  return {
    path,
    originalPath: null,
    kind: "unmerged",
    index: "conflicted",
    worktree: "conflicted",
  };
}

/**
 * Updates the staged, unstaged, untracked, and conflict accumulators for one entry.
 *
 * @param state - Mutable parse accumulator.
 * @param entry - Parsed entry.
 */
function countEntry(state: MutableStatus, entry: StatusEntry): void {
  if (entry.index === "conflicted" || entry.worktree === "conflicted") {
    state.conflictedPaths.push(entry.path);

    return;
  }

  if (entry.index !== "unmodified") {
    state.stagedCount += 1;
  }

  if (entry.worktree !== "unmodified") {
    state.unstagedCount += 1;
  }
}

/**
 * Splits a record into a fixed number of metadata fields and the remaining path.
 *
 * Splitting only on the first N spaces keeps paths with spaces, newlines, and leading dashes
 * intact.
 *
 * @param record - Record after its type prefix.
 * @param fieldCount - Number of metadata fields before the path.
 * @returns The fields and the path, or null when the record is too short.
 */
function takeFields(record: string, fieldCount: number): { fields: string[]; rest: string } | null {
  const fields: string[] = [];
  let rest = record;

  for (let index = 0; index < fieldCount; index += 1) {
    const separator = rest.indexOf(" ");

    if (separator < 0) {
      return null;
    }

    fields.push(rest.slice(0, separator));
    rest = rest.slice(separator + 1);
  }

  return { fields, rest };
}

/**
 * Maps one `XY` status character to a change kind.
 *
 * @param character - Index or working-tree status character.
 * @returns The matching change kind, or `unmodified` for `.` and unknown characters.
 */
function toChangeKind(character: string | undefined): FileChangeKind {
  switch (character) {
    case "M":
      return "modified";
    case "A":
      return "added";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    case "C":
      return "copied";
    case "T":
      return "type-changed";
    case "U":
      return "conflicted";
    default:
      return "unmodified";
  }
}
