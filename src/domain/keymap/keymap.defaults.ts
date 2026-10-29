import { parseBindingValues } from "./keymap.parse";
import type {
  ActionDefinition,
  KeymapContext,
  KeymapPlatform,
  ParsedBinding,
} from "./keymap.types";

/** Every focus context the resolver projects. */
export const KEYMAP_CONTEXTS: readonly KeymapContext[] = Object.freeze([
  "global",
  "top-bar",
  "branches",
  "remotes",
  "tags",
  "stashes",
  "worktrees",
  "graph",
  "right-pane",
  "diff",
  "console",
  "overlay",
]);

/** The hardcoded quit and cancel chord, which cannot be unbound. */
export const HARDCODED_QUIT_BINDING = "ctrl+c";

/** Actions that warn when configuration leaves them without any binding. */
export const REQUIRED_BINDING_ACTIONS: readonly ActionId[] = Object.freeze([
  "app.quit",
  "app.help",
  "app.palette",
]);

/** List contexts that support the shared navigation actions. */
const LIST_CONTEXTS: readonly KeymapContext[] = Object.freeze([
  "branches",
  "remotes",
  "tags",
  "stashes",
  "worktrees",
  "graph",
  "diff",
  "console",
  "overlay",
]);

/**
 * The action catalogue from product spec section 6.1.
 *
 * This is the only place action IDs and their built-in bindings are declared. Overrides are applied
 * on top of this catalogue by `keymap.resolve.ts`.
 */
export const ACTION_CATALOGUE = [
  {
    id: "app.quit",
    contexts: ["global"],
    defaults: ["q"],
    label: "Quit",
    category: "app",
    description: "Quit Gitminal; a running operation is cancelled first.",
  },
  {
    id: "app.help",
    contexts: ["global"],
    defaults: ["?", "f1"],
    label: "Help",
    category: "app",
    description: "Open help and the effective keybinding list.",
  },
  {
    id: "app.palette",
    contexts: ["global"],
    defaults: ["ctrl+p", "mod+p", "f2"],
    label: "Command palette",
    category: "app",
    description: "Open the command palette.",
  },
  {
    id: "app.console",
    contexts: ["global"],
    defaults: ["ctrl+`", "mod+`"],
    label: "Toggle console",
    category: "app",
    description: "Open or close the command console.",
  },
  {
    id: "app.refresh",
    contexts: ["global"],
    defaults: ["r"],
    label: "Refresh",
    category: "app",
    description: "Refresh the repository snapshot.",
  },
  {
    id: "app.reloadConfig",
    contexts: ["global"],
    defaults: [],
    label: "Reload configuration",
    category: "app",
    description: "Reload configuration, keybindings, and theme files.",
  },
  {
    id: "app.themePicker",
    contexts: ["global"],
    defaults: ["t"],
    label: "Theme picker",
    category: "app",
    description: "Open the theme picker.",
  },
  {
    id: "remote.pull",
    contexts: ["global"],
    defaults: ["p"],
    label: "Pull",
    category: "remote",
    description: "Pull the current branch upstream.",
  },
  {
    id: "remote.push",
    contexts: ["global"],
    defaults: ["P"],
    label: "Push",
    category: "remote",
    description: "Push the current branch.",
  },
  {
    id: "remote.pushForceSafe",
    contexts: ["global"],
    defaults: [],
    label: "Force push safely",
    category: "remote",
    description: "Force push with the safe force option.",
  },
  {
    id: "remote.pushForceOverwrite",
    contexts: ["global"],
    defaults: [],
    label: "Force push and overwrite",
    category: "remote",
    description: "Force push and overwrite the remote ref after confirmation.",
  },
  {
    id: "remote.pushNoVerify",
    contexts: ["global"],
    defaults: [],
    label: "Push without hooks",
    category: "remote",
    description: "Push while skipping pre-push hooks.",
  },
  {
    id: "remote.fetch",
    contexts: ["global"],
    defaults: ["f"],
    label: "Fetch",
    category: "remote",
    description: "Fetch configured branches from origin without pruning.",
  },
  {
    id: "remote.fetchPrune",
    contexts: ["global"],
    defaults: ["F"],
    label: "Fetch and prune",
    category: "remote",
    description: "Fetch and prune deleted remote refs.",
  },
  {
    id: "remote.more",
    contexts: ["global"],
    defaults: ["."],
    label: "More remote actions",
    category: "remote",
    description: "Open the more remote actions menu.",
  },
  {
    id: "commit.focus",
    contexts: ["global"],
    defaults: ["c"],
    label: "Focus commit composer",
    category: "commit",
    description: "Focus the commit message composer when it is visible.",
  },
  {
    id: "focus.next",
    contexts: ["global"],
    defaults: ["tab"],
    label: "Next region",
    category: "focus",
    description: "Move focus to the next region.",
  },
  {
    id: "focus.previous",
    contexts: ["global"],
    defaults: ["shift+tab"],
    label: "Previous region",
    category: "focus",
    description: "Move focus to the previous region.",
  },
  {
    id: "overlay.close",
    contexts: ["global"],
    defaults: ["esc"],
    label: "Close or cancel",
    category: "overlay",
    description: "Close the current overlay or cancel transient state.",
  },
  {
    id: "focus.region.topBar",
    contexts: ["global"],
    defaults: [],
    label: "Focus top bar",
    category: "focus",
    description: "Move focus to the top bar.",
  },
  {
    id: "focus.region.branches",
    contexts: ["global"],
    defaults: ["1"],
    label: "Focus branches",
    category: "focus",
    description: "Move focus to the branches panel.",
  },
  {
    id: "focus.region.remotes",
    contexts: ["global"],
    defaults: ["2"],
    label: "Focus remotes",
    category: "focus",
    description: "Move focus to the remotes panel.",
  },
  {
    id: "focus.region.tags",
    contexts: ["global"],
    defaults: ["3"],
    label: "Focus tags",
    category: "focus",
    description: "Move focus to the tags panel.",
  },
  {
    id: "focus.region.stashes",
    contexts: ["global"],
    defaults: ["4"],
    label: "Focus stashes",
    category: "focus",
    description: "Move focus to the stashes panel.",
  },
  {
    id: "focus.region.worktrees",
    contexts: ["global"],
    defaults: ["5"],
    label: "Focus worktrees",
    category: "focus",
    description: "Move focus to the worktrees panel.",
  },
  {
    id: "focus.region.graph",
    contexts: ["global"],
    defaults: ["6"],
    label: "Focus commit graph",
    category: "focus",
    description: "Move focus to the commit graph.",
  },
  {
    id: "focus.region.rightPane",
    contexts: ["global"],
    defaults: ["7"],
    label: "Focus right pane",
    category: "focus",
    description: "Move focus to the right pane.",
  },
  {
    id: "focus.region.diff",
    contexts: ["global"],
    defaults: ["8"],
    label: "Focus diffs",
    category: "focus",
    description: "Move focus to the diff panel.",
  },
  {
    id: "focus.region.console",
    contexts: ["global"],
    defaults: ["9"],
    label: "Focus console",
    category: "focus",
    description: "Open or focus the console.",
  },
  {
    id: "nav.up",
    contexts: [...LIST_CONTEXTS, "right-pane"],
    defaults: ["up", "k"],
    label: "Move up",
    category: "navigation",
    description: "Move the selection up.",
  },
  {
    id: "nav.down",
    contexts: [...LIST_CONTEXTS, "right-pane"],
    defaults: ["down", "j"],
    label: "Move down",
    category: "navigation",
    description: "Move the selection down.",
  },
  {
    id: "nav.pageUp",
    contexts: ["graph", "console", "overlay"],
    defaults: ["pageup"],
    label: "Page up",
    category: "navigation",
    description: "Move the selection up by one page.",
  },
  {
    id: "nav.pageDown",
    contexts: ["graph", "console", "overlay"],
    defaults: ["pagedown"],
    label: "Page down",
    category: "navigation",
    description: "Move the selection down by one page.",
  },
  {
    id: "nav.first",
    contexts: ["branches", "remotes", "graph", "console", "overlay"],
    defaults: ["g"],
    label: "Move to first",
    category: "navigation",
    description: "Move to the first item.",
  },
  {
    id: "nav.last",
    contexts: ["branches", "remotes", "graph", "console", "overlay"],
    defaults: ["G"],
    label: "Move to last",
    category: "navigation",
    description: "Move to the last loaded item.",
  },
  {
    id: "nav.activate",
    contexts: [
      "top-bar",
      "branches",
      "tags",
      "stashes",
      "worktrees",
      "graph",
      "right-pane",
      "console",
      "overlay",
    ],
    defaults: ["enter"],
    label: "Activate",
    category: "navigation",
    description: "Run the primary action for the focused item.",
  },
  {
    id: "nav.left",
    contexts: ["top-bar", "right-pane", "overlay"],
    defaults: ["left", "h"],
    label: "Move left",
    category: "navigation",
    description: "Move to the previous control.",
  },
  {
    id: "nav.right",
    contexts: ["top-bar", "right-pane", "overlay"],
    defaults: ["right", "l"],
    label: "Move right",
    category: "navigation",
    description: "Move to the next control.",
  },
  {
    id: "nav.expand",
    contexts: ["diff"],
    defaults: ["right", "l"],
    label: "Expand",
    category: "navigation",
    description: "Expand the selected section or file.",
  },
  {
    id: "nav.collapse",
    contexts: ["diff"],
    defaults: ["left", "h"],
    label: "Collapse",
    category: "navigation",
    description: "Collapse the selected section or file.",
  },
  {
    id: "list.filter",
    contexts: ["branches", "remotes", "tags", "stashes", "worktrees"],
    defaults: ["/"],
    label: "Search list",
    category: "list",
    description: "Open feature search, or focus the Branches inline filter.",
  },
  {
    id: "graph.search",
    contexts: ["graph"],
    defaults: ["/", "ctrl+f", "mod+f"],
    label: "Search commits",
    category: "graph",
    description: "Focus the commit graph search field.",
  },
  {
    id: "graph.loadOlder",
    contexts: ["graph"],
    defaults: ["L"],
    label: "Load older commits",
    category: "graph",
    description: "Load the next page of commit history.",
  },
  {
    id: "help.search",
    contexts: ["overlay"],
    defaults: ["/"],
    label: "Search help",
    category: "help",
    description: "Focus the help search field.",
  },
  {
    id: "branch.create",
    contexts: ["branches"],
    defaults: ["n"],
    label: "New branch",
    category: "branch",
    description: "Create a branch.",
  },
  {
    id: "branch.delete",
    contexts: ["branches"],
    defaults: ["d"],
    label: "Delete branch",
    category: "branch",
    description: "Delete the selected branch after confirmation.",
  },
  {
    id: "remote.createLocal",
    contexts: ["remotes"],
    defaults: ["space"],
    label: "Create local branch",
    category: "remote",
    description: "Create a local branch from the selected remote branch.",
  },
  {
    id: "tag.create",
    contexts: ["tags"],
    defaults: ["n"],
    label: "New tag",
    category: "tag",
    description: "Create a tag.",
  },
  {
    id: "tag.push",
    contexts: ["tags"],
    defaults: ["P"],
    label: "Push tag",
    category: "tag",
    description: "Push the selected tag.",
  },
  {
    id: "tag.delete",
    contexts: ["tags"],
    defaults: ["d"],
    label: "Delete tag",
    category: "tag",
    description: "Delete the selected tag after confirmation.",
  },
  {
    id: "stash.create",
    contexts: ["stashes"],
    defaults: ["s"],
    label: "Stash changes",
    category: "stash",
    description: "Stash working tree changes.",
  },
  {
    id: "stash.apply",
    contexts: ["stashes"],
    defaults: ["a"],
    label: "Apply stash",
    category: "stash",
    description: "Apply the selected stash without removing it.",
  },
  {
    id: "stash.pop",
    contexts: ["stashes"],
    defaults: ["p"],
    label: "Pop stash",
    category: "stash",
    description: "Apply and remove the selected stash after confirmation.",
  },
  {
    id: "stash.delete",
    contexts: ["stashes"],
    defaults: ["d"],
    label: "Delete stash",
    category: "stash",
    description: "Delete the selected stash after confirmation.",
  },
  {
    id: "worktree.create",
    contexts: ["worktrees"],
    defaults: ["n"],
    label: "New worktree",
    category: "worktree",
    description: "Create a worktree.",
  },
  {
    id: "worktree.delete",
    contexts: ["worktrees"],
    defaults: ["d"],
    label: "Delete worktree",
    category: "worktree",
    description: "Delete the selected worktree after confirmation.",
  },
  {
    id: "commit.submit",
    contexts: ["right-pane"],
    defaults: ["ctrl+s", "mod+s"],
    label: "Commit",
    category: "commit",
    description: "Commit the staged files.",
  },
  {
    id: "commit.submitNoVerify",
    contexts: ["right-pane"],
    defaults: [],
    label: "Commit without hooks",
    category: "commit",
    description: "Commit while skipping hooks after confirmation.",
  },
  {
    id: "commit.amend",
    contexts: ["right-pane"],
    defaults: [],
    label: "Amend commit",
    category: "commit",
    description: "Amend the previous commit.",
  },
  {
    id: "commit.amendNoVerify",
    contexts: ["right-pane"],
    defaults: [],
    label: "Amend without hooks",
    category: "commit",
    description: "Amend the previous commit while skipping hooks after confirmation.",
  },
  {
    id: "commit.options",
    contexts: ["right-pane"],
    defaults: [".", "alt+."],
    label: "Commit options",
    category: "commit",
    description: "Open the commit options menu.",
  },
  {
    id: "form.submit",
    contexts: ["overlay", "right-pane"],
    defaults: ["ctrl+enter", "mod+enter"],
    label: "Submit form",
    category: "form",
    description: "Submit the focused multiline form.",
  },
  {
    id: "diff.toggle",
    contexts: ["diff"],
    defaults: ["enter"],
    label: "Toggle file",
    category: "diff",
    description: "Expand or collapse the selected file.",
  },
  {
    id: "diff.stage",
    contexts: ["diff"],
    defaults: ["s"],
    label: "Stage file",
    category: "diff",
    description: "Stage the selected file.",
  },
  {
    id: "diff.unstage",
    contexts: ["diff"],
    defaults: ["u"],
    label: "Unstage file",
    category: "diff",
    description: "Unstage the selected file.",
  },
  {
    id: "diff.discard",
    contexts: ["diff"],
    defaults: ["d"],
    label: "Discard file changes",
    category: "diff",
    description: "Discard changes in the selected tracked file after confirmation.",
  },
  {
    id: "diff.deleteUntracked",
    contexts: ["diff"],
    defaults: [],
    label: "Delete untracked file",
    category: "diff",
    description: "Delete the selected untracked file after confirmation.",
  },
  {
    id: "diff.stageAll",
    contexts: ["diff"],
    defaults: ["S"],
    label: "Stage all",
    category: "diff",
    description: "Stage all files in the selected section.",
  },
  {
    id: "diff.stageAllUnstaged",
    contexts: ["global"],
    defaults: ["A"],
    label: "Stage all unstaged",
    category: "diff",
    description: "Stage every working-directory and untracked file from any region.",
  },
  {
    id: "diff.unstageAll",
    contexts: ["diff"],
    defaults: ["U"],
    label: "Unstage all",
    category: "diff",
    description: "Unstage all files in the current section.",
  },
  {
    id: "diff.discardAll",
    contexts: ["diff"],
    defaults: ["D"],
    label: "Discard all changes",
    category: "diff",
    description: "Discard changes in every tracked file in the current section after confirmation.",
  },
  {
    id: "diff.deleteAllUntracked",
    contexts: ["diff"],
    defaults: [],
    label: "Delete all untracked files",
    category: "diff",
    description: "Delete every untracked file in the current section after confirmation.",
  },
  {
    id: "diff.scrollDown",
    contexts: ["diff"],
    defaults: ["J"],
    label: "Scroll down",
    category: "diff",
    description: "Scroll the diff panel down by one line.",
  },
  {
    id: "diff.scrollUp",
    contexts: ["diff"],
    defaults: ["K"],
    label: "Scroll up",
    category: "diff",
    description: "Scroll the diff panel up by one line.",
  },
  {
    id: "diff.scrollFastDown",
    contexts: ["diff"],
    defaults: ["shift+down"],
    label: "Scroll down 5 lines",
    category: "diff",
    description: "Scroll the diff panel down by five lines.",
  },
  {
    id: "diff.scrollFastUp",
    contexts: ["diff"],
    defaults: ["shift+up"],
    label: "Scroll up 5 lines",
    category: "diff",
    description: "Scroll the diff panel up by five lines.",
  },
  {
    id: "diff.scrollLeft",
    contexts: ["diff"],
    defaults: ["H", "shift+left"],
    label: "Scroll left",
    category: "diff",
    description: "Scroll the diff panel left by eight columns.",
  },
  {
    id: "diff.scrollRight",
    contexts: ["diff"],
    defaults: ["L", "shift+right"],
    label: "Scroll right",
    category: "diff",
    description: "Scroll the diff panel right by eight columns.",
  },
  {
    id: "console.clear",
    contexts: ["console"],
    defaults: ["c"],
    label: "Clear console",
    category: "console",
    description: "Clear the console after confirmation.",
  },
] as const satisfies readonly ActionDefinition[];

// The catalogue is the process-wide source of truth shared by resolution, help, and the palette.
// Freeze each action, its context and default lists, and the catalogue itself so a consumer cannot
// mutate what every other consumer sees.
for (const action of ACTION_CATALOGUE) {
  Object.freeze(action.contexts);
  Object.freeze(action.defaults);
  Object.freeze(action);
}

Object.freeze(ACTION_CATALOGUE);

/** Every action ID in the catalogue. */
export type ActionId = (typeof ACTION_CATALOGUE)[number]["id"];

/** Action definitions keyed by their stable identifier. */
export const ACTION_BY_ID: Readonly<Record<ActionId, ActionDefinition>> = Object.freeze(
  Object.fromEntries(ACTION_CATALOGUE.map((action) => [action.id, action])) as Record<
    string,
    ActionDefinition
  >,
);

/**
 * Reports whether a value is an action ID in the catalogue.
 *
 * @param value - The candidate action ID.
 * @returns `true` when the value belongs to the catalogue.
 */
export function isActionId(value: string): value is ActionId {
  return Object.hasOwn(ACTION_BY_ID, value);
}

/**
 * Reads the parsed built-in bindings for one action.
 *
 * This is the single place that turns catalogue defaults into parsed bindings, so conflict
 * settlement and the resolution layers reset an action to exactly the same value. Only WSL adds
 * Ctrl+Space for the legacy NUL encoding of Ctrl+Backtick; other platforms keep catalogue defaults.
 *
 * @param actionId - The catalogue action.
 * @param platform - Platform used to expand `mod`.
 * @returns The parsed built-in bindings, or an empty list for an unknown action.
 */
export function readDefaultBindings(
  actionId: ActionId,
  platform: KeymapPlatform,
): readonly ParsedBinding[] {
  const action = ACTION_BY_ID[actionId];

  if (!action) {
    return [];
  }

  const defaults =
    actionId === "app.console" && platform === "wsl"
      ? [...action.defaults, "ctrl+space"]
      : action.defaults;

  return parseBindingValues(defaults, platform).bindings;
}
