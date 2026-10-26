import type { GitFailure, GitInvocationResult, GitReadOptions } from "../git/git.types";

/** Line and byte caps applied to one parsed file diff. */
export interface DiffLimits {
  /** Maximum retained lines. */
  readonly maxLines: number;
  /** Maximum retained UTF-8 bytes. */
  readonly maxBytes: number;
}

/** Result of applying the caps to one diff. */
export interface DiffLimitResult {
  /** The retained unified diff, cut only at a hunk boundary. */
  readonly text: string;
  /** True when at least one hunk was dropped or the header alone exceeded a cap. */
  readonly truncated: boolean;
  /** Total lines in the original diff. */
  readonly totalLines: number;
  /** Lines retained in `text`. */
  readonly shownLines: number;
  /** UTF-8 bytes in the original diff. */
  readonly totalBytes: number;
  /** UTF-8 bytes retained in `text`. */
  readonly shownBytes: number;
}

/** Result of applying the caps to one parsed file diff. */
export interface FileDiffLimitResult {
  /** The retained file, with dropped hunks removed and `raw` re-serialized. */
  readonly file: FileDiff;
  /** True when at least one hunk was dropped or the header alone exceeded a cap. */
  readonly truncated: boolean;
  /** Total physical lines in the original patch, including header and hunk headers. */
  readonly totalLines: number;
  /** Physical lines retained in the serialized patch. */
  readonly shownLines: number;
  /** UTF-8 bytes in the original patch. */
  readonly totalBytes: number;
  /** UTF-8 bytes retained in the serialized patch. */
  readonly shownBytes: number;
}

/** Section of the diff panel a file belongs to. */
export type DiffSection = "working" | "staged" | "untracked";

/** Changed-file status shown next to a diff row. */
export type DiffFileStatus = "modified" | "added" | "deleted" | "renamed" | "copied" | "conflicted";

/**
 * Kind of one parsed diff line.
 *
 * `meta` covers every line that carries no old or new line number: the no-newline marker, rename
 * and mode headers, binary notices, and any tolerant fallback for an unrecognized hunk line.
 */
export type DiffLineKind = "context" | "add" | "remove" | "meta";

/** One parsed line of a unified diff. */
export interface DiffLine {
  /** Classification of the line. */
  readonly kind: DiffLineKind;
  /**
   * Full source line, including its ` `, `+`, or `-` prefix.
   *
   * Meta lines carry their raw text. Keeping the prefix makes re-serialization a plain join.
   */
  readonly text: string;
  /** Old-file line number, or null for an added or meta line. */
  readonly oldLine: number | null;
  /** New-file line number, or null for a removed or meta line. */
  readonly newLine: number | null;
}

/** One parsed hunk with its header range and numbered lines. */
export interface DiffHunk {
  /** Original `@@ -old,count +new,count @@` header line. */
  readonly header: string;
  /** First old-file line number as git reported it. */
  readonly oldStart: number;
  /** Number of old-file lines the hunk header declares. */
  readonly oldCount: number;
  /** First new-file line number as git reported it. */
  readonly newStart: number;
  /** Number of new-file lines the hunk header declares. */
  readonly newCount: number;
  /** Text after the closing `@@`, or null when the header has no section heading. */
  readonly heading: string | null;
  /** Hunk body lines in source order. */
  readonly lines: readonly DiffLine[];
}

/** One parsed file of a unified diff. */
export interface FileDiff {
  /** Current path, root-relative. */
  readonly path: string;
  /** Pre-rename path, or null when the file was not renamed or copied. */
  readonly oldPath: string | null;
  /** Changed-file status inferred from the headers. */
  readonly status: DiffFileStatus;
  /** Every line before the first hunk: `diff --git`, mode, index, rename, and `---`/`+++` lines. */
  readonly headerLines: readonly string[];
  /** Parsed hunks in source order. */
  readonly hunks: readonly DiffHunk[];
  /** True when git reported a binary file instead of hunks. */
  readonly binary: boolean;
  /** True when the only change is an `old mode`/`new mode` pair with no hunks. */
  readonly modeOnly: boolean;
  /** True when the patch was assembled from conflict markers. */
  readonly conflict: boolean;
  /** True when the patch carries a `\ No newline at end of file` marker. */
  readonly hasNoNewlineMarker: boolean;
  /** Exact patch text the file was parsed from. */
  readonly raw: string;
}

/** Start and count of one contiguous hunk region. */
export interface DiffHunkRange {
  /** First old-file line number of the region. */
  readonly oldStart: number;
  /** Number of old-file lines in the region. */
  readonly oldCount: number;
  /** First new-file line number of the region. */
  readonly newStart: number;
  /** Number of new-file lines in the region. */
  readonly newCount: number;
}

/**
 * One renderable region of a parsed diff.
 *
 * A `diff` segment is a complete, valid unified patch and is the only thing passed to `<diff>`. A
 * `collapsed` segment is a text marker for hidden unchanged lines and is never rendered as a patch.
 */
export type DiffSegment =
  | ({
      /** Renderable kept region. */
      readonly kind: "diff";
      /** Index of the hunk the segment belongs to. */
      readonly hunkIndex: number;
      /** Complete unified patch text for this region. */
      readonly text: string;
    } & DiffHunkRange)
  | {
      /** Marker for a hidden run of context lines. */
      readonly kind: "collapsed";
      /** Number of hidden lines. */
      readonly count: number;
      /** Old-file line number of the first hidden line. */
      readonly oldStart: number;
      /** New-file line number of the first hidden line. */
      readonly newStart: number;
    };

/** A current path and, for a rename or copy, its pre-change path. */
export interface DiffPathPair {
  /** Current path, root-relative. */
  readonly path: string;
  /** Pre-rename path, or null when the file was not renamed or copied. */
  readonly oldPath: string | null;
}

/** Inputs for reading the working, staged, or untracked diff of one file. */
export interface DiffReadOptions extends GitReadOptions {
  /** Current path, root-relative. */
  readonly path: string;
  /** Pre-rename path, passed to git so rename detection sees both sides. */
  readonly oldPath?: string | null;
  /** Context lines requested from git. */
  readonly contextLines: number;
}

/** Inputs for reading the diff of one commit. */
export interface CommitDiffReadOptions extends GitReadOptions {
  /** Commit id or rev the caller already resolved. */
  readonly sha: string;
  /** Context lines requested from git. */
  readonly contextLines: number;
}

/** Inputs for the binary and size probes of one file. */
export interface DiffProbeOptions extends GitReadOptions {
  /** Current path, root-relative. */
  readonly path: string;
  /** Section whose comparison the probe must read. */
  readonly section: DiffSection;
}

/** Raw unified diff text plus the classified failure, if any. */
export interface DiffTextReadResult {
  /** True when git exited cleanly, or with a documented difference-producing status. */
  readonly ok: boolean;
  /** Captured patch text, empty on failure. */
  readonly text: string;
  /** Classified failure, or null on success. */
  readonly failure: GitFailure | null;
}

/** Parsed diff for one file plus the classified failure, if any. */
export interface FileDiffReadResult {
  /** True when the patch was read and parsed. */
  readonly ok: boolean;
  /** Parsed file, or null when git reported no change. */
  readonly file: FileDiff | null;
  /** Classified failure, or null on success. */
  readonly failure: GitFailure | null;
}

/** Parsed diff for a multi-file patch such as a commit or stash read. */
export interface DiffFilesReadResult {
  /** True when the patch was read and parsed. */
  readonly ok: boolean;
  /** Parsed files in source order, empty when none changed. */
  readonly files: readonly FileDiff[];
  /** Classified failure, or null on success. */
  readonly failure: GitFailure | null;
}

/** One changed file reported by a commit or stash name-status read. */
export interface DiffChangedFile {
  /** Current path, root-relative. */
  readonly path: string;
  /** Pre-rename or pre-copy path, or null when the path did not change. */
  readonly oldPath: string | null;
  /** Changed-file status git reported. */
  readonly status: DiffFileStatus;
}

/** Result of the binary probe for one file. */
export interface DiffBinaryProbeResult {
  /** True when the probe produced a conclusive answer. */
  readonly ok: boolean;
  /** True when git reported the file as binary. */
  readonly binary: boolean;
  /** Classified failure, or null on success. */
  readonly failure: GitFailure | null;
}

/**
 * Result of the size probe for one file.
 *
 * `sizeBytes` is null when the size cannot be known: a staged path with no stage-0 blob, or a
 * working-tree path that no longer exists. Callers must treat an unknown size as "not known to be
 * oversized" and rely on the bounded read and `diff.limits.ts` instead of claiming the file is
 * small.
 */
export interface DiffSizeProbeResult {
  /** True when the probe produced an answer, including an unknown size. */
  readonly ok: boolean;
  /** Measured file size, or null when the size is unknown. */
  readonly sizeBytes: number | null;
  /** Classified failure, or null on success. */
  readonly failure: GitFailure | null;
}

/** Reason a file action was rejected before any git invocation. */
export type DiffFileActionReason = "no-paths" | "invalid-path";

/** Inputs for one file action. */
export interface DiffFileActionOptions extends GitReadOptions {
  /** Targets of the action; a rename carries both paths. */
  readonly targets: readonly DiffPathPair[];
}

/**
 * Result of one file action.
 *
 * `partial` reports a rename discard that restored the old path but left the new path in place
 * because a status read did not confirm it is untracked. `warnings` names each such path.
 */
export interface DiffFileActionResult {
  /** True when every requested git write succeeded. */
  readonly ok: boolean;
  /** Classified failure, or null on success or a rejected request. */
  readonly failure: GitFailure | null;
  /** Ordered git invocations the action made. */
  readonly steps: readonly GitInvocationResult[];
  /** True when a rename discard was only partially applied. */
  readonly partial: boolean;
  /** Human-readable notes for partial results. */
  readonly warnings: readonly string[];
  /** Machine-readable rejection reason, present only for a rejected request. */
  readonly reason: DiffFileActionReason | null;
}

/** Kind of a fatal diff parse error. */
export type DiffParseErrorKind =
  | "malformed-hunk-header"
  | "content-before-file-header"
  | "combined-diff-unsupported";

/** Typed fatal diff parse error. */
export interface DiffParseError {
  /** Error category. */
  readonly kind: DiffParseErrorKind;
  /** One-based source line number the error was found on. */
  readonly line: number;
  /** Human-readable description. */
  readonly message: string;
}

/** Kind of a non-fatal diff parse warning. */
export type DiffParseWarningKind = "unknown-hunk-line" | "hunk-count-mismatch";

/** Typed non-fatal diff parse warning. */
export interface DiffParseWarning {
  /** Warning category. */
  readonly kind: DiffParseWarningKind;
  /** One-based source line number the warning was found on. */
  readonly line: number;
  /** Human-readable description. */
  readonly message: string;
}

/** Facts the caller already knows and the patch headers may omit. */
export interface ParseDiffOptions {
  /** Current path from the status snapshot, used when the patch has no usable `+++` line. */
  readonly path?: string;
  /** Pre-rename path from the status snapshot. */
  readonly oldPath?: string | null;
  /** Status the caller already classified, for example `conflicted`. */
  readonly status?: DiffFileStatus;
}

/** Result of parsing a multi-file unified diff. */
export type DiffParseResult =
  | {
      readonly ok: true;
      readonly files: readonly FileDiff[];
      readonly warnings: readonly DiffParseWarning[];
    }
  | {
      readonly ok: false;
      readonly files: readonly FileDiff[];
      readonly error: DiffParseError;
      readonly warnings: readonly DiffParseWarning[];
    };

/** Result of parsing one file's unified diff. */
export type FileDiffParseResult =
  | {
      readonly ok: true;
      readonly file: FileDiff | null;
      readonly warnings: readonly DiffParseWarning[];
    }
  | {
      readonly ok: false;
      readonly file: FileDiff | null;
      readonly error: DiffParseError;
      readonly warnings: readonly DiffParseWarning[];
    };

/** Load status of one file diff in the panel cache. */
export type DiffLoadStatus = "idle" | "loading" | "loaded" | "binary" | "oversized" | "error";

/** Identity of a lazily loaded file diff. */
export interface DiffFileRequest {
  /** Section that owns the row. */
  readonly section: DiffSection;
  /** Current path, root-relative. */
  readonly path: string;
  /** Pre-rename path, or null. */
  readonly oldPath: string | null;
}

/**
 * One entry of the per-path diff cache.
 *
 * `generation` lets the loader discard a stale result: only the newest generation may replace an
 * entry.
 */
export interface DiffLoadState {
  /** Identity the entry was loaded for. */
  readonly request: DiffFileRequest;
  /** Current load status. */
  readonly status: DiffLoadStatus;
  /** Generation token captured when the load started. */
  readonly generation: number;
  /** Parsed file, present once loaded. */
  readonly file: FileDiff | null;
  /** Collapsed segments ready for rendering, present once loaded. */
  readonly segments: readonly DiffSegment[];
  /** Caps and truncation metadata, present once loaded. */
  readonly limits: DiffLimitResult | null;
  /** User-facing error or notice text, or null. */
  readonly message: string | null;
  /** Probed file size in bytes, or null when unknown. */
  readonly sizeBytes: number | null;
}
