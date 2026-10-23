# 08 - Commit graph

## 1. Header

- Spec reference: `docs/product-spec.md` F-08 (lines 610-739), D3 (line 1871), D16 (line 1884), D17 (line 1885), graph config keys `graph.scope` and `graph.initialPageSize` (lines 1199-1200), action IDs (lines 1705-1742).
- Architecture contract: `docs/technical-implmentations/00-project-architecture.md`.
- Region id: `graph` (`src/features/shell/regions.ts`).
- Dependencies: F-01 (shell, focus, region order), F-09 (composer shown when the Pending Changes row is selected), F-10 (details shown when a commit is selected), F-11 (working tree and commit diffs), F-15 (error overlay and confirmations), F-16 (empty repository, detached HEAD), F-17 (refresh, pagination bounds, virtualization), F-18 (safety), F-19 (`graph.scope`, `graph.initialPageSize`, key overrides).
- Owned paths:
  - `src/features/graph/CommitGraph.tsx`
  - `src/features/graph/CommitRow.tsx`
  - `src/features/graph/PendingChangesRow.tsx`
  - `src/features/graph/GraphLanes.tsx`
  - `src/features/graph/CommitSearchInput.tsx`
  - `src/features/graph/SearchResultRow.tsx`
  - `src/features/graph/useCommitGraph.ts`
  - `src/features/graph/useCommitSearch.ts`
  - `src/domain/graph/graph.types.ts`
  - `src/domain/graph/graph.lanes.ts`
- Co-owned paths: `src/domain/graph/graph.paginate.ts` and `src/domain/graph/graph.search.ts` are shared with F-17 (see `17-freshness-and-performance.md` section 1). F-08 owns the page-window behavior and the search matching semantics; F-17 owns generation tokens, refresh interaction, and the global bounds table. See Open questions.
- Read-only references: `src/domain/git/git.log.ts`, `src/domain/git/parsers/parse.log.ts`, `src/domain/git/parsers/parse.refs.ts`, `src/domain/git/git.branches.ts`, `src/domain/git/git.tags.ts`, `src/domain/repository/repository.selectors.ts`.

## 2. Scope and non-goals

Scope: the Commit panel; the always-first Pending Changes row and its unstaged count; commit rows with graph lanes, nodes, merge distinctness, selection marker, truncated subject, ref badges in tag/local/remote order with `+N` overflow, right-aligned real file count, author shortening, and compact dates; a versioned log record format with `--raw` and `--numstat` so file counts and merge stats are real; selection and navigation including PageUp/PageDown and `g`/`G`; lazy bounded paging with an oldest-OID cursor, a loading row, a "Beginning of history" marker, a Retry row, cancellation on scope change, and bounded parent loading; window-preserving refresh split from status refresh; and the full commit search surface including literal fixed-string matching, body snippets, the flat result list, live debounced AND matching, bounded lazy result pages, highlighting, and one-press Esc restore.

Non-goals: commit details content (F-10); the composer and commit variants (F-09); working tree, staged, and untracked diff content (F-11); graph mutation such as reset, revert, or checkout (not in v1); regex, author, hash, path, and date search filters (deferred, product spec line 44); fetch and push (F-02); persisting the graph window or selection across restarts (F-17).

## 3. OpenTUI components used

| Component | Where used | Why it is the right component |
| --- | --- | --- |
| `<box>` | Commit panel frame, every commit row, the Pending Changes row, the loading row, the Retry row, the end-of-history marker row, and each search result row. | The only layout, border, focus-ring, and hit-test primitive. Rows need custom content (lanes, badges, columns) that `<select>` cannot render. |
| `<text>` | Subject line, metadata line, counts, state text, page markers, and the search status line. | Every UI string is rendered through `<text>`. |
| `<span>` | Lane cells per row, ref badges, selection marker emphasis, matched-term highlights in search results, and the `+N` overflow badge. | Inline styled runs inside a single `<text>`; badges and highlights are spans per architecture section 6. |
| `<scrollbox>` | The Commit panel body, with `viewportCulling` enabled. | The only OpenTUI scroll container; handles wheel scroll, scrollbars, and visible-window culling for very long histories. |
| `<input>` | `CommitSearchInput.tsx`, the single-line search field at the top of the Commit panel. | Single-line fields use `<input>`; the commit query is single line. |
| `<select>` | Not used for graph rows. | The graph is a custom-content list; architecture section 6 rule 3 requires a `<scrollbox>` plus `useListCursor` in that case. |
| `<code>`, `<diff>`, `<line-number>`, `<markdown>`, `<ascii-font>`, `<textarea>` | Not owned here. | N/A for this feature. |

Hooks used:

| Hook | Where used | Why |
| --- | --- | --- |
| `useKeyboard` | Only inside `src/app/hooks/useHotkeys.ts`. | Central dispatcher; this feature never calls it directly. |
| `useAction` | `useCommitGraph.ts` registers `nav.up`, `nav.down`, `nav.pageUp`, `nav.pageDown`, `nav.first`, `nav.last`, `nav.activate`, and `graph.search` with `scope: "graph"`. | Features receive action IDs, never raw key strings. Exactly one handler exists per `(actionId, scope)`; `useCommitSearch` supplies delegates, not a second registration. `app.refresh`, `commit.focus`, and `overlay.close` are app- or overlay-owned and are not registered here. |
| `useListCursor` | `useCommitGraph.ts` for cursor movement, `g`/`G`, PageUp/PageDown windows, and double click detection. | Shared cursor, page-step, and double click logic for custom rows. |
| `useTerminalDimensions` | `CommitGraph.tsx` computes the visible-row window and truncation budgets; `CommitRow.tsx` and `SearchResultRow.tsx` truncate subject and metadata. | Budget-aware truncation and culling from `@/lib/text.ts`. |
| `useOnResize` | `CommitGraph.tsx` recomputes the culled window and truncation budgets after a resize. | Keeps culling and budgets correct when the terminal changes size. |
| `useDebouncedValue` | `useCommitSearch.ts` debounces the raw query before dispatch. | Live search after a short debounce, not on every keystroke. |
| `useFocusRegion` | `CommitGraph.tsx` refreshes the graph when the `graph` region gains focus and supplies `regionProps`, `focused`, and the cursor projection. | Region focus is derived from native focus. `useFocus` reports terminal-window focus only; it is owned by `RepositoryProvider` for external-edit refresh (F-17) and is not region focus. |

`<select>` versus `<scrollbox>`: the graph uses a `<scrollbox>` of `<box>` rows because each row carries lane spans, a selection marker, ref badges, a right-aligned file count, and search highlighting. `<select>` is reserved for uniform option lists such as the composer More menu.

All icons and markers used by this feature come from `src/theme/icons.ts`; see architecture section 6.1. No glyph literal is written in feature code.

## 4. Component tree

```text
MainArea                            (src/features/shell/MainArea.tsx)
-> CommitGraph                      (src/features/graph/CommitGraph.tsx)
   Panel                            (ui/Panel.tsx, region frame for `graph`)
     PanelHeader                    (title "Commit", scope, loaded count, search status)
     CommitSearchInput              (only when search is open)
     ScrollableList                 (scrollbox, viewportCulling)
       PendingChangesRow            (only when the query is empty)
       CommitRow                    (one per loaded commit inside the visible window)
         GraphLanes                 (spans: lane lines and node)
         ListRow
           TextMarker               (selection marker `>`)
           text (subject)
           text (metadata: badges, author, date)
           text (right-aligned file count)
       SearchResultRow              (only in search mode, one per loaded result)
       LoadingRow                   (initial page, older page, or parent load in flight)
       ErrorState                   (page load failed, with Retry)
       EmptyState                   (no commits yet)
       text ("Beginning of history")
```

Search mode replaces the graph body: when the query is non-empty, `CommitGraph` renders `SearchResultRow` rows instead of `PendingChangesRow` and `CommitRow`, so the lanes and the Pending Changes row are hidden.

Selection is not a local graph mode. `AppShellHost` derives the right pane from `RepositoryProvider.selection` (architecture section 9): `{ kind: "pending" }` renders the composer, `{ kind: "commit", oid }` renders commit details, and the graph itself never owns a second selected OID.

## 5. Enforced files and folders

- `src/features/graph/CommitGraph.tsx` - panel composition, region registration, the scrollbox with `viewportCulling`, visible-window computation, and loading and end markers.
- `src/features/graph/CommitRow.tsx` - one commit row: lanes, selection marker, truncated subject, ref badges, right-aligned file count, author and date.
- `src/features/graph/PendingChangesRow.tsx` - the always-first Pending Changes row and its unstaged count.
- `src/features/graph/GraphLanes.tsx` - renders the lane prefix for one row as `<span>` runs from `graph.lanes.ts` output.
- `src/features/graph/CommitSearchInput.tsx` - the single-line search field, its placeholder, and its focus handling.
- `src/features/graph/SearchResultRow.tsx` - one flat search result row with matched-term highlighting.
- `src/features/graph/useCommitGraph.ts` - derives rows from selectors, owns the page-window view state, dispatches selection and page loads.
- `src/features/graph/useCommitSearch.ts` - owns search view state, debounces the query, cancels stale queries, and dispatches result pages.
- `src/domain/graph/graph.types.ts` - `GraphScope`, `GraphRow`, `GraphFileStat`, `GraphPage`, `GraphPageRequest`, `GraphCursor`, `GraphSearchCursor`, `GraphSearchQuery`, `GraphSearchResult`, `GraphSearchPage`, and `GraphGeneration`. The versioned log constants `GRAPH_LOG_FORMAT_VERSION`, `GRAPH_LOG_FIELD_SEPARATOR`, and `GRAPH_LOG_RECORD_SEPARATOR` are owned by `src/domain/git/git.log.ts` and typed there.
- `src/domain/graph/graph.lanes.ts` - pure lane assignment: given ordered commits with parents, returns per-row lane cells and the node column.
- `src/domain/graph/graph.paginate.ts` - co-owned with F-17: builds cursor page requests, tracks the loaded window and its oldest-OID cursor, enforces the single in-flight request, bounds `ensureLoaded(oid)` by pages and time, and discards stale results.
- `src/domain/graph/graph.search.ts` - co-owned with F-17: builds the bounded fixed-string search page request, the AND-term match predicate, and the body snippet and match ranges.
- Tests colocated: `src/domain/graph/graph.lanes.test.ts`, `src/domain/graph/graph.paginate.test.ts`, `src/domain/graph/graph.search.test.ts`, `src/domain/git/parsers/parse.log.test.ts`, `src/features/graph/CommitRow.test.tsx`, `src/features/graph/PendingChangesRow.test.tsx`, `src/features/graph/CommitGraph.test.tsx`, `src/features/graph/useCommitSearch.test.tsx`.

## 6. State model

View state, owned by `useCommitGraph.ts` and `useCommitSearch.ts`:

- Cursor index for the `graph` region, stored through `useListCursor` and persisted per region by `FocusProvider`, keyed by the stable row key (commit OID, or the literal `pending`). The cursor is a position only; the selection is provider state.
- The loaded page window: the scope key, the ordered list of loaded commit OIDs, the retained page boundaries, the `GraphCursor` (`oldestOid` plus the frontier of unemitted parent OIDs), whether an older page is in flight, whether the end of history is reached, and the last page error. This is view state fed by `graph.paginate.ts` (architecture section 9 and `17-freshness-and-performance.md` section 6).
- The graph-window refresh state: whether a window refresh is in flight, the window generation, and the number of pages to re-read. A status refresh never changes this state.
- Search view state: `searchOpen`, the raw query, the debounced query, the flat result list, the search cursor, whether a result page is in flight, the end-of-results flag, the search error, and a snapshot of the previous graph state (provider selection identity, scroll offset, loaded pages and cursor, composer visibility) captured when search opened.

Provider state, read and never recomputed here:

- `RepositoryProvider`: the repository snapshot, the refresh generation, the resolved `graph.scope` and `graph.initialPageSize`, and `selection`, the single source of the selected row. `{ kind: "pending" }` is the Pending Changes row and `{ kind: "commit", oid }` is a commit row. The feature never stores a second selected OID.
- `ConfigProvider`: `graph.scope`, `graph.initialPageSize`, and the resolved keymap used for hint text.
- `StatusProvider`: transient status and any running operation.
- `FocusProvider`: derived active region, `previousRegion`, and cursor map. The commit-search input mode is declared by the search owner; text focus itself is derived from native focus.
- `OverlayProvider`: whether an overlay is open, which exits search (F-15).

Rules: this feature never recomputes pending counts, refs, ahead/behind, or upstream state. It reads them from `@/domain/repository/repository.selectors.ts`. It never mutates git state; paging and search are reads only. Selection changes go through the internal selection commands and are applied to `RepositoryProvider`, not written directly by a component.

## 7. Data flow

Generic path (architecture section 9):

```text
key or click -> action ID or internal selection command -> useAction handler
  -> useCommandRunner.runCommand(request) for mutations, or a direct read through RepositoryProvider for graph reads
  -> command runner (availability + serialization) or @/domain/git/git.log.ts
  -> CommandResult or page result -> useCommandRunner applies status, console, and error effects for mutations
  -> RepositoryProvider refresh and CommitGraph re-render
```

The graph is read-only, so page loads and search reads do not pass through `commands.runner.ts`. They call `git.log.ts` through `graph.paginate.ts` and are serialized against writes by `git.client.ts` (architecture section 10). Selection changes dispatch internal command IDs and are applied to `RepositoryProvider.selection`.

Command and handler model (architecture section 8.1):

- `useCommitGraph.ts` is the single registration owner for the `graph` scope. It registers `nav.up`, `nav.down`, `nav.pageUp`, `nav.pageDown`, `nav.first`, `nav.last`, `nav.activate`, and `graph.search`. Exactly one handler exists per `(actionId, graph)`. `useCommitSearch.ts` returns delegates that the graph registration calls while search is open, so it never registers a second `nav.*` handler.
- The feature never registers `app.refresh`, `commit.focus`, `overlay.close`, or `focus.*`. `app.refresh` and `commit.focus` are global actions owned by the app or shell; `overlay.close` belongs to the overlay host; `focus.*` belongs to `useFocusModel`.
- `graph.selectCommit` is an internal command ID used by commit rows and by other features that need to select a commit. It has no action ID and no default key. The Pending Changes row uses the internal `graph.selectPending` command. Both targets are `{ kind: "commit", oid }` and `{ kind: "pending" }`, and both only set `RepositoryProvider.selection`.
- The palette entry "Search commits" dispatches the `graph.search` command with `{ kind: "none" }`. The palette closes, focuses or reveals the `graph` region through `focusRegion`, and the graph opens the search input. The palette never dispatches to a hidden graph cursor.
- Availability is target-aware. `graph.search` is unavailable in an empty repository with the reason "No commits to search". `graph.selectCommit` is unavailable when the target OID no longer exists. Navigation and page reads stay available while a repository write is in flight.

Versioned log record format: `git.log.ts` owns `GRAPH_LOG_FORMAT_VERSION = 1`, `GRAPH_LOG_FIELD_SEPARATOR = "\x00"`, and `GRAPH_LOG_RECORD_SEPARATOR = "\x1e"`. The format string is `%x1e1%x00%H%x00%P%x00%an%x00%ae%x00%aI%x00%ct%x00%D%x00%s%x00%b%x1e`. Fields are, in order:

1. `version`: the literal `1`.
2. `oid`: `%H`, the full commit OID.
3. `parents`: `%P`, space-separated parent OIDs.
4. `authorName`: `%an`.
5. `authorEmail`: `%ae`.
6. `authorDate`: `%aI`, strict ISO 8601.
7. `committerTimestamp`: `%ct`, epoch seconds.
8. `decorations`: `%D`, comma-separated ref names.
9. `subject`: `%s`.
10. `body`: `%b`, possibly empty and possibly multiline.

Each record starts and ends with `GRAPH_LOG_RECORD_SEPARATOR`, so the body cannot run into the file-stat block. Every field is separated by `GRAPH_LOG_FIELD_SEPARATOR`, which cannot appear in a commit message. The parser recognizes a record start only as the record separator followed by `1` and a field separator; NUL cannot appear in a message or a path, so a record-separator byte inside a body or filename is never mistaken for a boundary. `parse.log.ts` rejects a missing version, an unknown version, or the wrong field count with a typed parse error that the page error row shows with Retry; it never guesses. Git appends `--raw` and `--numstat` output after each record's closing separator, and the parser associates that block with the record that precedes it.

Log invocation: `git log --topo-order --parents --decorate=full --raw --numstat -z --diff-merges=first-parent --root --max-count=<n> --format=<versioned format> <scope>`. `--raw` supplies the file list and statuses, `--numstat` supplies additions and deletions, `--diff-merges=first-parent` makes merge stats a real diff against the first parent instead of combined output with zero counts, and `--root` gives the root commit a real file list. `fileCount` is the number of entries in the raw block; merge commits therefore show the same kind of count as ordinary commits.

| Action ID or trigger | Domain module | Git subcommand |
| --- | --- | --- |
| repository refresh (status only) | `RepositoryProvider.refreshStatus()` through `git.status.ts` and the ref readers in `git.branches.ts`, `git.tags.ts`, and `git.remotes.ts` | `git status --porcelain=v2 --branch -z --untracked-files=all` plus the ref read; no history page is re-read |
| repository refresh (graph window) | `RepositoryProvider.refreshGraphWindow()` through `graph.paginate.ts` and `git.log.ts` | the loaded-window page requests below, re-read for the same page count |
| initial page | `git.log.ts` `readLogPage()` through `graph.paginate.ts` | `git log --topo-order --parents --decorate=full --raw --numstat -z --diff-merges=first-parent --root --max-count=<graph.initialPageSize> --format=<versioned format> <scope>` |
| older page (`nav.last`, PageDown near bottom, scroll near bottom) | `graph.paginate.ts` `nextPageRequest()` then `git.log.ts` | the same log invocation with `--max-count=<pageSize>` and the cursor frontier as positive revisions; no `--skip` |
| parent selection loading (F-10) | `graph.paginate.ts` `ensureLoaded(oid)` then `git.log.ts` | cursor pages repeated until the OID is present or the page or time bound is reached |
| ref badges | `parsers/parse.log.ts` from `%D`, plus `parsers/parse.refs.ts` | `git for-each-ref` (branches, tags, remotes) mapped to commit OIDs by `repository.selectors.ts` |
| pending count | `parsers/parse.status.ts` via `git.status.ts` | `git status --porcelain=v2 --branch -z --untracked-files=all` |
| `graph.search` query | `graph.search.ts` `buildSearchRequest()` then `git.log.ts` | `git log --topo-order --decorate=full --raw --numstat -z --diff-merges=first-parent --root --fixed-strings -i --all-match --grep=<term1> --grep=<term2> --max-count=<pageSize> --format=<versioned format> <scope>` |
| search result page (scroll near bottom) | `graph.search.ts` `nextSearchPage()` then `git.log.ts` | the search invocation above with the search cursor as the starting point; no `--skip` |
| `app.refresh` | app-owned `useRepository` handler -> `RepositoryProvider.refresh()` | runs `refreshStatus()` and `refreshGraphWindow()`; the graph never registers the action |

Scope resolution for `graph.scope`: `all` -> `--branches --remotes HEAD`; `local` -> `--branches HEAD`; `current` -> `HEAD`. `HEAD` is explicit in `all` and `local` so a commit made while detached is visible in the graph; duplicate reachability is de-duplicated by git. The graph shows all commits reachable from local and remote branches (D3, F-08); orphan and unreachable commits are not shown. Tag-only commits outside those refs are not in scope.

Cursor pagination: the cursor is anchored on the oldest loaded OID and a frontier of unemitted parent OIDs. When a page is appended, `graph.paginate.ts` records the page's last OID as `oldestOid` and recomputes the frontier as the parents of emitted commits that have not themselves been emitted. The next request passes those frontier OIDs as positive revisions and appends only unseen rows; `oldestOid` is the monotonic display anchor and is retained even when the oldest page is released by window trimming. `--skip` is never used, so a page request never re-walks the loaded prefix, trimming the oldest page never changes the cursor used for the next page, and appending a page cannot duplicate an already loaded page. The parser and `graph.paginate.ts` both reject a page that repeats an OID.

Bounded `ensureLoaded(oid)`: selecting a parent commit or an old search result loads at most `GRAPH_ENSURE_MAX_PAGES` cursor pages (20, which is 10,000 commits at the default page size) within `GRAPH_ENSURE_TIMEOUT_MS` (10 seconds). The result is `loaded`, `notFound`, `exceeded`, or `cancelled`. On `exceeded` or `notFound`, the graph keeps the current selection and shows "Commit is not within the loaded history"; it never walks the entire repository to satisfy one selection. The bound constants live in `graph.paginate.ts`, are covered by tests, and are not user configuration.

Refresh split and window preservation: `RepositoryProvider.refreshStatus()` re-reads the canonical status, refs, and pending counts, merges refreshed ref badges into loaded rows by OID, and checks selection validity without touching the loaded history pages. `RepositoryProvider.refreshGraphWindow()` re-reads the same loaded page count from the current scope using the page cursor, merges refreshed rows by OID, and keeps the selected OID selected when it still exists; if new commits pushed the selected OID outside the re-read window, the bounded `ensureLoaded(selectedOid)` restores it rather than dropping it, and if it no longer exists the nearest row becomes selected. A refresh never falls back to re-reading only page 1, and it never drops pages 2..N while the selection is inside them. Manual `r`, a mutation result, and terminal-window focus call the combined `refresh()`; a status-only watcher event calls `refreshStatus()`. Both paths cancel an in-flight older-page or search load, bump the generation, and discard stale results (`17-freshness-and-performance.md` section 10). The viewport is anchored on the selected OID so rows inserted above it do not move the view.

`graph.lanes.ts` runs after each page parse. It takes the ordered commits with their parent OIDs, carries lane columns across page boundaries, and returns for each row a lane string (cells of `*` for the node, `|` for a continuing lane, `/` and `\` for branch and merge edges, and spaces) plus the node column. `GraphLanes.tsx` turns each lane string into one `<span>` per cell colored with a lane token. A merge commit is drawn with a node cell plus one edge cell per displayed parent, so merges are visually distinct and connected to all parents; octopus merges, branch starts, and disconnected lanes are handled by the same column assignment without corruption.

Author shortening and dates are pure helpers applied in `CommitRow.tsx`:

- Author: names up to 12 characters are shown as written; longer names are shortened to the first letters of the first two words, uppercased; a single long word shows its first two characters, uppercased. Example: "John Doe" becomes "JD". The full name and email are always available in commit details (F-10).
- Date: compact local time for commits from today; day and month for commits from the current year; day, month, and year for older commits. The full timestamp with timezone is shown in commit details.

Pending Changes row: label "Commit Changes" and secondary text with the unstaged file count. The count includes working tree modifications, deletions, renames, and untracked files (for example 7 modified plus 3 untracked shows "10 unstaged files"). When the working tree is clean the row shows "Working tree clean" and remains selectable. Staged-only changes still allow a commit even when the count is zero; the composer shows the staged count (F-09).

Ref badges: tags first, then local branches, then remote branches. When space is insufficient, show the first badges plus a `+N` count span. For tagged commits the badges get visual priority: the metadata line places badges before the date, and the date may be omitted when space is tight. The affected file count is right aligned at the row edge and comes from the commit's own `--raw` block, not from the refs or the working tree.

Commit search matching and body snippets: `graph.search.ts` passes each whitespace-separated term as a separate `--grep` with `--all-match`, `--fixed-strings`, and `-i`. Fixed strings mean `[`, `*`, `\`, `.`, `+`, `?`, `(`, and `)` match literally, and no regular expression is compiled. Git's grep covers the full commit message, so the subject and body both match case-insensitively. For each result, `buildBodySnippet(body, terms, budget)` normalizes whitespace, finds the first literal case-insensitive term occurrence in the body, and returns one context line with match ranges plus leading and trailing ellipsis flags. `SearchResultRow` renders the snippet only when the match is in the body, adds `ICONS.ellipsis` at the truncated ends, and highlights the matched terms with the accent token; the text stays readable without color. Search result rows show the short OID, subject, optional body snippet, ref badges, the real affected file count from `--raw`, author, and date.

## 8. Keyboard and focus

Action IDs only (product spec section 6.1). Raw key strings never appear outside `@/domain/keymap/**` and `src/app/hooks/useHotkeys.ts`. The region-scoped rows are `nav.*` and `graph.search`; `app.refresh`, `commit.focus`, `overlay.close`, and `focus.*` are listed for context and are not registered by this feature.

| Action ID | Behavior in the Commit graph |
| --- | --- |
| `nav.up`, `nav.down` | Move the selection one row. The selection follows the cursor, updates `RepositoryProvider.selection` through the internal selection command, and immediately updates the right pane (F-10) or the composer (F-09) when the Pending Changes row is selected. |
| `nav.pageUp`, `nav.pageDown` | Move by one screen of visible rows; PageDown near the bottom triggers an older-page load through `graph.paginate.ts`. |
| `nav.first` (`g`) | Jump to the newest loaded commit. |
| `nav.last` (`G`) | Jump to the oldest loaded commit and start loading the next older page when more history exists. |
| `nav.activate` (`Enter`) | Confirm the current row. On a commit row this dispatches `graph.selectCommit` with `{ kind: "commit", oid }`, replaces the composer with commit details, and shows the commit diff; on the Pending Changes row it dispatches `graph.selectPending` and restores the composer and working tree diffs. Mouse double click dispatches the same command. |
| `graph.search` (`/` or `Ctrl/Cmd+F`) | Open the commit search input at the top of the Commit panel and focus it. The binding applies when the graph region is focused and no text input owns the key. The palette entry "Search commits" dispatches the same command from any region, focuses the graph first, and opens the input. |
| `app.refresh` (`r`) | Global, app-owned. Manual refresh calls `RepositoryProvider.refresh()`, which runs `refreshStatus()` and `refreshGraphWindow()`, keeps the loaded page window, and keeps the selected OID selected when it still exists. |
| `commit.focus` (`c`) | Global, app-owned. Focus the composer when it is visible. |
| `overlay.close` (`Esc`) | Overlay-owned. In search mode it clears the query, cancels any in-flight search, and restores the previous graph state in one press. Outside search it returns focus to `previousRegion`. |
| `focus.next`, `focus.previous` | Tab traversal (owned by `useFocusModel`). |
| `focus.region.graph` | Direct jump to the graph (default `6`), shell-owned. |

Selection lives in `RepositoryProvider.selection`, keyed by stable identity (commit OID, or `pending`), so a refresh that preserves the commit preserves both the selection and the cursor (architecture sections 8 and 9). The graph does not store a selected OID of its own; `useCommitGraph` derives the selected row from the provider and the cursor from `FocusProvider`.

Search key routing: while the search input is focused, printable keys, including `j` and `k`, edit the query. `nav.up`, `nav.down`, `nav.pageUp`, `nav.pageDown`, and `nav.activate` are routed to the search result list by the declared `commit-search` input mode. This is a defined input mode, not a general exception to the region focus model: text inputs own unmodified keys by default, and the search mode opts specific navigation keys back into app dispatch. `Esc` cancels the search and restores the previous graph state in one press. `useCommitGraph` remains the one registration owner for the graph scope and calls the search delegates returned by `useCommitSearch`.

## 9. Loading, empty, error, and disabled states

- Loading, first page: a `LoadingRow` at the top with the marker `[..]` and "Loading history...". The panel frame renders immediately.
- Loading, older page: a bottom `LoadingRow` with "Loading older commits...". The user keeps navigating already loaded commits.
- Loading, parent selection: a visible `LoadingRow` with "Loading parent commit..." while `graph.paginate.ts` ensures the parent OID is loaded. The load stops at the page and time bound and then shows the bounded-miss state.
- Bounded miss: when `ensureLoaded` returns `exceeded` or `notFound`, an inline `text` row shows "Commit is not within the loaded history"; the current selection stays selected and no full-history walk starts.
- Empty repository: `EmptyState` with "No commits yet"; the Pending Changes row stays selectable so the user can stage and make the first commit (F-16).
- End of history: a persistent `text` row with "Beginning of history".
- Page or parse error: a persistent inline `ErrorState` row with the git or parser message and a Retry button. Already loaded rows remain usable.
- Refresh, status only: counts, refs, and the selected-row validity update in place; loaded rows do not disappear and no page is re-read.
- Refresh, graph window: the loaded row count is preserved, the selected OID stays selected when it still exists, and a replacement row appears only when the old row no longer exists.
- Search, empty query: the normal graph and Pending Changes row remain visible, and `CommitSearchInput` shows the placeholder "Search commit messages...".
- Search in flight: the header shows "Searching..." plus a count.
- Search partial: the header shows "N+ matches" while more results may exist.
- Search complete: the header shows "N matches".
- Search no matches: `EmptyState` with "No commits match <query>".
- Search error: an inline `ErrorState` row with Retry while the previous graph state remains intact underneath.
- Search unavailable in an empty repository: the input is disabled with the text "No commits to search".
- Detached HEAD: the graph still shows history, and the detached commit is visible in `all`, `local`, and `current` scopes because every scope includes `HEAD`; the current position is shown in the top bar and commit details (F-02, F-10).
- Disabled: selection is a read and stays available while a repository write is in flight; the graph never stages, commits, or changes refs.

Every state carries a text marker; color is never the only signal.

## 10. Performance and bounds

- The initial page is bounded by `graph.initialPageSize` (default 500, allowed range 100 to 2000, product spec line 1192). The graph never loads full history up front (D16).
- Older pages use the same page size and load automatically when the selection or scroll reaches near the bottom of the loaded rows.
- Exactly one older-page load runs at a time. Repeated scrolling or key presses coalesce into the single in-flight request; they do not queue duplicate requests.
- Pagination is cursor-based: the request uses the oldest loaded OID plus the frontier of unemitted parents, never `--skip`, so the loaded prefix is not re-walked and pages cannot duplicate. The cursor is retained independently of window trimming.
- Appending a page does not move the current selection, viewport, or focus.
- After a page loads, `nav.last` (`G`) again moves to the newly loaded oldest commit and can trigger the next page.
- Changing graph scope, reloading configuration, a status refresh, or a graph-window refresh cancels an in-flight older-page load and discards stale results. `graph.paginate.ts` compares the generation token on resolve and drops mismatched results (`17-freshness-and-performance.md` section 10).
- `ensureLoaded(oid)` is bounded by `GRAPH_ENSURE_MAX_PAGES` and `GRAPH_ENSURE_TIMEOUT_MS`; it cannot walk the full repository for one parent or search result.
- Virtualization: `CommitGraph.tsx` renders the list inside a `<scrollbox>` with `viewportCulling` enabled, so only rows intersecting the viewport are drawn. `useTerminalDimensions` supplies the visible-row window, and the component mounts only that window plus a small overscan, which keeps rendering cost proportional to terminal height, not to the loaded window. Wheel scroll and `nav.pageUp`/`nav.pageDown` move the window without remounting the panel.
- The loaded window is retained for the session and trimmed to a maximum retained window, releasing the oldest pages when they are far outside the viewport (`17-freshness-and-performance.md` section 10). Trimming removes rendered rows only; the cursor and frontier that decide the next page are kept, so the next page stays monotonic.
- Search pages are bounded by the same `graph.initialPageSize`; the flat result list is virtualized the same way and loads more results when scrolling near the bottom. Search uses `--fixed-strings` and literal term matching, never regex compilation, and never loads full history into the graph.
- Row truncation uses `@/lib/text.ts` with a budget from `useTerminalDimensions`. Truncation never hides the selection marker, the ref badge priority, the body snippet marker, or the file count.
- Graph lanes are computed once per loaded page in `graph.lanes.ts`, not per render. File stats and body snippets are computed once per parsed page and stored with the row.

## 11. Safety and confirmations

- The graph is a read-only surface. It never stages, commits, resets, reverts, checks out, or changes refs.
- Search mode is read-only; it never mutates repository state.
- Selecting a commit only changes the right pane and the diff view; it requires no confirmation.
- Page loads and search queries never touch the index and never run a mutation.
- Esc in search mode restores the previous state and never discards staged files or the composer draft.
- Every git invocation runs through `git.client.ts` with an argument array and no shell; credentials are redacted before any console or error rendering (F-18).

## 12. Acceptance mapping

| F-08 acceptance bullet | Implementing module or component |
| --- | --- |
| Pending count equals the working tree plus untracked files | `PendingChangesRow.tsx` reading the count selector from `repository.selectors.ts`; `parsers/parse.status.ts` over `git status --porcelain=v2 --branch -z --untracked-files=all` |
| Merge commits show a distinct node and connections to all displayed parents | `graph.lanes.ts` node and edge cells; `GraphLanes.tsx`; file stats from `--raw --numstat --diff-merges=first-parent` |
| Tags and branches appear as badges on the correct commits | `parsers/parse.log.ts` from `%D` and `parsers/parse.refs.ts` mapped by OID; `CommitRow.tsx` badge spans |
| Selecting a commit changes the right pane from composer to commit details | internal command `graph.selectCommit` sets `RepositoryProvider.selection`; `AppShellHost.tsx`; F-10 |
| Selecting Pending Changes restores the composer | internal command `graph.selectPending`; `PendingChangesRow.tsx`; F-09 |
| Very long histories remain navigable with keyboard and mouse | `CommitGraph.tsx` scrollbox with `viewportCulling`; `useListCursor` |
| A 100,000-commit branch opens with the initial page and never loads full history up front | `graph.paginate.ts` initial request with `graph.initialPageSize` |
| Scrolling near the bottom loads the next page, keeps the viewport and selection stable, and never starts duplicate page loads | `graph.paginate.ts` oldest-OID cursor and single in-flight request |
| `G` moves to the oldest loaded commit and triggers the next page | `useCommitGraph.ts` `nav.last` handler |
| End of loaded history shows "Beginning of history", and a failed page load shows a Retry row without breaking loaded rows | `CommitGraph.tsx` end marker and `ErrorState` row |
| Changing graph scope or refreshing discards stale older-page results | `graph.paginate.ts` generation token; status refresh and graph-window refresh cancel and discard |
| Refreshing keeps the loaded page window and the selected commit | `RepositoryProvider.refreshGraphWindow()` re-reads the same page count; `RepositoryProvider.selection` stays keyed by OID |
| A detached HEAD commit is visible in the default graph | scope resolution adds `HEAD` to `all` and `local` |
| File counts and merge stats are real, including the root commit | versioned `git log` invocation with `--raw --numstat --diff-merges=first-parent --root`; `parse.log.ts` |
| `/` or `Ctrl/Cmd+F` opens the commit search input at the top of the Commit panel | `CommitSearchInput.tsx`; the `graph.search` handler in `useCommitGraph.ts` |
| Commit search matches subject and message body case-insensitively across the full graph scope | `graph.search.ts` request with `--all-match --fixed-strings -i --grep` over the resolved scope |
| Search results stream in bounded pages; stale queries are canceled | `useCommitSearch.ts` debounce plus `graph.search.ts` search cursor and generation token |
| Search results show a body snippet when the match is in the body | `graph.search.ts` `buildBodySnippet()`; `SearchResultRow.tsx` |
| Up and Down navigate results while typing remains possible in the input | `useCommitGraph.ts` search delegates; `CommitSearchInput.tsx` |
| Enter exits search and selects the result in the graph, loading the containing page if needed | `useCommitSearch.ts` confirm handler; bounded `graph.paginate.ts` `ensureLoaded` |
| Esc cancels search and restores the previous selection, scroll position, and Pending Changes or composer state | `useCommitSearch.ts` state snapshot and `overlay.close` handler |
| No-results and search-error states are clear and recoverable | `EmptyState` with "No commits match <query>"; inline `ErrorState` with Retry |
| A parent or search-result commit outside the loaded pages loads within a bounded number of pages | `graph.paginate.ts` `ensureLoaded` with `GRAPH_ENSURE_MAX_PAGES` and `GRAPH_ENSURE_TIMEOUT_MS` |

## 13. Tests to add

- `src/domain/graph/graph.lanes.test.ts`: linear history, a branch start, a merge, an octopus merge, and disconnected lanes; assert node columns, edge cells, and lane continuity across a page boundary.
- `src/domain/graph/graph.paginate.test.ts`: initial page bounded by `graph.initialPageSize`; range validation 100 to 2000; one in-flight older page; coalesced requests; oldest-OID cursor and frontier advance correctly; no `--skip` in any request; a repeated OID is rejected; trimming the oldest page does not change the next-page cursor; page append does not duplicate rows; stale generation discarded; end-of-history flag; `ensureLoaded` returns `loaded`, `notFound`, `exceeded`, and `cancelled` within the page and time bounds.
- `src/domain/graph/graph.search.test.ts`: AND semantics over whitespace-separated terms; case-insensitivity; subject and body matching; `--fixed-strings` keeps `[`, `*`, `\`, `.`, `+`, `?`, `(`, and `)` literal; bounded cursor pages with no `--skip`; stale query discarded; no-match result; empty query produces no results; `buildBodySnippet` marks leading and trailing ellipses and returns match ranges for the first literal body match and no snippet for a subject-only match.
- `src/domain/git/parsers/parse.log.test.ts` (shared with F-10): parse recorded version-1 output with the NUL field separator and `\x1e` record separator, including merges, octopus merges, no-parent root commits, decorated refs, multiline bodies, and the following `--raw --numstat` block; assert one file entry per raw path, additions and deletions joined by path, rename old and new paths, a binary file count, a first-parent merge stat, a root commit file list, and a typed error for a missing or unknown version and a wrong field count.
- `src/domain/git/git.log.test.ts`: argument construction includes `--raw`, `--numstat`, `-z`, `--diff-merges=first-parent`, `--root`, the versioned format, `--max-count`, and the resolved scope; `all` and `local` both include `HEAD`.
- `src/app/providers/RepositoryProvider.test.tsx` (shared with F-17): `refreshStatus()` changes counts and refs without re-reading history; `refreshGraphWindow()` re-reads the same page count, preserves the selected OID, and falls back to the nearest row only when the OID disappears; both cancel and discard in-flight pages.
- `src/features/graph/CommitRow.test.tsx`: rendered lane spans, selection marker, truncated subject, badge order tags then local then remote, `+N` overflow, right-aligned file count from the commit's raw block, author shortening at 12 characters and above, and date formats for today, the current year, and older.
- `src/features/graph/PendingChangesRow.test.tsx`: "Commit Changes" label, "N unstaged files" count, and the "Working tree clean" state; the row stays selectable.
- `src/features/graph/CommitGraph.test.tsx`: `viewportCulling` renders only visible rows; the loading row, the "Beginning of history" marker, the bounded-miss row, and the Retry row appear in the right states; a page error keeps loaded rows usable; `useFocusRegion` requests a refresh when the region gains focus; the graph registers exactly one handler per `(actionId, graph)` and does not register `app.refresh`, `commit.focus`, or `overlay.close`; `Enter` dispatches `graph.selectCommit` or `graph.selectPending` and updates `RepositoryProvider.selection`.
- `src/features/graph/useCommitSearch.test.tsx`: search open and focus; debounce; query change cancels the previous query; "Searching...", "N+ matches", and "N matches"; the flat list hides lanes and the pending row; a body snippet appears only for a body match; literal metacharacters do not error or over-match; Up/Down move the result selection while printable keys edit the query; Enter confirms and loads the containing page within the bound; Esc restores the previous selection, scroll, pages, and composer state in one press; search exits on scope change, refresh, reload, overlay, and focus change; "No commits to search" in an empty repository.

## 14. Open questions

- Ownership of `src/domain/graph/graph.paginate.ts` and `graph.search.ts` is claimed by both F-08 and F-17. Resolution here: F-08 defines the page-window, cursor, and search-matching behavior and owns `graph.types.ts` and `graph.lanes.ts`; F-17 owns the generation-token and refresh interaction and the global bounds table. Confirm this split, or move the two shared files wholly under one doc.
- Product spec F-08 requires Up and Down to move search results while the input keeps focus. Resolved: `commit-search` is a text-input mode that opts `nav.up`, `nav.down`, `nav.pageUp`, `nav.pageDown`, and `nav.activate` back into app dispatch while printable keys stay in the input. The mode is local to the search feature; `FocusProvider` only derives text focus from native focus. Confirm the mode name when keymap contexts are finalized in F-19.
- `graph.scope: all` shows commits reachable from local and remote branches plus `HEAD`, and `local` shows `--branches HEAD`. Confirm that tag-only commits outside those refs stay excluded, or whether `--tags` must be added.
- The frontier that continues a topo-order page is derived from unemitted parents rather than a single OID. Confirm that the parser keeps enough parent data across trimmed pages to reconstruct it, and add a large fixture that asserts no duplicates across a trim.
- The maximum retained window (how many pages stay loaded before the oldest is released) is not specified. Confirm a value after measuring memory with a 100,000-commit fixture.
- The `GRAPH_ENSURE_MAX_PAGES` (20) and `GRAPH_ENSURE_TIMEOUT_MS` (10 seconds) bounds are initial values. Confirm them against a 100,000-commit fixture and the worst-case search-result jump.
