/**
 * The single configuration file for every icon, marker, and glyph in Gitminal.
 *
 * Every value is printable ASCII except two sanctioned groups. The first group holds six
 * pictographs: the `push`, `pull`, and `tagUnpushed` arrows, the `expanded` and `collapsed`
 * triangles, and the `success` check mark. The arrows and the `expanded` triangle are in WGL4 and
 * CP437, so mainstream terminal fonts and the Linux console font both draw them. The `collapsed`
 * triangle and the check mark are outside both sets but are present in Consolas, Menlo, DejaVu Sans
 * Mono, JetBrains Mono, and the other mainstream monospace fonts. The second group is the commit
 * graph set: the `graphCommit` circle, the `graphMerge` circle, and the box-drawing lines and
 * corners between them. Box drawing is present in CP437 and WGL4 as a contiguous block, so it is at
 * least as portable as the arrows. Every value in both groups is East Asian Ambiguous, which
 * OpenTUI's `unicode` and `wcwidth` width methods both measure as one cell, so the commit graph can
 * draw one lane in two cells without changing any row budget. Every other value stays ASCII. The
 * tag scope markers are their own text equivalent: `L` and `R` abbreviate local and remote,
 * `tagUnpushed` reuses the push arrow, and the bracket pair forms one fixed-width presence matrix
 * documented in architecture section 6.1.
 *
 * Components read from this object and never inline a reusable marker.
 */
export const ICONS = Object.freeze({
  focus: ">",
  selected: ">",
  unselected: " ",
  expanded: "▼",
  collapsed: "▶",
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
  tagScopeOpen: "[",
  tagScopeClose: "]",
  tagScopeAbsent: " ",
  tagLocal: "L",
  tagRemote: "R",
  tagUnpushed: "↑",
  tagUnknown: "?",
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
  graphCommit: "○",
  graphMerge: "◎",
  graphVertical: "│",
  graphHorizontal: "─",
  graphUpLeft: "╯",
  graphUpRight: "╰",
  graphDownLeft: "╮",
  graphDownRight: "╭",
  graphTeeUp: "┴",
  graphTeeDown: "┬",
  graphEndUp: "╵",
  graphEndDown: "╷",
  graphEndRight: "╶",
  ellipsis: "...",
  hintSeparator: "|",
  swatch: "[#]",
});

/** The name of every entry in `ICONS`. */
export type IconName = keyof typeof ICONS;
