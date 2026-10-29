/**
 * Install command definitions for the Hero command deck.
 */
const INSTALL_COMMANDS = Object.freeze({
  bun: {
    command: "bun add -g @im4all/gitminal",
    note: "Install the global `gitminal` binary via Bun (>= 1.3.14).",
  },
  bunx: {
    command: "bunx @im4all/gitminal",
    note: "Run immediately inside any Git repository without global installation.",
  },
  npm: {
    command: "npm install -g @im4all/gitminal",
    note: "Install globally via npm. Requires Bun (>= 1.3.14) installed on PATH.",
  },
});

/**
 * Available simulator themes matching Gitminal's built-in Catppuccin and monochrome palettes.
 */
const SIM_THEMES = Object.freeze([
  "catppuccin-mocha",
  "catppuccin-macchiato",
  "catppuccin-frappe",
  "mono-dark",
]);

/**
 * Simulated sidebar data for regions 1 through 5.
 */
const SIDEBAR_DATA = Object.freeze({
  branches: [
    { name: "main", current: true, meta: "origin/main" },
    { name: "feat/tree-sitter-wasm", current: false, meta: "ahead 2" },
    { name: "fix/redact-credentials", current: false, meta: "up to date" },
    { name: "feat/graph-lanes", current: false, meta: "no upstream" },
    { name: "chore/parsers-vendor", current: false, meta: "no upstream" },
    { name: "release/v1.3.0", current: false, meta: "origin/release" },
  ],
  remotes: [
    { name: "origin/main", badge: "", meta: "tracked" },
    { name: "origin/feat/tree-sitter-wasm", badge: "", meta: "tracked" },
    { name: "origin/develop", badge: "[?]", meta: "stale" },
    { name: "origin/feature/legacy-ui", badge: "[?]", meta: "stale" },
    { name: "upstream/main", badge: "", meta: "remote" },
  ],
  tags: [
    { name: "v1.3.0", badge: "[LR]", meta: "1f901cb" },
    { name: "v1.3.0-rc.1", badge: "[L\u2191]", meta: "a84d21e" },
    { name: "v1.2.0", badge: "[LR]", meta: "7c3b902" },
    { name: "v1.0.0", badge: "[L?]", meta: "c0291ab" },
  ],
  stashes: [
    { name: "stash@{0}: WIP on main: diff collapse", badge: "2m", meta: "3 files" },
    { name: "stash@{1}: untracked theme tokens", badge: "4h", meta: "1 file" },
  ],
  worktrees: [
    { name: "main *", badge: "current", meta: "~/repos/gitminal" },
    { name: "release-check +", badge: "linked", meta: "../gitminal-wt" },
  ],
});

/**
 * Simulated commits in region 6 (including working tree row at index 0).
 */
const GRAPH_COMMITS = Object.freeze([
  {
    id: "working-tree",
    isWorkingTree: true,
    isMerge: false,
    roundedLanes: "\u25cb   ",
    sharpLanes: "\u25cb   ",
    laneClass: "tui-commit__lane--0",
    roundedCont: "\u2502   ",
    sharpCont: "\u2502   ",
    subject: "Working tree (2 modified, 1 staged)",
    author: "Local Workspace",
    date: "uncommitted",
    filesCount: 3,
    refBadge: "INDEX",
    refType: "branch",
    parents: "1f901cb",
    stats: "3 files changed +42 -5",
    diffFile: "M src/domain/git/git.client.ts",
    diffAdd: "+28",
    diffDel: "-4",
    diffHunk: "@@ -44,8 +44,14 @@ export async function spawnGitCommand(argv: readonly string[])",
    diffLines: [
      { no: "44", sign: " ", type: "ctx", code: "  const child = spawn(gitBinary, argv, {" },
      { no: "45", sign: "-", type: "del", code: "    shell: false," },
      {
        no: "45",
        sign: "+",
        type: "add",
        code: "    shell: false, // Enforced: argv[] only, zero shell interpolation",
      },
      {
        no: "46",
        sign: "+",
        type: "add",
        code: "    env: buildSanitizedGitEnv(process.env),",
      },
      { no: "47", sign: " ", type: "ctx", code: '    stdio: ["ignore", "pipe", "pipe"],' },
      { no: "48", sign: " ", type: "ctx", code: "  });" },
      {
        no: "49",
        sign: "+",
        type: "add",
        code: "  const redactedStderr = redactCredentials(rawStderr);",
      },
    ],
  },
  {
    id: "1f901cb",
    isWorkingTree: false,
    isMerge: false,
    roundedLanes: "\u25cb   ",
    sharpLanes: "\u25cb   ",
    laneClass: "tui-commit__lane--0",
    roundedCont: "\u2502   ",
    sharpCont: "\u2502   ",
    subject: "feat(config): load settings from the environment",
    author: "Ada Lovelace <ada@example.com>",
    date: "14 Sep 16:26",
    filesCount: 1,
    refBadge: "main",
    refType: "branch",
    parents: "a84d21e",
    stats: "1 file changed +32 -1",
    diffFile: "M src/config.py",
    diffAdd: "+32",
    diffDel: "-1",
    diffHunk: "@@ -1,4 +1,18 @@",
    diffLines: [
      { no: "1", sign: "-", type: "del", code: "# feat: config loader" },
      {
        no: "1",
        sign: "+",
        type: "add",
        code: '"""Application settings loaded from environment variables."""',
      },
      { no: "2", sign: "+", type: "add", code: "from __future__ import annotations" },
      { no: "3", sign: "+", type: "add", code: "import os" },
      { no: "4", sign: "+", type: "add", code: "from dataclasses import dataclass, replace" },
      { no: "5", sign: " ", type: "ctx", code: "" },
      { no: "6", sign: "+", type: "add", code: "@dataclass(frozen=True)" },
      { no: "7", sign: "+", type: "add", code: "class Config:" },
      {
        no: "8",
        sign: "+",
        type: "add",
        code: '    api_base_url: str = "https://api.example.com"',
      },
      { no: "9", sign: "+", type: "add", code: "    api_timeout: float = 10.0" },
    ],
  },
  {
    id: "a84d21e",
    isWorkingTree: false,
    isMerge: false,
    roundedLanes: "\u25cb   ",
    sharpLanes: "\u25cb   ",
    laneClass: "tui-commit__lane--0",
    roundedCont: "\u2502   ",
    sharpCont: "\u2502   ",
    subject: "feat(diff): vendor tree-sitter wasm highlight queries",
    author: "Alan Turing <alan@example.com>",
    date: "14 Sep 14:10",
    filesCount: 4,
    refBadge: "v1.3.0",
    refType: "tag",
    parents: "7c3b902",
    stats: "4 files changed +118 -12",
    diffFile: "M src/app/syntax.parsers.ts",
    diffAdd: "+64",
    diffDel: "-6",
    diffHunk: "@@ -12,7 +12,15 @@ export const VENDORED_PARSERS = Object.freeze([",
    diffLines: [
      { no: "12", sign: " ", type: "ctx", code: '  "typescript",' },
      { no: "13", sign: " ", type: "ctx", code: '  "python",' },
      { no: "14", sign: "+", type: "add", code: '  "rust",' },
      { no: "15", sign: "+", type: "add", code: '  "go",' },
      { no: "16", sign: "+", type: "add", code: '  "yaml",' },
      { no: "17", sign: "-", type: "del", code: "  // runtime fetch fallback removed" },
      { no: "18", sign: " ", type: "ctx", code: "]);" },
    ],
  },
  {
    id: "7c3b902",
    isWorkingTree: false,
    isMerge: true,
    roundedLanes: "\u25ce\u2500\u256e ",
    sharpLanes: "+\u2500\u2510 ",
    laneClass: "tui-commit__lane--1",
    roundedCont: "\u2502 \u2502 ",
    sharpCont: "\u2502 \u2502 ",
    subject: "Merge branch 'feat/graph-lanes' into main",
    author: "Grace Hopper <grace@example.com>",
    date: "14 Sep 13:26",
    filesCount: 2,
    refBadge: "v1.2.0",
    refType: "tag",
    parents: "9b02c41, 4e119fa",
    stats: "2 files changed +85 -9",
    diffFile: "M src/features/graph/GraphLanes.tsx",
    diffAdd: "+54",
    diffDel: "-5",
    diffHunk: "@@ -22,6 +22,13 @@ export function selectLaneGlyphSet(style: GraphStyle)",
    diffLines: [
      {
        no: "22",
        sign: " ",
        type: "ctx",
        code: "export function selectLaneGlyphSet(style: GraphStyle) {",
      },
      { no: "23", sign: "-", type: "del", code: "  return ROUNDED_GLYPHS;" },
      {
        no: "23",
        sign: "+",
        type: "add",
        code: '  return style === "sharp" ? SHARP_GLYPHS : ROUNDED_GLYPHS;',
      },
      { no: "24", sign: " ", type: "ctx", code: "}" },
    ],
  },
  {
    id: "4e119fa",
    isWorkingTree: false,
    isMerge: false,
    roundedLanes: "\u2502 \u25cb ",
    sharpLanes: "\u2502 \u25cb ",
    laneClass: "tui-commit__lane--2",
    roundedCont: "\u251c\u2500\u256f ",
    sharpCont: "\u251c\u2500\u2518 ",
    subject: "feat(graph): add rounded and sharp lazygit lane set",
    author: "Ada Lovelace <ada@example.com>",
    date: "14 Sep 12:26",
    filesCount: 3,
    refBadge: "",
    refType: "",
    parents: "9b02c41",
    stats: "3 files changed +140 -18",
    diffFile: "M src/theme/icons.ts",
    diffAdd: "+19",
    diffDel: "-2",
    diffHunk: "@@ -70,6 +70,12 @@ export const ICONS = Object.freeze({",
    diffLines: [
      { no: "70", sign: " ", type: "ctx", code: '  graphCommit: "\\u25cb",' },
      { no: "71", sign: "+", type: "add", code: '  graphMerge: "\\u25ce",' },
      { no: "72", sign: "+", type: "add", code: '  graphMergeSharp: "+",' },
      { no: "73", sign: "+", type: "add", code: '  graphUpLeft: "\\u256f",' },
      { no: "74", sign: "+", type: "add", code: '  graphSharpUpLeft: "\\u2518",' },
    ],
  },
  {
    id: "9b02c41",
    isWorkingTree: false,
    isMerge: false,
    roundedLanes: "\u25cb   ",
    sharpLanes: "\u25cb   ",
    laneClass: "tui-commit__lane--0",
    roundedCont: "\u2502   ",
    sharpCont: "\u2502   ",
    subject: "fix(git): redact credentials from stderr and remote urls",
    author: "Alan Turing <alan@example.com>",
    date: "14 Sep 11:26",
    filesCount: 2,
    refBadge: "",
    refType: "",
    parents: "3d88e10",
    stats: "2 files changed +47 -3",
    diffFile: "M src/domain/git/git.redact.ts",
    diffAdd: "+47",
    diffDel: "-3",
    diffHunk: "@@ -8,4 +8,11 @@ export function redactGitText(input: string): string",
    diffLines: [
      { no: "8", sign: "-", type: "del", code: "  return input;" },
      {
        no: "8",
        sign: "+",
        type: "add",
        code: '  return input.replace(/(https?:\\/\\/[^:\\/\\s]+:)[^@\\s]+(@)/gi, "$1<redacted>$2");',
      },
      { no: "9", sign: " ", type: "ctx", code: "}" },
    ],
  },
  {
    id: "3d88e10",
    isWorkingTree: false,
    isMerge: false,
    roundedLanes: "\u25cb   ",
    sharpLanes: "\u25cb   ",
    laneClass: "tui-commit__lane--3",
    roundedCont: "\u2502   ",
    sharpCont: "\u2502   ",
    subject: "feat(branches): inspect unmerged risk before branch delete",
    author: "Grace Hopper <grace@example.com>",
    date: "13 Sep 22:15",
    filesCount: 3,
    refBadge: "",
    refType: "",
    parents: "c0291ab",
    stats: "3 files changed +92 -7",
    diffFile: "M src/features/branches/deleteBranch.risk.ts",
    diffAdd: "+68",
    diffDel: "-4",
    diffHunk: "@@ -15,5 +15,12 @@ export function evaluateBranchDeleteRisk(branch: BranchInfo)",
    diffLines: [
      { no: "15", sign: " ", type: "ctx", code: "  if (branch.unmergedCommitCount > 0) {" },
      {
        no: "16",
        sign: "+",
        type: "add",
        code: '    return { severity: "high", reason: "unmerged commits will be unreachable" };',
      },
      { no: "17", sign: " ", type: "ctx", code: "  }" },
    ],
  },
  {
    id: "c0291ab",
    isWorkingTree: false,
    isMerge: false,
    roundedLanes: "\u2575   ",
    sharpLanes: "\u2502   ",
    laneClass: "tui-commit__lane--0",
    roundedCont: "    ",
    sharpCont: "    ",
    subject: "chore(release): bootstrap @im4all/gitminal v1.0.0",
    author: "Md Habibullah Al Hadi",
    date: "12 Sep 09:00",
    filesCount: 12,
    refBadge: "v1.0.0",
    refType: "tag",
    parents: "root",
    stats: "12 files changed +640 -0",
    diffFile: "A package.json",
    diffAdd: "+86",
    diffDel: "-0",
    diffHunk: "@@ -0,0 +1,10 @@",
    diffLines: [
      { no: "1", sign: "+", type: "add", code: "{" },
      { no: "2", sign: "+", type: "add", code: '  "name": "@im4all/gitminal",' },
      { no: "3", sign: "+", type: "add", code: '  "version": "1.3.0",' },
      {
        no: "4",
        sign: "+",
        type: "add",
        code: '  "description": "A keyboard-first terminal git client."',
      },
      { no: "5", sign: "+", type: "add", code: "}" },
    ],
  },
]);

/**
 * Complete default keybinding catalog from README.md.
 */
const KEYBINDINGS = Object.freeze([
  { action: "Quit", id: "app.quit", scope: "global", keys: ["q", "ctrl+c"] },
  { action: "Help", id: "app.help", scope: "global", keys: ["?", "f1"] },
  {
    action: "Command palette",
    id: "app.palette",
    scope: "global",
    keys: ["ctrl+p", "mod+p", "f2"],
  },
  {
    action: "Toggle console",
    id: "app.console",
    scope: "global",
    keys: ["ctrl+`", "mod+`", "ctrl+space (WSL)"],
  },
  { action: "Refresh repository", id: "app.refresh", scope: "global", keys: ["r"] },
  { action: "Reload configuration", id: "app.reloadConfig", scope: "global", keys: [] },
  { action: "Theme picker", id: "app.themePicker", scope: "global", keys: ["t"] },
  { action: "Pull", id: "remote.pull", scope: "global", keys: ["p"] },
  { action: "Push", id: "remote.push", scope: "global", keys: ["P"] },
  { action: "Force push safely", id: "remote.pushForceSafe", scope: "global", keys: [] },
  {
    action: "Force push and overwrite",
    id: "remote.pushForceOverwrite",
    scope: "global",
    keys: [],
  },
  { action: "Push without hooks", id: "remote.pushNoVerify", scope: "global", keys: [] },
  { action: "Fetch", id: "remote.fetch", scope: "global", keys: ["f"] },
  { action: "Fetch and prune", id: "remote.fetchPrune", scope: "global", keys: ["F"] },
  { action: "More remote actions", id: "remote.more", scope: "global", keys: ["."] },
  { action: "Stage all unstaged", id: "diff.stageAllUnstaged", scope: "global", keys: ["A"] },
  { action: "Focus commit composer", id: "commit.focus", scope: "global", keys: ["c"] },
  { action: "Close or cancel", id: "overlay.close", scope: "global", keys: ["esc"] },

  { action: "Next region", id: "focus.next", scope: "navigation", keys: ["tab"] },
  { action: "Previous region", id: "focus.previous", scope: "navigation", keys: ["shift+tab"] },
  { action: "Focus top bar", id: "focus.region.topBar", scope: "navigation", keys: [] },
  { action: "Focus branches", id: "focus.region.branches", scope: "navigation", keys: ["1"] },
  { action: "Focus remotes", id: "focus.region.remotes", scope: "navigation", keys: ["2"] },
  { action: "Focus tags", id: "focus.region.tags", scope: "navigation", keys: ["3"] },
  { action: "Focus stashes", id: "focus.region.stashes", scope: "navigation", keys: ["4"] },
  { action: "Focus worktrees", id: "focus.region.worktrees", scope: "navigation", keys: ["5"] },
  { action: "Focus commit graph", id: "focus.region.graph", scope: "navigation", keys: ["6"] },
  { action: "Focus right pane", id: "focus.region.rightPane", scope: "navigation", keys: ["7"] },
  { action: "Focus diffs", id: "focus.region.diff", scope: "navigation", keys: ["8"] },
  { action: "Focus console", id: "focus.region.console", scope: "navigation", keys: ["9"] },
  { action: "Move up", id: "nav.up", scope: "navigation", keys: ["up", "k"] },
  { action: "Move down", id: "nav.down", scope: "navigation", keys: ["down", "j"] },
  { action: "Page up", id: "nav.pageUp", scope: "navigation", keys: ["pageup"] },
  { action: "Page down", id: "nav.pageDown", scope: "navigation", keys: ["pagedown"] },
  { action: "Move to first", id: "nav.first", scope: "navigation", keys: ["g"] },
  { action: "Move to last", id: "nav.last", scope: "navigation", keys: ["G"] },
  { action: "Activate", id: "nav.activate", scope: "navigation", keys: ["enter"] },
  { action: "Move left", id: "nav.left", scope: "navigation", keys: ["left", "h"] },
  { action: "Move right", id: "nav.right", scope: "navigation", keys: ["right", "l"] },
  { action: "Expand", id: "nav.expand", scope: "navigation", keys: ["right", "l"] },
  { action: "Collapse", id: "nav.collapse", scope: "navigation", keys: ["left", "h"] },
  { action: "Filter list", id: "list.filter", scope: "navigation", keys: ["/"] },
  {
    action: "Search commits",
    id: "graph.search",
    scope: "navigation",
    keys: ["/", "ctrl+f", "mod+f"],
  },
  { action: "Load older commits", id: "graph.loadOlder", scope: "navigation", keys: ["L"] },
  { action: "Search help", id: "help.search", scope: "navigation", keys: ["/"] },

  { action: "New branch", id: "branch.create", scope: "panels", keys: ["n"] },
  { action: "Delete branch", id: "branch.delete", scope: "panels", keys: ["d"] },
  { action: "Create local branch", id: "remote.createLocal", scope: "panels", keys: ["space"] },
  { action: "New tag", id: "tag.create", scope: "panels", keys: ["n"] },
  { action: "Push tag", id: "tag.push", scope: "panels", keys: ["P"] },
  { action: "Delete tag", id: "tag.delete", scope: "panels", keys: ["d"] },
  { action: "Stash changes", id: "stash.create", scope: "panels", keys: ["s"] },
  { action: "Apply stash", id: "stash.apply", scope: "panels", keys: ["a"] },
  { action: "Pop stash", id: "stash.pop", scope: "panels", keys: ["p"] },
  { action: "Delete stash", id: "stash.delete", scope: "panels", keys: ["d"] },
  { action: "New worktree", id: "worktree.create", scope: "panels", keys: ["n"] },
  { action: "Delete worktree", id: "worktree.delete", scope: "panels", keys: ["d"] },

  { action: "Commit", id: "commit.submit", scope: "composer", keys: ["ctrl+s", "mod+s"] },
  { action: "Commit without hooks", id: "commit.submitNoVerify", scope: "composer", keys: [] },
  { action: "Amend commit", id: "commit.amend", scope: "composer", keys: [] },
  { action: "Amend without hooks", id: "commit.amendNoVerify", scope: "composer", keys: [] },
  { action: "Commit options", id: "commit.options", scope: "composer", keys: [".", "alt+."] },
  {
    action: "Submit form",
    id: "form.submit",
    scope: "composer",
    keys: ["ctrl+enter", "mod+enter"],
  },

  { action: "Toggle file", id: "diff.toggle", scope: "diff", keys: ["enter"] },
  { action: "Scroll down one line", id: "diff.scrollDown", scope: "diff", keys: ["J"] },
  { action: "Scroll up one line", id: "diff.scrollUp", scope: "diff", keys: ["K"] },
  {
    action: "Scroll down five lines",
    id: "diff.scrollFastDown",
    scope: "diff",
    keys: ["shift+down"],
  },
  { action: "Scroll up five lines", id: "diff.scrollFastUp", scope: "diff", keys: ["shift+up"] },
  {
    action: "Scroll left eight columns",
    id: "diff.scrollLeft",
    scope: "diff",
    keys: ["H", "shift+left"],
  },
  {
    action: "Scroll right eight columns",
    id: "diff.scrollRight",
    scope: "diff",
    keys: ["L", "shift+right"],
  },
  { action: "Stage file", id: "diff.stage", scope: "diff", keys: ["s"] },
  { action: "Unstage file", id: "diff.unstage", scope: "diff", keys: ["u"] },
  { action: "Discard file changes", id: "diff.discard", scope: "diff", keys: ["d"] },
  { action: "Delete untracked file", id: "diff.deleteUntracked", scope: "diff", keys: [] },
  { action: "Stage all in section", id: "diff.stageAll", scope: "diff", keys: ["S"] },
  { action: "Unstage all", id: "diff.unstageAll", scope: "diff", keys: ["U"] },
  { action: "Discard all changes", id: "diff.discardAll", scope: "diff", keys: ["D"] },
  { action: "Delete all untracked", id: "diff.deleteAllUntracked", scope: "diff", keys: [] },
  { action: "Clear console", id: "console.clear", scope: "diff", keys: ["c"] },
]);

/**
 * Configuration & environment snippets for the Reference section.
 */
const CONFIG_SNIPPETS = Object.freeze({
  config: {
    path: "$GITMINAL_CONFIG -> $XDG_CONFIG_HOME/gitminal/config.json -> ~/.config/gitminal/config.json",
    code: `{
  "version": 1,
  "git": { "path": "git" },
  "theme": "catppuccin-mocha",
  "ui": { "mouse": true },
  "graph": {
    "scope": "all",
    "initialPageSize": 500,
    "style": "rounded"
  },
  "diff": {
    "contextLines": 3,
    "expandFirstWorkingFile": true
  },
  "stash": { "includeUntrackedByDefault": true },
  "remote": { "fetchScope": "local" }
}`,
    notes:
      "Every key is optional. Invalid fields keep their previous effective value and emit a non-fatal warning. Set graph.style to 'sharp' if your terminal font lacks rounded arc glyphs.",
  },
  keybindings: {
    path: "$GITMINAL_KEYBINDINGS -> ~/.config/gitminal/keybindings.json",
    code: `{
  "app.palette": ["f2", "ctrl+space"],
  "nav.up": ["up", "k", "ctrl+k"],
  "diff.discard": null,
  "remote.pushForceOverwrite": []
}`,
    notes:
      "A string or array replaces the built-in binding, null restores the default, and [] unbinds the action. Reload config from the Command Palette (Ctrl+P) without restarting.",
  },
  "truecolor-unix": {
    path: "~/.zshrc or ~/.bashrc (macOS, Linux, and WSL)",
    code: `# Launch once with 24-bit truecolor enabled:
env -u NO_COLOR COLORTERM=truecolor gitminal

# Or persist in ~/.zshrc or ~/.bashrc:
unset NO_COLOR
export COLORTERM=truecolor`,
    notes:
      "A non-empty NO_COLOR disables colors. Setting COLORTERM=truecolor enables full 24-bit Catppuccin palettes in WSL and Unix shells.",
  },
  "truecolor-ps": {
    path: "$PROFILE (Windows Terminal PowerShell)",
    code: `Remove-Item Env:NO_COLOR -ErrorAction SilentlyContinue
$env:COLORTERM = 'truecolor'
gitminal`,
    notes:
      "Gitminal inspects NO_COLOR, COLORTERM, and TERM directly. Add the first two lines to your PowerShell $PROFILE to persist across sessions.",
  },
});

/**
 * Simulated remote command specs.
 */
const REMOTE_SPECS = Object.freeze({
  pull: { cmd: "git pull --ff-only --progress", label: "Pulling origin/main..." },
  push: { cmd: "git push --progress origin HEAD", label: "Pushing to origin/main..." },
  fetch: { cmd: "git fetch --prune --progress origin", label: "Fetching origin..." },
});

/**
 * Mutable UI state for the interactive page.
 */
const state = {
  installTab: "bun",
  graphStyle: "rounded",
  simThemeIndex: 0,
  consoleOpen: true,
  activeRegion: "6",
  selectedCommitIndex: 1,
  graphFilter: "",
  sidebarSelection: {
    branches: 0,
    remotes: 0,
    tags: 0,
    stashes: 0,
    worktrees: 0,
  },
  keymapScope: "all",
  keymapQuery: "",
  configTab: "config",
  paletteOpen: false,
  paletteQuery: "",
  paletteCursor: 0,
  consoleLogs: [
    { cmd: "git status --porcelain=v2 --branch --untracked-files=all", dur: "9ms" },
    { cmd: "git log --graph --max-count=500 --format=<gitminal-log-v1>", dur: "18ms" },
    { cmd: "git for-each-ref refs/heads refs/remotes refs/tags", dur: "7ms" },
    { cmd: "git worktree list --porcelain", dur: "4ms" },
  ],
};

/**
 * Sets textContent on an element looked up by ID.
 *
 * @param {string} id - DOM element ID.
 * @param {string} text - Text value to assign.
 */
function setTextById(id, text) {
  const el = document.getElementById(id);
  if (el) {
    el.textContent = text;
  }
}

/**
 * Sets innerHTML on an element looked up by ID.
 *
 * @param {string} id - DOM element ID.
 * @param {string} html - HTML markup string.
 */
function setHtmlById(id, html) {
  const el = document.getElementById(id);
  if (el) {
    el.innerHTML = html;
  }
}

/**
 * Copies text to the clipboard and runs a completion callback.
 *
 * @param {string} text - Text to copy.
 * @param {() => void} onDone - Callback invoked after copy succeeds.
 */
function copyToClipboard(text, onDone) {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(onDone).catch(onDone);
    return;
  }
  onDone();
}

/**
 * Escapes HTML special characters for safe DOM insertion.
 *
 * @param {string} value - Raw text string.
 * @returns {string} Escaped HTML string.
 */
function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * Appends a simulated Git command entry to the Console drawer.
 *
 * @param {string} cmd - The serialized argv command string.
 * @param {string} dur - Execution duration label.
 */
function appendConsoleLog(cmd, dur) {
  state.consoleLogs.unshift({ cmd, dur });
  if (state.consoleLogs.length > 18) {
    state.consoleLogs.pop();
  }
  renderConsoleLogs();
}

/**
 * Renders the simulated Console drawer entries.
 */
function renderConsoleLogs() {
  if (state.consoleLogs.length === 0) {
    setHtmlById(
      "sim-console-list",
      '<div class="tui-console__entry"><span class="tui-console__dur">Console cleared. No commands in buffer.</span></div>',
    );
    return;
  }

  const html = state.consoleLogs
    .map(
      (entry) => `
      <div class="tui-console__entry">
        <span class="tui-console__cmd"><span class="tui-console__status">\u2713 0</span>$ ${escapeHtml(entry.cmd)}</span>
        <span class="tui-console__dur">${escapeHtml(entry.dur)}</span>
      </div>`,
    )
    .join("");
  setHtmlById("sim-console-list", html);
}

/**
 * Selects the leading row marker character for a sidebar item.
 *
 * @param {{ current?: boolean }} item - Sidebar item.
 * @param {boolean} isSelected - Whether the row is selected.
 * @returns {string} Marker HTML string.
 */
function getSidebarMarker(item, isSelected) {
  if (item.current) {
    return "*";
  }
  return isSelected ? "&gt;" : " ";
}

/**
 * Formats one sidebar row HTML snippet.
 *
 * @param {{ name: string, current?: boolean, badge?: string, meta: string }} item - Row item.
 * @param {number} idx - Row index.
 * @param {number} selectedIdx - Active cursor index.
 * @param {string} panelKey - Sidebar panel key.
 * @param {string} regionId - Region number string.
 * @returns {string} HTML string for the row.
 */
function formatSidebarRow(item, idx, selectedIdx, panelKey, regionId) {
  const isSelected = idx === selectedIdx;
  const marker = getSidebarMarker(item, isSelected);
  const badgeHtml = item.badge
    ? `<span class="tui-row__badge">${escapeHtml(item.badge)}</span>`
    : "";

  return `
    <div
      class="tui-row"
      data-selected="${isSelected}"
      data-sidebar-panel="${panelKey}"
      data-sidebar-index="${idx}"
      data-sidebar-region="${regionId}"
    >
      <span class="tui-row__left">
        <span class="tui-row__marker">${marker}</span>
        <span>${escapeHtml(item.name)}</span>
        ${badgeHtml}
      </span>
      <span class="tui-row__meta">${escapeHtml(item.meta)}</span>
    </div>`;
}

/**
 * Renders one sidebar list inside the interactive TUI workbench.
 *
 * @param {string} containerId - DOM element ID.
 * @param {readonly { name: string, current?: boolean, badge?: string, meta: string }[]} items - Row items.
 * @param {number} selectedIdx - Currently selected index.
 * @param {string} panelKey - State key for selection.
 * @param {string} regionId - Region number string ("1".."5").
 */
function renderSidebarList(containerId, items, selectedIdx, panelKey, regionId) {
  const html = items
    .map((item, idx) => formatSidebarRow(item, idx, selectedIdx, panelKey, regionId))
    .join("");
  setHtmlById(containerId, html);
}

/**
 * Renders all five sidebar panels in the TUI simulator.
 */
function renderAllSidebarPanels() {
  const sel = state.sidebarSelection;
  renderSidebarList("sim-branches-list", SIDEBAR_DATA.branches, sel.branches, "branches", "1");
  renderSidebarList("sim-remotes-list", SIDEBAR_DATA.remotes, sel.remotes, "remotes", "2");
  renderSidebarList("sim-tags-list", SIDEBAR_DATA.tags, sel.tags, "tags", "3");
  renderSidebarList("sim-stashes-list", SIDEBAR_DATA.stashes, sel.stashes, "stashes", "4");
  renderSidebarList("sim-worktrees-list", SIDEBAR_DATA.worktrees, sel.worktrees, "worktrees", "5");
}

/**
 * Checks whether a commit matches a lowercase search query.
 *
 * @param {typeof GRAPH_COMMITS[number]} commit - Commit entry.
 * @param {string} query - Lowercase search string.
 * @returns {boolean} True when the commit matches.
 */
function matchesCommitQuery(commit, query) {
  const haystack =
    `${commit.subject} ${commit.author} ${commit.id} ${commit.refBadge}`.toLowerCase();
  return haystack.includes(query);
}

/**
 * Returns the filtered list of commits for the center Commit Graph.
 *
 * @returns {readonly typeof GRAPH_COMMITS[number][]} Filtered commit list.
 */
function getFilteredCommits() {
  const query = state.graphFilter.trim().toLowerCase();
  return query ? GRAPH_COMMITS.filter((c) => matchesCommitQuery(c, query)) : GRAPH_COMMITS;
}

/**
 * Formats the ref badge HTML for a commit row.
 *
 * @param {typeof GRAPH_COMMITS[number]} commit - Commit entry.
 * @returns {string} HTML string for the ref badge.
 */
function formatCommitRefBadge(commit) {
  if (!commit.refBadge) {
    return "";
  }
  const mod = commit.refType === "tag" ? " tui-commit__ref--tag" : "";
  return `<span class="tui-commit__ref${mod}">[${escapeHtml(commit.refBadge)}]</span>`;
}

/**
 * Resolves the top and bottom lane strings for a commit row.
 *
 * @param {typeof GRAPH_COMMITS[number]} commit - Commit object.
 * @param {boolean} isSharp - True when sharp graph style is active.
 * @returns {{ top: string, bot: string }} Lane strings.
 */
function getCommitLanes(commit, isSharp) {
  return {
    top: isSharp ? commit.sharpLanes : commit.roundedLanes,
    bot: isSharp ? commit.sharpCont : commit.roundedCont,
  };
}

/**
 * Formats one commit row HTML block for the center Commit Graph.
 *
 * @param {typeof GRAPH_COMMITS[number]} commit - Commit object.
 * @param {number} idx - Row index.
 * @param {boolean} isSharp - True when sharp graph style is active.
 * @returns {string} HTML markup for the commit row.
 */
function formatCommitRow(commit, idx, isSharp) {
  const isSelected = idx === state.selectedCommitIndex;
  const lanes = getCommitLanes(commit, isSharp);
  const subjMod = commit.isWorkingTree ? " tui-commit__subject--pending" : "";

  return `
    <div
      class="tui-commit"
      role="option"
      tabindex="-1"
      aria-selected="${isSelected}"
      data-commit-index="${idx}"
    >
      <div class="tui-commit__line">
        <div class="tui-commit__left">
          <span class="tui-commit__lanes ${commit.laneClass}">${escapeHtml(lanes.top)}</span>
          <span class="tui-commit__subject${subjMod}">${escapeHtml(commit.subject)}</span>
        </div>
        <span class="tui-commit__files-count">${commit.filesCount}</span>
      </div>
      <div class="tui-commit__line">
        <div class="tui-commit__left">
          <span class="tui-commit__lanes ${commit.laneClass}">${escapeHtml(lanes.bot)}</span>
          ${formatCommitRefBadge(commit)}
          <span class="tui-commit__author">${escapeHtml(commit.author)}</span>
        </div>
        <span class="tui-commit__date">${escapeHtml(commit.date)}</span>
      </div>
    </div>`;
}

/**
 * Updates the graph style labels across the page.
 *
 * @param {boolean} isSharp - True when sharp style is active.
 */
function updateGraphStyleLabels(isSharp) {
  const footerDesc = isSharp
    ? "sharp (\u250c \u2510 \u2514 \u2518 \u25cb +)"
    : "rounded (\u256d \u256e \u2570 \u256f \u25cb \u25ce)";
  setTextById("tui-graph-footer-style", footerDesc);
  setTextById("graph-style-label", state.graphStyle);
  setTextById("footer-graph-style", state.graphStyle);
}

/**
 * Renders the center Commit Graph list with rounded or sharp box-drawing lanes.
 */
function renderCommitGraph() {
  const isSharp = state.graphStyle === "sharp";
  updateGraphStyleLabels(isSharp);

  const commits = getFilteredCommits();
  if (commits.length === 0) {
    setHtmlById(
      "sim-graph-list",
      '<div class="tui-commit"><span class="tui-commit__author">No commits match search query.</span></div>',
    );
    return;
  }

  state.selectedCommitIndex = Math.min(state.selectedCommitIndex, commits.length - 1);
  const html = commits.map((commit, idx) => formatCommitRow(commit, idx, isSharp)).join("");
  setHtmlById("sim-graph-list", html);
}

/**
 * Renders the top-right Commit Composer or Commit Details pane ([7]).
 *
 * @param {typeof GRAPH_COMMITS[number]} commit - Selected commit entry.
 */
function renderDetailsOrComposerPane(commit) {
  if (commit.isWorkingTree) {
    setTextById("sim-details-title", "Commit Composer (Working Tree)");
    setHtmlById(
      "sim-details-body",
      `<div class="tui-composer">
        <div class="tui-composer__identity">Author: Md Habibullah Al Hadi &lt;hadi@gitminal.dev&gt;</div>
        <input
          type="text"
          class="tui-composer__input"
          id="sim-composer-input"
          value="feat(git): enforce sanitized argv execution"
          aria-label="Simulated commit message"
        />
        <div class="tui-composer__actions">
          <span class="tui-details__stats">${escapeHtml(commit.stats)}</span>
          <button type="button" class="tui-composer__btn" id="sim-commit-submit-btn">
            [Ctrl+S] Commit Staged
          </button>
        </div>
      </div>`,
    );
    bindComposerSubmit();
    return;
  }

  setTextById("sim-details-title", `Commit ${commit.id}`);
  setHtmlById(
    "sim-details-body",
    `<div class="tui-details__row">
      <span class="tui-details__label">Commit</span>
      <span class="tui-details__oid">${escapeHtml(commit.id)}</span>
      <span class="tui-details__stats">${escapeHtml(commit.stats)}</span>
    </div>
    <div class="tui-details__row">
      <span class="tui-details__label">Parents</span>
      <span>${escapeHtml(commit.parents)}</span>
    </div>
    <div class="tui-details__row">
      <span class="tui-details__label">Author</span>
      <span>${escapeHtml(commit.author)} (${escapeHtml(commit.date)})</span>
    </div>
    <div class="tui-details__msg">${escapeHtml(commit.subject)}</div>`,
  );
}

/**
 * Maps a diff line type to its BEM modifier class.
 *
 * @param {string} lineType - "add", "del", or "ctx".
 * @returns {string} CSS class name.
 */
function getDiffLineClass(lineType) {
  if (lineType === "add") {
    return "tui-diff__line tui-diff__line--add";
  }
  if (lineType === "del") {
    return "tui-diff__line tui-diff__line--del";
  }
  return "tui-diff__line";
}

/**
 * Renders the bottom-right Unified Diff pane ([8]).
 *
 * @param {typeof GRAPH_COMMITS[number]} commit - Selected commit entry.
 */
function renderDiffPane(commit) {
  const title = commit.isWorkingTree
    ? "Working Tree & Staged Diff"
    : `Commit ${commit.id} Unified Diff`;
  setTextById("sim-diff-title", title);

  const linesHtml = commit.diffLines
    .map(
      (line) => `
      <div class="${getDiffLineClass(line.type)}">
        <span class="tui-diff__lineno">${escapeHtml(line.no)}</span>
        <span class="tui-diff__sign">${escapeHtml(line.sign)}</span>
        <span class="tui-diff__code">${escapeHtml(line.code)}</span>
      </div>`,
    )
    .join("");

  setHtmlById(
    "sim-diff-body",
    `<div class="tui-diff__file-header">
      <span>\u25bc ${escapeHtml(commit.diffFile)}</span>
      <span>
        <span class="tui-diff__file-stat-add">${escapeHtml(commit.diffAdd)}</span>
        <span class="tui-diff__file-stat-del">${escapeHtml(commit.diffDel)}</span>
      </span>
    </div>
    <div class="tui-diff__hunk">${escapeHtml(commit.diffHunk)}</div>
    ${linesHtml}`,
  );
}

/**
 * Renders the right-hand Commit Details / Commit Composer ([7]) and Diff Viewer ([8]).
 */
function renderInspectorPanes() {
  const commits = getFilteredCommits();
  const commit = commits[state.selectedCommitIndex] ?? GRAPH_COMMITS[0];
  if (!commit) {
    return;
  }
  renderDetailsOrComposerPane(commit);
  renderDiffPane(commit);
}

/**
 * Binds the simulated Commit Composer submit button when the Working Tree row is active.
 */
function bindComposerSubmit() {
  const btn = document.getElementById("sim-commit-submit-btn");
  btn?.addEventListener("click", () => {
    const input = document.getElementById("sim-composer-input");
    const raw = input instanceof HTMLInputElement ? input.value.trim() : "";
    const msg = raw || "feat: update repository state";
    appendConsoleLog(`git commit -m "${msg}"`, "24ms");
    setTextById("tui-status-message", "\u2713 committed to main");
  });
}

/**
 * Updates the focused region border and title indicator inside the TUI simulator.
 *
 * @param {string} regionId - Region identifier ("1".."9").
 */
function setFocusedRegion(regionId) {
  state.activeRegion = regionId;
  let activeName = `[${regionId}] Region`;

  for (const panel of document.querySelectorAll("[data-region-id]")) {
    const isMatch = panel.getAttribute("data-region-id") === regionId;
    panel.classList.toggle("tui-panel--focused", isMatch);
    if (isMatch) {
      activeName = panel.getAttribute("data-region-name") || activeName;
    }
  }
  setTextById("tui-active-region-label", activeName);
}

/**
 * Toggles the graph box-drawing style between "rounded" and "sharp".
 */
function toggleGraphStyle() {
  state.graphStyle = state.graphStyle === "rounded" ? "sharp" : "rounded";
  renderCommitGraph();
  appendConsoleLog(`config.set graph.style="${state.graphStyle}"`, "1ms");
}

/**
 * Sets the simulator theme flavor and updates all theme pill buttons.
 *
 * @param {string} themeName - Theme identifier.
 */
function setSimulatorTheme(themeName) {
  const idx = SIM_THEMES.indexOf(themeName);
  state.simThemeIndex = Math.max(idx, 0);
  const effective = SIM_THEMES[state.simThemeIndex] || "catppuccin-mocha";

  document.getElementById("tui-simulator")?.setAttribute("data-sim-theme", effective);
  setTextById("sim-theme-label", effective);

  for (const pill of document.querySelectorAll("[data-theme-pick]")) {
    pill.classList.toggle(
      "swatch-pill--active",
      pill.getAttribute("data-theme-pick") === effective,
    );
  }
}

/**
 * Cycles to the next simulator theme flavor.
 */
function cycleSimulatorTheme() {
  const nextIndex = (state.simThemeIndex + 1) % SIM_THEMES.length;
  setSimulatorTheme(SIM_THEMES[nextIndex] || "catppuccin-mocha");
  appendConsoleLog(`theme.resolve "${SIM_THEMES[nextIndex]}"`, "2ms");
}

/**
 * Toggles the visibility of the simulated Git Console drawer ([9]).
 */
function toggleConsoleDrawer() {
  state.consoleOpen = !state.consoleOpen;
  const drawer = document.getElementById("tui-console-drawer");
  if (drawer) {
    drawer.hidden = !state.consoleOpen;
  }
  setTextById("console-state-label", state.consoleOpen ? "open" : "closed");
}

/**
 * Updates the simulated frame-buffer progress bar width and text.
 *
 * @param {string} label - Progress phase text.
 * @param {number} percent - Clamped percentage (0..100).
 */
function setProgressState(label, percent) {
  const fill = document.getElementById("tui-progress-fill");
  if (fill) {
    fill.style.width = `${percent}%`;
  }
  setTextById("tui-progress-label", `${label} ${percent}%`);
}

/**
 * Simulates a guarded Git remote command with a frame-buffer progress bar animation.
 *
 * @param {string} action - One of "pull", "push", or "fetch".
 */
function runSimulatedGitRemote(action) {
  const wrap = document.getElementById("tui-progress-wrap");
  const spec = REMOTE_SPECS[action] || REMOTE_SPECS.fetch;
  if (!wrap) {
    return;
  }

  wrap.hidden = false;
  setProgressState(spec.label, 35);
  setTimeout(() => setProgressState(spec.label, 82), 180);
  setTimeout(() => {
    setProgressState(spec.label, 100);
    appendConsoleLog(spec.cmd, "142ms");
    setTextById("tui-status-message", `\u2713 ${action} complete`);
  }, 380);
  setTimeout(() => {
    wrap.hidden = true;
  }, 750);
}

/**
 * Updates the active install command tab in the Hero command deck.
 *
 * @param {string} tabKey - Key in INSTALL_COMMANDS ("bun" | "bunx" | "npm").
 */
function setInstallTab(tabKey) {
  const entry = INSTALL_COMMANDS[tabKey];
  if (!entry) {
    return;
  }
  state.installTab = tabKey;
  setTextById("install-command-text", entry.command);
  setTextById("install-command-note", entry.note);

  for (const tab of document.querySelectorAll("[data-install-tab]")) {
    const isMatch = tab.getAttribute("data-install-tab") === tabKey;
    tab.classList.toggle("installer__tab--active", isMatch);
    tab.setAttribute("aria-selected", String(isMatch));
  }
}

/**
 * Copies the currently active install command and displays confirmation feedback.
 */
function copyActiveInstallCommand() {
  const entry = INSTALL_COMMANDS[state.installTab] || INSTALL_COMMANDS.bun;
  const btn = document.getElementById("copy-install-btn");

  copyToClipboard(entry.command, () => {
    btn?.setAttribute("data-copied", "true");
    setTextById("copy-install-label", "Copied!");
    setTextById("topbar-sync-status", `[v] Copied: ${entry.command}`);

    setTimeout(() => {
      btn?.removeAttribute("data-copied");
      setTextById("copy-install-label", "Copy");
      setTextById("topbar-sync-status", "origin/main ahead 0 behind 0 [v] up to date");
    }, 1800);
  });
}

/**
 * Checks whether a keybinding entry matches the active scope and search filter.
 *
 * @param {{ action: string, id: string, scope: string, keys: readonly string[] }} item - Keymap row.
 * @param {string} query - Lowercase query string.
 * @returns {boolean} True when the row matches.
 */
function matchesKeybindingFilter(item, query) {
  const scopeOk = state.keymapScope === "all" || item.scope === state.keymapScope;
  if (!scopeOk || !query) {
    return scopeOk;
  }
  const text = `${item.action} ${item.id} ${item.keys.join(" ")}`.toLowerCase();
  return text.includes(query);
}

/**
 * Formats one row in the Keybindings reference table.
 *
 * @param {{ action: string, id: string, scope: string, keys: readonly string[] }} item - Keymap row.
 * @returns {string} HTML table row string.
 */
function formatKeymapRow(item) {
  const keysHtml =
    item.keys.length > 0
      ? item.keys.map((k) => `<kbd class="keymap-table__kbd">${escapeHtml(k)}</kbd>`).join("")
      : '<span class="keymap-table__none">palette only</span>';

  return `
    <tr class="keymap-table__tr">
      <td class="keymap-table__td keymap-table__action">${escapeHtml(item.action)}</td>
      <td class="keymap-table__td"><code class="keymap-table__id">${escapeHtml(item.id)}</code></td>
      <td class="keymap-table__td"><span class="keymap-table__scope">${escapeHtml(item.scope)}</span></td>
      <td class="keymap-table__td">${keysHtml}</td>
    </tr>`;
}

/**
 * Renders the filterable Keybindings table in the Reference section.
 */
function renderKeymapTable() {
  const query = state.keymapQuery.trim().toLowerCase();
  const filtered = KEYBINDINGS.filter((item) => matchesKeybindingFilter(item, query));
  setTextById("keymap-match-count", `Showing ${filtered.length} of ${KEYBINDINGS.length} actions`);
  setHtmlById("keymap-table-body", filtered.map(formatKeymapRow).join(""));
}

/**
 * Renders the active Configuration or Truecolor snippet tab.
 *
 * @param {string} tabKey - Key in CONFIG_SNIPPETS.
 */
function setConfigTab(tabKey) {
  const spec = CONFIG_SNIPPETS[tabKey];
  if (!spec) {
    return;
  }
  state.configTab = tabKey;
  setTextById("config-path-display", spec.path);
  setTextById("config-code-display", spec.code);
  setTextById("config-notes-display", spec.notes);

  for (const tab of document.querySelectorAll("[data-config-tab]")) {
    const active = tab.getAttribute("data-config-tab") === tabKey;
    tab.classList.toggle("config-box__tab--active", active);
    tab.setAttribute("aria-selected", String(active));
  }
}

/**
 * Scrolls smoothly to a section by DOM ID.
 *
 * @param {string} sectionId - Target element ID.
 */
function scrollToSection(sectionId) {
  document.getElementById(sectionId)?.scrollIntoView({ behavior: "smooth" });
}

/**
 * Builds the list of executable commands for the interactive Command Palette modal.
 *
 * @returns {Array<{ label: string, id: string, key: string, run: () => void }>} Palette items.
 */
function getPaletteCommands() {
  return [
    {
      label: "Copy global install (bun add -g @im4all/gitminal)",
      id: "install.copyBunGlobal",
      key: "y",
      run: () => {
        setInstallTab("bun");
        copyActiveInstallCommand();
      },
    },
    {
      label: "Copy install command (bunx @im4all/gitminal)",
      id: "install.copyBunx",
      key: "bunx",
      run: () => {
        setInstallTab("bunx");
        copyActiveInstallCommand();
      },
    },
    {
      label: "Toggle Commit Graph Style (rounded <-> sharp)",
      id: "graph.toggleStyle",
      key: "g",
      run: toggleGraphStyle,
    },
    {
      label: "Cycle Workbench Catppuccin Theme",
      id: "app.themePicker",
      key: "t",
      run: cycleSimulatorTheme,
    },
    {
      label: "Toggle Git Console Drawer",
      id: "app.console",
      key: "9 / ctrl+`",
      run: toggleConsoleDrawer,
    },
    {
      label: "Jump to Interactive TUI Workbench",
      id: "nav.workbench",
      key: "w",
      run: () => scrollToSection("workbench"),
    },
    {
      label: "Jump to System Architecture Matrix",
      id: "nav.matrix",
      key: "m",
      run: () => scrollToSection("matrix"),
    },
    {
      label: "Jump to Keymap & Configuration Explorer",
      id: "nav.reference",
      key: "k",
      run: () => scrollToSection("reference"),
    },
    {
      label: "Switch Workbench to Reference Screenshot",
      id: "workbench.screenshot",
      key: "image",
      run: () => {
        setWorkbenchMode("screenshot");
        scrollToSection("workbench");
      },
    },
    {
      label: "Open GitHub Repository (im4aLL/gitminal)",
      id: "ext.github",
      key: "enter",
      run: () => {
        window.open("https://github.com/im4aLL/gitminal", "_blank", "noopener,noreferrer");
      },
    },
    {
      label: "Open npm Package (@im4all/gitminal)",
      id: "ext.npm",
      key: "enter",
      run: () => {
        window.open(
          "https://www.npmjs.com/package/@im4all/gitminal",
          "_blank",
          "noopener,noreferrer",
        );
      },
    },
  ];
}

/**
 * Returns the filtered Command Palette items matching the current query.
 *
 * @returns {Array<{ label: string, id: string, key: string, run: () => void }>} Filtered commands.
 */
function getFilteredPaletteCommands() {
  const q = state.paletteQuery.trim().toLowerCase();
  const all = getPaletteCommands();
  if (!q) {
    return all;
  }
  return all.filter((item) => `${item.label} ${item.id} ${item.key}`.toLowerCase().includes(q));
}

/**
 * Renders the Command Palette modal command list.
 */
function renderPaletteList() {
  const items = getFilteredPaletteCommands();
  state.paletteCursor = items.length > 0 ? Math.min(state.paletteCursor, items.length - 1) : 0;

  const html = items
    .map((item, idx) => {
      const active = idx === state.paletteCursor;
      return `
        <button type="button" class="palette__item" data-active="${active}" data-palette-index="${idx}">
          <span class="palette__item-left">
            <span class="palette__item-marker">${active ? "&gt;" : " "}</span>
            <span>${escapeHtml(item.label)}</span>
            <code class="palette__item-id">(${escapeHtml(item.id)})</code>
          </span>
          <kbd class="palette__item-key">${escapeHtml(item.key)}</kbd>
        </button>`;
    })
    .join("");
  setHtmlById("palette-command-list", html);
}

/**
 * Opens or closes the interactive Command Palette modal.
 *
 * @param {boolean} open - True to open, false to close.
 */
function setPaletteOpen(open) {
  state.paletteOpen = open;
  const modal = document.getElementById("palette-modal");
  if (!modal) {
    return;
  }
  modal.hidden = !open;
  if (!open) {
    return;
  }

  state.paletteQuery = "";
  state.paletteCursor = 0;
  const input = document.getElementById("palette-search-input");
  if (input instanceof HTMLInputElement) {
    input.value = "";
    input.focus();
  }
  renderPaletteList();
}

/**
 * Updates aria-selected and active class on a button element.
 *
 * @param {string} id - Button element ID.
 * @param {string} activeClass - Active modifier class.
 * @param {boolean} isActive - Active state boolean.
 */
function setTabButtonState(id, activeClass, isActive) {
  const btn = document.getElementById(id);
  if (btn) {
    btn.classList.toggle(activeClass, isActive);
    btn.setAttribute("aria-selected", String(isActive));
  }
}

/**
 * Switches between the interactive TUI simulator and the high-res reference screenshot.
 *
 * @param {string} mode - Either "simulator" or "screenshot".
 */
function setWorkbenchMode(mode) {
  const isSim = mode !== "screenshot";
  const simEl = document.getElementById("tui-simulator");
  const shotEl = document.getElementById("tui-screenshot-view");
  if (simEl) {
    simEl.hidden = !isSim;
  }
  if (shotEl) {
    shotEl.hidden = isSim;
  }
  setTabButtonState("mode-simulator-btn", "workbench__mode-btn--active", isSim);
  setTabButtonState("mode-screenshot-btn", "workbench__mode-btn--active", !isSim);
}

/**
 * Moves the commit graph cursor to a clamped index.
 *
 * @param {number} nextIndex - Target commit index.
 */
function selectCommitByIndex(nextIndex) {
  const commits = getFilteredCommits();
  if (commits.length === 0) {
    return;
  }
  const clamped = Math.max(0, Math.min(commits.length - 1, nextIndex));
  state.selectedCommitIndex = clamped;
  setFocusedRegion("6");
  renderCommitGraph();
  renderInspectorPanes();
  const selected = commits[clamped];
  if (selected && !selected.isWorkingTree) {
    appendConsoleLog(`git show --stat --patch ${selected.id}`, "11ms");
  }
}

/**
 * Focuses the commit graph search input.
 */
function focusGraphSearchInput() {
  const searchInput = document.getElementById("sim-graph-search");
  if (searchInput instanceof HTMLInputElement) {
    searchInput.focus();
  }
}

/**
 * Lookup table for single-key global workbench shortcuts.
 */
const SINGLE_KEY_ACTIONS = Object.freeze({
  "?": () => setPaletteOpen(true),
  F1: () => setPaletteOpen(true),
  F2: () => setPaletteOpen(true),
  1: () => setFocusedRegion("1"),
  2: () => setFocusedRegion("2"),
  3: () => setFocusedRegion("3"),
  4: () => setFocusedRegion("4"),
  5: () => setFocusedRegion("5"),
  6: () => setFocusedRegion("6"),
  7: () => setFocusedRegion("7"),
  8: () => setFocusedRegion("8"),
  9: toggleConsoleDrawer,
  j: () => selectCommitByIndex(state.selectedCommitIndex + 1),
  ArrowDown: () => selectCommitByIndex(state.selectedCommitIndex + 1),
  k: () => selectCommitByIndex(state.selectedCommitIndex - 1),
  ArrowUp: () => selectCommitByIndex(state.selectedCommitIndex - 1),
  g: toggleGraphStyle,
  G: () => selectCommitByIndex(getFilteredCommits().length - 1),
  t: cycleSimulatorTheme,
  y: copyActiveInstallCommand,
  "/": focusGraphSearchInput,
});

/**
 * Checks whether the event is a Ctrl/Cmd + P or K palette toggle chord.
 *
 * @param {KeyboardEvent} event - DOM keydown event.
 * @returns {boolean} True when the chord matches.
 */
function isPaletteChord(event) {
  const lower = event.key.toLowerCase();
  return (event.ctrlKey || event.metaKey) && (lower === "p" || lower === "k");
}

/**
 * Dispatches a single-key workbench shortcut if registered.
 *
 * @param {KeyboardEvent} event - DOM keydown event.
 */
function dispatchSingleKeyShortcut(event) {
  if (handleTypingEscape(event)) {
    return;
  }
  const handler = SINGLE_KEY_ACTIONS[event.key];
  if (handler) {
    event.preventDefault();
    handler();
  }
}

/**
 * Handles global keyboard shortcuts when no text input is capturing typing.
 *
 * @param {KeyboardEvent} event - DOM keydown event.
 */
function handleGlobalKeydown(event) {
  if (isPaletteChord(event)) {
    event.preventDefault();
    setPaletteOpen(!state.paletteOpen);
    return;
  }
  if (state.paletteOpen) {
    handlePaletteKeydown(event);
    return;
  }
  dispatchSingleKeyShortcut(event);
}

/**
 * Checks whether an input is focused and handles Escape to blur it.
 *
 * @param {KeyboardEvent} event - DOM keydown event.
 * @returns {boolean} True when a text input is currently focused.
 */
function handleTypingEscape(event) {
  const activeEl = document.activeElement;
  const isTyping = activeEl instanceof HTMLInputElement || activeEl instanceof HTMLTextAreaElement;
  if (isTyping && event.key === "Escape") {
    activeEl.blur();
  }
  return isTyping;
}

/**
 * Moves the Command Palette selection cursor by delta.
 *
 * @param {number} delta - Step offset (+1 or -1).
 */
function movePaletteCursor(delta) {
  const items = getFilteredPaletteCommands();
  if (items.length > 0) {
    state.paletteCursor = (state.paletteCursor + delta + items.length) % items.length;
    renderPaletteList();
  }
}

/**
 * Runs the currently highlighted Command Palette item.
 */
function executeActivePaletteCommand() {
  const chosen = getFilteredPaletteCommands()[state.paletteCursor];
  if (chosen) {
    setPaletteOpen(false);
    chosen.run();
  }
}

/**
 * Lookup table for open Command Palette keyboard navigation.
 */
const PALETTE_KEY_ACTIONS = Object.freeze({
  Escape: () => setPaletteOpen(false),
  ArrowDown: () => movePaletteCursor(1),
  ArrowUp: () => movePaletteCursor(-1),
  Enter: executeActivePaletteCommand,
});

/**
 * Handles keyboard navigation inside the open Command Palette modal.
 *
 * @param {KeyboardEvent} event - DOM keydown event.
 */
function handlePaletteKeydown(event) {
  const fn = PALETTE_KEY_ACTIONS[event.key];
  if (fn) {
    event.preventDefault();
    fn();
  }
}

/**
 * Logs branch switch when a branch row is selected in the sidebar.
 *
 * @param {string} panel - Panel key.
 * @param {number} idx - Row index.
 */
function logSidebarAction(panel, idx) {
  const branch = panel === "branches" ? SIDEBAR_DATA.branches[idx] : undefined;
  if (branch) {
    appendConsoleLog(`git switch ${branch.name}`, "12ms");
  }
}

/**
 * Handles clicks on a sidebar row inside the TUI simulator.
 *
 * @param {Element} sidebarRow - Clicked sidebar row element.
 */
function handleSidebarRowClick(sidebarRow) {
  const panel = sidebarRow.getAttribute("data-sidebar-panel") || "branches";
  const idx = Number(sidebarRow.getAttribute("data-sidebar-index"));
  const region = sidebarRow.getAttribute("data-sidebar-region") || "1";

  setFocusedRegion(region);
  state.sidebarSelection[panel] = idx;
  logSidebarAction(panel, idx);
  renderAllSidebarPanels();
}

/**
 * Focuses the simulator region enclosing the clicked target element.
 *
 * @param {HTMLElement} target - Clicked DOM element.
 */
function focusEnclosingRegion(target) {
  const regionId = target.closest("[data-region-id]")?.getAttribute("data-region-id");
  if (regionId) {
    setFocusedRegion(regionId);
  }
}

/**
 * Handles clicks inside the TUI simulator container.
 *
 * @param {MouseEvent} event - Click event.
 */
function handleSimulatorClick(event) {
  if (!(event.target instanceof HTMLElement)) {
    return;
  }
  const commitRow = event.target.closest("[data-commit-index]");
  if (commitRow) {
    selectCommitByIndex(Number(commitRow.getAttribute("data-commit-index")));
    return;
  }
  const sidebarRow = event.target.closest("[data-sidebar-panel]");
  if (sidebarRow) {
    handleSidebarRowClick(sidebarRow);
    return;
  }
  focusEnclosingRegion(event.target);
}

/**
 * Binds Hero installer and Workbench toolbar events.
 */
function bindWorkbenchEvents() {
  document.addEventListener("keydown", handleGlobalKeydown);

  for (const tab of document.querySelectorAll("[data-install-tab]")) {
    tab.addEventListener("click", () => setInstallTab(tab.getAttribute("data-install-tab") || ""));
  }

  document.getElementById("copy-install-btn")?.addEventListener("click", copyActiveInstallCommand);
  document
    .getElementById("footer-copy-trigger")
    ?.addEventListener("click", copyActiveInstallCommand);

  for (const modeBtn of document.querySelectorAll("[data-workbench-mode]")) {
    modeBtn.addEventListener("click", () =>
      setWorkbenchMode(modeBtn.getAttribute("data-workbench-mode") || "simulator"),
    );
  }

  document.getElementById("toggle-graph-style-btn")?.addEventListener("click", toggleGraphStyle);
  document.getElementById("footer-graph-trigger")?.addEventListener("click", toggleGraphStyle);
  document.getElementById("cycle-theme-btn")?.addEventListener("click", cycleSimulatorTheme);
  document.getElementById("toggle-console-btn")?.addEventListener("click", toggleConsoleDrawer);
  document.getElementById("footer-console-trigger")?.addEventListener("click", toggleConsoleDrawer);
  document.getElementById("clear-console-btn")?.addEventListener("click", () => {
    state.consoleLogs = [];
    renderConsoleLogs();
  });
}

/**
 * Binds simulator internal controls, mobile tabs, and graph search input.
 */
function bindSimulatorInternalEvents() {
  for (const cmdBtn of document.querySelectorAll("[data-sim-git]")) {
    cmdBtn.addEventListener("click", () =>
      runSimulatedGitRemote(cmdBtn.getAttribute("data-sim-git") || "fetch"),
    );
  }

  for (const mobTab of document.querySelectorAll("[data-mobile-pane]")) {
    mobTab.addEventListener("click", () => {
      const pane = mobTab.getAttribute("data-mobile-pane") || "graph";
      document.getElementById("tui-main-grid")?.setAttribute("data-mobile-active", pane);
      for (const btn of document.querySelectorAll("[data-mobile-pane]")) {
        btn.classList.toggle("tui__mobile-tab--active", btn === mobTab);
      }
    });
  }

  document.getElementById("tui-simulator")?.addEventListener("click", handleSimulatorClick);

  const graphSearch = document.getElementById("sim-graph-search");
  if (graphSearch instanceof HTMLInputElement) {
    graphSearch.addEventListener("input", () => {
      state.graphFilter = graphSearch.value;
      state.selectedCommitIndex = 0;
      renderCommitGraph();
      renderInspectorPanes();
    });
  }
}

/**
 * Updates the active keymap scope tab and re-renders the keybindings table.
 *
 * @param {Element} clickedBtn - The clicked scope tab button.
 */
function selectKeymapScopeButton(clickedBtn) {
  state.keymapScope = clickedBtn.getAttribute("data-keymap-scope") || "all";
  for (const b of document.querySelectorAll("[data-keymap-scope]")) {
    const active = b === clickedBtn;
    b.classList.toggle("keymap-box__scope-btn--active", active);
    b.setAttribute("aria-selected", String(active));
  }
  renderKeymapTable();
}

/**
 * Binds events for the Keymap Explorer filter controls.
 */
function bindKeymapEvents() {
  for (const scopeBtn of document.querySelectorAll("[data-keymap-scope]")) {
    scopeBtn.addEventListener("click", () => selectKeymapScopeButton(scopeBtn));
  }

  const keymapInput = document.getElementById("keymap-search-input");
  if (keymapInput instanceof HTMLInputElement) {
    keymapInput.addEventListener("input", () => {
      state.keymapQuery = keymapInput.value;
      renderKeymapTable();
    });
  }
}

/**
 * Binds events for the Config Blueprints tabs and Catppuccin theme pills.
 */
function bindConfigEvents() {
  for (const cfgTab of document.querySelectorAll("[data-config-tab]")) {
    cfgTab.addEventListener("click", () =>
      setConfigTab(cfgTab.getAttribute("data-config-tab") || "config"),
    );
  }

  document.getElementById("copy-config-btn")?.addEventListener("click", copyConfigSnippet);

  for (const pill of document.querySelectorAll("[data-theme-pick]")) {
    pill.addEventListener("click", () => {
      setSimulatorTheme(pill.getAttribute("data-theme-pick") || "catppuccin-mocha");
      scrollToSection("workbench");
    });
  }
}

/**
 * Copies the active configuration snippet to the clipboard.
 */
function copyConfigSnippet() {
  const spec = CONFIG_SNIPPETS[state.configTab] || CONFIG_SNIPPETS.config;
  copyToClipboard(spec.code, () => {
    setTextById("copy-config-label", "[Copied!]");
    setTimeout(() => setTextById("copy-config-label", "[Copy Snippet]"), 1500);
  });
}

/**
 * Binds events for the interactive Command Palette modal.
 */
function bindPaletteEvents() {
  document
    .getElementById("open-palette-btn")
    ?.addEventListener("click", () => setPaletteOpen(true));
  document
    .getElementById("footer-palette-trigger")
    ?.addEventListener("click", () => setPaletteOpen(true));
  document
    .getElementById("close-palette-btn")
    ?.addEventListener("click", () => setPaletteOpen(false));
  document
    .getElementById("palette-backdrop")
    ?.addEventListener("click", () => setPaletteOpen(false));

  const paletteInput = document.getElementById("palette-search-input");
  if (paletteInput instanceof HTMLInputElement) {
    paletteInput.addEventListener("input", () => {
      state.paletteQuery = paletteInput.value;
      state.paletteCursor = 0;
      renderPaletteList();
    });
  }

  document.getElementById("palette-command-list")?.addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target : null;
    const itemBtn = target?.closest("[data-palette-index]");
    if (itemBtn) {
      state.paletteCursor = Number(itemBtn.getAttribute("data-palette-index") || "0");
      executeActivePaletteCommand();
    }
  });
}

/**
 * CSS selector for blocks that fade and rise into view on scroll.
 */
const REVEAL_SELECTOR =
  ".workbench__header, .matrix__header, .reference__header, .matrix-card, .keymap-box, .config-box";

/**
 * Sets up the desktop scroll-reveal effect: each matching block fades and rises
 * in once it enters the viewport, then the reveal classes are removed so the
 * element's own hover styles can take over. No-op on narrow viewports and when
 * the visitor prefers reduced motion.
 */
function initScrollReveal() {
  const desktopQuery = window.matchMedia("(min-width: 781px)");
  const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  if (!desktopQuery.matches || motionQuery.matches) {
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) {
          continue;
        }
        const el = entry.target;
        el.classList.add("is-visible");
        el.addEventListener(
          "animationend",
          () => el.classList.remove("anim-reveal", "is-visible"),
          { once: true },
        );
        observer.unobserve(el);
      }
    },
    { threshold: 0.15 },
  );

  for (const el of document.querySelectorAll(REVEAL_SELECTOR)) {
    el.classList.add("anim-reveal");
    observer.observe(el);
  }
}

/**
 * Bootstraps the Gitminal documentation and interactive workbench page.
 */
function initApp() {
  renderAllSidebarPanels();
  renderCommitGraph();
  renderInspectorPanes();
  renderConsoleLogs();
  renderKeymapTable();
  setConfigTab("config");
  bindWorkbenchEvents();
  bindSimulatorInternalEvents();
  bindKeymapEvents();
  bindConfigEvents();
  bindPaletteEvents();
  initScrollReveal();
}

initApp();
