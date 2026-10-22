# 08 - Commit graph

## 1. Header

- Status: Draft for review.
- Spec reference: `docs/product-spec.md` F-08 (lines 576-701), D3 (line 1737), D16 (line 1750), D17 (line 1751), graph config keys `graph.scope` and `graph.initialPageSize` (lines 1153-1154), action IDs (lines 1583-1611).
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

Scope: the Commit panel; the always-first Pending Changes row and its unstaged count; commit rows with graph lanes, nodes, merge distinctness, selection marker, truncated subject, ref badges in tag/local/remote order with `+N` overflow, right-aligned file count, author shortening, and compact dates; selection and navigation including PageUp/PageDown and `g`/`G`; lazy bounded paging with a loading row, a "Beginning of history" marker, a Retry row, cancellation on scope change, and parent-selection loading; and the full commit search surface including the flat result list, live debounced AND matching, bounded lazy result pages, highlighting, and one-press Esc restore.

Non-goals: commit details content (F-10); the composer and commit variants (F-09); working tree, staged, and untracked diff content (F-11); graph mutation such as reset, revert, or checkout (not in v1); regex, author, hash, path, and date search filters (deferred, product spec line 43); fetch and push (F-02); persisting the graph window or selection across restarts (F-17).

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
| `useAction` | `useCommitGraph.ts` and `useCommitSearch.ts` register `nav.up`, `nav.down`, `nav.pageUp`, `nav.pageDown`, `nav.first`, `nav.last`, `nav.activate`, `graph.search`, `app.refresh`, `commit.focus`, `overlay.close`. | Features receive action IDs, never raw key strings. |
| `useListCursor` | `useCommitGraph.ts` for cursor movement, `g`/`G`, PageUp/PageDown windows, and double click detection. | Shared cursor, page-step, and double click logic for custom rows. |
| `useTerminalDimensions` | `CommitGraph.tsx` computes the visible-row window and truncation budgets; `CommitRow.tsx` and `SearchResultRow.tsx` truncate subject and metadata. | Budget-aware truncation and culling from `@/lib/text.ts`. |
| `useOnResize` | `CommitGraph.tsx` recomputes the culled window and truncation budgets after a resize. | Keeps culling and budgets correct when the terminal changes size. |
| `useDebouncedValue` | `useCommitSearch.ts` debounces the raw query before dispatch. | Live search after a short debounce, not on every keystroke. |
| `useFocus` | `CommitGraph.tsx` requests a refresh when the terminal regains focus (D10). | Keeps external changes visible. |

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

## 5. Enforced files and folders

- `src/features/graph/CommitGraph.tsx` - panel composition, region registration, the scrollbox with `viewportCulling`, visible-window computation, and loading and end markers.
- `src/features/graph/CommitRow.tsx` - one commit row: lanes, selection marker, truncated subject, ref badges, right-aligned file count, author and date.
- `src/features/graph/PendingChangesRow.tsx` - the always-first Pending Changes row and its unstaged count.
- `src/features/graph/GraphLanes.tsx` - renders the lane prefix for one row as `<span>` runs from `graph.lanes.ts` output.
- `src/features/graph/CommitSearchInput.tsx` - the single-line search field, its placeholder, and its focus handling.
- `src/features/graph/SearchResultRow.tsx` - one flat search result row with matched-term highlighting.
- `src/features/graph/useCommitGraph.ts` - derives rows from selectors, owns the page-window view state, dispatches selection and page loads.
- `src/features/graph/useCommitSearch.ts` - owns search view state, debounces the query, cancels stale queries, and dispatches result pages.
- `src/domain/graph/graph.types.ts` - `GraphScope`, `GraphRow`, `GraphPage`, `GraphPageRequest`, `GraphSearchQuery`, `GraphSearchPage`, `GraphGeneration`.
- `src/domain/graph/graph.lanes.ts` - pure lane assignment: given ordered commits with parents, returns per-row lane cells and the node column.
- `src/domain/graph/graph.paginate.ts` - co-owned with F-17: builds page requests, tracks the loaded window, enforces the single in-flight request, and discards stale results.
- `src/domain/graph/graph.search.ts` - co-owned with F-17: builds the bounded search page request and the AND-term match predicate.
- Tests colocated: `src/domain/graph/graph.lanes.test.ts`, `src/domain/graph/graph.paginate.test.ts`, `src/domain/graph/graph.search.test.ts`, `src/features/graph/CommitRow.test.tsx`, `src/features/graph/PendingChangesRow.test.tsx`, `src/features/graph/CommitGraph.test.tsx`, `src/features/graph/useCommitSearch.test.tsx`.

## 6. State model

View state, owned by `useCommitGraph.ts` and `useCommitSearch.ts`:

- Cursor index for the `graph` region, stored through `useListCursor` and persisted per region by `FocusProvider`, keyed by the stable row key (commit OID, or the literal `pending`).
- The loaded page window: the scope key, the ordered list of loaded commit OIDs, whether an older page is in flight, whether the end of history is reached, and the last page error. This is view state fed by `graph.paginate.ts` (architecture section 9 and `17-freshness-and-performance.md` section 6).
- Search view state: `searchOpen`, the raw query, the debounced query, the flat result list, whether a result page is in flight, the end-of-results flag, the search error, and a snapshot of the previous graph state (selection, scroll offset, loaded pages, composer visibility) captured when search opened.

Provider state, read and never recomputed here:

- `RepositoryProvider`: the repository snapshot, the selected commit identity, the current refresh generation, and the resolved `graph.scope` and `graph.initialPageSize`.
- `ConfigProvider`: `graph.scope`, `graph.initialPageSize`, and the resolved keymap used for hint text.
- `StatusProvider`: transient status and any running operation.
- `FocusProvider`: active region, `previousRegion`, cursor map, and the commit-search text-input flag.
- `OverlayProvider`: whether an overlay is open, which exits search (F-15).

Rules: this feature never recomputes pending counts, refs, ahead/behind, or upstream state. It reads them from `@/domain/repository/repository.selectors.ts`. It never writes repository state; paging and search are reads only.

## 7. Data flow

Generic path (architecture section 9):

```text
key or click -> action ID -> useAction handler -> command from @/domain/commands/commands.registry
  -> command runner (availability + serialization) -> @/domain/git/git.log.ts -> git CLI
  -> parse -> RepositoryProvider refresh -> CommitGraph re-render -> console entry + status
```

| Action ID or trigger | Domain module | Git subcommand |
| --- | --- | --- |
| repository refresh (first page) | `git.log.ts` `readLogPage()` through `graph.paginate.ts` | `git log --topo-order --parents --decorate=full --max-count=<graph.initialPageSize> --format=... <scope>` |
| older page (`nav.last`, PageDown near bottom, scroll near bottom) | `graph.paginate.ts` `nextPageRequest()` then `git.log.ts` | `git log --topo-order --parents --decorate=full --skip=<loadedCount> --max-count=<pageSize> --format=... <scope>` |
| parent selection loading (F-10) | `graph.paginate.ts` `ensureLoaded(oid)` then `git.log.ts` | the older-page subcommand repeated, bounded, until the parent OID is present |
| ref badges | `parsers/parse.log.ts` from `--decorate=full`, plus `parsers/parse.refs.ts` | `git for-each-ref` (branches, tags, remotes) mapped to commit OIDs by `repository.selectors.ts` |
| pending count | `parsers/parse.status.ts` via `git.status.ts` | `git status --porcelain=v2 --branch --untracked-files=all` |
| `graph.search` query | `graph.search.ts` `buildSearchRequest()` then `git.log.ts` | `git log --topo-order --all-match -i --grep=<term1> --grep=<term2> --max-count=<pageSize> --skip=<n> --format=... <scope>` |
| search result page (scroll near bottom) | `graph.search.ts` `nextSearchPage()` then `git.log.ts` | the search subcommand above with the next `--skip` |
| `app.refresh` | `RepositoryProvider.refresh()` | re-reads status and the first page |

Scope resolution for `graph.scope`: `all` -> `--branches --remotes`; `local` -> `--branches`; `current` -> `HEAD`. The graph shows all commits reachable from local and remote branches (D3, product spec line 671); orphan and unreachable commits are not shown.

`graph.lanes.ts` runs after each page parse. It takes the ordered commits with their parent OIDs, carries lane columns across page boundaries, and returns for each row a lane string (cells of `*` for the node, `|` for a continuing lane, `/` and `\` for branch and merge edges, and spaces) plus the node column. `GraphLanes.tsx` turns each lane string into one `<span>` per cell colored with a lane token. A merge commit is drawn with a node cell plus one edge cell per displayed parent, so merges are visually distinct and connected to all parents; octopus merges, branch starts, and disconnected lanes are handled by the same column assignment without corruption.

Author shortening and dates are pure helpers applied in `CommitRow.tsx`:

- Author: names up to 12 characters are shown as written; longer names are shortened to the first letters of the first two words, uppercased; a single long word shows its first two characters, uppercased. Example: "John Doe" becomes "JD". The full name and email are always available in commit details (F-10).
- Date: compact local time for commits from today; day and month for commits from the current year; day, month, and year for older commits. The full timestamp with timezone is shown in commit details.

Pending Changes row: label "Commit Changes" and secondary text with the unstaged file count. The count includes working tree modifications, deletions, renames, and untracked files (for example 7 modified plus 3 untracked shows "10 unstaged files"). When the working tree is clean the row shows "Working tree clean" and remains selectable. Staged-only changes still allow a commit even when the count is zero; the composer shows the staged count (F-09).

Ref badges: tags first, then local branches, then remote branches. When space is insufficient, show the first badges plus a `+N` count span. For tagged commits the badges get visual priority: the metadata line places badges before the date, and the date may be omitted when space is tight. The affected file count is right aligned at the row edge.

## 8. Keyboard and focus

Action IDs only (product spec section 6.1). Raw key strings never appear outside `@/domain/keymap/**` and `src/app/hooks/useHotkeys.ts`.

| Action ID | Behavior in the Commit graph |
| --- | --- |
| `nav.up`, `nav.down` | Move the selection one row. The selection follows the cursor and immediately updates the right pane (F-10) or the composer (F-09) when the Pending Changes row is selected. |
| `nav.pageUp`, `nav.pageDown` | Move by one screen of visible rows; PageDown near the bottom triggers an older-page load through `graph.paginate.ts`. |
| `nav.first` (`g`) | Jump to the newest loaded commit. |
| `nav.last` (`G`) | Jump to the oldest loaded commit and start loading the next older page when more history exists. |
| `nav.activate` (`Enter`) | Select the current row. On a commit row this replaces the composer with commit details and shows the commit diff; on the Pending Changes row it restores the composer and working tree diffs. Mouse double click dispatches the same ID. |
| `graph.search` (`/` or `Ctrl/Cmd+F`) | Open the commit search input at the top of the Commit panel and focus it. The palette entry "Search commits" dispatches the same ID from any region, focusing the graph first. |
| `app.refresh` (`r`) | Manual refresh; keeps the selected commit selected when it still exists, otherwise selects the nearest row. |
| `commit.focus` (`c`) | Focus the composer when it is visible. |
| `overlay.close` (`Esc`) | In search mode: clear the query, cancel any in-flight search, and restore the previous graph state in one press. Otherwise: return focus to `previousRegion`. |
| `focus.next`, `focus.previous` | Tab traversal (owned by `useFocusModel`). |

Selection is stored by stable identity (commit OID, or `pending`), so a refresh that preserves the commit preserves the cursor (architecture section 8).

Search keys: while the search input is focused, `nav.up` and `nav.down` move the result selection while printable keys, including `j` and `k`, continue to edit the query; `nav.pageUp` and `nav.pageDown` scroll the result list; `nav.activate` (`Enter`) confirms the highlighted commit, exits search, and selects that commit in the normal graph, loading the containing page first when the commit is not on a loaded page. This is the one deliberate exception to the architecture section 8 rule that arrow keys pass to a focused text input; see Open questions.

## 9. Loading, empty, error, and disabled states

- Loading, first page: a `LoadingRow` at the top with the marker `[..]` and "Loading history...". The panel frame renders immediately.
- Loading, older page: a bottom `LoadingRow` with "Loading older commits...". The user keeps navigating already loaded commits.
- Loading, parent selection: a visible `LoadingRow` with "Loading parent commit..." while `graph.paginate.ts` ensures the parent OID is loaded.
- Empty repository: `EmptyState` with "No commits yet"; the Pending Changes row stays selectable so the user can stage and make the first commit (F-16).
- End of history: a persistent `text` row with "Beginning of history".
- Page error: a persistent inline `ErrorState` row with the git message and a Retry button. Already loaded rows remain usable.
- Search, empty query: the normal graph and Pending Changes row remain visible, and `CommitSearchInput` shows the placeholder "Search commit messages...".
- Search in flight: the header shows "Searching..." plus a count.
- Search partial: the header shows "N+ matches" while more results may exist.
- Search complete: the header shows "N matches".
- Search no matches: `EmptyState` with "No commits match <query>".
- Search error: an inline `ErrorState` row with Retry while the previous graph state remains intact underneath.
- Search unavailable in an empty repository: the input is disabled with the text "No commits to search".
- Detached HEAD: the graph still shows history; the current position is shown in the top bar and commit details (F-02, F-10).
- Disabled: selection is a read and stays available while a repository write is in flight; the graph never stages, commits, or changes refs.

Every state carries a text marker; color is never the only signal.

## 10. Performance and bounds

- The initial page is bounded by `graph.initialPageSize` (default 500, allowed range 100 to 2000, product spec line 1154). The graph never loads full history up front (D16).
- Older pages use the same page size and load automatically when the selection or scroll reaches near the bottom of the loaded rows.
- Exactly one older-page load runs at a time. Repeated scrolling or key presses coalesce into the single in-flight request; they do not queue duplicate requests.
- Appending a page does not move the current selection, viewport, or focus.
- After a page loads, `nav.last` (`G`) again moves to the newly loaded oldest commit and can trigger the next page.
- Changing graph scope, reloading configuration, or refreshing repository state cancels an in-flight older-page load and discards stale results. `graph.paginate.ts` compares the generation token on resolve and drops mismatched results (`17-freshness-and-performance.md` section 10).
- Virtualization: `CommitGraph.tsx` renders the list inside a `<scrollbox>` with `viewportCulling` enabled, so only rows intersecting the viewport are drawn. `useTerminalDimensions` supplies the visible-row window, and the component mounts only that window plus a small overscan, which keeps rendering cost proportional to terminal height, not to the loaded window. Wheel scroll and `nav.pageUp`/`nav.pageDown` move the window without remounting the panel.
- The loaded window is retained for the session and trimmed to a maximum retained window, releasing the oldest pages when they are far outside the viewport (`17-freshness-and-performance.md` line 151).
- Search pages are bounded by the same `graph.initialPageSize`; the flat result list is virtualized the same way and loads more results when scrolling near the bottom. Search never loads full history into the graph.
- Row truncation uses `@/lib/text.ts` with a budget from `useTerminalDimensions`. Truncation never hides the selection marker, the ref badge priority, or the file count.
- Graph lanes are computed once per loaded page in `graph.lanes.ts`, not per render.

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
| Pending count equals the working tree plus untracked files | `PendingChangesRow.tsx` reading the count selector from `repository.selectors.ts`; `parsers/parse.status.ts` |
| Merge commits show a distinct node and connections to all displayed parents | `graph.lanes.ts` node and edge cells; `GraphLanes.tsx` |
| Tags and branches appear as badges on the correct commits | `parsers/parse.log.ts` and `parsers/parse.refs.ts` mapped by OID; `CommitRow.tsx` badge spans |
| Selecting a commit changes the right pane from composer to commit details | `useCommitGraph.ts` selection dispatch; `CommitGraph.tsx`; F-10 |
| Selecting Pending Changes restores the composer | `PendingChangesRow.tsx` and `useCommitGraph.ts`; F-09 |
| Very long histories remain navigable with keyboard and mouse | `CommitGraph.tsx` scrollbox with `viewportCulling`; `useListCursor` |
| A 100,000-commit branch opens with the initial page and never loads full history up front | `graph.paginate.ts` initial request with `graph.initialPageSize` |
| Scrolling near the bottom loads the next page, keeps the viewport and selection stable, and never starts duplicate page loads | `graph.paginate.ts` single in-flight request and append-without-move |
| `G` moves to the oldest loaded commit and triggers the next page | `useCommitGraph.ts` `nav.last` handler |
| End of loaded history shows "Beginning of history", and a failed page load shows a Retry row without breaking loaded rows | `CommitGraph.tsx` end marker and `ErrorState` row |
| Changing graph scope or refreshing discards stale older-page results | `graph.paginate.ts` generation token |
| `/` or `Ctrl/Cmd+F` opens the commit search input at the top of the Commit panel | `CommitSearchInput.tsx`; the `graph.search` handler in `useCommitSearch.ts` |
| Commit search matches subject and message body case-insensitively across the full graph scope | `graph.search.ts` request with `--all-match -i --grep` over the resolved scope |
| Search results stream in bounded pages; stale queries are canceled | `useCommitSearch.ts` debounce plus `graph.search.ts` bounded pages and generation token |
| Up and Down navigate results while typing remains possible in the input | `useCommitSearch.ts` search-context handlers; `CommitSearchInput.tsx` |
| Enter exits search and selects the result in the graph, loading the containing page if needed | `useCommitSearch.ts` `nav.activate` handler; `graph.paginate.ts` `ensureLoaded` |
| Esc cancels search and restores the previous selection, scroll position, and Pending Changes or composer state | `useCommitSearch.ts` state snapshot and `overlay.close` handler |
| No-results and search-error states are clear and recoverable | `EmptyState` with "No commits match <query>"; inline `ErrorState` with Retry |

## 13. Tests to add

- `src/domain/graph/graph.lanes.test.ts`: linear history, a branch start, a merge, an octopus merge, and disconnected lanes; assert node columns, edge cells, and lane continuity across a page boundary.
- `src/domain/graph/graph.paginate.test.ts`: initial page bounded by `graph.initialPageSize`; range validation 100 to 2000; one in-flight older page; coalesced requests; stale generation discarded; append does not change the window start; end-of-history flag.
- `src/domain/graph/graph.search.test.ts`: AND semantics over whitespace-separated terms; case-insensitivity; subject and body matching; bounded pages with `--skip`; stale query discarded; no-match result; empty query produces no results. Fixtures are recorded `git log --grep` output.
- `src/domain/git/parsers/parse.log.test.ts` (shared with F-10): parse recorded `--topo-order --parents --decorate=full` output including merges, octopus merges, no-parent root commits, and decorated refs.
- `src/features/graph/CommitRow.test.tsx`: rendered lane spans, selection marker, truncated subject, badge order tags then local then remote, `+N` overflow, right-aligned file count, author shortening at 12 characters and above, and date formats for today, the current year, and older.
- `src/features/graph/PendingChangesRow.test.tsx`: "Commit Changes" label, "N unstaged files" count, and the "Working tree clean" state; the row stays selectable.
- `src/features/graph/CommitGraph.test.tsx`: `viewportCulling` renders only visible rows; the loading row, the "Beginning of history" marker, and the Retry row appear in the right states; a page error keeps loaded rows usable.
- `src/features/graph/useCommitSearch.test.tsx`: search open and focus; debounce; query change cancels the previous query; "Searching...", "N+ matches", and "N matches"; the flat list hides lanes and the pending row; Up/Down move the result selection while printable keys edit the query; Enter confirms and loads the containing page; Esc restores the previous selection, scroll, pages, and composer state in one press; search exits on scope change, refresh, reload, overlay, and focus change; "No commits to search" in an empty repository.

## 14. Open questions

- Ownership of `src/domain/graph/graph.paginate.ts` and `graph.search.ts` is claimed by both F-08 and F-17. Resolution here: F-08 defines the page-window and search-matching behavior and owns `graph.types.ts` and `graph.lanes.ts`; F-17 owns the generation-token and refresh interaction and the global bounds table. Confirm this split, or move the two shared files wholly under one doc.
- Product spec line 657 requires Up and Down to move search results while the input keeps focus, which conflicts with architecture section 8 ("arrow keys pass to the input"). Resolution here: `CommitSearchInput` marks a `commit-search` text-input flag, and `useHotkeys` resolves `nav.up`, `nav.down`, `nav.pageUp`, `nav.pageDown`, and `nav.activate` to the search context before the input default while printable keys still reach the input. Confirm this exception, or add dedicated search-navigation action IDs.
- `graph.scope: all` shows commits reachable from local and remote branches, but product spec line 672 also excludes unreachable commits. Confirm that `--branches --remotes` (without `--tags`) is the exact scope, or whether tag-only commits must be included.
- Paging uses `--skip`, which re-walks history on each page. For very large histories, confirm whether to switch to a cursor based on the oldest loaded OID plus `--max-count`, and measure the tradeoff.
- The maximum retained window (how many pages stay loaded before the oldest is released) is not specified. Confirm a value after measuring memory with a 100,000-commit fixture.
