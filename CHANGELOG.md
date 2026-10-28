# Changelog

All notable changes to Gitminal are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.3.0] - 2026-10-28

### Changed

- Every scrollable surface now shares one scrollbar implementation through `src/ui/useScrollbarOptions.ts`: thumb and arrow foregrounds use the `scrollbar` token, track and arrow backgrounds use `background`, and the colors follow theme previews, restores, and terminal capability changes. Sidebar panels use a vertical-only scrollbar and hide the horizontal one.
- Modals now size to their content up to the terminal height instead of reserving a fixed height. `ModalFrame` applies one cell of content padding and one row of gap, short dialogs no longer render empty filler rows, and bounded option lists scroll instead of padding themselves out. Help keeps its explicit scroll viewport, and Delete Branch overrides the gap for its separately budgeted risk section.
- Branch name validation in the New Branch modal now follows edits after a failed submit, so a corrected name clears its inline error immediately.
- `stash.includeUntrackedByDefault` now defaults to `true`, so the Create Stash modal includes untracked files unless the user turns the checkbox off or overrides the setting.

## [1.2.0] - 2026-10-28

### Changed

- The splash update notice now suggests `bun add -g @im4all/gitminal` instead of the npm command, and names only the version to upgrade to because the running version is already shown above it.

## [1.1.0] - 2026-10-28

### Added

- Fetch and prune (`F`) now removes stale remote branches after the prune, not just remote-tracking refs, and reports the removed branches in the operation console.
- Global "stage all unstaged" action (`A`). The existing `S` binding stays scoped to the focused unstaged section.
- Diff scrolling controls: `J` and `K` scroll one line, `shift+down` and `shift+up` scroll five lines, and `H`, `L`, `shift+left`, and `shift+right` scroll horizontally by eight columns.
- Commit search results now scroll into view, and history can be paged explicitly with the `L` "load older commits" action or the in-list button. Scrolling and cursor movement never page the graph automatically.
- Mouse wheel and trackpad scrolling of the commit graph now moves the native viewport only and leaves the selection where it is.
- `ctrl+space` toggles the console as an alias for `ctrl+backtick` in WSL sessions, where Windows Terminal can encode the two chords identically.
- README terminal color guide covering `NO_COLOR`, `COLORTERM`, `TERM`, WSL, Linux, macOS, and Windows PowerShell.

### Changed

- Custom-row lists mount the whole bounded loaded window inside one `<scrollbox>` with viewport culling, so native scrollbars and scroll offsets describe the real list instead of a hand-rolled mounted slice.
- The footer shows a curated subset of keybindings instead of every binding.

### Fixed

- The repository watcher no longer hits the maximum listener warning.
- `S` consistently stages within the focused unstaged section.
- Drilling into a diff and its files scrolls the selected row into view.
- The prepublish hook runs the full check suite correctly.
- Formatting and lint issues found by the audit.

## [1.0.0] - 2026-10-27

### Added

- Initial public release of Gitminal, a keyboard-first terminal git client with full mouse support.
- Repository support for empty, detached HEAD, conflict, and normal states, with a background watch loop plus manual refresh.
- Commit graph with lazygit-style lanes, rounded and sharp glyph styles, selection, paging, search, and a pending changes row.
- Per-file unified diffs with hunk collapsing, context control, syntax highlighting through bundled tree-sitter grammars, and expand/collapse navigation.
- Working tree actions: stage, unstage, discard, delete untracked, stage all, unstage all, discard all, and their section-scoped and global variants, with confirmations, a status line, and an error overlay.
- Commit composer with message prefill, amend, commit options, identity handling, and no-verify variants.
- Sidebar panels for branches, remotes, tags, stashes, and worktrees, including create, delete, checkout, push, prune, and stash apply, pop, and delete.
- Remote operations for pull, push, force push with safe and overwrite variants, push without hooks, fetch, and fetch and prune, with busy state, progress, and a sync badge.
- Operation console with command, status, duration, and expandable output.
- Command palette, searchable Help, theme picker with Catppuccin flavors, and truecolor, 256-color, and monochrome capability detection.
- Optional `config.json`, `keybindings.json`, and `theme.json`, with environment overrides, per-field validation warnings, live reload, and configurable mouse and graph scope and style.
- Splash screen with package and version display plus a registry update check.
- Mouse support across lists, buttons, checkboxes, section headers, tables, and scrollbars.
- Architecture, boundary, glyph, and structure checks plus unit and integration test suites.
