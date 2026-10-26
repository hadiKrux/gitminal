import { useCallback, useMemo } from "react";
import {
  COMMAND_TARGET_DIFF_CURSOR_SEPARATOR,
  COMMAND_TARGET_READONLY_DIFF_CURSOR_PREFIX,
} from "@/app/hooks/useCommandTargets.constants";
import type {
  CommandTargetHandle,
  CommandTargetInput,
  CommandTargetSources,
} from "@/app/hooks/useCommandTargets.types";
import { useFocusState } from "@/app/hooks/useFocusState";
import { useRepository } from "@/app/hooks/useRepository";
import type {
  CommandDescriptor,
  CommandRegion,
  CommandTarget,
  CommandTargetKind,
} from "@/domain/commands/commands.types";
import type { DiffSection } from "@/domain/diff/diff.types";
import type { RemoteBranchRecord } from "@/domain/git/git.types";
import { selectDiffSections } from "@/domain/repository/repository.selectors";

/** Every diff section name, used to validate a parsed cursor identity. */
const DIFF_SECTIONS: ReadonlySet<string> = new Set<DiffSection>(["working", "staged", "untracked"]);

/** Reads the target one descriptor target kind resolves from. */
type CommandTargetReader = (input: CommandTargetInput) => CommandTarget;

/** Compares two targets of the same kind. */
type CommandTargetComparator = (left: CommandTarget, right: CommandTarget) => boolean;

/**
 * Target readers by descriptor target kind.
 *
 * The table is exhaustive over `CommandTargetKind`, so adding a target kind without a reader is a
 * type error instead of a silently disabled command.
 */
const TARGET_READERS: Readonly<Record<CommandTargetKind, CommandTargetReader>> = Object.freeze({
  branch: readBranchTarget,
  remoteBranch: readRemoteBranchTarget,
  tag: readTagTarget,
  stash: readStashTarget,
  worktree: readWorktreeTarget,
  commit: readCommitTarget,
  pending: readPendingTarget,
  diffFile: readDiffFileTarget,
  form: readNoTarget,
  none: readNoTarget,
});

/**
 * Target comparators by kind.
 *
 * Each entry compares only the fields that identify its kind, so an absent optional field never
 * creates a false mismatch. The table is exhaustive over `CommandTargetKind`, so a new target kind
 * has to state how it compares before the module compiles.
 */
const TARGET_COMPARATORS: Readonly<Record<CommandTargetKind, CommandTargetComparator>> =
  Object.freeze({
    branch: (left, right) =>
      left.kind === "branch" && right.kind === "branch" && left.name === right.name,
    remoteBranch: (left, right) =>
      left.kind === "remoteBranch" &&
      right.kind === "remoteBranch" &&
      left.remote === right.remote &&
      left.branch === right.branch,
    tag: (left, right) =>
      left.kind === "tag" &&
      right.kind === "tag" &&
      left.name === right.name &&
      left.remote === right.remote,
    stash: (left, right) =>
      left.kind === "stash" && right.kind === "stash" && left.objectName === right.objectName,
    worktree: (left, right) =>
      left.kind === "worktree" && right.kind === "worktree" && left.path === right.path,
    commit: (left, right) =>
      left.kind === "commit" && right.kind === "commit" && left.oid === right.oid,
    pending: (left, right) => left.kind === "pending" && right.kind === "pending",
    diffFile: (left, right) =>
      left.kind === "diffFile" &&
      right.kind === "diffFile" &&
      left.section === right.section &&
      left.path === right.path &&
      left.oldPath === right.oldPath,
    form: (left, right) =>
      left.kind === "form" && right.kind === "form" && left.formId === right.formId,
    none: (left, right) => left.kind === "none" && right.kind === "none",
  });

/**
 * Reads the shared command target derivations both discovery surfaces use.
 *
 * The palette captures a target when it opens and re-derives it on activation; help derives a target
 * for every action so it can join live availability. Both read the same repository projections and
 * the same focus cursors through this hook, so a command is described identically in both surfaces.
 * The returned functions read the providers when they are called, so a target is never a snapshot of
 * mount-time state.
 *
 * @returns The target derivation and comparison operations.
 * @throws When called outside a `RepositoryProvider` or a `FocusProvider`.
 */
export function useCommandTargets(): CommandTargetHandle {
  const repository = useRepository();
  const focus = useFocusState();
  const sources = useMemo<CommandTargetSources>(
    () => ({
      snapshot: repository.snapshot,
      signals: repository.signals,
      selection: repository.selection,
      getCursor: focus.getCursor,
    }),
    [focus.getCursor, repository.selection, repository.signals, repository.snapshot],
  );
  const deriveTarget = useCallback(
    (descriptor: CommandDescriptor): CommandTarget => {
      return deriveCommandTarget({ ...sources, descriptor });
    },
    [sources],
  );

  return useMemo(
    () => ({ deriveTarget, readOwningRegion, areCommandTargetsEqual }),
    [deriveTarget],
  );
}

/**
 * Derives the explicit target a command would dispatch.
 *
 * The descriptor's target kind decides the source. A branch-scoped remote command targets the
 * current branch, while a branch panel command targets the branches cursor. Commit and pending
 * targets come from the right-pane selection, a diff file from the diff cursor, and tag, stash, and
 * worktree targets from their own region cursors. A missing source yields the `none` target, which
 * the availability check reports as a missing target instead of guessing an ambient value.
 *
 * @param input - Command descriptor plus the provider and focus projections.
 * @returns The explicit target for the command.
 */
function deriveCommandTarget(input: CommandTargetInput): CommandTarget {
  return TARGET_READERS[input.descriptor.targetKind](input);
}

/**
 * Reads the target for a descriptor that carries no derivable target.
 *
 * Form and targetless commands keep their input in the form values, so a dispatcher that reads a
 * target for them must find `none` instead of an ambient cursor value.
 *
 * @returns The `none` target.
 */
function readNoTarget(): CommandTarget {
  return { kind: "none" };
}

/**
 * Maps a command scope to the availability region a discovery surface evaluates it in.
 *
 * A global command is dispatched from an open overlay, so `overlay` is the context that asks for
 * its availability. Every region and overlay scope keeps its own value. The palette, help, and
 * footer call this one mapping, so the same command reports the same reason everywhere.
 *
 * @param scope - Command descriptor scope.
 * @returns The command region passed to `getAvailability`.
 */
export function readAvailabilityRegion(scope: CommandDescriptor["scope"]): CommandRegion {
  return scope === "global" ? "overlay" : scope;
}

/**
 * Resolves the owning region of a command scope.
 *
 * Global and overlay commands have no owning region, so a refusal cannot move focus to a surface.
 * Every other scope is a shell region id.
 *
 * @param scope - Command descriptor scope.
 * @returns The owning region, or null for a global or overlay command.
 */
function readOwningRegion(
  scope: CommandDescriptor["scope"],
): Exclude<CommandRegion, "overlay"> | null {
  if (scope === "global" || scope === "overlay") {
    return null;
  }

  return scope;
}

/**
 * Compares two explicit command targets by value.
 *
 * The palette captures one target at open time and derives another on activation, so identity
 * comparison would treat every capture as stale. The comparison is field based so an absent optional
 * field never creates a false mismatch.
 *
 * @param left - Captured target.
 * @param right - Freshly derived target.
 * @returns True when both targets name the same command target.
 */
function areCommandTargetsEqual(left: CommandTarget, right: CommandTarget): boolean {
  if (left.kind !== right.kind) {
    return false;
  }

  return TARGET_COMPARATORS[left.kind](left, right);
}

/**
 * Reads a branch target.
 *
 * A branches-panel command uses the branches cursor. Every other branch command is a remote command
 * that operates on the checked-out branch, so the current branch is its explicit target.
 *
 * @param descriptor - Command descriptor.
 * @param sources - Repository and cursor projections.
 * @returns The branch target, or `none` when no branch is known.
 */
function readBranchTarget(input: CommandTargetInput): CommandTarget {
  const { descriptor, getCursor, signals, snapshot } = input;
  const name =
    descriptor.scope === "branches" ? getCursor("branches") : (snapshot?.branch ?? signals.branch);

  return name === null || name === undefined || name.length === 0
    ? { kind: "none" }
    : { kind: "branch", name };
}

/**
 * Reads a remote-branch target from the remotes cursor.
 *
 * The cursor identity is `<remote>/<branch>`, but a legal remote name may contain a slash, so the
 * record is resolved through the snapshot instead of splitting the string.
 *
 * @param sources - Repository and cursor projections.
 * @returns The remote-branch target, or `none` when the cursor names no known ref.
 */
function readRemoteBranchTarget(sources: CommandTargetSources): CommandTarget {
  const cursor = sources.getCursor("remotes");
  const record = readRemoteBranchRecord(sources, cursor);

  if (record === null) {
    return { kind: "none" };
  }

  return { kind: "remoteBranch", remote: record.remote, branch: record.branch };
}

/**
 * Finds the remote-tracking branch a remotes cursor identity names.
 *
 * @param sources - Repository and cursor projections.
 * @param cursor - Remotes cursor identity, or null.
 * @returns The matching record, or null when none matches.
 */
function readRemoteBranchRecord(
  sources: CommandTargetSources,
  cursor: string | null,
): RemoteBranchRecord | null {
  if (cursor === null) {
    return null;
  }

  return (
    sources.snapshot?.remoteBranches.find(
      (record) => `${record.remote}/${record.branch}` === cursor,
    ) ?? null
  );
}

/**
 * Reads a tag target from the tags cursor.
 *
 * @param sources - Repository and cursor projections.
 * @returns The tag target, or `none` when the tags cursor is empty.
 */
function readTagTarget(sources: CommandTargetSources): CommandTarget {
  const name = sources.getCursor("tags");

  return name === null || name.length === 0 ? { kind: "none" } : { kind: "tag", name };
}

/**
 * Reads a stash target from the stashes cursor.
 *
 * The target carries the immutable object name, never the renumbered display selector.
 *
 * @param sources - Repository and cursor projections.
 * @returns The stash target, or `none` when the stashes cursor is empty.
 */
function readStashTarget(sources: CommandTargetSources): CommandTarget {
  const objectName = sources.getCursor("stashes");

  return objectName === null || objectName.length === 0
    ? { kind: "none" }
    : { kind: "stash", objectName };
}

/**
 * Reads a worktree target from the worktrees cursor.
 *
 * @param sources - Repository and cursor projections.
 * @returns The worktree target, or `none` when the worktrees cursor is empty.
 */
function readWorktreeTarget(sources: CommandTargetSources): CommandTarget {
  const path = sources.getCursor("worktrees");

  return path === null || path.length === 0 ? { kind: "none" } : { kind: "worktree", path };
}

/**
 * Reads a commit target from the right-pane selection.
 *
 * A commit target requires a selected commit. A pending row has no commit identity, so a
 * commit-scoped command is disabled rather than aimed at the pending selection.
 *
 * @param sources - Repository and cursor projections.
 * @returns The commit target, or `none` when no commit is selected.
 */
function readCommitTarget(sources: CommandTargetSources): CommandTarget {
  const selection = sources.selection;

  return selection.kind === "commit" ? { kind: "commit", oid: selection.oid } : { kind: "none" };
}

/**
 * Reads a pending target from the right-pane selection.
 *
 * @param sources - Repository and cursor projections.
 * @returns The pending target, or `none` when the pending row is not selected.
 */
function readPendingTarget(sources: CommandTargetSources): CommandTarget {
  return sources.selection.kind === "pending" ? { kind: "pending" } : { kind: "none" };
}

/**
 * Reads a diff-file target from the diff cursor.
 *
 * A pending row is resolved through `selectDiffSections`, so a rename keeps its pre-change path. A
 * read-only row is not part of the pending sections, so its documented `readonly::<path>` identity
 * maps to the staged section; every diff mutation is refused as read-only in that mode anyway.
 *
 * @param sources - Repository and cursor projections.
 * @returns The diff-file target, or `none` when the cursor names no file.
 */
function readDiffFileTarget(sources: CommandTargetSources): CommandTarget {
  const cursor = sources.getCursor("diff");

  if (cursor === null) {
    return { kind: "none" };
  }

  const pending = readPendingDiffTarget(sources, cursor);

  if (pending !== null) {
    return pending;
  }

  return readReadOnlyDiffTarget(cursor);
}

/**
 * Finds a pending diff row by its stable cursor identity.
 *
 * @param sources - Repository and cursor projections.
 * @param cursor - Diff cursor identity.
 * @returns The diff-file target, or null when no pending row matches.
 */
function readPendingDiffTarget(
  sources: CommandTargetSources,
  cursor: string,
): CommandTarget | null {
  for (const section of selectDiffSections(sources.snapshot)) {
    const file = section.files.find((candidate) => candidate.id === cursor);

    if (file !== undefined) {
      return {
        kind: "diffFile",
        section: file.section,
        path: file.path,
        ...(file.oldPath === null ? {} : { oldPath: file.oldPath }),
      };
    }
  }

  return null;
}

/**
 * Maps a read-only diff cursor identity to its staged target.
 *
 * @param cursor - Diff cursor identity.
 * @returns The diff-file target, or `none` when the cursor is not a read-only row.
 */
function readReadOnlyDiffTarget(cursor: string): CommandTarget {
  if (!cursor.startsWith(COMMAND_TARGET_READONLY_DIFF_CURSOR_PREFIX)) {
    return readParsedDiffTarget(cursor);
  }

  const path = cursor.slice(COMMAND_TARGET_READONLY_DIFF_CURSOR_PREFIX.length);

  return path.length === 0 ? { kind: "none" } : { kind: "diffFile", section: "staged", path };
}

/**
 * Parses a `<section>::<path>` diff cursor identity.
 *
 * This is the fallback for a cursor whose row is no longer in the snapshot, so activation detects a
 * stale target instead of silently treating the command as if it had no target at all.
 *
 * @param cursor - Diff cursor identity.
 * @returns The parsed target, or `none` when the identity is not a diff row.
 */
function readParsedDiffTarget(cursor: string): CommandTarget {
  const separator = cursor.indexOf(COMMAND_TARGET_DIFF_CURSOR_SEPARATOR);

  if (separator <= 0) {
    return { kind: "none" };
  }

  const section = cursor.slice(0, separator);
  const path = cursor.slice(separator + COMMAND_TARGET_DIFF_CURSOR_SEPARATOR.length);

  if (!DIFF_SECTIONS.has(section) || path.length === 0) {
    return { kind: "none" };
  }

  return { kind: "diffFile", section: section as DiffSection, path };
}
