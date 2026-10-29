import type { CommandAvailabilityReason } from "./commands.types";

/**
 * Display text for every availability reason.
 *
 * The strings are the shared wording for the footer, palette, help, buttons, and confirmations.
 * Top-bar reasons keep the product spec wording exactly, so a disabled Pull and the More menu
 * explain the same condition the same way.
 */
const REASON_TEXT: Readonly<Partial<Record<CommandAvailabilityReason, string>>> = Object.freeze({
  "missing-target": "Select an item first",
  "invalid-target": "The selected target is no longer valid",
  "unknown-remote": "The selected remote is not configured",
  "unsafe-fetch-refspec":
    "Fetch refused: configure remote fetch destinations under refs/remotes, not local branches",
  "cannot-delete-current-branch": "Cannot delete the current branch",
  "checked-out-in-worktree": "checked out in another worktree",
  "no-remote-branch": "no matching remote branch",
  "nothing-to-stash": "nothing to stash",
  "only-untracked-changes": "only untracked changes; include untracked files to stash",
  "nothing-to-commit": "nothing to commit",
  "message-required": "message required",
  "no-stash-selected": "no stash selected",
  "stash-changed-externally": "stash changed externally; list refreshed",
  "remote-tag-unknown": "remote tag state unknown; refresh to retry",
  "tag-already-on-remote": "tag exists on a remote",
  "tag-already-exists": "tag already exists",
  "current-worktree": "current worktree",
  "worktree-missing": "worktree no longer exists",
  "resolve-conflicts-first": "Resolve conflicts first",
  "merge-state": "Another operation is in progress",
  "read-only": "read-only",
  "no-files": "no files",
  "command-not-found": "Command not found",
  "not-a-mutation": "This command does not change the repository",
  "operation-in-progress": "operation in progress",
  "command-not-implemented": "This command is not implemented yet",
  "composer-hidden": "The commit composer is not visible",
  "not-a-repository": "Not a git repository",
  "bare-repository": "Bare repositories are not supported",
  "git-missing": "Git not found",
  "permission-error": "Permission denied",
  "no-commits-yet": "no commits yet",
  "detached-head": "detached HEAD",
  "no-remote": "no remote",
  "no-upstream": "no upstream; use Push to create it first.",
  "no-local-upstreams": "no local branches with upstreams",
  "no-current-upstream": "no upstream for the current branch",
  "upstream-gone": "upstream gone; push to recreate it",
  "merge-in-progress": "Merge in progress",
  "rebase-in-progress": "Rebase in progress",
  "cherry-pick-in-progress": "Cherry-pick in progress",
  "missing-git-identity": "Set user.name and user.email first",
  loading: "loading repository",
});

/**
 * Reads readable text for an availability reason.
 *
 * @param reason - Machine-readable reason.
 * @returns The documented display text, or the reason with its hyphens replaced by spaces.
 */
export function describeCommandReason(reason: CommandAvailabilityReason): string {
  return REASON_TEXT[reason] ?? reason.replace(/-/g, " ");
}
