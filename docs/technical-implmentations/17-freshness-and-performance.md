# 17 - Freshness and Performance

## 1. Header

- Status: Draft for review
- Spec reference: `docs/product-spec.md` F-17 (lines 1052-1079), decisions D10, D16, D17, and the assumed defaults (lines 1754-1768).
- Dependencies: `01-app-shell-and-focus.md` (regions, refresh key), `08-commit-graph.md` (paging and virtualization), `10-commit-details.md` (selection to details), `11-diffs-and-file-actions.md` (lazy diff), `13-console.md` (bounded log), `15-overlays-and-confirmations.md` (error history), `16-repository-states.md` (upstream states), `18-safety-and-platform-behavior.md` (serialized writes, watch opt-in).
- Owned paths (cross-cutting; F-17 has no `src/features/<name>/` folder in architecture section 4):
  - `src/app/providers/RepositoryProvider.tsx`
  - `src/domain/git/git.client.ts`
  - `src/domain/git/git.watcher.ts`
  - `src/domain/git/git.progress.ts`
  - `src/domain/graph/graph.paginate.ts`
  - `src/domain/graph/graph.search.ts`
  - `src/domain/diff/diff.limits.ts`
  - `src/domain/repository/repository.upstream.ts`
  - `src/domain/repository/repository.selectors.ts`
  - `src/domain/commands/commands.runner.ts`
  - `src/domain/console/console.buffer.ts`

F-17 behavior lives in these shared modules and is surfaced through `RepositoryProvider` and the feature UIs owned by the feature docs above. Paging detail lives in `08-commit-graph.md`, diff detail in `11-diffs-and-file-actions.md`, log detail in `13-console.md`, and confirmation and serialization detail in `18-safety-and-platform-behavior.md`.

## 2. Scope and non-goals

In scope: refresh after every mutation; manual `r` refresh; git-directory watching; opt-in working-tree watching with a focus-refresh fallback; refresh on terminal focus; ahead/behind and upstream re-evaluation after fetch and fetch --prune; preserving selection and expansion across refreshes; every performance target in F-17 mapped to a mechanism and owning module.

Non-goals: watching the whole worktree by default (D10); streaming partial hunks or progressive diff painting; prefetching history beyond the next page; persisting the graph window or selection across restarts; watching configuration files (F-19 makes reload explicit).

## 3. OpenTUI components used

| Component | Where used | Why it is the right component |
| --- | --- | --- |
| `<scrollbox>` | Commit graph, diff panel, console, help, sidebar panels | The only OpenTUI scroll container; `viewportCulling` is the built-in virtualization for large lists. |
| `<box>` | Graph rows, diff rows, console entry rows | Layout and custom-row composition; rows need ref badges and inline actions. |
| `<text>` | Counts, page markers, truncation notice | Every status string; the primary signal is text, not color. |
| `<span>` | Inline truncation notice and "new entries" marker | Inline styled runs inside `<text>`. |
| `useFocus(handler)` | `RepositoryProvider` | Refresh when the terminal regains focus after external edits. |
| `useTimeline(options)` | `Spinner` during page loads; remote progress is rendered by F-02 in the top bar | Animation only; runs off the render path so progress never freezes rendering. |
| `useTerminalDimensions()` | Visible-row window sizing and truncation budgets | Derive the number of rows to cull and the truncation budget. |
| `useOnResize(cb)` | Recompute the culled window after resize | Keeps culling and budgets correct when the terminal changes size. |
| `useKeyboard` | Not used directly | Centralized in `src/app/hooks/useHotkeys.ts`; F-17 registers `app.refresh` through `useAction`. |

All icons and markers used by this feature come from `src/theme/icons.ts`; see architecture section 6.1. No glyph literal is written in feature code.

## 4. Component tree

```text
ConfigProvider
  ThemeProvider
    KeymapProvider
      RepositoryProvider        (refresh cycle, watcher wiring, focus refresh)
        AppShell
          MainArea
            CommitGraph         (scrollbox viewportCulling + graph.paginate window)
              CommitRow         (box + text + span, culled)
            CommitDetails       (async read, no blocking)
            DiffPanel
              DiffSection       (scrollbox)
                DiffFileRow
                  DiffContent   (diff loaded on expand via useFileDiff)
            ConsoleDrawer       (scrollbox over console.buffer)
          TopBar
            TopBarStatus        (phase and percentage from git.progress, via StatusProvider)
              ProgressBar       (OpenTUI FrameBuffer bar)
              Spinner           (indeterminate remote progress)
          Footer
            HintBar             (keyboard hints only)
```

`RepositoryProvider` owns the refresh cycle and exposes it through `useRepository`. Graph paging state is view state inside `useCommitGraph` fed by `graph.paginate.ts`. Console history is provider state in `ConsoleProvider` fed by `console.buffer.ts`.

## 5. Enforced files and folders

- `src/app/providers/RepositoryProvider.tsx`
- `src/domain/git/git.client.ts`
- `src/domain/git/git.watcher.ts`
- `src/domain/git/git.progress.ts`
- `src/domain/graph/graph.paginate.ts`
- `src/domain/graph/graph.search.ts`
- `src/domain/diff/diff.limits.ts`
- `src/domain/repository/repository.upstream.ts`
- `src/domain/repository/repository.selectors.ts`
- `src/domain/commands/commands.runner.ts`
- `src/domain/console/console.buffer.ts`

## 6. State model

- `RepositoryProvider` (provider state): the repository snapshot, the current refresh generation, watch status (on or off, path, mode git-dir or worktree), the in-flight read and write flags, and the last fetch result used for upstream classification.
- `ConsoleProvider` (provider state): the bounded entry buffer from `console.buffer.ts`, follow mode, and the "new entries" counter.
- `StatusProvider` (provider state): transient status and remote progress phase and percentage from `git.progress.ts`.
- `graph.paginate.ts` (domain state object): the loaded page window, the scope key, the single in-flight page request, and a generation token. Held by `useCommitGraph` as view state, not in a provider.
- Feature view state: expansion flags (diff sections, file rows), cursor positions, and the current commit selection identity. Selection and expansion are stored by stable identity (path, or commit OID) so they survive a refresh.
- `src/theme/useTokens.ts`: read-only tokens for markers and progress colors; not mutated here.

## 7. Data flow

Refresh after a mutation:

```text
action ID -> useAction -> command from commands.registry
   -> commands.runner (availability + serialization) -> git.client (argument array, no shell)
   -> parse in domain/git/parsers -> RepositoryProvider.refresh()
   -> repository.selectors + repository.upstream recompute -> features re-render
   -> ConsoleProvider entry + StatusProvider status
```

Freshness flow:

- Manual `app.refresh` and focus refresh call `RepositoryProvider.refresh()`.
- `git.watcher.ts` watches the git directory (`.git` refs, index, HEAD) and debounces events into `refresh()`. Worktree watching is a separate opt-in mode that watches the working tree root; it is off by default and, when off, the UI shows a hint and refresh also runs on focus.
- After `remote.fetch` and `remote.fetchPrune`, `repository.upstream.ts` re-evaluates each configured upstream against the freshly fetched remote-tracking refs, sets `[?]` for missing refs, and only classifies a missing ref as deleted after a successful prune for that remote.
- Ahead/behind comes from `repository.selectors.ts` and reflects the last fetched refs, never a network call during navigation.

Paging flow: `useCommitGraph` calls `graph.paginate.ts` with the scope key; older pages load near the bottom and each result carries the generation token. A result whose token no longer matches the current scope or repository generation is discarded. Search uses `graph.search.ts` with the same token discipline.

## 8. Keyboard and focus

Action IDs only, from product spec section 6.1:

- `app.refresh`: manual refresh, default `r`, global context. Available unless an overlay owns keys.
- `app.reloadConfig`: triggers a full reload that includes re-reading repository scope; no default key, always in the palette. Detail in `19-configuration-and-keybindings.md`.
- `app.themePicker`: opens the theme picker; it never touches repository state. Detail in `20-theme-and-colors.md`.
- Navigation (`nav.up`, `nav.down`, `nav.pageUp`, `nav.pageDown`, `nav.first`, `nav.last`) drive the graph window and trigger a page load at the bottom edge.

Focus interaction: `useHotkeys` resolves precedence (overlay, then text input, then focused region, then global). `app.refresh` is a global action and is shadowed only while a text input has focus for printable keys. When the terminal loses and regains focus, `useFocus` in `RepositoryProvider` triggers a refresh without stealing focus.

## 9. Loading, empty, error, and disabled states

- Loading: a page load shows a `LoadingRow` with a `Spinner` and text "Loading older commits..."; the initial load shows "Loading history...". Remote operations show phase text plus the top bar `ProgressBar` when a percentage is reported.
- Empty: an empty repository or empty diff section shows `EmptyState` with text, never a blank region.
- Error: a failed refresh keeps the previous snapshot and shows a non-blocking status; a failed page load shows an inline error row with Retry (`ErrorState`) and keeps the loaded window. Errors also land in the console.
- Disabled: while a write is in flight, conflicting actions render with the `dim` token and a text reason from `commands.availability.ts`. A refresh requested during an in-flight refresh is coalesced, not stacked, and reports "refresh in progress" only if it is user-initiated.

## 10. Performance and bounds

Every F-17 target maps to a mechanism and an owner.

| Target | Mechanism | Owner |
| --- | --- | --- |
| 100,000 commits navigable | Graph keeps only the loaded window; `scrollbox viewportCulling` renders visible rows | `graph.paginate.ts`, `CommitGraph.tsx` |
| 10,000 changed files navigable | Diff sections cull file rows; diffs load per file on expand | `DiffPanel.tsx`, `useFileDiff.ts` |
| First screen within one second | Initial bounded page; `git log -n <pageSize>`; no full-history read | `git.client.ts`, `graph.paginate.ts` |
| Selection updates details and diff promptly | Async reads with a single in-flight request per surface; details read is debounced | `useDebouncedValue.ts`, `useCommitDetails.ts` |
| Initial commit page bounded | `graph.initialPageSize` default 500, range 100-2000 | `graph.paginate.ts` |
| 100,000-commit branch never blocks startup | First page only at startup; older pages on demand | `graph.paginate.ts` |
| Older pages incremental near bottom, coalesced | Single in-flight page flag; new requests coalesce into one | `graph.paginate.ts` |
| Stale page loads discarded | Generation token compared on resolve; mismatched results dropped | `graph.paginate.ts` |
| Only visible rows rendered | `viewportCulling` plus row-height window from `useTerminalDimensions` | `CommitGraph.tsx` |
| Commit search lazy and bounded, cancels stale | `graph.search.ts` returns bounded pages and carries the generation token | `graph.search.ts`, `useCommitSearch.ts` |
| Diffs load on expand | `useFileDiff` requests on expand; no up-front diff for all files | `useFileDiff.ts`, `git.diff.ts` |
| Diff line and byte cap with truncation notice | `diff.limits.ts` enforces caps; `DiffContent` renders a "diff truncated" notice | `diff.limits.ts`, `DiffContent.tsx` |
| Console and error history bounded | `console.buffer.ts` keeps at least 200 entries with output head and tail capping; the error overlay replaces rather than stacks | `console.buffer.ts`, `OverlayProvider` |
| Remote progress without freezing | `git.progress.ts` publishes phase and percentage; F-02 renders `ProgressBar` and `Spinner` via `useTimeline` in the top bar status strip | `git.progress.ts`, `TopBarStatus.tsx`, `ProgressBar.tsx` |
| Reads and writes serialized | `commands.runner.ts` serializes writes; `git.client.ts` serializes index-touching reads against writes | `commands.runner.ts`, `git.client.ts` |

Bounds: the graph window is `pages * graph.initialPageSize` and is trimmed to a maximum retained window (oldest pages released when far outside the viewport). The console buffer is bounded by entry count and a per-entry byte cap. Diff caps are a line count and a byte count from `diff.limits.ts`.

## 11. Safety and confirmations

- Refresh is read-only and never prompts.
- Watcher-triggered refresh never runs a mutation and never auto-stashes, resets, or checks out.
- A refresh never clears drafts, staged files, or selection.
- Page loads are reads only; they never touch the index.
- Remote progress is display only; it never auto-retries.

## 12. Acceptance mapping

- "After every successful or failed mutation, refresh the affected repository state." -> `commands.runner.ts` triggers `RepositoryProvider.refresh()` in both outcomes.
- "Provide `r` to refresh manually." -> `app.refresh` handler in `useRepository`.
- "Live watch the git directory... manual refresh." -> `git.watcher.ts` plus `app.refresh`.
- "Watching the working tree is optional... show a hint or refresh on focus." -> watcher mode flag in `RepositoryProvider`; `useFocus` refresh; hint in `Footer` or `Sidebar`.
- "Ahead and behind reflect the last fetched remote refs." -> `repository.selectors.ts`, `repository.upstream.ts`.
- "After every fetch, re-evaluate upstreams... `[?]`... deleted only after prune." -> `repository.upstream.ts` keyed by `remote.fetchPrune`.
- "Preserve selection and expansion across refreshes." -> identity-keyed selection and expansion in `RepositoryProvider` and feature view state.
- Performance bullets -> the table in section 10.

## 13. Tests to add

- `src/domain/graph/graph.paginate.test.ts`: page bounds, single in-flight request, coalescing, stale-token discard, window trimming.
- `src/domain/graph/graph.search.test.ts`: bounded pages, stale query cancellation.
- `src/domain/diff/diff.limits.test.ts`: line cap, byte cap, truncation flag.
- `src/domain/console/console.buffer.test.ts`: 200-entry bound, output head and tail capping.
- `src/domain/repository/repository.upstream.test.ts`: re-evaluation after fetch, `[?]` before prune, deleted only after prune.
- `src/domain/git/git.watcher.test.ts`: debounce, git-dir versus worktree mode, no refresh storm.
- `src/app/providers/RepositoryProvider.test.tsx`: refresh after mutation, selection and expansion preserved across refresh.
- Performance smoke: a synthetic large log fixture asserting the first page bound and one in-flight page load (per architecture section 13).

## 14. Open questions

- Retained-window trimming policy: the exact maximum number of pages to keep resident before releasing the oldest.
- Whether focus refresh should be suppressed during an active write to avoid interleaving reads with a mutation.
- Whether the worktree-watch opt-in is a config field in v1 or deferred to a later release.
