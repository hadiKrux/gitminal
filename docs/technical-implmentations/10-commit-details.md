# 10 - Commit details

## 1. Header

- Status: Ready for dev.
- Spec reference: `docs/product-spec.md` F-10 (lines 805-837), F-11 (lines 838-953), F-16 (lines 1067-1095), decision D3 (section 9, refs on commits), the keyboard map (lines 1539-1704), action IDs (lines 1705-1742).
- Architecture contract: `docs/technical-implmentations/00-project-architecture.md`.
- Region id: `right-pane` (`src/features/shell/regions.ts`), owned by `MainArea.tsx`. Commit details is the right-pane mode when `RepositoryProvider.selection.kind === "commit"`. The full mode map is pending -> composer, commit -> commit details, stash -> stash details, worktree -> worktree details; there is no separate sub-mode flag.
- Dependencies: F-01 (shell, focus, region order), F-06 (a stash selection shows stash details in the same right-pane mode), F-07 (a worktree selection shows worktree details in the same right-pane mode), F-08 (graph selection and parent loading), F-09 (the composer replaces details when Pending Changes is selected), F-11 (the Diff panel shows the commit diff), F-15 (error overlay and Retry), F-16 (detached HEAD, empty repository), F-17 (debounced async reads, single in-flight request), F-18 (read-only, redaction), F-19 (keymap overrides).
- Owned paths:
  - `src/features/commit-details/CommitDetails.tsx`
  - `src/features/commit-details/CommitMetaRow.tsx`
  - `src/features/commit-details/ParentRef.tsx`
  - `src/features/commit-details/useCommitDetails.ts`
- Shared path owned by F-08 and F-17: the details read uses `src/domain/git/git.log.ts` `readCommitDetails()` (this feature defines the fields it returns) and `src/domain/git/parsers/parse.log.ts`.
- Read-only references: `src/domain/graph/graph.paginate.ts` (`ensureLoaded` for parent selection), `src/domain/git/git.diff.ts` and `src/features/diff/useFileDiff.ts` (the commit diff below the details, F-11), `src/domain/repository/repository.selectors.ts` (selected commit identity).

## 2. Scope and non-goals

Scope: the read-only commit details pane shown in the right pane when a commit row is selected; the fields (short and full hash, tree hash, author name, email and date with timezone, committer name and date when different, parent hashes, branches and tags pointing at the commit, and stats: files changed plus insertions and deletions); the commit message body; selecting a parent to move the graph selection and loading the parent when it is absent; returning to the composer on the Pending Changes row; and the error state that keeps the graph selection unchanged.

Non-goals: commit actions such as revert, reset, cherry-pick, or checkout (none exist in v1, F-10); editing any field; the commit diff content and grouping (F-11); the graph rows and paging (F-08); the composer (F-09); stash details (F-06) and worktree details (F-07), which occupy the same right-pane region for their own selections; creating branches or tags from a commit (F-03, F-05).

## 3. OpenTUI components used

| Component | Where used | Why it is the right component |
| --- | --- | --- |
| `<code>` | The full hash, tree hash, and the commit message body block in `CommitDetails.tsx`. | Syntax-highlighted read-only content; hashes and the message body are monospace highlighted blocks (architecture section 6). |
| `<box>` | The details panel frame, each metadata row, each parent row, the ref badge row, and the stats row. | The only layout, border, and hit-test primitive. |
| `<text>` | Field labels, the short hash, author and committer lines, dates, parent short hashes, ref badge text, stats text, and state text. | Every UI string is rendered through `<text>`. |
| `<span>` | Ref badges (tags, local branches, remote branches), the short-hash emphasis, and the committer-differs marker. | Inline styled runs inside a single `<text>`; badges are spans per architecture section 6. |
| `<scrollbox>` | The details body and the parent list container. | Scrollable bounded regions; handles wheel scroll and scrollbars, and parent rows need custom content. |
| `<select>` | Not used for parents. | Parent rows show a monospace short hash plus the parent subject, which `<select>` cannot render; architecture section 6 rule 3 requires a `<scrollbox>` of `<box>` rows for custom content. |
| `<diff>`, `<line-number>`, `<markdown>`, `<ascii-font>`, `<textarea>`, `<input>` | Not owned here. The commit diff uses `<diff>` in F-11. | N/A for this feature. |

Hooks used:

| Hook | Where used | Why |
| --- | --- | --- |
| `useKeyboard` | Only inside `src/app/hooks/useHotkeys.ts`. | Central dispatcher; this feature never calls it directly. |
| `useAction` | `useCommitDetails.ts` registers right-pane scoped `nav.up`, `nav.down`, and `nav.activate` for the parent list. | Features receive action IDs, never raw key strings. Global actions such as `app.refresh`, `commit.focus`, `focus.next`, `focus.previous`, and `overlay.close` are owned by the app, the shell, or `useRepository`, never by this feature. |
| `useListCursor` | `useCommitDetails.ts` for the parent list cursor and double click detection. | Shared cursor and double click logic for custom rows. |
| `useDebouncedValue` | `useCommitDetails.ts` debounces the details read as the graph selection moves. | Selection updates details promptly without a read per keypress (F-17). |
| `useTerminalDimensions` | `CommitDetails.tsx` and `CommitMetaRow.tsx` compute truncation budgets. | Budget-aware truncation via `@/lib/text.ts`. |
| `useTimeline` | The `Spinner` shown while details load. | Animation only. |

`<code>` versus `<text>`: the full hash, tree hash, and the message body are rendered with `<code>` because they are read-only monospace blocks where alignment and highlighting help. Short labels, dates, and stats use `<text>`; ref badges use `<span>` runs.

All icons and markers used by this feature come from `src/theme/icons.ts`; see architecture section 6.1. No glyph literal is written in feature code.

## 4. Component tree

```text
MainArea                            (src/features/shell/MainArea.tsx)
-> CommitDetails                    (src/features/commit-details/CommitDetails.tsx, rendered when `RepositoryProvider.selection.kind === "commit"`)
   Panel                            (ui/Panel.tsx, region frame for `right-pane`)
     PanelHeader                    (title "Commit", short hash)
     ScrollableList                 (scrollbox, viewportCulling)
       text (short hash, prominent)
       code (full hash)
       code (tree hash)
       CommitMetaRow                (author: name, email, date with timezone)
       CommitMetaRow                (committer: shown only when different from the author)
       text (refs label)
         span (tag badges, then local branch badges, then remote branch badges)
       ScrollableList               (scrollbox, parent list)
         ParentRef                  (one per parent: short hash, parent subject)
       text (stats: "N files changed +I -D")
       code (message body)
       LoadingRow                   (while details load)
       ErrorState                   (details load failed, with Retry)
   DiffPanel                        (F-11, the commit diff grouped by file, below the details)
```

`CommitDetails`, `CommitComposer`, stash details, and worktree details are mutually exclusive right-pane modes selected by `RepositoryProvider.selection.kind`. When `selection.kind` is `"pending"` `MainArea` renders `CommitComposer`; `"commit"` renders `CommitDetails`; `"stash"` renders stash details (F-06); `"worktree"` renders worktree details (F-07). No second sub-mode flag exists in a provider or a feature.

## 5. Enforced files and folders

- `src/features/commit-details/CommitDetails.tsx` - details panel composition, region registration, hashes, message body, refs, stats, loading and error states.
- `src/features/commit-details/CommitMetaRow.tsx` - one labeled metadata row (author or committer), with truncation and the committer-differs marker.
- `src/features/commit-details/ParentRef.tsx` - one parent row: short hash plus parent subject, selectable.
- `src/features/commit-details/useCommitDetails.ts` - owns the details view state, debounces the read, cancels stale reads, and dispatches parent selection.
- Tests colocated: `src/domain/git/git.log.test.ts` (shared with F-08), `src/features/commit-details/CommitDetails.test.tsx`, `src/features/commit-details/CommitMetaRow.test.tsx`, `src/features/commit-details/ParentRef.test.tsx`, `src/features/commit-details/useCommitDetails.test.tsx`.

## 6. State model

View state, owned by `useCommitDetails.ts`:

- The loaded details for the currently selected commit: `CommitDetails` value keyed by OID.
- The in-flight read flag, the read error, and the debounce token so a stale read is discarded when the selection changes.
- The parent list cursor, stored through `useListCursor` and persisted per region by `FocusProvider`.
- The expansion flag for the message body (collapsed to a bounded number of lines by default, expandable).

Provider state, read and never recomputed here:

- `RepositoryProvider`: the right-pane selection union and its `kind` (`pending`, `commit`, `stash`, `worktree`, or a diff file) and the repository refresh generation. The selected commit identity is read from `selection` when `kind === "commit"`; it is the single source of truth for the right-pane mode.
- `StatusProvider`: transient status and any running operation.
- `OverlayProvider`: the error overlay and whether an overlay is open.
- `FocusProvider`: derived active region and cursor map.
- `ConfigProvider`: the resolved keymap for hint text.

Rules: the selected commit identity is provider state in `RepositoryProvider`; this feature does not keep a second copy of the selection and does not store a right-pane mode flag. It reads `selection` and derives the details read from it. Details are a read-only projection of `git log` output; nothing here writes repository state.

## 7. Data flow

Generic path (architecture section 9):

```text
graph selection change -> useCommitDetails.ts -> @/domain/git/git.log.ts readCommitDetails(oid)
  -> git CLI -> parse.log.ts -> CommitDetails re-render
```

| Trigger | Domain module | Git subcommand |
| --- | --- | --- |
| selection moves to a commit | `git.log.ts` `readCommitDetails(oid)` | `git log -1 --format=<meta> <oid>` for hashes, tree, author, committer, parents, and `--decorate=full` refs |
| stats | `git.log.ts` `readCommitStats(oid)` | `git log -1 --numstat --format= --diff-merges=first-parent <oid>` (summed into files changed, insertions, deletions) |
| refs pointing at the commit | `parsers/parse.log.ts` from `--decorate=full`, plus `parsers/parse.refs.ts` | `git for-each-ref` mapped to the commit OID by `repository.selectors.ts` |
| parent selection (`nav.activate` on a `ParentRef`) | `graph.paginate.ts` `ensureLoaded(parentOid)` then `git.log.ts` | bounded older-page loads until the parent OID is loaded (F-08) |
| commit diff (below the details) | F-11 `useFileDiff.ts` and `git.diff.ts` | `git show --no-color -U<diff.contextLines> --format= --diff-merges=first-parent <oid>` |
| retry after an error | `git.log.ts` `readCommitDetails(oid)` | the details subcommand above |

Field mapping from the parsed output:

- Short hash: `%h`, shown prominently; full hash: `%H`, shown in a `<code>` block.
- Tree hash: `%T`.
- Author: `%an` and `%ae`, with `%aI` rendered as a full date and time with timezone.
- Committer: `%cn` and `%cI`, shown in a second `CommitMetaRow` only when the committer name or date differs from the author.
- Parents: `%P`, split into OIDs; each parent becomes a `ParentRef` with its short hash (`%h` of the parent) and, when available from the loaded window, its subject.
- Refs: from `--decorate=full` and `for-each-ref`, split into tags, local branches, and remote branches, rendered in that badge order.
- Stats: files changed is the count of `--numstat` lines, insertions is the sum of the added column, deletions is the sum of the removed column, rendered as for example "8 files changed +120 -34".
- Message body: `%B`, rendered in a `<code>` block; the subject line is the first line.

The details read is debounced as the graph selection moves, and only one read is in flight at a time. A read whose OID no longer matches the current selection is discarded (F-17).

For merge commits, both the stats read and the commit diff pass `--diff-merges=first-parent`, so the commit is compared with its first parent. Without it git prints no file stats and an empty diff for a merge, which would show "0 files changed" and a blank panel. The details pane still lists every parent from `%P`, and selecting a non-first parent changes only the graph selection.

Parent selection: `nav.activate` on a `ParentRef` moves the graph selection to that parent OID through the graph's selection command with an explicit `{ kind: "commit", oid }` target. When the parent is already loaded, the selection moves immediately and the details pane updates. When it is not loaded, `graph.paginate.ts` `ensureLoaded(parentOid)` runs a bounded load capped by a fixed page count and a fixed time budget, with the visible loading state described in F-08, and the graph selection moves only once the parent is loaded. If the cap is reached first, the pane shows the bounded-load reason and keeps the graph selection unchanged rather than loading unbounded history.

Returning to the composer: selecting the Pending Changes row sets `RepositoryProvider.selection.kind` to `"pending"`, which switches the right pane back to `CommitComposer` and the working tree diffs; the draft itself lives in `DraftProvider` (F-08, F-09).

Error state: when the details read fails, `CommitDetails` shows a persistent `ErrorState` with the git message and a Retry action, and the graph selection is left unchanged. The error is also recorded in the console (F-13).

### Command registration and targets

`useCommitDetails.ts` registers handlers with `useAction(actionId, { scope: "right-pane", targetKind: "none" }, handler)` for parent navigation. Exactly one handler may exist per `(actionId, scope)`; a duplicate registration is a development error and the later one is rejected. The feature registers no global handler: `app.refresh` is owned by the app and `useRepository`, `focus.*` and `overlay.close` are owned by the shell or overlay, and the pane never mutates selection directly. A parent row dispatches the graph selection command with an explicit commit target, and availability is computed from the same `getAvailability(commandId, context)` result that the footer, palette, and help read.

## 8. Keyboard and focus

Action IDs only (product spec section 6.1). Raw key strings never appear outside `@/domain/keymap/**` and `src/app/hooks/useHotkeys.ts`.

| Action ID | Behavior in the Commit details pane |
| --- | --- |
| `nav.up`, `nav.down` | Move the parent cursor when the parent list has more than one entry. With zero or one parent the pane has nothing to navigate, and the keys are unhandled here. |
| `nav.activate` (`Enter`) | Select the highlighted parent, moving the graph selection to that parent commit and loading it first when absent. Mouse double click on a `ParentRef` dispatches the same ID. |
| `overlay.close` (`Esc`) | Return focus to `previousRegion`; it never changes the graph selection. |
| `focus.next`, `focus.previous` (`Tab` / `Shift+Tab`) | Tab traversal (owned by `useFocusModel`). |
| `focus.region.rightPane` (`7`) | Direct jump to the `right-pane` region and into the active mode; shell-owned. |
| `app.refresh` (`r`) | Manual refresh, owned globally by the app and `useRepository`; this feature does not register it. The details re-read when the selected commit still exists, and if it no longer exists the graph selects the nearest row (F-08) and the details follow. |

Moving the graph selection is the only way to change which commit is detailed, so the details pane itself registers only right-pane scoped parent navigation. The footer shows the parent-selection hint only when the selected commit has at least one parent. The details pane is read-only and exposes no commit actions.

## 9. Loading, empty, error, and disabled states

- Loading: a `LoadingRow` with the marker `[..]` and "Loading commit details..." while the debounced read is in flight. The previous details stay visible until the new read resolves, so the pane does not flash empty during fast navigation.
- Empty, root commit: the parent section shows the text "No parents" instead of a `ParentRef` list. The rest of the details render normally.
- Empty, no refs: the refs row shows the text "No refs" so the row is never blank.
- Error: a persistent `ErrorState` with "Could not load commit details", the git message, and a Retry button. The graph selection is unchanged.
- Detached HEAD: the details render normally; the current position is shown in the top bar (F-02).
- Disabled: the pane is entirely read-only. While a repository write is in flight the details remain readable; the pane never stages, commits, resets, or checks out.
- Message body long: the body block is collapsed to a bounded number of lines with an expand toggle; expanding scrolls inside the `<scrollbox>`.

Every state carries a text marker; color is never the only signal.

## 10. Performance and bounds

- The details read is debounced and single-flight; moving quickly through the graph cancels the previous read and discards its result when it resolves (F-17).
- The stats read sums `--numstat` output in `git.log.ts` with `--diff-merges=first-parent`; for commits with very many files the row is bounded to a line count and shows a "stats truncated" note when the cap is hit.
- The message body is collapsed to a bounded number of lines by default and rendered in a `<code>` block inside a `<scrollbox>`; the full body is available on expand.
- The parent list is bounded by the number of parents (normally one or two, up to the octopus case) and is rendered in a `<scrollbox>` with `viewportCulling`.
- Truncation of hashes, dates, and metadata uses `@/lib/text.ts` with a budget from `useTerminalDimensions`. Truncation never hides the short hash or the parent hashes.
- The pane adds no unbounded list: the commit diff below it is bounded by F-11.

## 11. Safety and confirmations

- The details pane is read-only. There are no commit actions such as revert, reset, cherry-pick, or checkout in v1 (F-10).
- Selecting a parent changes only the graph selection and the right pane; it requires no confirmation and mutates nothing.
- The details read never touches the index and never runs a mutation.
- On a read failure the graph selection is kept unchanged, so a transient failure cannot move the user elsewhere.
- Every git invocation runs through `git.client.ts` with an argument array and no shell; credentials are redacted before any console or error rendering (F-18).

## 12. Acceptance mapping

| F-10 acceptance bullet | Implementing module or component |
| --- | --- |
| All requested fields are present and accurate | `CommitDetails.tsx` and `CommitMetaRow.tsx` from `git.log.ts` `readCommitDetails()` and `readCommitStats()` |
| The diff matches the selected commit | F-11 `DiffPanel` and `useFileDiff.ts` keyed by the selected OID, with `--diff-merges=first-parent` |
| Merge commits show real file stats and a non-empty diff | `readCommitStats()` and the commit diff both pass `--diff-merges=first-parent` |
| The composer is not visible while a commit is selected | `MainArea.tsx` renders `CommitDetails` when `RepositoryProvider.selection.kind === "commit"` |
| Returning to Pending Changes restores the composer state | `DraftProvider` holds the draft; `MainArea.tsx` switches mode from `selection.kind` (F-08, F-09) |
| Short and full hash with the short hash prominent | `CommitDetails.tsx` `<text>` short hash and `<code>` full hash |
| Tree hash | `CommitDetails.tsx` `<code>` tree hash from `%T` |
| Author name, email, and date with timezone | `CommitMetaRow.tsx` from `%an`, `%ae`, `%aI` |
| Committer shown when different | `CommitMetaRow.tsx` committer row rendered only when it differs |
| Parent hashes selectable, loading the parent when absent | `ParentRef.tsx` and `useCommitDetails.ts` `nav.activate`; `graph.paginate.ts` `ensureLoaded` |
| Branches and tags that point at the commit | ref badge spans from `parsers/parse.refs.ts` and `--decorate=full` |
| Stats "N files changed +I -D" | `CommitDetails.tsx` stats row from `--numstat --diff-merges=first-parent` summation |
| Read-only, no commit actions in v1 | no mutation handlers registered; only parent navigation and Esc |
| Details load error keeps the graph selection unchanged | `useCommitDetails.ts` error handling; `ErrorState` with Retry |

## 13. Tests to add

- `src/domain/git/git.log.test.ts` (shared with F-08): `readCommitDetails()` and `readCommitStats()` argument construction and field mapping for a normal commit, a root commit with no parents, a merge with two parents, an octopus merge, and a commit with a committer that differs from the author; assert the `--diff-merges=first-parent` flag on both the stats and commit-diff invocations and that a merge fixture produces real file stats and a non-empty diff; parse recorded `git log` fixtures.
- `src/features/commit-details/CommitDetails.test.tsx`: all fields rendered; short hash prominent; full and tree hashes in `<code>` blocks; stats text "N files changed +I -D"; "No parents" and "No refs" empty states; loading row; error state with Retry; the pane renders only when `selection.kind === "commit"`.
- `src/features/commit-details/CommitMetaRow.test.tsx`: author row always rendered; committer row rendered only when it differs; date with timezone; truncation budget.
- `src/features/commit-details/ParentRef.test.tsx`: one row per parent with short hash and subject; double click dispatches `nav.activate`; disabled reason while the parent load is in flight.
- `src/features/commit-details/useCommitDetails.test.tsx`: debounce; single in-flight read; stale read discarded when the selection changes; parent selection dispatches an explicit commit target; `ensureLoaded` stops at the page cap and time budget and leaves the selection unchanged when the parent is not reached; failure keeps the graph selection unchanged; duplicate `(actionId, scope)` registration is rejected; the feature registers no `app.refresh` or other global handler.

## 14. Open questions

- The committer row is shown "when different from the author". Confirm whether "different" means a different name, a different date, or either, since a rebase changes the committer date but may keep the name.
- Parent rows show the parent subject when it is available from the loaded window. Confirm whether to always read the parent subject on demand, which adds a read per parent, or to show only the short hash until the parent is loaded.
- The default collapsed line count for the message body and the stats truncation cap are not specified. Confirm values after measuring with a large commit fixture.
- The pane currently keeps the previous details visible while a new read is in flight. Confirm this is preferred over clearing to a loading row, which is simpler but flashes during fast navigation.
- Should `app.refresh` be the only way to re-read details, or should the pane also re-read on terminal focus like the graph (D10)? `app.refresh` is global and owned by the app and `useRepository`; this doc also re-reads when the selection or refresh generation changes.
