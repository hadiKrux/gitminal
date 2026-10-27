/**
 * The single configuration file for every icon, marker, and glyph in Gitminal.
 *
 * Every value is printable ASCII except three pictographs: the `push` and `pull` arrows and the
 * `success` check mark. The arrows are in WGL4 and CP437, so mainstream terminal fonts and the
 * Linux console font both draw them. The check mark is outside both sets but is present in
 * Consolas, Menlo, DejaVu Sans Mono, JetBrains Mono, and the other mainstream monospace fonts.
 * All three are East Asian Ambiguous, which OpenTUI's `unicode` and `wcwidth` width methods both
 * measure as one cell. Every other value stays ASCII. Every state marker is also paired with a
 * text equivalent at the point of use.
 *
 * Components read from this object and never inline a reusable marker.
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
  push: "↑",
  pull: "↓",
  success: "✓",
  warning: "!",
  warningMarker: "[!]",
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
  swatch: "[#]",
});

/** The name of every entry in `ICONS`. */
export type IconName = keyof typeof ICONS;
