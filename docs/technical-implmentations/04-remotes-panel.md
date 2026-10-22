# 04 Remotes Panel

## 1. Header

- Status: Draft for review
- Spec reference: `docs/product-spec.md` F-04 (lines 377-419), fetch scope rules (lines 245-260), decision D15 (line 1749), action IDs (lines 1583-1611)
- Architecture contract: `docs/technical-implmentations/00-project-architecture.md`
- Region id: `remotes` (`src/features/shell/regions.ts`)
- Dependencies: F-01 (shell and focus), F-02 (Fetch and Fetch --prune, `remote.fetchScope`), F-03 (the created branch appears in the Branches panel), F-15 (modal structure), F-16 (repository states), F-17 (freshness and performance), F-18 (safety), F-19 (`remote.fetchScope`).
- Owned paths:
  - `src/features/remotes/RemotesPanel.tsx`
  - `src/features/remotes/RemoteRow.tsx`
  - `src/features/remotes/RemoteFilter.tsx`
  - `src/features/remotes/CreateLocalBranchModal.tsx`
  - `src/features/remotes/useRemotes.ts`
  - `src/domain/git/git.remotes.ts`
- Co-owned path: `src/domain/repository/repository.selectors.ts` owns the stale classification and the grouping inputs consumed by this panel.

## 2. Scope and non-goals

Scope: list remote-tracking branches grouped and sorted by remote name and then branch name; a filter field at the top; a stale indicator for refs not updated recently; Space and double click open the Create Local Branch modal; Enter does nothing in v1; the fetch-scope interaction where only fetched upstream refs change and unrelated refs keep their last known state.

Non-goals: checking out a remote branch directly; adding, removing, or renaming a remote; initiating Fetch or Fetch --prune from this panel (F-02 owns those actions); pushing; deleting a remote branch from this panel (F-03 owns remote deletion as a delete scope); any Enter behavior.

## 3. OpenTUI components used

| Component | Where used | Why it is right |
| --- | --- | --- |
| `<box>` | Panel frame, group header rows, every remote-branch row, modal layout | The only layout primitive; rows need custom columns and a grouping header |
| `<text>` | Remote branch name, group header label, last known commit summary and date, stale text, empty and error text | Every UI string must be rendered through `<text>` |
| `<span>` | Inline stale indicator and the remote-name versus branch-name split inside one `<text>` | Inline styled runs inside a single `<text>` |
| `<scrollbox>` | The remote-branch list container, with `viewportCulling` and a scrollbar when the filtered list overflows | Scrollable region; required by F-04 for overflowing filtered lists |
| `<input>` | The filter field, composed through the `SearchField` primitive in `RemoteFilter.tsx` | Single-line field; the filter is a single-line, case-insensitive text match |
| `<select>` | Not used | Rows need grouping and multi-column content, so the list uses a scrollbox of box rows |

Hooks used:

| Hook | Where used | Why |
| --- | --- | --- |
| `useKeyboard` | Only inside `src/app/hooks/useHotkeys.ts` | Central dispatcher; this feature never calls it directly |
| `useAction` | `useRemotes.ts` registers `remote.createLocal`, `nav.activate`, `list.filter`, `app.refresh` | Features receive action IDs, never raw key strings |
| `useListCursor` | `useRemotes.ts` navigation, `g`/`G`, and double click detection | Shared cursor and double click logic for custom rows |
| `useFocus` | `RemotesPanel.tsx` refreshes the remote refs when the region gains focus (D10) | Refresh on focus keeps external changes visible |
| `useTerminalDimensions` | `RemoteRow.tsx` computes the truncation budget for the commit summary and date | Budget-aware truncation via `@/lib/text.ts` |

`<scrollbox>` versus `<select>` decision: the remote list uses a `<scrollbox>` of `<box>` rows because F-04 requires grouping by remote, an optional stale indicator, and a commit summary and date where space permits. `<select>` cannot render group headers or multi-column rows. Navigation, selection, and `g`/`G` come from `useListCursor` (architecture section 6 rule 3).

All icons and markers used by this feature come from `src/theme/icons.ts`; see architecture section 6.1. No glyph literal is written in feature code.

## 4. Component tree

```text
RemotesPanel
  Panel
    PanelHeader (title "Remotes", count of visible remote branches)
    RemoteFilter (SearchField -> input, placeholder "Filter remote branches", focused by list.filter)
    ScrollableList (scrollbox, viewportCulling, scrollbar when overflowing)
      RemoteRow (one per remote-tracking branch)
        ListRow (box)
          TextMarker
          text (remote name and branch name)
            span (stale indicator when present)
          text (last known commit summary and date, when width permits)
      LoadingRow (while the first read is in flight)
      EmptyState (no remote branches, or no matches for the filter)
      ErrorState (read failed, with Retry)
```

The Create Local Branch modal is not nested in the panel. The panel pushes it onto `OverlayProvider` (F-15):

```text
CreateLocalBranchModal
  ModalFrame
    text (title "Create local branch from <remote>/<branch>")
    FormField (local branch name input, prefilled, inline error text)
    text (read-only base ref)
    Checkbox ("Check out after creating", default on)
    ModalActions (Create, Cancel)
```

## 5. Enforced files and folders

- `src/features/remotes/RemotesPanel.tsx` - panel composition, region registration, action wiring, focus refresh.
- `src/features/remotes/RemoteRow.tsx` - one remote-branch row with columns and the stale indicator.
- `src/features/remotes/RemoteFilter.tsx` - the filter field and its clear-on-Esc behavior.
- `src/features/remotes/CreateLocalBranchModal.tsx` - prefilled name, read-only base ref, checkout checkbox, validation.
- `src/features/remotes/useRemotes.ts` - derives grouped rows from repository selectors, owns filter and cursor state, dispatches commands.
- `src/domain/git/git.remotes.ts` - remote-ref reads, grouping and sorting, and local-branch creation from a remote ref.
- Tests colocated: `src/domain/git/git.remotes.test.ts`, `src/features/remotes/RemotesPanel.test.tsx`, `src/features/remotes/RemoteRow.test.tsx`, `src/features/remotes/RemoteFilter.test.tsx`.

## 6. State model

Local view state (owned by `useRemotes.ts`, `RemoteFilter.tsx`, and the modal):

- Filter string, held in `RemoteFilter.tsx` local state and lifted through `useRemotes.ts` for list derivation.
- Cursor index for the `remotes` region, stored through `useListCursor` and persisted per region by `FocusProvider`.
- Modal open flag and which row opened it, through `useOverlay`.
- Create Local Branch draft: local name string, checkout checkbox boolean.

Provider state (read, never recomputed here):

- `RepositoryProvider` snapshot: remote-tracking refs with name, remote, branch, tip objectname, committer date, and commit summary.
- The fetched upstream scope set and per-remote last fetch timestamps, updated by F-02 Fetch and Fetch --prune.
- Stale classification, derived in `@/domain/repository/repository.selectors.ts`.
- `ConfigProvider`: `remote.fetchScope` and `git.path`.
- `StatusProvider`: operation progress and transient status.
- `FocusProvider`: active region and cursor map.

Rules: this feature never recomputes grouping, sorting, or staleness itself. It reads the grouped rows and stale flags from `@/domain/git/git.remotes.ts` and `@/domain/repository/repository.selectors.ts` (architecture section 9).

## 7. Data flow

Generic path (architecture section 9):

```text
key or click -> action ID -> useAction handler -> command from @/domain/commands/commands.registry
  -> command runner (availability + serialization) -> @/domain/git/git.remotes.ts -> git CLI
  -> parse -> RepositoryProvider refresh -> RemotesPanel re-render -> console entry + status
```

| Action ID or refresh | Domain module | Git subcommand |
| --- | --- | --- |
| repository refresh (list) | `git.remotes.ts` `listRemoteBranches()` | `git for-each-ref refs/remotes --format=%(refname:short)%00%(objectname)%00%(committerdate:iso-strict)%00%(objectname:short)%00%(subject)` |
| grouping and sorting | `git.remotes.ts` `groupByRemote()` (pure) | none; sorts by remote name, then branch name, and drops the `origin/HEAD` symbolic ref |
| stale classification | `repository.selectors.ts` | none; derived from per-remote last fetch timestamps and ref committer dates |
| `remote.createLocal` | `git.remotes.ts` `createLocalBranchFromRemote()` | `git branch <name> <remoteRef>` then `git checkout <name>` when checkout is requested |
| `nav.activate` | none | none; the action is unavailable in v1 (see section 9) |
| `app.refresh` | `git.remotes.ts` `listRemoteBranches()` via repository refresh | the list read above |

Fetch scope interaction (owned by F-02, observed here):

- Fetch updates only remote refs that are upstreams of local branches, grouped by remote and deduplicated (D15).
- After a successful Fetch, only the fetched upstream refs change. Unrelated remote branches keep their last known state.
- Fetch --prune removes stale refs only inside the fetched upstream scope. Unrelated remote branches are not removed.
- The panel never claims an out-of-scope ref is current or deleted; those rows show the stale indicator instead.
- Remote branches outside the fetch scope remain visible until they are fetched or pruned by another means.

## 8. Keyboard and focus

| Action ID | Behavior in the Remotes region |
| --- | --- |
| `nav.up`, `nav.down` | Move the cursor one row |
| `nav.first`, `nav.last` | Jump to the first or last row |
| `nav.pageUp`, `nav.pageDown` | Move by a screen |
| `nav.activate` | No action in v1; unavailable with the reason "Enter does nothing in v1; press Space to create a local branch" |
| `remote.createLocal` | Open the Create Local Branch modal for the selected remote branch |
| `list.filter` | Focus the filter field |
| `app.refresh` | Manual refresh of repository state |
| `focus.next`, `focus.previous` | Tab traversal (owned by `useFocusModel`) |

Notes: double click on a row performs the same action as `remote.createLocal`. While the filter field is focused, it owns printable keys, Backspace, Delete, and arrow keys through `useHotkeys` text-input precedence. `Esc` clears a non-empty filter first and only leaves the field when the filter is already empty. The footer and help read availability from `@/domain/commands/commands.availability.ts`.

## 9. Loading, empty, error, and disabled states

- Loading: `LoadingRow` with the text marker `[..]` and "loading remote branches" while the first read is in flight.
- Empty, no remote branches: `EmptyState` with "No remote branches" and the hint "Fetch updates upstream refs only".
- Empty, no remotes configured: `EmptyState` with "No remotes configured".
- Empty, filter matches nothing: `EmptyState` with "No remote branches match <filter>" and the hint "Esc clears the filter".
- Error: `ErrorState` with "Could not read remote branches" plus the git error text and a Retry button; the previous rows stay visible.
- Disabled, Enter: `nav.activate` is unavailable with the reason "Enter does nothing in v1; press Space to create a local branch". The footer hides it and the palette shows the reason.
- Disabled, `remote.createLocal` with no selected row: unavailable with the reason "no remote branch selected".
- Stale: the row shows the text marker `[stale]` and the detail text "last known state; not fetched in this scope". The indicator is not color-only.
- Operation in progress: the panel is read-only; a second mutation is blocked with the reason from the runner.

## 10. Performance and bounds

- Remote-tracking refs are rendered inside a `<scrollbox>` with `viewportCulling`; a soft cap of 5000 rendered rows applies, beyond which a notice row reports the truncation.
- Grouping and sorting are pure and O(n log n) in `git.remotes.ts`, computed once per snapshot and memoized in the selector.
- The filter runs client-side over the loaded refs and is case-insensitive against the full remote branch name (`<remote>/<branch>`).
- Row truncation uses `@/lib/text.ts` with a budget from `useTerminalDimensions`; the commit summary and date drop before the remote branch name.
- Refresh is coalesced by `RepositoryProvider`; the panel does not start its own git reads outside the repository refresh cycle.

## 11. Safety and confirmations

- Creating a local branch from a remote ref is non-destructive and requires no confirmation beyond the modal.
- The modal validates the name inline and keeps the modal open on error (F-15).
- Navigating the list, filtering, and focusing the region never mutate repository state.
- The panel never initiates a fetch, prune, or delete, so it cannot lose remote state as a side effect.
- The panel must not claim an out-of-scope remote branch is current or deleted; it shows the stale indicator instead (F-04, F-17).
- Every command runs through `git.client.ts` with an argument array and no shell; credentials in remote URLs are redacted before any console or error rendering.

## 12. Acceptance mapping

| F-04 acceptance bullet | Implementing module or component |
| --- | --- |
| Space and double click both open the confirmation modal with an editable local name | `useRemotes.ts` maps `remote.createLocal` and double click to the modal; `CreateLocalBranchModal.tsx` |
| Creating from a remote branch does not require a fetch first, but uses the locally known remote ref | `git.remotes.ts` `createLocalBranchFromRemote()` targets the existing remote-tracking ref |
| Invalid names keep the modal open with an inline error | `CreateLocalBranchModal.tsx` validation via `FormField` error text |
| A remote branch that was pruned from the remote disappears after Fetch --prune when in scope | F-02 prune flow removes the ref; `git.remotes.ts` list read drops it |
| Remote branches outside the fetch scope keep their last known state and are not removed by scoped Fetch --prune | Fetch scope rules in section 7; stale classification in `repository.selectors.ts` |
| Local branches that tracked the pruned remote branch show `[?] remote branch deleted` until recreated or changed | F-03 `repository.upstream.ts` classification; not computed here |
| Filter field filters case-insensitively against the full remote branch name | `RemoteFilter.tsx` plus `useRemotes.ts` filter derivation |
| Scrollbar appears when the filtered list overflows | `ScrollableList` (`<scrollbox>`) |
| Rows show the remote branch, last known summary and date, and a stale indicator | `RemoteRow.tsx` |
| Remote branches are not checked out directly; selecting offers creation of a local branch | `useRemotes.ts` action wiring; no checkout command registered |
| Enter does nothing in v1 | `commands.availability.ts` marks `nav.activate` unavailable in the remotes context |

## 13. Tests to add

- `src/domain/git/git.remotes.test.ts`: grouping and sorting by remote then branch, `origin/HEAD` exclusion, deduplication, and argument construction for `createLocalBranchFromRemote` with and without checkout; no spawning in unit tests.
- `src/domain/repository/repository.selectors.test.ts`: stale classification from a given fetch timestamp set and ref dates, and that out-of-scope refs are never marked deleted.
- `src/features/remotes/RemoteFilter.test.tsx`: typing filters the list, and the first `Esc` clears the filter while a second `Esc` leaves the field.
- `src/features/remotes/RemoteRow.test.tsx`: rendered name, summary, date, and stale marker under a constrained width.
- `src/features/remotes/RemotesPanel.test.tsx`: Space and double click both open the modal with the prefilled name, `nav.activate` is unavailable with the reason, and the filter empty state appears.

## 14. Open questions

- Define the exact stale threshold. This doc treats a ref as stale when it is outside the fetched upstream scope for the current session and its committer date is older than the newest fetched ref by more than a configured bound. Confirm the bound and whether it is time-based or fetch-cycle-based.
- Should `Enter` show a transient status hint in addition to the disabled availability reason, or stay silent? The spec says it does nothing.
- Confirm that the filter matches only `<remote>/<branch>` and not the commit summary.
- Confirm whether a remote branch whose remote was removed from configuration should be hidden or shown as an orphan row.
