# 17 - Freshness and Performance

## 1. Header

- Spec reference: `docs/product-spec.md` F-17 (lines 1096-1125), F-08 lazy loading and commit search (lines 659-702), F-11 file expansion and oversize notices (lines 897-908), F-02 fetch and prune rules (lines 256-273), decisions D10 (line 1878), D16 (line 1884), D17 (line 1885), the assumed defaults (lines 1890-1908), F-18 execution rules (lines 1126-1153), and the action IDs in section 6.1 (lines 1705-1742).
- Dependencies: `01-app-shell-and-focus.md` (regions, refresh key), `02-top-bar.md` (fetch, fetch --prune, and pull results), `08-commit-graph.md` (paging and virtualization), `10-commit-details.md` (selection to details), `11-diffs-and-file-actions.md` (lazy diff and diff caps), `13-console.md` (bounded log), `15-overlays-and-confirmations.md` (error history), `16-repository-states.md` (upstream states), `18-safety-and-platform-behavior.md` (serialized writes, git execution contract, watch opt-in).
- Owned paths (cross-cutting; F-17 has no `src/features/<name>/` folder in architecture section 4):
  - `src/app/providers/RepositoryProvider.tsx`
  - `src/app/hooks/useCommandRunner.ts`
  - `src/app/hooks/useRemoteCommands.ts`
  - `src/app/hooks/useRemoteCommands.types.ts`
  - `src/domain/git/git.client.ts`
  - `src/domain/git/git.watcher.ts`
  - `src/domain/git/git.progress.ts`
  - `src/domain/git/git.remotes.ts`
  - `src/domain/git/git.remotes.types.ts`
  - `src/domain/graph/graph.paginate.ts`
  - `src/domain/graph/graph.search.ts`
  - `src/domain/diff/diff.limits.ts`
  - `src/domain/repository/repository.upstream.ts`
  - `src/domain/repository/repository.selectors.ts`
  - `src/domain/commands/commands.runner.ts`
  - `src/domain/commands/commands.reasons.ts`
  - `src/domain/commands/commands.steps.ts`
  - `src/domain/commands/commands.remote.ts`
  - `src/domain/commands/commands.remote.types.ts`
  - `src/domain/console/console.buffer.ts`

F-17 behavior lives in these shared modules and is surfaced through `RepositoryProvider` and the feature UIs owned by the feature docs above. Paging detail lives in `08-commit-graph.md`, diff detail in `11-diffs-and-file-actions.md`, log detail in `13-console.md`, and confirmation and serialization detail in `18-safety-and-platform-behavior.md`.

## 2. Scope and non-goals

In scope: refresh after every mutation; manual `r` refresh; git-directory watching; opt-in working-tree watching with a focus-refresh fallback; refresh on terminal focus; the split between `refreshStatus` and `refreshGraphWindow`; ahead/behind and upstream re-evaluation after fetch and fetch --prune; staleness derived from the last successful remote check or fetch; preserving selection, expansion, the loaded graph window, the composer draft, and console follow mode across refreshes; and every performance target in F-17 mapped to a mechanism and owning module.

Non-goals: watching the whole worktree by default (D10); streaming partial hunks or progressive diff painting; prefetching history beyond the next page; persisting the graph window or selection across restarts; watching configuration files (F-19 makes reload explicit); the platform fallbacks and quit choreography (F-18 `18-safety-and-platform-behavior.md` owns those, and section 7.1 is the execution summary consumed here).

## 3. OpenTUI components used

| Component | Where used | Why it is the right component |
| --- | --- | --- |
| `<scrollbox>` | Commit graph, diff panel, console, help, sidebar panels | The only OpenTUI scroll container; `viewportCulling` is the built-in virtualization for large lists. |
| `<box>` | Graph rows, diff rows, console entry rows | Layout and custom-row composition; rows need ref badges and inline actions. |
| `<text>` | Counts, page markers, truncation notice | Every status string; the primary signal is text, not color. |
| `<span>` | Inline truncation notice and "new entries" marker | Inline styled runs inside `<text>`. |
| `useFocus(handler)` | `RepositoryProvider` | Refresh when the terminal window regains focus after external edits. Never region focus. |
| `useTimeline(options)` | `Spinner` during page loads; remote progress is rendered by F-02 in the top bar | Animation only; runs off the render path so progress never freezes rendering. |
| `useTerminalDimensions()` | First-frame visible-row estimate before the scrollbox viewport is measured | Fallback row capacity for the first frame only. |
| `useScrollViewportSize()` | Measured scrollbox viewport width and height for graph rows and the visible-row window | The real viewport excludes the panel chrome, status footer, and console drawer, so the selected row and truncation budgets match what is drawn. |
| `useOnResize(cb)` | Recompute the culled window after resize | Keeps culling and budgets correct when the terminal changes size. |
| `useKeyboard` | Not used directly | Centralized in `src/app/hooks/useHotkeys.ts`; F-17 does not register an action handler. The single global `app.refresh` handler is owned by `useRepository` in the app layer. |

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
- `src/app/hooks/useCommandRunner.ts`
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

- `RepositoryProvider` (provider state): the repository snapshot, the right-pane `selection` union (`pending`, `commit`, `stash`, `worktree`, or a diff file), the refresh generation, watch status (on or off, path, mode git-dir or worktree), the in-flight flags for status and graph-window refreshes, the last successful remote check or fetch per remote, and the last refresh error. It exposes `refresh()`, `refreshStatus()`, and `refreshGraphWindow()`. The write latch lives in `commands.runner.ts` and is projected through `StatusProvider`.
- Selection is `RepositoryProvider` state and is never duplicated in a feature. It is keyed by stable identity (OID, path, stash object name, worktree path). A status refresh never writes it; a graph-window refresh keeps it when the item still exists and selects the nearest row only when it does not.
- `DraftProvider` (provider state): the composer draft string and `hasUnsavedDraft`. The composer writes it through `useDraft`; the shell quit handler will read the same value once draft-based quit lands. It is never cleared by a refresh or a failed command.
- `useCommandRunner` (app-layer orchestration, no persistent state): reads the `CommandResult`, writes `StatusProvider`, `ConsoleProvider`, `RepositoryProvider`, and `OverlayProvider`, and forwards progress events. It never stores repository data of its own.
- `ConsoleProvider` (provider state): the bounded entry buffer from `console.buffer.ts`, `followMode`, and the "new entries" counter. Follow mode is provider state, not console view state.
- `StatusProvider` (provider state): transient status and remote progress phase and percentage from `git.progress.ts`.
- `graph.paginate.ts` (domain state object): the loaded page window, the scope key, the `GraphCursor` (oldest loaded OID plus the frontier of unvisited scope tips and unemitted parents), the single in-flight page request, and a generation token. Held by `useCommitGraph` as feature view state and never in a provider.
- Feature view state: row expansion flags (diff sections and files, graph sections), focused control index, filter text, and cursor positions. Expansion and the loaded page window are feature view state; neither is stored in `RepositoryProvider`.
- Ownership summary: selection is `RepositoryProvider` state; row and section expansion is feature view state in the owning feature; the composer draft is `DraftProvider` state; console follow mode is `ConsoleProvider` state. A provider never keeps a second copy of another provider's state, and a feature never keeps a second copy of `selection`.
- `src/theme/useTokens.ts`: read-only tokens for markers and progress colors; not mutated here.

## 7. Data flow

Refresh after a mutation:

```text
action ID -> useAction -> useCommandRunner.runCommand(request)          (app layer)
   -> commands.runner (availability + serialization) -> git.client (argument array, no shell, timeout, AbortSignal)
   -> domain command -> parsers -> CommandResult
   -> useCommandRunner: RepositoryProvider.refresh() after success, failure, cancellation, and timeout
      -> refreshStatus() -> repository.selectors + repository.upstream recompute -> features re-render
      -> refreshGraphWindow() -> same loaded page count, selected OID retained
   -> useCommandRunner: ConsoleProvider entry + StatusProvider status or error overlay
```

`commands.runner.ts` is a pure executor. It returns the result and progress events; it never calls `RepositoryProvider.refresh()` or any other provider. `useCommandRunner` is the single place that applies the result. Read refresh (manual `app.refresh`, watcher, and focus) goes directly to `RepositoryProvider` and does not use the command runner.

Every invocation through `git.client.ts` has a timeout and an `AbortSignal`. Defaults are 10 seconds for local reads, 30 seconds for local writes, and 120 seconds for network operations; on abort the client sends `SIGTERM`, waits two seconds, then sends `SIGKILL`, and returns a cancelled result. A timeout returns a timed-out result. Neither is ever reported as success, and both trigger a refresh so the UI reflects any partial local change. The full environment matrix and quit behavior live in F-18.

### 7.1 Git execution contract

`git.client.ts` is the only production module that spawns a process. It executes `git.path` directly with an argument array, `cwd` at the repository root, no shell, and stdin ignored, so file names cannot be interpreted as shell syntax and no child can read terminal input. The contract is consumed here and owned in detail by `18-safety-and-platform-behavior.md`.

| Concern | Contract |
| --- | --- |
| Timeout | 10 seconds for local reads, 30 seconds for local writes, 120 seconds for network operations. |
| Cancellation | Every invocation receives an `AbortSignal`. On abort the client sends `SIGTERM`, waits two seconds, then sends `SIGKILL`, waits for the child to exit, and returns a cancelled result. |
| Timeout result | A timeout uses the same kill path and returns a timed-out result with "timed out after N seconds". |
| Never success | A cancelled or timed-out result is never success. It is a warning, and the orchestrator refreshes so partial local changes are visible. |
| Prompt suppression | `GIT_TERMINAL_PROMPT=0`, `GCM_INTERACTIVE=never`, `GIT_ASKPASS=""`, `SSH_ASKPASS=""`, `SSH_ASKPASS_REQUIRE=never`. |
| Editor and pager suppression | `GIT_EDITOR=true`, `GIT_SEQUENCE_EDITOR=true`, `GIT_PAGER=cat`, `PAGER=cat`, `GIT_MERGE_AUTOEDIT=no`, `LC_ALL=C`. |
| SSH | `GIT_SSH_COMMAND=ssh -o BatchMode=yes` only when the user has not configured `GIT_SSH_COMMAND` or `core.sshCommand`; a user setting wins. |
| Progress | Network operations pass `--progress` (`git fetch --progress`, `git push --progress`); pull runs `git pull --progress --no-edit`, so git never opens an editor for a merge message. |
| Output | Stderr is streamed through `git.progress.ts`; commands without a meaningful percentage emit phase-only events. |

Refresh entry points:

| Trigger | Method | Reads |
| --- | --- | --- |
| Manual `app.refresh`, a mutation result, or terminal-window focus | `RepositoryProvider.refresh()` | `refreshStatus()` then `refreshGraphWindow()` |
| A git-directory watcher event | `RepositoryProvider.refreshStatus()` | Status, refs, branches, tags, worktrees, stashes, and upstreams; no history page |
| A graph scope change or an explicit graph-window reload | `RepositoryProvider.refreshGraphWindow()` | The loaded page count from the current scope and cursor |

`refreshStatus()` runs the canonical status command `git status --porcelain=v2 --branch -z --untracked-files=all`, reads refs, branches, tags, worktrees, stashes, and upstream classification, and merges refreshed ref badges into loaded rows by OID. It validates `RepositoryProvider.selection` against the refreshed snapshot without writing it and never re-reads a history page. The selected OID stays selected, and the loaded window, including pages 2 to N, stays loaded. A status refresh therefore never drops loaded pages or selects a different commit. When the status read changes the scope tip key after the graph has pages, the graph feature follows it with `refreshGraphWindow()`, because the paginator seeds its cursor from the tips only before the first page and never folds a late tip into a started cursor. Selection repair for a vanished item belongs to `refreshGraphWindow()`, which picks the nearest row.

`refreshGraphWindow()` takes the current loaded page count and cursor from `useCommitGraph`/`graph.paginate.ts`, re-reads that same page count from the current scope, merges rows by OID, and keeps the selected OID selected when it still exists. When new commits push the selected OID outside the re-read window, the bounded `ensureLoaded(selectedOid)` restores it instead of dropping it, the restored window is published to the feature mirror, and the cursor follows the selected OID; when the OID no longer exists, the nearest row becomes selected. A failed page read restores the checkpoint captured before the reload, which carries the window and every emitted OID, so a trimmed window continues at its old cursor instead of re-walking the newest history. The page Retry then re-runs the window reload, so a tip that arrived before the failure is loaded rather than treated as handled. A graph-window refresh never falls back to re-reading only page 1.

Freshness rules:

- `git.watcher.ts` watches the git directory (`.git` refs, index, HEAD) and debounces events into `refreshStatus()`. Recursive watching is requested first. When the platform refuses it, the git directory, `refs/heads`, `refs/tags`, and `refs/remotes` are watched non-recursively so external commits and branch switches still produce events; the limitation is published through the watcher status. Worktree watching is a separate opt-in mode that watches the working tree root, ignores `.git`, `node_modules`, and common build output, and is off by default. When it is off, including the default git-dir mode, `refresh()` runs on terminal focus. The text hint that F-17 assigns to the footer or sidebar is not rendered yet: the M5 top bar is reserved for branch information, operation progress, and transient status, so the hint is deferred to the F-17 sidebar/footer surface that lands with that surface; the architecture tree and this ticket record the deferral so the contract never claims a hint no component renders. This is a documented deferral, not a claim that the UI already shows it. `.git/index.lock` churn never triggers a refresh, and a mid-life watch error closes the watch, publishes an inactive status, and leaves manual and focus refresh as the fallback.
- After `remote.fetch` and `remote.fetchPrune`, `repository.upstream.ts` re-evaluates each configured upstream against the freshly fetched remote-tracking refs and updates `[?]` plus ahead/behind. The read uses the explicit `%(upstream:remotename)` and `%(upstream:remoteref)` atoms and checks `refs/remotes/<remote>/<branch>`, so a remote name containing `/` is never split; `%(upstream:short)` is display-only. A missing ref stays `upstream not found` until a successful Fetch --prune confirms absence with `git ls-remote --heads <remote>` for that remote, or until a remote branch deletion initiated from the Delete Branch flow succeeds.
- A failed, truncated, or timed-out remote check is `unknown`, never "missing", "deleted", or "unpushed". Partial fetch success is reported per remote, and one failed remote does not downgrade another remote's confirmed state.
- `confirmUpstreamAbsent` and `markUpstreamUnknown` remain as the future F-04 remote-branch-deletion entry point. Each refreshes once per call and must not be reintroduced into the prune path, which folds every pruned and unknown ref through the batched `recordUpstreamEvidence` writer and its single refresh.
- Staleness is derived from the last successful remote check or fetch timestamp per remote, held in `RepositoryProvider`. It is never derived from commit dates or from the age of a ref object. A remote that has never been checked is `unknown`, not stale.
- Ahead/behind comes from `repository.selectors.ts` and reflects the last fetched refs, never a network call during navigation.

Paging flow: `useCommitGraph` calls `graph.paginate.ts` with the scope key. The first page is issued only after the initial repository read settles, so startup seeds the cursor from the real snapshot tips once instead of re-reading the first page when the snapshot arrives. Older pages use cursor pagination anchored on the oldest loaded OID plus the frontier of the scope's still-unvisited tips and every unemitted parent; the scope is passed only on the first page, `--skip` is never used for the graph, and the next-page request is monotonic even after the oldest loaded page is trimmed. The cursor is seeded from the scope tips only at reset and before the first page; a tip that appears after the window started triggers a `RepositoryProvider.refreshGraphWindow()` reload of the same page count instead of being folded into the cursor, and an already-emitted OID is never re-added. The provider owns the reload's in-flight flag, so a second graph refresh joins it and a status refresh cannot cancel it. The tips path records a key only after a successful reload and runs a bounded loop: it re-runs when the current tip key differs from the recorded key the successful reload seeded, so a joined reload that started before the tip or a second tip change during the reload is loaded while a joined reload that already recorded the current key adds no attempt. One loop runs at most three attempts; when the last attempt succeeds but the key moved again, the effect re-arms once, for at most two consecutive loops. Past that bound the newest key waits for the next page append, search toggle, or successful external window reload, which resets the bound; the loop's own successful attempts do not reset it. A reload that fails a page read restores the checkpoint and surfaces its message through the page error, while a reload whose selection-restoration walk fails shows the distinct walk notice with its own Retry. Either failure leaves the key unrecorded. The walk notice's own Retry always re-runs the window reload instead of silently forgetting the tip, while a page-read failure takes over the error surface and clears the walk notice; the page Retry re-runs the reload when the failed read belonged to the reload and loads the older page when the failed read belonged to that request. Exactly one page request is in flight; repeated scrolling coalesces into it. Each result carries the generation token, and a result whose token no longer matches the current scope or repository generation is discarded. A status refresh keeps the cursor, the loaded window, and the selected OID while no scope tip changes, while it discards the stale result of any in-flight page or search request; the git invocation itself is not aborted and may run to completion. Search uses `graph.search.ts` with the same token and a stable result offset over the fixed scope, because search results are append-only and are never trimmed; the graph's no-`--skip` rule does not apply to search. The search offset is stable only for an unchanged repository: a match inserted above the current offset after the first page may be skipped while older matches are still returned, and the header may still label the result set complete.

## 8. Keyboard and focus

Action IDs only, from product spec section 6.1:

- `app.refresh`: manual refresh, default `r`, global context. Runs `RepositoryProvider.refresh()`, which is `refreshStatus()` then `refreshGraphWindow()`, so loaded pages and the selected OID survive. Available unless an overlay owns keys.
- `remote.fetch` and `remote.fetchPrune`: top-bar actions owned by the top bar. This feature consumes their result: the orchestrator refreshes status and re-evaluates upstreams after success or failure.
- `remote.pull`, `remote.push`, `remote.pushForceSafe`, `remote.pushForceOverwrite`, and `remote.pushNoVerify`: top-bar mutation actions. The orchestrator runs the combined `refresh()` after success, failure, cancellation, and timeout.
- `app.reloadConfig`: triggers a full reload that includes re-reading repository scope; no default key, always in the palette. Detail in `19-configuration-and-keybindings.md`.
- `app.themePicker`: opens the theme picker; it never touches repository state. Detail in `20-theme-and-colors.md`.
- Navigation (`nav.up`, `nav.down`, `nav.pageUp`, `nav.pageDown`, `nav.first`, `nav.last`) drive the graph window and trigger a page load at the bottom edge.

Command model: `app.refresh` is a read command with an action ID; its single handler in `useRepository` calls `RepositoryProvider.refresh()` directly and never enters `commands.runner.ts`. `remote.fetch`, `remote.fetchPrune`, `remote.pull`, `remote.push`, and their force and no-verify variants are mutation commands dispatched through `useCommandRunner`; the orchestrator performs the post-result refresh. M4 wired the `remote.fetch` executor and its temporary global trigger. M5 adds the `remote.pull`, `remote.push`, `remote.pushForceSafe`, `remote.pushForceOverwrite`, `remote.pushNoVerify`, and `remote.fetchPrune` executors in `commands.remote.ts` and registers all seven through `useRemoteCommands`; the top-bar UI still owns their action triggers. `remote.fetch` is scoped to the upstream refs of local branches, grouped by remote and deduplicated, and runs `git fetch --progress -- <remote> +refs/heads/<branch>:refs/remotes/<remote>/<branch>` with the network timeout class. The forced-update prefix is required so an amended, rebased, or force-pushed upstream updates its remote-tracking ref instead of failing as non-fast-forward, and the destination is never a local branch. `remote.push` and its variants read the actual current branch, push an explicit remote and `refs/heads/<branch>:refs/heads/<upstream.branch>` refspec, so `push.default=matching` cannot update unrelated branches and a stale snapshot cannot push the wrong branch; Push without an upstream creates `origin/<branch>` with an explicit refspec. `remote.fetchPrune` confirms each affected remote with `git ls-remote --heads -- <remote>` before deleting any tracking ref, and a failed, timed-out, or truncated check leaves the group unknown. The repository read resolves whether any local branch has an upstream, and Fetch is blocked with "no local branches with upstreams" when that set is empty. Internal selection commands (`graph.selectCommit`, `graph.selectPending`, `stash.select`, `worktree.select`) have command IDs and no action IDs, no default key, and only update `RepositoryProvider.selection`. No feature registers a second handler for `app.refresh` or a `remote.*` action.

Focus interaction: `useHotkeys` resolves precedence (overlay, then text input, then native list widget, then focused region, then global). `app.refresh` is a global action and never fires while a text input has focus for an unmodified key. Region focus refresh is driven by `useFocusRegion` in each panel, not by `useFocus`. `useFocus` in `RepositoryProvider` only handles terminal-window focus and triggers a refresh without stealing focus.

## 9. Loading, empty, error, and disabled states

- Loading: a page load shows a `LoadingRow` with a `Spinner` and text "Loading older commits..."; the initial load shows "Loading history...". Remote operations show phase text plus the top bar `ProgressBar` when a percentage is reported; network commands pass `--progress`.
- Empty: an empty repository or empty diff section shows `EmptyState` with text, never a blank region.
- Error: a failed `refreshStatus()` or `refreshGraphWindow()` keeps the previous snapshot and loaded pages and shows a non-blocking status; a failed page load shows an inline error row with Retry (`ErrorState`) and keeps the loaded window. A failed bounded parent or search-result walk shows the separate walk-error notice instead, with Retry only when it belonged to a failed window reload. Errors also land in the console. A failed remote check is shown as `unknown` and never as deleted, absent, or unpushed.
- Cancelled or timed out: the operation ends with a warning status, "cancelled" or "timed out after N seconds", never success; the repository refreshes so partial local changes are visible.
- Disabled: while a write is in flight, conflicting actions render with the `dim` token and a text reason from `getAvailability` in `commands.availability.ts`. A refresh requested during an in-flight refresh is coalesced, not stacked, and reports "refresh in progress" only if it is user-initiated.

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
| Older pages monotonic, no duplicates | Cursor is the oldest loaded OID plus the frontier of unvisited scope tips and unemitted parents; `--skip` is never used; a repeated OID is rejected | `graph.paginate.ts` |
| Status refresh never drops loaded pages or changes selection | `refreshStatus()` reads no history and validates selection without writing it; `refreshGraphWindow()` re-reads the same page count and keeps the selected OID | `RepositoryProvider.tsx` |
| Stale page loads discarded | Generation token compared on resolve; mismatched results dropped | `graph.paginate.ts` |
| Only visible rows rendered | `viewportCulling` plus the row window from the measured scrollbox viewport height; the terminal height is only the first-frame fallback | `CommitGraph.tsx`, `useScrollViewportSize.ts` |
| Commit search lazy and bounded, discards stale | `graph.search.ts` returns bounded pages and carries the generation token; a stale result is discarded and the invocation may run to completion | `graph.search.ts`, `useCommitSearch.ts` |
| Diffs load on expand | `useFileDiff` requests on expand; no up-front diff for all files | `useFileDiff.ts`, `git.diff.ts` |
| Read-only commit and stash diffs not re-read on every refresh | `useReadOnlyDiff` keeps a settled diff across generation bumps; it re-reads only on target, client, root, context-line, or Retry changes, while an in-flight read is still discarded | `useReadOnlyDiff.ts` |
| Diff line and byte cap with truncation notice | `diff.limits.ts` enforces caps; `DiffContent` renders a "diff truncated" notice | `diff.limits.ts`, `DiffContent.tsx` |
| Console and error history bounded | `console.buffer.ts` keeps at least 200 entries with output head and tail capping; the error overlay replaces rather than stacks | `console.buffer.ts`, `OverlayProvider` |
| Remote progress without freezing | `git.progress.ts` publishes phase and percentage from `--progress`; F-02 renders `ProgressBar` and `Spinner` in the top bar status strip. `Spinner` uses `useTimeline`; `ProgressBar` throttles redraws with a 100 ms timer and redraws only when the rounded cells, width, or color change | `git.progress.ts`, `TopBarStatus.tsx`, `ProgressBar.tsx`, `Spinner.tsx` |
| No invocation can hang or run unbounded | `git.client.ts` applies the 10s local read, 30s local write, and 120s network timeout with an `AbortSignal`; abort sends `SIGTERM`, then `SIGKILL` after two seconds, and waits for exit | `git.client.ts` |
| No child waits on a prompt, editor, or pager | Prompt, editor, and pager environment matrix; stdin ignored; `--progress` on network commands and `--no-edit` on pull | `git.client.ts` |
| Remote staleness is explicit | Per-remote last successful check or fetch timestamp in `RepositoryProvider`; a failed check is `unknown` | `RepositoryProvider.tsx`, `repository.upstream.ts` |
| Reads and writes serialized | `commands.runner.ts` serializes writes; `git.client.ts` serializes index-touching reads against writes; `useCommandRunner.ts` performs the post-result refresh | `commands.runner.ts`, `git.client.ts`, `useCommandRunner.ts` |

Bounds: the graph window is `pages * graph.initialPageSize` and is trimmed at the far end from the viewport: older pages append below the viewport, so the newest retained tail stays resident, including the page just loaded, while the oldest rows at the top are released. The cursor and frontier that decide the next page are kept so pagination stays monotonic. The console buffer is bounded by entry count and a per-entry byte cap. Diff caps are a line count and a byte count from `diff.limits.ts`. The palette hands the native select at most 15 option rows and never fewer than one, whatever the terminal height, and help pages its row cursor by 8 rows while the body scrollbox clips rendering to the viewport.

## 11. Safety and confirmations

- Refresh is read-only and never prompts. Every invocation goes through `git.client.ts` with the prompt, editor, and pager environment matrix, stdin ignored, an argument array, a timeout, and an `AbortSignal`. Pull passes `--no-edit`; network operations pass `--progress`. The full contract is section 7.1 and F-18.
- A cancelled or timed-out refresh or mutation is reported as a warning, never as success; the repository refreshes so partial local changes are visible.
- Watcher-triggered refresh never runs a mutation and never auto-stashes, resets, checks out, cleans, or prunes.
- A refresh never clears drafts, staged files, selection, expansion, or console follow mode. The draft lives in `DraftProvider`, selection in `RepositoryProvider`, expansion in the owning feature, and follow mode in `ConsoleProvider`.
- A status refresh never re-reads history and never drops loaded pages or changes the selected commit.
- Page loads are reads only; they never touch the index.
- A missing upstream is never classified as deleted without a successful prune confirmation or a successful app-initiated remote branch deletion. A failed or timed-out remote check is `unknown`, and staleness comes from the last successful check or fetch, never from commit dates.
- Remote progress is display only; it never auto-retries.

## 12. Acceptance mapping

- "After every successful or failed mutation, refresh the affected repository state." (line 1092) -> `useCommandRunner.ts` calls `RepositoryProvider.refresh()` after the runner returns, in success, failure, cancellation, and timeout. The runner itself performs no refresh.
- "Provide `r` to refresh manually." (line 1093) -> `app.refresh` handler in `useRepository` calls `refresh()`.
- "Live watch the git directory..." (line 1094) -> `git.watcher.ts` debounces git-dir events into `refreshStatus()`, plus `app.refresh` for a full refresh.
- "Watching the working tree is optional... show a hint or refresh on focus." (line 1095) -> watcher mode flag in `RepositoryProvider`; terminal-window `useFocus` refresh; region focus refresh through `useFocusRegion`. The hint is deferred to the F-17 footer/sidebar surface; no component renders it yet, so the refresh-on-focus half of the bullet is the implemented behavior.
- "Ahead and behind reflect the last fetched remote refs." (line 1096) -> `repository.selectors.ts`.
- "After every fetch, re-evaluate upstreams... `[?]`... classified as deleted only after a successful prune..." (line 1097) -> `repository.upstream.ts` keyed by the fetch/prune result, with a successful app-initiated remote branch deletion as the second confirmed path and `unknown` on a failed check.
- "Preserve selection, expansion state, and the loaded graph window... A status refresh never silently drops loaded pages or the selected commit." (line 1098) -> `refreshStatus()` and `refreshGraphWindow()` in `RepositoryProvider`; selection in `RepositoryProvider`; expansion in feature view state.
- "Pagination is monotonic..." (line 1099) -> oldest-OID cursor plus unemitted-parent frontier in `graph.paginate.ts`; no `--skip`, and an appended page never repeats a loaded OID.
- "Every git invocation has a timeout and can be cancelled... a timed-out or cancelled command is reported as a warning, never as success." (line 1126) -> the section 7.1 contract in `git.client.ts`; `useCommandRunner.ts` maps cancelled and timed-out results to a warning status and still refreshes.
- Performance bullets (lines 1101-1116) -> the table in section 10.

## 13. Tests to add

- `src/domain/graph/graph.paginate.test.ts`: page bounds, single in-flight request, coalescing, oldest-OID cursor plus frontier, no `--skip`, monotonic next-page cursor after trimming, stale-token discard, window trimming, and append never duplicating a page.
- `src/features/graph/useScopeTipsReload.test.tsx`: a fourth tip change is loaded by the single re-arm, a joined reload that recorded the current key adds no attempt, a persistently changing key stops at the round bound, and a successful external reload resets that bound.
- `src/domain/graph/graph.search.test.ts`: bounded pages, stale query result discard, stable offset pagination that always passes the scope and adds `--skip` only after the first page, a non-matching parent between matches that does not drop a deeper match, and a shifted result set that still returns the older matches.
- `src/domain/diff/diff.limits.test.ts`: line cap, byte cap, truncation flag.
- `src/domain/console/console.buffer.test.ts`: 200-entry bound, output head and tail capping.
- `src/domain/repository/repository.upstream.test.ts`: re-evaluation after fetch, `[?]` before prune, deleted after a successful prune, deleted after a successful app-initiated remote branch deletion, `unknown` after a failed or timed-out check, and no deletion claim from commit dates.
- `src/domain/git/git.watcher.test.ts`: debounce, git-dir versus worktree mode, no refresh storm.
- `src/domain/git/git.status.test.ts`: the canonical invocation is `git status --porcelain=v2 --branch -z --untracked-files=all`.
- `src/domain/git/git.client.test.ts` (shared with F-18): 10s/30s/120s timeout selection, `AbortSignal` cancellation, `SIGTERM` then `SIGKILL` after two seconds plus a wait for exit, cancelled/timed-out results distinct from success, the prompt, editor, and pager environment matrix, stdin ignored, `--progress` on network commands, and `git pull --progress --no-edit`.
- `src/app/providers/RepositoryProvider.test.tsx`: `refreshStatus()` changes counts, refs, branches, tags, worktrees, stashes, and upstreams without re-reading history, without dropping loaded pages, without changing the selected OID or the cursor, and it discards an in-flight page result through the generation token; `refreshGraphWindow()` re-reads the same page count and preserves the selected OID; selection, expansion, `DraftProvider` draft, and `ConsoleProvider.followMode` survive a refresh; the per-remote last-successful check timestamp drives staleness and a failed check stays `unknown`.
- `src/app/hooks/useCommandRunner.test.tsx`: a success result triggers exactly one combined refresh, one console append, and a success status; a failure result refreshes once, appends once, and opens the error overlay; a cancelled or timed-out result refreshes once and sets a warning status without success; a blocked result performs no refresh, console append, or error overlay and surfaces the reason as a transient status; progress events update the operation phase and percentage; the orchestrator never clears drafts; `app.refresh` calls the read path and never invokes the runner.
- Performance smoke: a synthetic large log fixture asserting the first page bound and one in-flight page load (per architecture section 13).

## 14. Open questions

- Retained-window trimming policy: the exact maximum number of pages to keep resident before releasing the oldest.
- Whether focus refresh should be suppressed during an active write to avoid interleaving reads with a mutation.
- Whether the worktree-watch opt-in is a config field in v1 or deferred to a later release.
- Whether the per-remote last-successful-check timestamps persist across restarts or reset to `unknown` each launch. This document resets them, so a cold start never claims a remote is fresh.
