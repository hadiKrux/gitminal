import type { DiffChangedFile } from "@/domain/diff/diff.types";
import type { GitFailure, GitReadOptions } from "./git.types";

/** Inputs for reading the diff of one stash. */
export interface StashDiffReadOptions extends GitReadOptions {
  /** Selector that currently holds the stash, such as `stash@{0}`. */
  readonly stashRef: string;
  /** Context lines requested from git. */
  readonly contextLines: number;
}

/** Result of one whole-patch read, before parsing. */
export interface WholePatchRead {
  /** True when git exited cleanly and the output was complete. */
  readonly ok: boolean;
  /** Captured patch text, empty unless `ok` is true. */
  readonly text: string;
  /** True when the output exceeded the client limit and lost its middle. */
  readonly truncated: boolean;
  /** Classified failure, or null when `ok` is true. */
  readonly failure: GitFailure | null;
}

/** Result of one changed-file list read. */
export interface ChangedFileListRead {
  /** True when the list was read completely. */
  readonly ok: boolean;
  /** Changed files in git order. */
  readonly files: readonly DiffChangedFile[];
  /** Classified failure, or null when `ok` is true. */
  readonly failure: GitFailure | null;
}
