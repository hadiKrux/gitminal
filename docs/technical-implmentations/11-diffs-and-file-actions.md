# 11 Diffs and File Actions

## 1. Header

- Status: Draft for review
- Spec reference: `docs/product-spec.md` F-11 (lines 801-909), decision D5 (line 1739), action IDs (lines 1583-1611), diff config keys (lines 1155-1156), conflict and binary states (lines 1038 and 1043), diff performance (lines 1075-1076), diff theme tokens (lines 1405-1413)
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

Scope: the three sections Working Directory, Staged Files, and Untracked Files in that order; section and file expand and collapse; per-file and bulk actions with confirmations for the destructive ones; empty, loading, error, and disabled states; file row contents including status letters, rename headers, and add and remove counts; inline unified diff through the OpenTUI `<diff>` component with theme-mapped added and removed backgrounds and signs; collapsed unchanged runs; binary and oversized notices; untracked full content; deleted files; mode-only metadata diffs; conflicts as `U` rows with a conflict banner and a conflict-marker diff, staged after external resolution; read-only behavior when a commit or stash is selected; the full keyboard map for the diff panel; the exact `<diff>` configuration and the collapse computation that runs before rendering.

Non-goals: ours and theirs resolution actions (D5); hunk-level staging through `git add -p`; word-level diffs; side-by-side view; syntax highlighting inside diffs (diffs use `<diff>`, not `<code>`); editing a file in the app; diffing two arbitrary commits; blame; three-way conflict resolution inside the app.

## 3. OpenTUI components used

| Component | Where used | Why it is right |
| --- | --- | --- |
| `<box>` | Panel frame, section headers, file rows, conflict banner, notice rows | The only layout primitive; rows carry a status letter, counts, a path, and actions |
| `<text>` | Section titles, counts, file paths, notices, unchanged-run markers, hints | Every UI string is rendered through `<text>` |
| `<span>` | Inline status letter, add and remove counts, and the expand indicator inside one `<text>` | Inline styled runs inside a single `<text>` |
| `<scrollbox>` | The whole panel body: sections, file rows, and expanded diff content, with `viewportCulling` and a scrollbar | Scrollable region; a large working tree must be virtualized |
| `<diff>` | The inline unified diff of one expanded text file, inside `DiffContent.tsx` | Architecture section 6 rule 5 assigns every diff to `<diff>` with unified view, line numbers, and theme-mapped backgrounds |
| `<line-number>` | Not used | `<diff>` already draws gutters and signs; conflict markers are shown through `<diff>` |
| `<code>` | Not used | Architecture section 6 rule 5 reserves `<code>` for syntax-highlighted non-diff content |
| `<input>` | Not used in this feature | The diff panel has no text field; filtering lives in the sidebar panels |
| `<select>`, `<tab-select>` | Not used | Rows need custom content, so a `<scrollbox>` of `<box>` rows is required (section 6 rule 3) |

Hooks used:

| Hook | Where used | Why |
| --- | --- | --- |
| `useKeyboard` | Only inside `src/app/hooks/useHotkeys.ts` | Central dispatcher; this feature never calls it directly |
| `useAction` | `useDiffPanel.ts` registers `nav.up`, `nav.down`, `nav.pageUp`, `nav.pageDown`, `nav.expand`, `nav.collapse`, `diff.toggle`, `diff.stage`, `diff.unstage`, `diff.discard`, `diff.stageAll`, `diff.unstageAll`, `diff.discardAll`, `app.refresh` | Features receive action IDs, never raw key strings |
| `useListCursor` | `useDiffPanel.ts` row navigation and double click detection | Shared cursor and double click logic for custom rows |
| `useFileDiff` | `DiffContent.tsx` through `useDiffPanel.ts` | Lazy per-file diff load with a single in-flight request |
| `useFocus` | `DiffPanel.tsx` refreshes the sections when the region gains focus | Keeps external edits visible |
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
- `src/domain/git/git.diff.ts` - all diff and file-action command builders, and the size and binary probes.
- `src/domain/git/parsers/parse.diff.ts` - parses unified diff text into `FileDiff`.
- Tests colocated: `src/domain/git/parsers/parse.diff.test.ts`, `src/domain/diff/diff.collapse.test.ts`, `src/domain/diff/diff.limits.test.ts`, `src/domain/git/git.diff.test.ts`, `src/features/diff/DiffPanel.test.tsx`, `src/features/diff/DiffFileRow.test.tsx`, `src/features/diff/DiffContent.test.tsx`, `src/features/diff/ConflictBanner.test.tsx`.

## 6. State model

Local view state (owned by `useDiffPanel.ts` and `useFileDiff.ts`):

- Section expansion map for Working Directory, Staged Files, and Untracked Files. All three are expanded by default (F-11 line 844).
- File expansion map keyed by repository-relative path. The first Working Directory file is expanded by default only when it has a text diff and `diff.expandFirstWorkingFile` is true; all other file rows are collapsed by default (F-11 line 847).
- Cursor index for the `diff` region, stored through `useListCursor` and persisted per region by `FocusProvider`. The cursor addresses a section header or a file row.
- Selected path and section, kept across a collapse so the previous file selection is restored when the section is expanded again and the path still exists (F-11 line 848).
- Per-file diff load state in `useFileDiff.ts`: idle, loading, loaded, or error, keyed by path and side (working or staged), with a generation token so a stale result is discarded.

Provider state (read, never recomputed here):

- `RepositoryProvider` snapshot: the three sections from `git.status.ts`, each file carrying the status letter, the old path for a rename, add and remove counts, and the working-versus-staged comparison; the conflicted-file set; the in-progress operation (merge, rebase, cherry-pick); the current selection (Pending Changes, commit, or stash); and the pending counts.
- `ConfigProvider`: `diff.contextLines` (default 3, range 0 to 20) and `diff.expandFirstWorkingFile` (default true).
- `ThemeProvider` tokens read through `@/theme/useTokens.ts`: `diffAdd`, `diffRemove`, `diffAddBackground`, `diffRemoveBackground`, `diffContext`, and `diffHunk`.
- `StatusProvider`, `FocusProvider`, `OverlayProvider`, and `ConsoleProvider`.

Rules: this feature never recomputes the section membership, the pending counts, or the upstream state. It reads them from `@/domain/repository/repository.selectors.ts` and `git.status.ts` (architecture section 9).

## 7. Data flow

Generic path (architecture section 9):

```text
key or click -> action ID -> useAction handler -> command from @/domain/commands/commands.registry
  -> command runner (availability + serialization) -> @/domain/git/git.diff.ts -> git CLI
  -> parse -> collapse -> limits -> RepositoryProvider refresh -> DiffPanel re-render -> console entry + status
```

| Action ID or refresh | Domain module | Git subcommand |
| --- | --- | --- |
| repository refresh (three sections) | `git.status.ts` `readStatus()` -> `parsers/parse.status.ts` | `git status --porcelain=v2 --branch -z` |
| working diff on expand | `git.diff.ts` `readWorkingDiff(path)` -> `parse.diff.ts` -> `diff.collapse.ts` -> `diff.limits.ts` | `git diff --no-color -U<diff.contextLines> -- <path>` |
| staged diff on expand | `git.diff.ts` `readStagedDiff(path)` -> `parse.diff.ts` | `git diff --cached --no-color -U<diff.contextLines> -- <path>` |
| untracked full content | `git.diff.ts` `readUntrackedContent(path)`; every line is an added line | `git diff --no-color --no-index /dev/null -- <path>` or a bounded file read in the domain layer |
| deleted file diff | `git.diff.ts` `readWorkingDiff(path)`; all lines are removed | `git diff --no-color -U<diff.contextLines> -- <path>` |
| rename header and content | `git.diff.ts` `readWorkingDiff(path)` with rename detection | `git diff -M --no-color -U<diff.contextLines> -- <path>` |
| mode-only metadata diff | `git.diff.ts` `readWorkingDiff(path)`; the output is `old mode` and `new mode` lines | `git diff --no-color -- <path>` |
| conflict-marker diff | `git.diff.ts` `readConflictDiff(path)` | `git diff --no-color -- <path>` shows the `<<<<<<<`, `=======`, `>>>>>>>` markers |
| binary probe | `git.diff.ts` `probeBinary(path)` | `git diff --numstat --no-color -- <path>` returns `-` `-` for a binary file |
| oversized probe | `git.diff.ts` `probeSize(path)` -> `diff.limits.ts` | `git diff --numstat` counts, plus a file size read in the domain layer |
| `diff.stage` | `git.diff.ts` `stageFile()` | `git add -- <path>` |
| `diff.unstage` | `git.diff.ts` `unstageFile()` | `git restore --staged -- <path>` |
| `diff.discard` (working) | `git.diff.ts` `discardFile()` | `git restore -- <path>` |
| `diff.stageAll` (Working Directory) | `git.diff.ts` `stageAll(section)` | `git add -A -- .` |
| `diff.stageAll` (Untracked Files) | `git.diff.ts` `stageAll(section)` | `git add -A -- .` |
| `diff.unstageAll` | `git.diff.ts` `unstageAll()` | `git restore --staged -- .` |
| `diff.discardAll` (Working Directory) | `git.diff.ts` `discardAll()` | `git restore -- .` |
| `diff.discard` (untracked delete) | `git.diff.ts` `deleteUntracked(path)` | scoped unlink of the exact path, or `git clean -f -- <path>` |
| `diff.discardAll` (untracked delete all) | `git.diff.ts` `deleteAllUntracked()` | `git clean -f -d` scoped to the untracked set; never `-x` |
| commit read-only diff | `git.log.ts` `readCommitDiff(sha)` -> `parse.diff.ts` | `git show --no-color -U<diff.contextLines> --format= <sha>` |
| stash read-only diff | `git.stashes.ts` `showStash(ref)` -> `parse.diff.ts` | `git stash show -p --no-color <ref>` |

Section to action mapping: `diff.stage`, `diff.stageAll`, `diff.discard`, and `diff.discardAll` apply to Working Directory and Untracked Files; `diff.unstage`, `diff.unstageAll` apply to Staged Files; `diff.discard` restores a tracked file and deletes an untracked file, so its label and confirmation follow the section. Untracked delete uses a scoped path list and never a wildcard that could escape the repository.

## 8. Keyboard and focus

| Action ID | Behavior in the Diff region |
| --- | --- |
| `nav.up`, `nav.down` | Move the cursor one row, across section headers and file rows |
| `nav.pageUp`, `nav.pageDown` | Move by a screen |
| `nav.expand` | Expand the selected section or file row |
| `nav.collapse` | Collapse the selected section or file row |
| `diff.toggle` | Toggle the selected file row; this ID shadows `nav.activate` in the diff panel (spec line 1607) |
| `diff.stage` | Stage the selected file; no confirmation |
| `diff.unstage` | Unstage the selected file; no confirmation |
| `diff.discard` | Discard or delete the selected file, with the confirmation for its section |
| `diff.stageAll` | Stage all files in the current section; no confirmation |
| `diff.unstageAll` | Unstage all files in the current section; no confirmation |
| `diff.discardAll` | Discard or delete all files in the current section, with confirmation |
| `app.refresh` | Manual refresh of repository state |
| `focus.next`, `focus.previous` | Tab traversal (owned by `useFocusModel`) |

Notes: Up and Down or `j` and `k` move, Left and Right or `h` and `l` collapse and expand, and Enter toggles a file (F-11 lines 885-893). The footer reflects the current section and selected row, so a Working Directory row shows Stage and Discard while a Staged Files row shows Unstage. In read-only mode `diff.stage`, `diff.unstage`, `diff.discard`, `diff.stageAll`, `diff.unstageAll`, and `diff.discardAll` are unavailable with the reason "read-only". Confirmations are overlays and own all keys while open, with `overlay.close` cancelling.

## 9. Loading, empty, error, and disabled states

- Loading, section: a `LoadingRow` with the text marker `[..]` and "loading changes" while the first status read is in flight.
- Loading, file: the expanded `DiffContent` shows a `LoadingRow` with "loading diff" while `useFileDiff` is in flight.
- Empty, Working Directory: `EmptyState` with "No unstaged changes" and disabled bulk actions.
- Empty, Staged Files: `EmptyState` with "No staged changes" and disabled bulk actions.
- Empty, Untracked Files: `EmptyState` with "No untracked files" and disabled bulk actions.
- Error, status: `ErrorState` with "Could not read status" plus the git error text and a Retry button.
- Error, file diff: an inline `ErrorState` inside the expanded row with "Could not read diff for <path>" and Retry; the row stays expanded.
- Disabled, bulk action on an empty section: unavailable with the reason "no files".
- Disabled, any action during a running operation: unavailable with the reason "operation in progress" (F-11 line 880).
- Disabled, read-only mode: all stage, unstage, and discard actions are unavailable with the reason "read-only" (F-11 lines 896-899).
- Binary file: the row shows "Binary file - preview unavailable" and the actions remain available (F-11 line 864).
- Oversized file: the row shows "File too large to preview" with the size and the actions remain available (F-11 line 865).
- Conflicted file: a `U` status row in Working Directory, a `ConflictBanner` above the list, and a conflict-marker diff. A merge, rebase, or cherry-pick shows a persistent banner naming the operation (F-11 line 840).

## 10. Performance and bounds

- Lazy per-file diffs: a diff is read only when its file row is expanded. No diff is read for the whole working tree up front (F-17 line 1075).
- One in-flight diff read at a time. Expanding a different file replaces the request; a stale result is discarded by a generation token, and loaded diffs are cached per path and side until the next repository refresh.
- `diff.limits.ts` applies a line cap and a byte cap per file and sets a truncation flag. `DiffContent.tsx` renders a "diff truncated" notice with the shown and total counts (F-17 line 1076).
- The oversized check runs before parsing: when the file size exceeds the preview limit, the read is skipped and `DiffContent.tsx` renders the oversized notice with the size. Binary files skip parsing the same way.
- File rows render inside a `<scrollbox>` with `viewportCulling`; only visible rows are rendered, which keeps a 10,000-file working tree navigable (F-17 line 1066).
- Commit and stash diff reads are bounded and debounced, so moving the cursor does not flood the reads.
- Bulk actions run as one git write per section and are serialized by `commands.runner.ts`; the panel does not optimistically mutate the sections.
- Row truncation uses `@/lib/text.ts` with a budget from `useTerminalDimensions`; the path drops before the status letter and the expand indicator.

### How `<diff>` is configured

`DiffContent.tsx` renders exactly one `<diff>` component per kept diff segment. The configuration is fixed by architecture section 6 rule 5:

- `diff={segmentText}`: the unified diff text for one contiguous kept region, produced by `parse.diff.ts` and `diff.collapse.ts`, never the raw git output.
- `view="unified"`: the only view used in v1; side-by-side is a non-goal.
- `showLineNumbers`: draws the old and new line-number gutters, so the app does not add its own gutter.
- `addedBg={tokens.diffAddBackground}` and `removedBg={tokens.diffRemoveBackground}`: the added and removed line backgrounds, resolved from the theme.
- `addedSignColor={tokens.diffAdd}` and `removedSignColor={tokens.diffRemove}`: the `+` and `-` sign colors.
- The component draws the `+` and `-` signs and the hunk headers itself, so `DiffContent.tsx` does not draw signs or gutters.
- The tokens come from `@/theme/useTokens.ts`. No component holds a hex literal, and with `NO_COLOR` the component falls back to monochrome while the signs and status letters remain.

### How collapse is computed before rendering

Collapse runs in the domain, before any string reaches `<diff>`:

1. `git.diff.ts` returns the raw unified diff text for one file.
2. `parse.diff.ts` splits it into a `FileDiff`: the file header lines, the hunks with their `@@ -old,+new @@` headers, and each line tagged `context`, `add`, `remove`, or `meta`, with its old and new line numbers. Rename headers (`rename from` and `rename to`), mode lines (`old mode` and `new mode`), and `\ No newline at end of file` are kept as `meta`.
3. `diff.limits.ts` caps the parsed line count and byte count and sets `truncated` when a cap is hit. Capping runs before collapse so a truncated tail is never collapsed.
4. `diff.collapse.ts` walks each hunk and finds runs of consecutive `context` lines. A run longer than `2 * diff.contextLines + 1` is collapsed: the first `diff.contextLines` lines and the last `diff.contextLines` lines are kept, and the middle is replaced by one `DiffSegment` of kind `collapsed` carrying the count and the old and new start line numbers. Runs at or below the threshold are kept whole. The output is a `DiffSegment[]` of kind `diff` (a contiguous kept region, stringified into unified diff text) and kind `collapsed` (a marker).
5. `DiffContent.tsx` maps each segment: a `diff` segment becomes a `<diff>` component, and a `collapsed` segment becomes a `<text>` marker row reading "N unchanged lines". This keeps the marker in the app style and lets the component render valid unified diff text only.

With `diff.contextLines` set to 0, no run is collapsed because the threshold is 1, and every unchanged line is hidden except the single context line kept at each edge of a run. Collapse is pure and unit tested with fixtures.

## 11. Safety and confirmations

- No confirmation: `diff.stage`, `diff.unstage`, `diff.stageAll`, `diff.unstageAll` (F-11 lines 873-879).
- `diff.discard` on a tracked file: the confirm label is "Discard changes" and the modal names the path and states that the working copy returns to the index version.
- `diff.discard` on an untracked file: the confirm label is "Delete untracked file" and the modal names the path and states that the file is removed from disk.
- `diff.discardAll`: the confirm label is "Discard changes" and the modal names the count of files.
- Delete All untracked: the confirm label names the count of files and states that they are removed from disk.
- Destructive confirmations default focus to Cancel (F-15 line 1010).
- No ours and theirs actions (D5). Conflicted files are staged only after the user resolves them externally, and a staged conflict can be unstaged.
- The app never auto-resolves, auto-stashes, resets, checks out, or cleans as a side effect (F-18 line 1087). `git clean` is never run with `-x`.
- Discard restores from the index and never touches staged content.
- Failures keep the selection, the staged files, and the expanded state, and show the git error in the error overlay and the console.
- Every command runs through `git.client.ts` with an argument array and no shell, so a file name can never be interpreted as shell syntax; credentials in remote URLs are redacted before any console or error rendering.

## 12. Acceptance mapping

| F-11 acceptance bullet | Implementing module or component |
| --- | --- |
| The three sections reflect git status accurately | `git.status.ts` and `parsers/parse.status.ts`; `DiffPanel.tsx` renders Working Directory, Staged Files, Untracked Files in order |
| Each per-file and bulk action is available and does what its label says | `git.diff.ts` command builders; `DiffSection.tsx` and `DiffFileRow.tsx` action wiring; `commands.availability.ts` |
| Destructive actions require confirmation and clearly state what will be lost | `diff.discard` and `diff.discardAll` handlers; the "Discard changes", "Delete untracked file", and delete-all confirmations |
| Binary and oversized files show a clear notice and do not break the panel | `git.diff.ts` binary and size probes; `diff.limits.ts`; `DiffContent.tsx` notices |
| Expanding and collapsing preserves selection and does not refetch unnecessarily | `useDiffPanel.ts` selection preservation; `useFileDiff.ts` per-path cache and single in-flight request |
| Staged and working diffs show the correct comparison, not the same diff twice | `git.diff.ts` `readWorkingDiff()` uses `git diff`, `readStagedDiff()` uses `git diff --cached` |
| All three sections are expanded by default, and the first Working Directory file is expanded when it has a text diff | `useDiffPanel.ts` defaults; `diff.expandFirstWorkingFile` |
| Long runs of unchanged lines collapse behind a marker | `diff.collapse.ts`; the `collapsed` segment marker in `DiffContent.tsx` |
| Untracked files show full content as added lines, deleted files show all lines as removed, renames show a header, mode-only changes show metadata | `git.diff.ts` read builders; `parse.diff.ts`; `DiffContent.tsx` |
| Conflicts appear as `U` rows with a banner and a conflict-marker diff, and are staged after external resolution | `ConflictBanner.tsx`; `parse.status.ts` `U` rows; `git.diff.ts` `readConflictDiff()`; `diff.stage` |
| A commit or stash selection makes the panel read-only | `useDiffPanel.ts` read-only mode; `git.log.ts` and `git.stashes.ts` reads |
| If an operation is running, conflicting actions are disabled | `commands.availability.ts` "operation in progress"; `DiffPanel.tsx` disabled states |
| After an action, refresh the affected sections and keep the selection on the same path | `RepositoryProvider` refresh; `useDiffPanel.ts` path-keyed selection |

## 13. Tests to add

- `src/domain/git/parsers/parse.diff.test.ts`: parse recorded unified diff fixtures covering a single hunk, multiple hunks, correct old and new line numbering for context, add, and remove lines, a rename header (`rename from` and `rename to`), a mode-only change (`old mode` and `new mode`), a binary notice, `\ No newline at end of file`, and conflict markers.
- `src/domain/diff/diff.collapse.test.ts`: a run exactly at the threshold is kept; a run over the threshold is collapsed with the right count; the first and last context lines of a run are kept; multiple runs in one hunk; no collapse when `diff.contextLines` is 0; the segment boundaries match the parsed line numbers.
- `src/domain/diff/diff.limits.test.ts`: the line cap, the byte cap, the oversized check, and the truncation flag and counts.
- `src/domain/git/git.diff.test.ts`: argument construction for the working, staged, untracked, deleted, rename, conflict, commit, and stash reads, and for stage, unstage, discard, and the bulk variants; the oversized and binary skip paths; no spawning in unit tests.
- `src/features/diff/DiffFileRow.test.tsx`: status letters `M`, `A`, `D`, `R`, `C`, `U`, the rename `old -> new` header, add and remove counts, and the expand indicator.
- `src/features/diff/DiffContent.test.tsx`: the binary notice, the oversized notice, the truncation notice, the "N unchanged lines" marker, and the metadata-only diff.
- `src/features/diff/DiffPanel.test.tsx`: the three sections in order, the first Working Directory file expanded only when `diff.expandFirstWorkingFile` and it has a text diff, per-section bulk availability, disabled actions during a running operation, read-only mode for a commit or stash selection, and selection preserved across a collapse.
- `src/features/diff/ConflictBanner.test.tsx`: the conflict banner text and the merge, rebase, or cherry-pick banner.
- `src/domain/keymap/keymap.resolve.test.ts` (shared): `d` resolves to `diff.discard` in the `diff` context and to `branch.delete` or `tag.delete` elsewhere; `diff.toggle` shadows `nav.activate` in the `diff` context.

## 14. Open questions

- The exact line cap, byte cap, and oversized preview threshold. F-17 defers the numbers to this feature; confirm them and whether they are configurable.
- Whether untracked content is read directly from the filesystem or through `git diff --no-index`, which exits non-zero when files differ and would need the runner to treat that exit code as success.
- Whether `diff.unstage` uses `git restore --staged` and `diff.discard` uses `git restore`, both of which require git 2.23 or newer, or the older `git reset` and `git checkout --` forms. Confirm the minimum git version.
- Whether the conflict-marker diff shows the file as-is or the combined diff from `git diff --cc`, which changes how conflict rows render.
- Whether the first-file auto-expand should apply when the first Working Directory file is binary or oversized. This doc does not auto-expand those; it leaves them collapsed with the notice shown on expand.
- Whether `diff.stageAll` for Untracked Files should stage only the untracked set or the whole working tree, given that `git add -A -- .` covers both. This doc uses one `git add -A -- .` and relies on the section label.
