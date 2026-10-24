/**
 * The single configuration file for every icon, marker, and glyph in Gitminal.
 *
 * Values are printable ASCII only and every state marker is paired with a text equivalent at the
 * point of use. Components read from this object and never inline a reusable marker.
 */
export const ICONS = Object.freeze({
  focus: ">",
  selected: ">",
  unselected: " ",
  expanded: "v",
  collapsed: ">",
  currentBranch: "*",
  worktree: "+",
  detached: "~",
  missingUpstream: "[?]",
  noUpstream: "-",
  locked: "L",
  prunable: "P",
  dirty: "*",
  modified: "M",
  added: "A",
  deleted: "D",
  renamed: "R",
  copied: "C",
  conflicted: "U",
  untracked: "?",
  diffAdd: "+",
  diffRemove: "-",
  diffContext: " ",
  diffNoNewline: "\\ No newline at end of file",
  tagLocal: "local",
  tagRemote: "remote",
  tagUnpushed: "unpushed",
  tagLocalOnly: "local only",
  push: "^",
  pull: "v",
  success: "v",
  warning: "!",
  error: "x",
  info: "i",
  pending: "[ ]",
  running: "[..]",
  done: "[v]",
  spinnerFrames: Object.freeze(["|", "/", "-", "\\"]),
  checkboxOn: "[x]",
  checkboxOff: "[ ]",
  badgeOverflow: "+",
  omittedLines: "... N lines omitted ...",
  graphLanes: Object.freeze(["*", "|", "/", "\\", "-", "+"]),
  ellipsis: "...",
  hintSeparator: "|",
});

/** The name of every entry in `ICONS`. */
export type IconName = keyof typeof ICONS;
