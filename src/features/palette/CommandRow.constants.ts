import type { PaletteCategory } from "@/features/palette/CommandRow.types";

/** Shown in the shortcut column when an action has no effective binding. */
export const PALETTE_UNBOUND_LABEL = "Unbound";

/** Prefix of a category header option row. */
export const PALETTE_GROUP_HEADER_PREFIX = "-- ";

/** Suffix of a category header option row. */
export const PALETTE_GROUP_HEADER_SUFFIX = " --";

/** Display label per palette category, used as both the group header and the option name prefix. */
export const PALETTE_CATEGORY_LABELS: Readonly<Record<PaletteCategory, string>> = Object.freeze({
  recent: "Recent",
  app: "App",
  remote: "Remote",
  focus: "Focus",
  navigation: "Navigation",
  list: "List",
  branch: "Branch",
  tag: "Tag",
  stash: "Stash",
  worktree: "Worktree",
  commit: "Commit",
  diff: "Diff",
  graph: "Graph",
  console: "Console",
  help: "Help",
  form: "Form",
  overlay: "Overlay",
});
