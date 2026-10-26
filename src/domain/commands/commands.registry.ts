import type {
  CommandDescriptor,
  CommandKind,
  CommandRegion,
  CommandTargetKind,
} from "./commands.types";

/** Compact descriptor row used to build the catalogue without repeating field names. */
type DescriptorRow = readonly [
  id: string,
  kind: CommandKind,
  scope: CommandRegion | "global",
  targetKind: CommandTargetKind,
  category: CommandDescriptor["category"],
  label: string,
  description: string,
  needsInput: boolean,
];

/**
 * Single command catalogue.
 *
 * It names every command the repository-state gates, the remote executors, and the M5 top bar need
 * before the remaining feature panels land. Each row declares the command kind, the owning scope,
 * and the target kind, so availability and dispatch share one source of truth.
 */
const DESCRIPTOR_ROWS: readonly DescriptorRow[] = Object.freeze([
  ["app.refresh", "read", "global", "none", "app", "Refresh", "Reload repository state", false],
  ["remote.fetch", "mutation", "global", "none", "remote", "Fetch", "Fetch a remote", false],
  [
    "remote.fetchPrune",
    "mutation",
    "global",
    "none",
    "remote",
    "Fetch prune",
    "Fetch a remote and prune deleted refs",
    false,
  ],
  [
    "remote.pull",
    "mutation",
    "global",
    "branch",
    "remote",
    "Pull",
    "Pull the upstream branch",
    false,
  ],
  [
    "remote.push",
    "mutation",
    "global",
    "branch",
    "remote",
    "Push",
    "Push the current branch",
    false,
  ],
  [
    "remote.pushForceSafe",
    "mutation",
    "global",
    "branch",
    "remote",
    "Force push safely",
    "Push with --force-with-lease",
    false,
  ],
  [
    "remote.pushForceOverwrite",
    "mutation",
    "global",
    "branch",
    "remote",
    "Overwrite remote",
    "Push with --force",
    false,
  ],
  [
    "remote.pushNoVerify",
    "mutation",
    "global",
    "branch",
    "remote",
    "Push without hooks",
    "Push with --no-verify",
    false,
  ],
  ["remote.more", "navigation", "global", "none", "remote", "More", "Open remote actions", false],
  [
    "remote.createLocal",
    "mutation",
    "remotes",
    "remoteBranch",
    "remote",
    "Create local branch",
    "Create a local branch from a remote branch",
    true,
  ],
  [
    "graph.selectCommit",
    "navigation",
    "graph",
    "commit",
    "graph",
    "Select commit",
    "Show the selected commit",
    false,
  ],
  [
    "branch.create",
    "mutation",
    "branches",
    "none",
    "branch",
    "Create branch",
    "Create and check out a branch",
    true,
  ],
  [
    "branch.delete",
    "mutation",
    "branches",
    "branch",
    "branch",
    "Delete branch",
    "Delete the selected branch",
    false,
  ],
  [
    "branch.checkout",
    "mutation",
    "branches",
    "branch",
    "branch",
    "Checkout branch",
    "Check out the selected local branch",
    false,
  ],
  ["tag.create", "mutation", "tags", "none", "tag", "Create tag", "Create a tag", true],
  ["tag.push", "mutation", "tags", "tag", "tag", "Push tag", "Push the selected tag", false],
  ["tag.delete", "mutation", "tags", "tag", "tag", "Delete tag", "Delete the selected tag", false],
  ["stash.create", "mutation", "stashes", "none", "stash", "Create stash", "Stash changes", true],
  ["stash.apply", "mutation", "stashes", "stash", "stash", "Apply stash", "Apply a stash", false],
  [
    "stash.pop",
    "mutation",
    "stashes",
    "stash",
    "stash",
    "Pop stash",
    "Apply and drop a stash",
    false,
  ],
  ["stash.delete", "mutation", "stashes", "stash", "stash", "Drop stash", "Drop a stash", false],
  [
    "stash.select",
    "navigation",
    "stashes",
    "stash",
    "stash",
    "Select stash",
    "Show the selected stash",
    false,
  ],
  [
    "worktree.create",
    "mutation",
    "worktrees",
    "none",
    "worktree",
    "Create worktree",
    "Add a linked worktree",
    true,
  ],
  [
    "worktree.delete",
    "mutation",
    "worktrees",
    "worktree",
    "worktree",
    "Delete worktree",
    "Remove a linked worktree",
    false,
  ],
  [
    "worktree.select",
    "navigation",
    "worktrees",
    "worktree",
    "worktree",
    "Select worktree",
    "Show the selected worktree",
    false,
  ],
  ["commit.submit", "mutation", "right-pane", "none", "commit", "Commit", "Create a commit", false],
  [
    "commit.submitNoVerify",
    "mutation",
    "right-pane",
    "none",
    "commit",
    "Commit without hooks",
    "Create a commit with --no-verify",
    false,
  ],
  ["commit.amend", "mutation", "right-pane", "none", "commit", "Amend commit", "Amend HEAD", false],
  [
    "commit.amendNoVerify",
    "mutation",
    "right-pane",
    "none",
    "commit",
    "Amend without hooks",
    "Amend HEAD with --no-verify",
    false,
  ],
  ["diff.stage", "mutation", "diff", "diffFile", "diff", "Stage file", "Stage one file", false],
  [
    "diff.unstage",
    "mutation",
    "diff",
    "diffFile",
    "diff",
    "Unstage file",
    "Unstage one file",
    false,
  ],
  [
    "diff.discard",
    "mutation",
    "diff",
    "diffFile",
    "diff",
    "Discard changes",
    "Discard tracked changes in a file",
    false,
  ],
  [
    "diff.deleteUntracked",
    "mutation",
    "diff",
    "diffFile",
    "diff",
    "Delete untracked file",
    "Delete an untracked file",
    false,
  ],
  ["diff.stageAll", "mutation", "diff", "none", "diff", "Stage all", "Stage every change", false],
  [
    "diff.unstageAll",
    "mutation",
    "diff",
    "none",
    "diff",
    "Unstage all",
    "Unstage every change",
    false,
  ],
  [
    "diff.discardAll",
    "mutation",
    "diff",
    "none",
    "diff",
    "Discard all",
    "Discard every tracked change",
    false,
  ],
  [
    "diff.deleteAllUntracked",
    "mutation",
    "diff",
    "none",
    "diff",
    "Delete all untracked",
    "Delete every untracked file",
    false,
  ],
]);

/**
 * Internal selection commands that have no action id and no default key.
 *
 * They are palette-invocable command ids only: the owning panel dispatches them to set the
 * right-pane selection, so they must never expose an `actionId` a keybinding could bind.
 */
const INTERNAL_NAVIGATION_COMMANDS: ReadonlySet<string> = new Set([
  "graph.selectCommit",
  "stash.select",
  "worktree.select",
]);

/** Indexed command catalogue. */
const COMMAND_DESCRIPTORS: ReadonlyMap<string, CommandDescriptor> = new Map(
  DESCRIPTOR_ROWS.map((row) => {
    const descriptor = createDescriptor(row);

    return [descriptor.id, descriptor] as const;
  }),
);

/**
 * Builds a descriptor from one compact row.
 *
 * @param row - Descriptor row.
 * @returns The frozen descriptor.
 */
function createDescriptor(row: DescriptorRow): CommandDescriptor {
  const [id, kind, scope, targetKind, category, label, description, needsInput] = row;

  return Object.freeze({
    id,
    ...(INTERNAL_NAVIGATION_COMMANDS.has(id) ? {} : { actionId: id }),
    kind,
    scope,
    targetKind,
    label,
    description,
    keywords: Object.freeze(buildKeywords(id, label)),
    category,
    paletteInvocable: true,
    needsInput,
  });
}

/**
 * Derives palette keywords from a command id and label.
 *
 * @param id - Command id such as `remote.fetchPrune`.
 * @param label - Human-readable label.
 * @returns Search terms with the id parts and the label words.
 */
function buildKeywords(id: string, label: string): string[] {
  const idParts = id
    .split(".")
    .flatMap((part) => part.split(/(?=[A-Z])/))
    .map((part) => part.toLowerCase());
  const labelWords = label.toLowerCase().split(" ");

  return [...new Set([...idParts, ...labelWords])];
}

/**
 * Reads one command descriptor.
 *
 * @param commandId - Stable command id.
 * @returns The descriptor, or undefined when the command is not in the catalogue.
 */
export function getCommandDescriptor(commandId: string): CommandDescriptor | undefined {
  return COMMAND_DESCRIPTORS.get(commandId);
}

/**
 * Lists every command descriptor in catalogue order.
 *
 * The returned list is a frozen snapshot, so callers can iterate it for the palette, help, and
 * registry tests without gaining access to the mutable index.
 *
 * @returns The frozen descriptors in declaration order.
 */
export function listCommandDescriptors(): readonly CommandDescriptor[] {
  return Object.freeze([...COMMAND_DESCRIPTORS.values()]);
}
