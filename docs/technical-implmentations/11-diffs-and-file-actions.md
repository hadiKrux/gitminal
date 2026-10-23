# 11 Diffs and File Actions

## 1. Header

- Spec reference: `docs/product-spec.md` F-11 (lines 838-953), F-16 (lines 1067-1095), the keyboard map (lines 1539-1704), action IDs (lines 1705-1742), F-19 for the `diff.*` configuration keys, and F-20 for the diff theme tokens.
- Architecture contract: `docs/technical-implmentations/00-project-architecture.md`
- Region id: `diff` (`src/features/shell/regions.ts`)
- Dependencies: F-06 (a selected stash makes the panel read-only), F-08 (the Pending Changes row and commit selection drive the panel mode), F-09 (the composer becomes editable after staging), F-10 (commit details), F-15 (confirmations), F-16 (conflict banner, merge and rebase banner, binary and oversized states), F-17 (lazy loading and caps), F-18 (safety), F-19 (`diff.contextLines`, `diff.expandFirstWorkingFile`), F-20 (diff tokens).
- Owned paths:
  - `src/features/diff/DiffPanel.tsx`
  - `src/features/diff/DiffSection.tsx`
  - `src/features/diff/DiffFileRow.tsx`
  - `src/features/diff/DiffContent.tsx`
  - `src/features/diff/ConflictBanner.tsx`
  - `src/features/diff/useDiffPanel.ts`
  - `src/features/diff/useFileDiff.ts`
  - `src/domain/diff/diff.types.ts`
  - `src/domain/diff/diff.collapse.ts`
  - `src/domain/diff/diff.limits.ts`
  - `src/domain/git/git.diff.ts`
  - `src/domain/git/parsers/parse.diff.ts`
- Co-owned paths: `src/domain/git/git.status.ts` and `parsers/parse.status.ts` own the three sections; `src/domain/git/git.stashes.ts` and `git.log.ts` own the read-only commit and stash diffs.

## 2. Scope and non-goals

Scope: the three sections Working Directory, Staged Files, and Untracked Files in that order; section and file expand and collapse; per-file and bulk actions with confirmations for the destructive ones; empty, loading, error, and disabled states; file row contents including status letters, rename headers, and add and remove counts; inline unified diff through the OpenTUI `<diff>` component with theme-mapped added and removed backgrounds and signs; collapsed unchanged runs; binary and oversized notices; untracked full content; deleted files; mode-only metadata diffs; conflicts as `U` rows with a conflict banner and a synthetic conflict-marker patch, staged after external resolution; read-only behavior when a commit or stash is selected; the full keyboard map for the diff panel; the exact `<diff>` configuration and the collapse computation that runs before rendering; literal pathspec arguments; section-scoped bulk actions; rename-safe discard; and merge, rebase, and cherry-pick gating.

Non-goals: ours and theirs resolution actions (D5); hunk-level staging through `git add -p`; word-level diffs; side-by-side view; syntax highlighting inside diffs (diffs use `<diff>`, not `<code>`); editing a file in the app; diffing two arbitrary commits; blame; three-way conflict resolution inside the app.

## 3. OpenTUI components used

| Component | Where used | Why it is right |
| --- | --- | --- |
| `<box>` | Panel frame, section headers, file rows, conflict banner, notice rows | The only layout primitive; rows carry a status letter, counts, a path, and actions |
| `<text>` | Section titles, counts, file paths, notices, unchanged-run markers, hints | Every UI string is rendered through `<text>` |
| `<span>` | Inline status letter, add and remove counts, and the expand indicator inside one `<text>` | Inline styled runs inside a single `<text>` |
| `<scrollbox>` | The whole panel body: sections, file rows, and expanded diff content, with `viewportCulling` and a scrollbar | Scrollable region; a large working tree must be virtualized |
| `<diff>` | The inline unified diff of one expanded text file, inside `DiffContent.tsx` | Architecture section 6 rule 5 assigns every diff to `<diff>` with unified view, line numbers, and theme-mapped backgrounds |
| `<line-number>` | Not used | `<diff>` already draws its single gutter and signs; conflict markers are shown through `<diff>` |
| `<code>` | Not used | Architecture section 6 rule 5 reserves `<code>` for syntax-highlighted non-diff content |
| `<input>` | Not used in this feature | The diff panel has no text field; filtering lives in the sidebar panels |
| `<select>`, `<tab-select>` | Not used | Rows need custom content, so a `<scrollbox>` of `<box>` rows is required (section 6 rule 3) |

Hooks used:

| Hook | Where used | Why |
| --- | --- | --- |
| `useKeyboard` | Only inside `src/app/hooks/useHotkeys.ts` | Central dispatcher; this feature never calls it directly |
| `useAction` | `useDiffPanel.ts` registers only `diff` scoped handlers: `nav.up`, `nav.down`, `nav.pageUp`, `nav.pageDown`, `nav.expand`, `nav.collapse`, `diff.toggle`, `diff.stage`, `diff.unstage`, `diff.discard`, `diff.deleteUntracked`, `diff.stageAll`, `diff.unstageAll`, `diff.discardAll`, `diff.deleteAllUntracked` | Features receive action IDs, never raw key strings. `app.refresh` and every other global action are owned by the app and `useRepository`, never by this feature |
| `useListCursor` | `useDiffPanel.ts` row navigation and double click detection | Shared cursor and double click logic for custom rows |
| `useFileDiff` | `DiffContent.tsx` through `useDiffPanel.ts` | Lazy per-file diff load with a single in-flight request |
| `useFocusRegion` | `DiffPanel.tsx` refreshes the sections when `focused` flips true | Region focus is derived from native focus; `useFocus` only reports terminal-window focus |
| `useTerminalDimensions` | `DiffFileRow.tsx` computes the path truncation budget | Budget-aware truncation through `@/lib/text.ts` |
| `useOverlay` | `useDiffPanel.ts` opens the destructive confirmations | Modal stack lives in `OverlayProvider` |
| `useTheme` | `DiffContent.tsx` reads the diff tokens through `@/theme/useTokens.ts` | Diffs map added and removed backgrounds from theme tokens, never hex literals |
| `useRepository`, `useStatus` | `useDiffPanel.ts` reads the snapshot and publishes status | Provider state is never copied locally |

All icons and markers used by this feature come from `src/theme/icons.ts`; see architecture section 6.1. No glyph literal is written in feature code.

## 4. Component tree

```text
DiffPanel
  Panel
    ConflictBanner (when conflicted files exist, or a merge, rebase, or cherry-pick is in progress)
    ScrollableList (scrollbox, viewportCulling, scrollbar when overflowing)
      DiffSection (Working Directory)
        SectionHeader (indicator, title, count, bulk actions: Discard All, Stage All)
        DiffFileRow (one per file)
          ListRow (box)
            TextMarker (status letter M, A, D, R, C, or U)
            text (path; renames render as "old -> new")
              span (add and remove counts, when available)
              span (expand indicator "v" or ">")
          DiffContent (rendered only when the row is expanded)
            diff (unified, showLineNumbers, theme-mapped backgrounds)
            text (unchanged-run marker "N unchanged lines")
            text (binary notice "Binary file - preview unavailable")
            text (oversized notice "File too large to preview" with the size)
            text (metadata-only notice for a mode-only change)
            text (truncation notice when diff.limits.ts caps the diff)
      DiffSection (Staged Files)
        SectionHeader (bulk action: Unstage All)
      DiffSection (Untracked Files)
        SectionHeader (bulk actions: Delete All, Stage All)
      LoadingRow (while a section read is in flight)
      EmptyState (per empty section)
      ErrorState (status read failed, with Retry)
```

Read-only mode, when the `RepositoryProvider` selection is a commit or a stash:

```text
DiffPanel (read-only)
  Panel
    PanelHeader (title "Commit <short sha>" or "Stash <message>")
    ScrollableList
      DiffFileRow (one per changed file, no action buttons)
        DiffContent (unified diff, read-only)
```

In read-only mode the three sections are replaced by a single file list from the commit or stash, there are no bulk actions, and the per-file actions are disabled with the reason "read-only".

Conflict rows use the same `DiffContent` component with a synthetic unified patch built from the working-tree bytes, never git's combined `--cc` output. The patch has its own file header, recomputed `@@` headers, and the conflict markers as text, so the renderer sees real hunks.

## 5. Enforced files and folders

- `src/features/diff/DiffPanel.tsx` - panel composition, region registration, section list, read-only mode switch, action wiring.
- `src/features/diff/DiffSection.tsx` - one section header with the indicator, title, count, and bulk actions.
- `src/features/diff/DiffFileRow.tsx` - one file row: status letter, path, rename header, counts, expand indicator, per-file actions.
- `src/features/diff/DiffContent.tsx` - renders the `<diff>` component, unchanged-run markers, and binary, oversized, metadata-only, and truncation notices.
- `src/features/diff/ConflictBanner.tsx` - the conflict banner and the merge, rebase, or cherry-pick banner.
- `src/features/diff/useDiffPanel.ts` - section and file expansion state, cursor, selection preservation, command dispatch, read-only mode.
- `src/features/diff/useFileDiff.ts` - lazy per-file diff loading, single in-flight request, stale-result discard, per-path cache.
- `src/domain/diff/diff.types.ts` - `FileDiff`, `DiffHunk`, `DiffLine`, `DiffSegment`, and the section and status types.
- `src/domain/diff/diff.collapse.ts` - computes collapsed unchanged runs into `DiffSegment[]` before rendering.
- `src/domain/diff/diff.limits.ts` - line and byte caps, the oversized check, and the truncation flag.
- `src/domain/git/git.diff.ts` - all diff and file-action command builders, the literal pathspec wrapper, the synthetic conflict patch builder, and the size and binary probes.
- `src/domain/git/parsers/parse.diff.ts` - parses unified diff text into `FileDiff`.
- Tests colocated: `src/domain/git/parsers/parse.diff.test.ts`, `src/domain/diff/diff.collapse.test.ts`, `src/domain/diff/diff.limits.test.ts`, `src/domain/git/git.diff.test.ts`, `src/features/diff/DiffPanel.test.tsx`, `src/features/diff/DiffFileRow.test.tsx`, `src/features/diff/DiffContent.test.tsx`, `src/features/diff/useDiffPanel.test.tsx`, `src/features/diff/ConflictBanner.test.tsx`.

## 6. State model

Local view state (owned by `useDiffPanel.ts` and `useFileDiff.ts`):

- Section expansion map for Working Directory, Staged Files, and Untracked Files. All three are expanded by default (F-11).
- File expansion map keyed by repository-relative path. The first Working Directory file is expanded by default only when it has a text diff and `diff.expandFirstWorkingFile` is true; all other file rows are collapsed by default (F-11).
- Cursor index for the `diff` region, stored through `useListCursor` and persisted per region by `FocusProvider`. The cursor addresses a section header or a file row.
- Selected path and section, kept across a collapse so the previous file selection is restored when the section is expanded again and the path still exists (F-11).
- Per-file diff load state in `useFileDiff.ts`: idle, loading, loaded, or error, keyed by path and side (working or staged), with a generation token so a stale result is discarded.

Provider state (read, never recomputed here):

- `RepositoryProvider` snapshot: the three sections from `git.status.ts`, each file carrying the status letter, the old path for a rename, add and remove counts, and the working-versus-staged comparison; the conflicted-file set; the in-progress operation (merge, rebase, cherry-pick); the selection union (`pending`, `commit`, `stash`, `worktree`, or a diff file); and the pending counts. The selection is also the single source of the right-pane mode, so the panel does not store a second read-only flag.
- `ConfigProvider`: `diff.contextLines` (default 3, range 0 to 20) and `diff.expandFirstWorkingFile` (default true).
- `ThemeProvider` tokens read through `@/theme/useTokens.ts`: `diffAdd`, `diffRemove`, `diffAddBackground`, `diffRemoveBackground`, `diffContext`, and `diffHunk`.
- `StatusProvider`, `FocusProvider`, `OverlayProvider`, and `ConsoleProvider`.

Rules: this feature never recomputes the section membership, the pending counts, or the upstream state. It reads them from `@/domain/repository/repository.selectors.ts` and `git.status.ts` (architecture section 9).

## 7. Data flow

Generic path (architecture section 9):

```text
key or click -> action ID -> useAction handler -> useCommandRunner.runCommand(request)
  -> command runner (availability + serialization) -> @/domain/git/git.diff.ts -> git CLI
  -> CommandResult -> useCommandRunner applies RepositoryProvider refresh, console entry, status, and error overlay
  -> collapse -> limits -> DiffPanel re-render
```

| Action ID or refresh | Domain module | Git subcommand |
| --- | --- | --- |
| repository refresh (three sections) | `git.status.ts` `readStatus()` -> `parsers/parse.status.ts` | `git status --porcelain=v2 --branch -z --untracked-files=all` |
| working diff on expand | `git.diff.ts` `readWorkingDiff(path)` -> `parse.diff.ts` -> `diff.collapse.ts` -> `diff.limits.ts` | `git diff --no-color -U<diff.contextLines> -- :(literal)<path>` |
| staged diff on expand | `git.diff.ts` `readStagedDiff(path)` -> `parse.diff.ts` | `git diff --cached --no-color -U<diff.contextLines> -- :(literal)<path>` |
| untracked full content | `git.diff.ts` `readUntrackedContent(path)`; every line is an added line | bounded domain file read of `path`; no git path argument |
| deleted file diff | `git.diff.ts` `readWorkingDiff(path)`; all lines are removed | `git diff --no-color -U<diff.contextLines> -- :(literal)<path>` |
| rename header and content | `git.diff.ts` `readWorkingDiff(paths)` with rename detection | `git diff -M --no-color -U<diff.contextLines> -- :(literal)<oldPath> :(literal)<newPath>` |
| mode-only metadata diff | `git.diff.ts` `readWorkingDiff(path)`; the output is `old mode` and `new mode` lines | `git diff --no-color -- :(literal)<path>` |
| conflicted-file patch | `git.diff.ts` `readConflictDiff(path)` builds a synthetic unified patch from the working-tree bytes; never `git diff --cc` | no combined diff command; the patch is assembled in the domain layer with recomputed `@@` headers |
| binary probe | `git.diff.ts` `probeBinary(path)` | `git diff --numstat --no-color -- :(literal)<path>` returns `-` `-` for a binary file |
| oversized probe | `git.diff.ts` `probeSize(path)` -> `diff.limits.ts` | `git diff --numstat -- :(literal)<path>` counts, plus a file size read in the domain layer |
| `diff.stage` | `git.diff.ts` `stageFile(paths)` | `git add -- :(literal)<path>` |
| `diff.unstage` | `git.diff.ts` `unstageFile(paths)` | `git restore --staged -- :(literal)<path>` |
| `diff.discard` (tracked working) | `git.diff.ts` `discardFile(paths)` | `git restore -- :(literal)<path>` |
| `diff.stageAll` (Working Directory) | `git.diff.ts` `stagePaths(paths)` with only the working-tree path set | `git add -- :(literal)<path1> :(literal)<path2> ...` |
| `diff.stageAll` (Untracked Files) | `git.diff.ts` `stagePaths(paths)` with only the untracked path set | `git add -- :(literal)<path1> :(literal)<path2> ...` |
| `diff.unstageAll` | `git.diff.ts` `unstagePaths(paths)` with only the staged path set | `git restore --staged -- :(literal)<path1> :(literal)<path2> ...` |
| `diff.discardAll` (Working Directory) | `git.diff.ts` `discardPaths(paths)` with only tracked working paths | `git restore -- :(literal)<path1> :(literal)<path2> ...` |
| `diff.deleteUntracked` | `git.diff.ts` `deleteUntrackedFile(path)` | scoped delete of the exact untracked path through `git clean -f -- :(literal)<path>` or an exact unlink |
| `diff.deleteAllUntracked` | `git.diff.ts` `deleteAllUntracked(paths)` with only the untracked path set | `git clean -f -d -- :(literal)<path1> :(literal)<path2> ...`; never `-x` and never a wildcard |
| commit read-only diff | `git.log.ts` `readCommitDiff(sha)` -> `parse.diff.ts` | `git show --no-color -U<diff.contextLines> --format= --diff-merges=first-parent <sha>` |
| stash read-only diff | `git.stashes.ts` `showStash(ref)` -> `parse.diff.ts` | `git stash show -p --no-color <ref>` |

Section to action mapping: `diff.stage` and `diff.stageAll` apply to Working Directory and Untracked Files, but each bulk command receives only its own section's path set. `diff.discard` and `diff.discardAll` act only on tracked working-tree paths; `diff.deleteUntracked` and `diff.deleteAllUntracked` act only on untracked paths; `diff.unstage` and `diff.unstageAll` act only on staged paths. The `diff` context binds `d` and `D` to the tracked intent on a tracked working row and to the untracked intent on an untracked row.

Bulk actions apply only to the section's own path set. Working Directory Stage All stages only the working-tree paths listed in that section, Untracked Stage All stages only the untracked paths, Unstage All unstages only the staged paths, and Discard All discards only tracked working paths. A rename contributes both of its paths to the section set, and bulk discard applies the same rename rule as the per-file command. The builders never use `git add -A -- .`, `git restore -- .`, or any whole-tree pathspec.

Literal pathspecs: every git path argument is wrapped as `:(literal)<path>`, never passed as a raw path. The builder receives repository-relative paths from the status parser and wraps each one itself; UI code never constructs a pathspec. Git therefore treats bracket and glob characters literally, so a file named `a[1].txt` can never stage or discard `a1.txt`.

Renames carry both paths. Stage, unstage, and diff commands pass both `:(literal)<oldPath>` and `:(literal)<newPath>`. Discarding a rename restores `oldPath` from the index and then removes `newPath` only after a status read confirms `newPath` is untracked; if it is tracked or still referenced, the new path is left in place and the result reports the partial discard. No wildcard is used.

Conflicted files are never rendered from combined output. `readConflictDiff(path)` reads the working-tree file and assembles a synthetic unified patch: a file header, a recomputed `@@ -1,N +1,N @@` header, and the file's lines, including the `<<<<<<<`, `=======`, and `>>>>>>>` markers, carried as context text. `git diff --cc` and `git show --cc` are never passed to `<diff>`, because the patch parser reads them as zero hunks and renders blank.

### Command registration, targets, and availability

`useDiffPanel.ts` registers handlers with `useAction(actionId, { scope: "diff", targetKind }, handler)`. Exactly one handler may exist per `(actionId, scope)`; a duplicate registration is a development error and the later one is rejected, never last-mounted-wins. The feature registers only `diff` scoped handlers for the actions in section 8. It never registers `app.refresh` or any other global action: `app.refresh` is owned by the app and `useRepository`, `focus.*` and `overlay.close` are owned by the shell or the overlay, and no feature calls `RepositoryProvider.refresh()` directly.

Every handler receives an explicit target. Section and bulk handlers use a target derived from the section, never an ambient cursor. Per-file handlers use `{ kind: "diffFile", section, path, oldPath? }`, where `section` is `working`, `staged`, or `untracked`, and a rename carries `oldPath` and `path` as the new path. Availability is target-aware through `getAvailability(commandId, { state, signals, target, region, operation })`:

- `diff.discard` and `diff.discardAll` are available only for tracked working-tree targets. `diff.deleteUntracked` and `diff.deleteAllUntracked` are available only for untracked targets.
- `diff.unstage` and `diff.unstageAll` are available only for staged targets. `diff.unstageAll` is unavailable during a merge, rebase, or cherry-pick with the reason "merge state", and `diff.unstage` is unavailable there when the target file is conflicted, because `git restore --staged` would destroy the merge stages. Per-file unstage of a non-conflicted staged file remains available.
- `diff.stageAll` is unavailable during a merge, rebase, or cherry-pick with the reason "merge state" because it can stage conflict markers as resolved. Per-file `diff.stage` remains available so the user can stage a file after resolving it externally.
- Every action is unavailable in read-only mode (a commit or stash selection) with the reason "read-only", and during a conflicting write with the reason "operation in progress".
- A bulk action on an empty section is unavailable with the reason "no files".

The footer, palette, help, buttons, and confirmations all read the same result.

## 8. Keyboard and focus

| Action ID | Behavior in the Diff region |
| --- | --- |
| `nav.up`, `nav.down` | Move the cursor one row, across section headers and file rows |
| `nav.pageUp`, `nav.pageDown` | Move by a screen |
| `nav.expand` | Expand the selected section or file row |
| `nav.collapse` | Collapse the selected section or file row |
| `diff.toggle` | Toggle the selected file row; this ID shadows `nav.activate` in the diff panel (F-11) |
| `diff.stage` | Stage the selected file; no confirmation |
| `diff.unstage` | Unstage the selected file; no confirmation |
| `diff.discard` | Discard the selected tracked working-tree file; unavailable on untracked rows |
| `diff.deleteUntracked` | Delete the selected untracked file, with confirmation |
| `diff.stageAll` | Stage all files in the current section, using only that section's path set; unavailable during a merge, rebase, or cherry-pick |
| `diff.unstageAll` | Unstage all files in the current section, using only the staged path set; unavailable during a merge, rebase, or cherry-pick |
| `diff.discardAll` | Discard all tracked working-tree files in the current section, with confirmation |
| `diff.deleteAllUntracked` | Delete all untracked files in the current section, with confirmation |
| `focus.next`, `focus.previous` | Tab traversal (owned by `useFocusModel`) |
| `focus.region.diff` | Direct jump to the Diff panel (default `8`), shell-owned |

Notes: Up and Down or `j` and `k` move, Left and Right or `h` and `l` collapse and expand, and Enter toggles a file (F-11). The `diff` context binds `d` and `D` to the intent that matches the selected row: `diff.discard` and `diff.discardAll` on tracked working rows, `diff.deleteUntracked` and `diff.deleteAllUntracked` on untracked rows. The footer reflects the current section and selected row, so a Working Directory row shows Stage and Discard while an Untracked row shows Stage and Delete and a Staged Files row shows Unstage. In read-only mode every stage, unstage, discard, and delete action is unavailable with the reason "read-only". During a merge, rebase, or cherry-pick, `diff.stageAll`, `diff.unstageAll`, and unstaging a conflicted file are unavailable with the reason "merge state"; per-file stage on a resolved file remains available. Confirmations are overlays and own all keys while open, with `overlay.close` cancelling.

## 9. Loading, empty, error, and disabled states

- Loading, section: a `LoadingRow` with the text marker `[..]` and "loading changes" while the first status read is in flight.
- Loading, file: the expanded `DiffContent` shows a `LoadingRow` with "loading diff" while `useFileDiff` is in flight.
- Empty, Working Directory: `EmptyState` with "No unstaged changes" and disabled bulk actions.
- Empty, Staged Files: `EmptyState` with "No staged changes" and disabled bulk actions.
- Empty, Untracked Files: `EmptyState` with "No untracked files" and disabled bulk actions.
- Error, status: `ErrorState` with "Could not read status" plus the git error text and a Retry button.
- Error, file diff: an inline `ErrorState` inside the expanded row with "Could not read diff for <path>" and Retry; the row stays expanded.
- Disabled, bulk action on an empty section: unavailable with the reason "no files".
- Disabled, any action during a running operation: unavailable with the reason "operation in progress" (F-11).
- Disabled, read-only mode: all stage, unstage, discard, and delete actions are unavailable with the reason "read-only" (F-11).
- Disabled, merge, rebase, or cherry-pick: `diff.unstageAll` and unstaging a conflicted file are unavailable because `git restore --staged` destroys the merge stages; bulk `diff.stageAll` is unavailable because it can stage conflict markers as resolved. The reason is "merge state".
- Binary file: the row shows "Binary file - preview unavailable" and the actions remain available (F-11).
- Oversized file: the row shows "File too large to preview" with the size and the actions remain available (F-11).
- Conflicted file: a `U` status row in Working Directory, a `ConflictBanner` above the list, and a synthetic conflict-marker patch rendered through `<diff>`. The patch is built from the working-tree bytes, never from combined `--cc` output. A merge, rebase, or cherry-pick shows a persistent banner naming the operation (F-11, F-16).

## 10. Performance and bounds

- Lazy per-file diffs: a diff is read only when its file row is expanded. No diff is read for the whole working tree up front (F-17).
- One in-flight diff read at a time. Expanding a different file replaces the request; a stale result is discarded by a generation token, and loaded diffs are cached per path and side until the next repository refresh.
- `diff.limits.ts` applies a line cap and a byte cap per file and sets a truncation flag. Truncation cuts at a hunk boundary and never splits a hunk, and the kept prefix is re-serialized as a valid unified patch with recomputed `@@` headers. `DiffContent.tsx` renders a "diff truncated" notice with the shown and total counts (F-17).
- The oversized check runs before parsing: when the file size exceeds the preview limit, the read is skipped and `DiffContent.tsx` renders the oversized notice with the size. Binary files skip parsing the same way.
- File rows render inside a `<scrollbox>` with `viewportCulling`; only visible rows are rendered, which keeps a 10,000-file working tree navigable (F-17).
- Commit and stash diff reads are bounded and debounced, so moving the cursor does not flood the reads.
- Bulk actions run as one git write per section and are serialized by `commands.runner.ts`; the panel does not optimistically mutate the sections.
- Row truncation uses `@/lib/text.ts` with a budget from `useTerminalDimensions`; the path drops before the status letter and the expand indicator.

### How `<diff>` is configured

`DiffContent.tsx` renders exactly one `<diff>` component per kept diff segment. The configuration is fixed by architecture section 6 rule 5:

- `diff={segmentText}`: the unified diff text for one contiguous kept region, produced by `parse.diff.ts` and `diff.collapse.ts`, never the raw git output. Every string is a complete, valid unified patch with its own file header and recomputed `@@` hunk headers.
- `view="unified"`: the only view used in v1; side-by-side is a non-goal.
- `showLineNumbers`: draws one line-number gutter, so the app does not add its own gutter. The mockup's two-gutter appearance is illustrative; v1 does not add a two-gutter renderer.
- `addedBg={tokens.diffAddBackground}` and `removedBg={tokens.diffRemoveBackground}`: the added and removed line backgrounds, resolved from the theme.
- `addedSignColor={tokens.diffAdd}` and `removedSignColor={tokens.diffRemove}`: the `+` and `-` sign colors.
- The component draws the `+` and `-` signs and the hunk headers itself, so `DiffContent.tsx` does not draw signs or gutters.
- The tokens come from `@/theme/useTokens.ts`. No component holds a hex literal, and with `NO_COLOR` the component falls back to monochrome while the signs and status letters remain.

### How collapse is computed before rendering

Collapse runs in the domain, before any string reaches `<diff>`:

1. `git.diff.ts` returns the raw unified diff text for one file.
2. `parse.diff.ts` splits it into a `FileDiff`: the file header lines, the hunks with their `@@ -old,+new @@` headers, and each line tagged `context`, `add`, `remove`, or `meta`, with its old and new line numbers. Rename headers (`rename from` and `rename to`), mode lines (`old mode` and `new mode`), and `\ No newline at end of file` are kept as `meta`.
3. `diff.limits.ts` caps the parsed line count and byte count and sets `truncated` when a cap is hit. Truncation runs before collapse, cuts only at a hunk boundary, and records the dropped count so `DiffContent.tsx` can render the truncation notice; it never splits a hunk or leaves a dangling `@@` header.
4. `diff.collapse.ts` walks each hunk and finds runs of consecutive `context` lines. A run longer than `2 * diff.contextLines + 1` is collapsed: the first `diff.contextLines` lines and the last `diff.contextLines` lines are kept, and the middle is replaced by one `DiffSegment` of kind `collapsed` carrying the count and the old and new start line numbers. Runs at or below the threshold are kept whole. The output is a `DiffSegment[]` of kind `diff` (a contiguous kept region) and kind `collapsed` (a marker).
5. Every `diff` segment is re-serialized into a complete unified patch: the original file header lines, then a recomputed `@@ -oldStart,oldCount +newStart,newCount @@` header derived from the segment's first and last kept lines, then those lines. The `collapsed` segment is never passed to `<diff>`; `DiffContent.tsx` renders it as a `<text>` marker row reading "N unchanged lines". This keeps the marker in the app style and guarantees that every string the renderer receives is a valid unified patch with a correct hunk header.

With `diff.contextLines` set to 0, no run is collapsed because the threshold is 1, and every unchanged line is hidden except the single context line kept at each edge of a run. Collapse and hunk re-serialization are pure and unit tested with fixtures, including a multi-hunk file and a truncated hunk tail.

## 11. Safety and confirmations

- No confirmation: `diff.stage`, `diff.unstage`, `diff.stageAll`, `diff.unstageAll` (F-11).
- `diff.discard` on a tracked file: the confirm label is "Discard changes" and the modal names the path and states that the working copy returns to the index version. It never deletes an untracked file.
- `diff.deleteUntracked`: the confirm label is "Delete untracked file" and the modal names the path and states that the file is removed from disk.
- `diff.discardAll`: the confirm label is "Discard changes" and the modal names the count of tracked files.
- `diff.deleteAllUntracked`: the confirm label names the count of untracked files and states that they are removed from disk.
- Destructive confirmations default focus to Cancel (F-15).
- Bulk actions apply only to the section's own path set: Working Directory Stage All stages only working-tree paths, Untracked Stage All stages only untracked paths, Unstage All unstages only staged paths, and Discard All discards only tracked working paths. No bulk command targets the whole working tree.
- Every git path argument is a literal pathspec, `:(literal)<path>`. Raw paths and wildcards are never passed, so brackets, stars, and question marks in a file name are matched literally.
- Renames use both paths. Discarding a rename restores the old path from the index and removes the new path only after a status read confirms it is untracked; a tracked or still-referenced new path is left in place and the partial result is reported. No wildcard is used.
- During a merge, rebase, or cherry-pick, `diff.unstageAll` and unstaging a conflicted file are disabled because `git restore --staged` destroys the merge stages. Bulk `diff.stageAll` is disabled because it can stage conflict markers as resolved. Per-file stage on a resolved file remains available.
- Conflicted files render from a synthetic unified patch built from the working-tree bytes, never from combined `--cc` output.
- No ours and theirs actions (D5). Conflicted files are staged only after the user resolves them externally.
- The app never auto-resolves, auto-stashes, resets, checks out, or cleans as a side effect (F-18). `git clean` is never run with `-x` and never with a wildcard.
- Discard restores from the index and never touches staged content.
- Failures keep the selection, the staged files, and the expanded state, and show the git error in the error overlay and the console.
- Every command runs through `git.client.ts` with an argument array and no shell, so a file name can never be interpreted as shell syntax; credentials in remote URLs are redacted before any console or error rendering.

## 12. Acceptance mapping

| F-11 acceptance bullet | Implementing module or component |
| --- | --- |
| The three sections reflect git status accurately | `git.status.ts` and `parsers/parse.status.ts`; `DiffPanel.tsx` renders Working Directory, Staged Files, Untracked Files in order |
| Each per-file and bulk action is available and does what its label says | `git.diff.ts` command builders; `DiffSection.tsx` and `DiffFileRow.tsx` action wiring; `commands.availability.ts` target-aware checks; section-scoped path sets |
| Destructive actions require confirmation and clearly state what will be lost | `diff.discard`, `diff.deleteUntracked`, `diff.discardAll`, and `diff.deleteAllUntracked` handlers; the "Discard changes" and "Delete untracked file" confirmations |
| Per-file and bulk commands treat paths literally and include both rename paths | `git.diff.ts` `:(literal)<path>` wrapper; rename path pairs from `parse.status.ts` |
| Bulk actions apply only to their section's paths | `DiffSection.tsx` passes the section path set; `git.diff.ts` `stagePaths`, `unstagePaths`, `discardPaths`, `deleteAllUntracked` |
| Merge, rebase, or cherry-pick disables unsafe bulk staging and unstaging | `commands.availability.ts` "merge state"; `useDiffPanel.ts` disabled states |
| Binary and oversized files show a clear notice and do not break the panel | `git.diff.ts` binary and size probes; `diff.limits.ts`; `DiffContent.tsx` notices |
| Expanding and collapsing preserves selection and does not refetch unnecessarily | `useDiffPanel.ts` selection preservation; `useFileDiff.ts` per-path cache and single in-flight request |
| Staged and working diffs show the correct comparison, not the same diff twice | `git.diff.ts` `readWorkingDiff()` uses `git diff`, `readStagedDiff()` uses `git diff --cached` |
| All three sections are expanded by default, and the first Working Directory file is expanded when it has a text diff | `useDiffPanel.ts` defaults; `diff.expandFirstWorkingFile` |
| Long runs of unchanged lines collapse behind a marker, and every rendered segment is a valid patch | `diff.collapse.ts`; hunk re-serialization before `<diff>`; the `collapsed` segment marker in `DiffContent.tsx` |
| Untracked files show full content as added lines, deleted files show all lines as removed, renames show a header, mode-only changes show metadata | `git.diff.ts` read builders; `parse.diff.ts`; `DiffContent.tsx` |
| Conflicts appear as `U` rows with a banner and a synthetic conflict-marker patch, and are staged after external resolution | `ConflictBanner.tsx`; `parse.status.ts` `U` rows; `git.diff.ts` `readConflictDiff()`; `diff.stage` |
| The unified diff renders one line-number gutter | `DiffContent.tsx` `<diff showLineNumbers>`; no custom two-gutter renderer |
| A commit or stash selection makes the panel read-only | `RepositoryProvider.selection`; `useDiffPanel.ts` read-only mode; `git.log.ts` and `git.stashes.ts` reads |
| If an operation is running, conflicting actions are disabled | `commands.availability.ts` "operation in progress"; `DiffPanel.tsx` disabled states |
| After an action, refresh the affected sections and keep the selection on the same path | `RepositoryProvider` refresh; `useDiffPanel.ts` path-keyed selection |

## 13. Tests to add

- `src/domain/git/parsers/parse.diff.test.ts`: parse recorded unified diff fixtures covering a single hunk, multiple hunks, correct old and new line numbering for context, add, and remove lines, a rename header (`rename from` and `rename to`), a mode-only change (`old mode` and `new mode`), a binary notice, `\ No newline at end of file`, and conflict markers in a synthetic patch.
- `src/domain/diff/diff.collapse.test.ts`: a run exactly at the threshold is kept; a run over the threshold is collapsed with the right count; the first and last context lines of a run are kept; multiple runs in one hunk; no collapse when `diff.contextLines` is 0; the segment boundaries match the parsed line numbers; every `diff` segment is a valid unified patch whose recomputed `@@` header matches its first and last line numbers.
- `src/domain/diff/diff.limits.test.ts`: the line cap, the byte cap, the oversized check, the truncation flag and counts, truncation at a hunk boundary, and recomputed headers for a truncated prefix.
- `src/domain/git/git.diff.test.ts`: argument construction for the working, staged, untracked, deleted, rename, conflict, commit, and stash reads, and for stage, unstage, discard, untracked delete, and the bulk variants; assert that every path argument is `:(literal)<path>` and that a path such as `a[1].txt` is never rewritten; assert that rename commands pass both old and new paths; assert that bulk stage and discard commands receive only their section's path set and never `.`; assert that `readConflictDiff()` does not invoke `--cc`; the oversized and binary skip paths; no spawning in unit tests.
- `src/features/diff/DiffFileRow.test.tsx`: status letters `M`, `A`, `D`, `R`, `C`, `U`, the rename `old -> new` header, add and remove counts, and the expand indicator.
- `src/features/diff/DiffContent.test.tsx`: the binary notice, the oversized notice, the truncation notice, the "N unchanged lines" marker, the metadata-only diff, and a synthetic conflict patch rendered with visible conflict markers.
- `src/features/diff/DiffPanel.test.tsx`: the three sections in order, the first Working Directory file expanded only when `diff.expandFirstWorkingFile` and it has a text diff, per-section bulk availability, section-scoped bulk dispatch, disabled actions during a running operation, disabled bulk staging and unstaging during a merge, rebase, or cherry-pick, read-only mode for a commit or stash selection, selection preserved across a collapse, and target-aware `diff.discard` versus `diff.deleteUntracked` availability.
- `src/features/diff/useDiffPanel.test.tsx`: duplicate `(actionId, scope)` registration is rejected; the feature registers no `app.refresh` or other global handler; bulk handlers receive only the section's paths; a handler with a stale or missing target returns a blocked result without refreshing.
- `src/features/diff/ConflictBanner.test.tsx`: the conflict banner text and the merge, rebase, or cherry-pick banner.
- `src/domain/keymap/keymap.resolve.test.ts` (shared): `d` resolves to `diff.discard` on a tracked working row and to `diff.deleteUntracked` on an untracked row; `D` resolves to `diff.discardAll` or `diff.deleteAllUntracked` by section; `diff.toggle` shadows `nav.activate` in the `diff` context.
- `src/domain/git/parsers/parse.status.test.ts` (shared): the canonical `git status --porcelain=v2 --branch -z --untracked-files=all` invocation and parsing of `-z` output with bracket characters and newlines in paths.

## 14. Open questions

- The exact line cap, byte cap, and oversized preview threshold. F-17 defers the numbers to this feature; confirm them and whether they are configurable.
- Whether `diff.unstage` uses `git restore --staged` and `diff.discard` uses `git restore`, both of which require git 2.23 or newer, or the older `git reset` and `git checkout --` forms. Confirm the minimum git version.
- Whether the first-file auto-expand should apply when the first Working Directory file is binary or oversized. This doc does not auto-expand those; it leaves them collapsed with the notice shown on expand.
- When discarding a rename, should a new path that is tracked or still referenced block the whole discard, or should the old path be restored and the partial result reported? This doc restores the old path and reports the partial result without removing a tracked new path.
- Whether untracked delete uses `git clean -f` or an exact domain unlink for a single file. Both paths are literal and scoped; confirm the preference after platform testing.
