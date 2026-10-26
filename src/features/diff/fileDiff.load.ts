import { collapseFileDiff } from "@/domain/diff/diff.collapse";
import { applyFileDiffLimits, isDiffOversized } from "@/domain/diff/diff.limits";
import type {
  DiffFileRequest,
  DiffLimitResult,
  DiffLoadState,
  FileDiff,
  FileDiffLimitResult,
} from "@/domain/diff/diff.types";
import {
  probeBinary,
  probeSize,
  readConflictDiff,
  readStagedDiff,
  readUntrackedContent,
  readWorkingDiff,
} from "@/domain/git/git.diff";
import { readCommitDiff, readStashDiff } from "@/domain/git/git.diff.read-only";
import type { GitClient } from "@/domain/git/git.types";
import type { RepositorySelection } from "@/domain/repository/repository.types";
import type { ReadOnlyDiffState, ReadOnlyTarget } from "./fileDiff.types";

/**
 * Reads the key of one lazily cached file diff.
 *
 * @param request - Section, path, and pre-rename path.
 * @returns The cache key.
 */
export function readCacheKey(request: DiffFileRequest): string {
  return `${request.section}::${request.path}::${request.oldPath ?? ""}`;
}

/**
 * Resolves the read-only target of a selection.
 *
 * @param selection - Right-pane selection.
 * @param stashSelector - Current selector for a stash selection, or null.
 * @returns The read target, or null outside read-only mode.
 */
export function readReadOnlyTarget(
  selection: RepositorySelection,
  stashSelector: string | null,
): ReadOnlyTarget | null {
  if (selection.kind === "commit") {
    return { kind: "commit", key: `commit::${selection.oid}`, oid: selection.oid };
  }

  if (selection.kind === "stash") {
    return { kind: "stash", key: `stash::${selection.objectName}`, selector: stashSelector };
  }

  return null;
}

/**
 * Loads one file diff through the probes, the section read, and the limits.
 *
 * @param input - Client, root, context lines, generation, request, and signal.
 * @returns The settled cache entry.
 */
export async function loadFile(input: {
  readonly client: GitClient;
  readonly cwd: string;
  readonly contextLines: number;
  readonly generation: number;
  readonly request: DiffFileRequest;
  readonly conflicted: boolean;
  readonly signal: AbortSignal;
}): Promise<DiffLoadState> {
  const { client, conflicted, contextLines, cwd, generation, request, signal } = input;
  const size = await probeSize(client, {
    cwd,
    signal,
    path: request.path,
    section: request.section,
  });

  if (!size.ok) {
    return failedEntry(
      generation,
      request,
      size.failure?.message ?? "could not read the file size",
    );
  }

  if (isDiffOversized(size.sizeBytes)) {
    return {
      ...emptyEntry(generation, request),
      status: "oversized",
      sizeBytes: size.sizeBytes,
    };
  }

  const binary = await probeBinary(client, {
    cwd,
    signal,
    path: request.path,
    section: request.section,
  });

  if (!binary.ok) {
    return failedEntry(generation, request, binary.failure?.message ?? "could not probe the file");
  }

  if (binary.binary) {
    return { ...emptyEntry(generation, request), status: "binary", sizeBytes: size.sizeBytes };
  }

  const read = await readSectionDiff({
    client,
    conflicted,
    contextLines,
    cwd,
    request,
    signal,
  });

  if (!read.ok) {
    return failedEntry(generation, request, read.failure?.message ?? "could not read the diff");
  }

  return loadedEntry(generation, request, read.file, contextLines, size.sizeBytes);
}

/**
 * Reads one file's patch for its section.
 *
 * @param input - Client, conflicted flag, context lines, root, request, and signal.
 * @returns The parsed file or the classified failure.
 */
async function readSectionDiff(input: {
  readonly client: GitClient;
  readonly conflicted: boolean;
  readonly contextLines: number;
  readonly cwd: string;
  readonly request: DiffFileRequest;
  readonly signal: AbortSignal;
}) {
  const { client, conflicted, contextLines, cwd, request, signal } = input;

  if (conflicted) {
    return await readConflictDiff(client, {
      cwd,
      signal,
      path: request.path,
      contextLines: 0,
    });
  }

  if (request.section === "untracked") {
    return await readUntrackedContent(client, {
      cwd,
      signal,
      path: request.path,
      contextLines,
    });
  }

  return request.section === "staged"
    ? await readStagedDiff(client, {
        cwd,
        signal,
        path: request.path,
        oldPath: request.oldPath,
        contextLines,
      })
    : await readWorkingDiff(client, {
        cwd,
        signal,
        path: request.path,
        oldPath: request.oldPath,
        contextLines,
      });
}

/**
 * Loads the whole diff of one commit or stash.
 *
 * @param input - Client, root, context lines, generation, signal, and resolved target.
 * @returns The read-only list state.
 */
export async function loadReadOnlyDiff(input: {
  readonly client: GitClient;
  readonly cwd: string;
  readonly contextLines: number;
  readonly generation: number;
  readonly signal: AbortSignal;
  readonly target: ReadOnlyTarget;
}): Promise<ReadOnlyDiffState> {
  const { client, contextLines, cwd, generation, signal, target } = input;

  if (target.kind === "stash" && target.selector === null) {
    return {
      key: target.key,
      status: "error",
      files: [],
      message: "Stash no longer exists",
    };
  }

  const read =
    target.kind === "commit"
      ? await readCommitDiff(client, { cwd, signal, sha: target.oid, contextLines })
      : await readStashDiff(client, {
          cwd,
          signal,
          stashRef: target.selector ?? "",
          contextLines,
        });

  if (!read.ok) {
    return {
      key: target.key,
      status: "error",
      files: [],
      message: read.failure?.message ?? "could not read the diff",
    };
  }

  return {
    key: target.key,
    status: "loaded",
    files: read.files.map((file) => readOnlyEntry(generation, file, contextLines)),
    message: null,
  };
}

/**
 * Builds the cache entry for one file of a read-only patch.
 *
 * @param generation - Repository generation.
 * @param file - Parsed file.
 * @param contextLines - Configured context lines.
 * @returns The entry.
 */
function readOnlyEntry(generation: number, file: FileDiff, contextLines: number): DiffLoadState {
  const request: DiffFileRequest = {
    section: "staged",
    path: file.path,
    oldPath: file.oldPath,
  };

  if (file.binary) {
    return { ...emptyEntry(generation, request), status: "binary" };
  }

  const limited = applyFileDiffLimits(file);

  return {
    request,
    status: "loaded",
    generation,
    file: limited.file,
    segments: collapseFileDiff(limited.file, contextLines),
    limits: limited.truncated ? toLimitResult(limited) : null,
    message: null,
    sizeBytes: null,
  };
}

/**
 * Builds one loaded entry for a per-file read.
 *
 * @param generation - Repository generation.
 * @param request - Original request.
 * @param file - Parsed file, or null when the read reported no change.
 * @param contextLines - Configured context lines.
 * @param sizeBytes - Probed size, or null.
 * @returns The loaded entry.
 */
function loadedEntry(
  generation: number,
  request: DiffFileRequest,
  file: FileDiff | null,
  contextLines: number,
  sizeBytes: number | null,
): DiffLoadState {
  if (file === null) {
    return { ...emptyEntry(generation, request), status: "loaded", sizeBytes };
  }

  const limited = applyFileDiffLimits(file);

  return {
    request,
    status: "loaded",
    generation,
    file: limited.file,
    segments: collapseFileDiff(limited.file, contextLines),
    limits: limited.truncated ? toLimitResult(limited) : null,
    message: null,
    sizeBytes,
  };
}

/**
 * Builds the neutral entry shared by the non-text statuses.
 *
 * @param generation - Repository generation.
 * @param request - Original request.
 * @returns The blank entry.
 */
function emptyEntry(generation: number, request: DiffFileRequest): DiffLoadState {
  return {
    request,
    status: "idle",
    generation,
    file: null,
    segments: [],
    limits: null,
    message: null,
    sizeBytes: null,
  };
}

/**
 * Builds an error entry.
 *
 * @param generation - Repository generation.
 * @param request - Original request.
 * @param message - Failure text.
 * @returns The error entry.
 */
function failedEntry(generation: number, request: DiffFileRequest, message: string): DiffLoadState {
  return { ...emptyEntry(generation, request), status: "error", message };
}

/**
 * Projects a per-file limit result onto the render-facing limit shape.
 *
 * @param limited - Parsed limit result.
 * @returns The text and truncation metadata.
 */
function toLimitResult(limited: FileDiffLimitResult): DiffLimitResult {
  return {
    text: limited.file.raw,
    truncated: limited.truncated,
    totalLines: limited.totalLines,
    shownLines: limited.shownLines,
    totalBytes: limited.totalBytes,
    shownBytes: limited.shownBytes,
  };
}
