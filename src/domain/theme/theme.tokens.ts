/** Every theme token name in the F-20 token table. */
export const THEME_TOKEN_NAMES = Object.freeze([
  "background",
  "panel",
  "surface",
  "border",
  "focus",
  "text",
  "muted",
  "dim",
  "selection",
  "accent",
  "success",
  "warning",
  "error",
  "info",
  "scrollbar",
  "tag",
  "branchLocal",
  "branchRemote",
  "diffAdd",
  "diffRemove",
  "diffAddBackground",
  "diffRemoveBackground",
  "diffContext",
  "diffHunk",
  "graph",
] as const);

/** One visual token name. */
export type ThemeToken = (typeof THEME_TOKEN_NAMES)[number];

/** The OpenTUI destination of one theme token. */
export interface ThemeTokenTarget {
  /** Token name. */
  readonly token: ThemeToken;
  /** OpenTUI component or primitive that consumes the token. */
  readonly target: string;
  /** OpenTUI property that receives the resolved color. */
  readonly prop: string;
  /** Short purpose used by documentation and tests. */
  readonly purpose: string;
}

/** The token-to-OpenTUI-prop mapping from the F-20 contract. */
export const THEME_TOKEN_TARGETS: readonly ThemeTokenTarget[] = [
  {
    token: "background",
    target: "root box and text base",
    prop: "backgroundColor",
    purpose: "App background",
  },
  {
    token: "panel",
    target: "sidebar, diff, and console panel surfaces (no current consumer)",
    prop: "backgroundColor",
    purpose: "Sidebar, diff, and console panels",
  },
  {
    token: "surface",
    target:
      "raised rows, selected sidebar ListRow, modals, inputs, native modal selects, ProgressBar track",
    prop: "backgroundColor",
    purpose:
      "Raised rows, selected sidebar list rows, modals, inputs, and native select backgrounds",
  },
  {
    token: "border",
    target: "inactive box borders, separators, and idle Button fill",
    prop: "borderColor and backgroundColor",
    purpose: "Inactive borders, separators, and idle button fill",
  },
  {
    token: "focus",
    target: "focused box border",
    prop: "focusedBorderColor",
    purpose: "Focused border and active accent",
  },
  {
    token: "text",
    target: "text, diff code, and native select option text",
    prop: "fg",
    purpose: "Primary text, diff code, and select option labels",
  },
  {
    token: "muted",
    target: "secondary text and the selected native select option description",
    prop: "fg",
    purpose: "Secondary text, author names, and selected option descriptions",
  },
  {
    token: "dim",
    target: "hints, disabled text, and native select option descriptions",
    prop: "fg",
    purpose: "Hints, context lines, disabled text, and option descriptions",
  },
  {
    token: "selection",
    target: "selected native select option and focused Button (sidebar ListRow uses surface)",
    prop: "backgroundColor",
    purpose: "Selected option and focused button background; sidebar rows use surface",
  },
  {
    token: "accent",
    target: "key hints, current and worktree markers, and ProgressBar fill",
    prop: "fg and FrameBuffer fill color",
    purpose: "Key hints, current markers, and progress fill",
  },
  {
    token: "success",
    target: "StatusBadge and add counts",
    prop: "fg",
    purpose: "Success status and added counts",
  },
  {
    token: "warning",
    target: "StatusBadge and pending state",
    prop: "fg",
    purpose: "Warnings and pending state",
  },
  {
    token: "error",
    target: "StatusBadge and destructive labels",
    prop: "fg",
    purpose: "Errors, deletions, and destructive actions",
  },
  {
    token: "info",
    target: "StatusBadge and hunk headers",
    prop: "fg",
    purpose: "Informational status and hunk headers",
  },
  {
    token: "scrollbar",
    target: "scrollbox thumb",
    prop: "scrollbar thumb color",
    purpose: "Scrollbar thumb",
  },
  {
    token: "tag",
    target: "tag labels (no current consumer)",
    prop: "fg",
    purpose: "Tag badges",
  },
  {
    token: "branchLocal",
    target: "local branch labels (no current consumer)",
    prop: "fg",
    purpose: "Local branch badges",
  },
  {
    token: "branchRemote",
    target: "remote branch labels (no current consumer)",
    prop: "fg",
    purpose: "Remote branch badges",
  },
  {
    token: "diffAdd",
    target: "diff",
    prop: "addedSignColor",
    purpose: "Added lines and add counts",
  },
  {
    token: "diffRemove",
    target: "diff",
    prop: "removedSignColor",
    purpose: "Removed lines and delete counts",
  },
  {
    token: "diffAddBackground",
    target: "diff",
    prop: "addedBg",
    purpose: "Added line background",
  },
  {
    token: "diffRemoveBackground",
    target: "diff",
    prop: "removedBg",
    purpose: "Removed line background",
  },
  {
    token: "diffContext",
    target: "diff",
    prop: "context line color",
    purpose: "Diff context text",
  },
  {
    token: "diffHunk",
    target: "diff",
    prop: "hunk header color",
    purpose: "Diff hunk header",
  },
  {
    token: "graph",
    target: "GraphLanes per-lane box and text",
    prop: "fg and backgroundColor per lane",
    purpose: "Commit graph lane colors",
  },
];

// The target table is shared read-only data: consumers receive these same entries by reference.
for (const target of THEME_TOKEN_TARGETS) {
  Object.freeze(target);
}

Object.freeze(THEME_TOKEN_TARGETS);
