# 04 Remotes Panel

## 1. Header

- Spec reference: `docs/product-spec.md` F-04 (lines 408-451), F-02 fetch scope rules (lines 260-273), decisions D15 (lines 1865-1889), action IDs (lines 1705-1742)
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
- Co-owned path: `src/domain/repository/repository.selectors.ts` owns the freshness classification and the grouping inputs consumed by this panel.

## 2. Scope and non-goals

Scope: list remote-tracking branches grouped and sorted by remote name and then branch name; a filter field at the top; a stale indicator derived from the last successful remote check or fetch timestamp; Space and double click open the Create Local Branch modal; atomic create-and-checkout; Enter does nothing in v1; the fetch-scope interaction where only fetched upstream refs change and unrelated refs keep their last known state; an `unknown` state that never claims a ref is absent, deleted, or unpushed.

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
| `useAction` | `useRemotes.ts` registers only the region-scoped handlers `remote.createLocal`, `nav.activate`, and `list.filter` with `scope: "remotes"`; it never registers `app.refresh` or another global action | Features receive action IDs, never raw key strings; exactly one handler exists per `(actionId, scope)` |
| `useListCursor` | `useRemotes.ts` navigation, `g`/`G`, and double click detection | Shared cursor and double click logic for custom rows |
| `useFocusRegion` | `RemotesPanel.tsx` refreshes the remote refs when `focused` flips true (D10) | Region focus is derived from native focus; `useFocus` only reports terminal-window focus |
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
- `src/features/remotes/useRemotes.ts` - derives grouped rows and freshness from repository selectors, owns filter and cursor state, calls `getAvailability(commandId, context)` with the selected remote branch target, registers the three scoped handlers, and dispatches commands.
- `src/domain/git/git.remotes.ts` - remote-ref reads, grouping and sorting, and atomic local-branch creation from a remote ref.
- Tests colocated: `src/domain/git/git.remotes.test.ts`, `src/domain/git/git.remotes.integration.test.ts`, `src/domain/repository/repository.selectors.test.ts`, `src/features/remotes/useRemotes.test.ts`, `src/features/remotes/RemotesPanel.test.tsx`, `src/features/remotes/RemoteRow.test.tsx`, `src/features/remotes/RemoteFilter.test.tsx`.

## 6. State model

Local view state (owned by `useRemotes.ts`, `RemoteFilter.tsx`, and the modal):

- Filter string, held in `RemoteFilter.tsx` local state and lifted through `useRemotes.ts` for list derivation.
- Cursor index for the `remotes` region, stored through `useListCursor` and persisted per region by `FocusProvider`.
- Modal open flag and which row opened it, through `useOverlay`.
- Create Local Branch draft: local name string, checkout checkbox boolean.

Provider state (read, never recomputed here):

- `RepositoryProvider` snapshot: remote-tracking refs with name, remote, branch, tip objectname, committer date, and commit summary.
- The fetched upstream scope set and per-remote last successful remote check or fetch timestamp, updated only after a successful F-02 Fetch or Fetch --prune confirmation. Creating a local branch from a locally known ref does not update it.
- Freshness classification (`fresh`, `stale`, `unknown`), derived in `@/domain/repository/repository.selectors.ts` from the per-remote timestamp and the current clock.
- `ConfigProvider`: `remote.fetchScope` and `git.path`.
- `StatusProvider`: operation progress and transient status.
- `FocusProvider`: derived active region and cursor map.

Rules: this feature never recomputes grouping, sorting, or freshness itself. It reads the grouped rows and freshness flags from `@/domain/git/git.remotes.ts` and `@/domain/repository/repository.selectors.ts` (architecture section 9). Freshness is based on the last successful remote check or fetch timestamp, not on the ref commit date. A remote with no successful check in this session is `unknown`; a failed, cancelled, or timed-out check leaves the previous timestamp and state in place. `unknown` is never rendered as absent, deleted, or unpushed.

## 7. Data flow

Generic path (architecture section 9):

```text
key or click -> action ID -> useAction handler -> useCommandRunner.runCommand(request)
  -> command runner (availability + serialization) -> @/domain/git/git.remotes.ts -> git CLI
  -> CommandResult -> useCommandRunner applies RepositoryProvider refresh, console entry, status, and error overlay
  -> RemotesPanel re-render
```

| Action ID or refresh | Domain module | Git subcommand |
| --- | --- | --- |
| repository refresh (list) | `git.remotes.ts` `listRemoteBranches()` | `git for-each-ref refs/remotes --format=%(refname:short)%00%(objectname)%00%(committerdate:iso-strict)%00%(objectname:short)%00%(subject)` |
| grouping and sorting | `git.remotes.ts` `groupByRemote()` (pure) | none; sorts by remote name, then branch name, and drops the `origin/HEAD` symbolic ref |
| freshness classification | `repository.selectors.ts` | none; derived from each remote's last successful remote check or fetch timestamp compared with the current clock, never from ref committer dates |
| `remote.createLocal` with checkout | `git.remotes.ts` `createLocalBranchFromRemote()` | One atomic command: `git switch -c <name> <remoteRef>`, or `git checkout -b <name> <remoteRef>` when `switch` is unavailable. A failed checkout leaves no branch behind. |
| `remote.createLocal` without checkout | `git.remotes.ts` `createLocalBranchFromRemote()` | `git branch <name> <remoteRef>` |
| `nav.activate` | none | none; the action is unavailable in v1 (see section 9) |
| repository refresh | `git.remotes.ts` `listRemoteBranches()` via repository refresh | the list read above; `app.refresh` is a global action owned outside this feature |

Fetch scope interaction (owned by F-02, observed here):

- Fetch updates only remote refs that are upstreams of local branches, grouped by remote and deduplicated (D15).
- After a successful Fetch, only the fetched upstream refs change. Unrelated remote branches keep their last known state.
- Fetch --prune removes stale refs only inside the fetched upstream scope. Unrelated remote branches are not removed.
- The panel never claims an out-of-scope ref is current or deleted; those rows show the stale or unknown indicator instead.
- Remote branches outside the fetch scope remain visible until they are fetched or pruned by another means.
- A failed, cancelled, timed-out, or never-run `ls-remote` or fetch leaves the remote's freshness `unknown` and preserves its previous refs and timestamps. It never produces `absent`, `deleted`, or `unpushed`.
- A successful remote-delete event from F-03 removes the matching remote-tracking ref and records the confirmed deletion, so the panel drops the row after the repository refresh without claiming that out-of-scope refs changed.

Availability is target-aware and scoped. `useRemotes` calls `getAvailability(commandId, { state, signals, target: { kind: "remoteBranch", remote, branch }, region: "remotes", operation })`. `remote.createLocal` requires a selected remote branch and a valid local name; in an empty repository with no commits and no remote-tracking refs it is unavailable with the reason "no commits yet". `nav.activate` is unavailable with "Enter does nothing in v1; press Space to create a local branch". Repository-wide gates from `gateRepository` cover no remote, no commits, and operation in progress. The panel registers only `remote.createLocal`, `nav.activate`, and `list.filter`; `app.refresh` and global remote operations stay with their designated owners.

## 8. Keyboard and focus

| Action ID | Behavior in the Remotes region |
| --- | --- |
| `nav.up`, `nav.down` | Move the cursor one row |
| `nav.first`, `nav.last` | Jump to the first or last row |
| `nav.activate` | No action in v1; unavailable with the reason "Enter does nothing in v1; press Space to create a local branch" |
| `remote.createLocal` | Open the Create Local Branch modal for the selected remote branch |
| `list.filter` | Focus the filter field |
| `focus.next`, `focus.previous` | Tab traversal (owned by `useFocusModel`, not registered here) |
| `focus.region.remotes` | Direct jump to this panel (default `2`), shell-owned |

Notes: double click on a row performs the same action as `remote.createLocal`. `useRemotes` registers only `remote.createLocal`, `nav.activate`, and `list.filter`, all with `scope: "remotes"`; `app.refresh`, `focus.*`, and every `remote.*` global operation stay with their designated owner. While the filter field is focused, it declares `search` mode, so printable keys, Backspace, Delete, and Left/Right stay in the field while Up/Down move the highlighted row. The first `Esc` clears a non-empty filter; the next `Esc` leaves the field and returns focus to the `remotes` region frame. The footer and help read `getAvailability(commandId, context)` for the selected remote branch.

## 9. Loading, empty, error, and disabled states

- Loading: `LoadingRow` with the text marker `[..]` and "loading remote branches" while the first read is in flight.
- Empty, no remote branches: `EmptyState` with "No remote branches" and the hint "Fetch updates upstream refs only".
- Empty, no remotes configured: `EmptyState` with "No remotes configured".
- Empty repository, no commits and no remote-tracking refs: `EmptyState` with "No remote branches" and the reason "no commits yet" for `remote.createLocal`; no action claims a ref was deleted or unpushed.
- Empty, filter matches nothing: `EmptyState` with "No remote branches match <filter>" and the hint "Esc clears the filter".
- Error: `ErrorState` with "Could not read remote branches" plus the git error text and a Retry button; the previous rows stay visible.
- Disabled, Enter: `nav.activate` is unavailable with the reason "Enter does nothing in v1; press Space to create a local branch". The footer hides it and the palette shows the reason.
- Disabled, `remote.createLocal` with no selected row: unavailable with the reason "no remote branch selected".
- Stale: the row shows the text marker `[stale]` and the detail text "last known state; not checked recently". The classification comes from the last successful remote check or fetch timestamp for that remote, not from the ref commit date. The indicator is not color-only.
- Unknown: the row shows `[?]` or the unknown marker and the detail text "remote state unknown; the last check did not complete". A failed, cancelled, timed-out, or never-run check never renders as absent, deleted, or unpushed.
- Operation in progress: the panel is read-only; a second mutation is blocked with the reason from the runner.

## 10. Performance and bounds

- Remote-tracking refs are rendered inside a `<scrollbox>` with `viewportCulling`; a soft cap of 5000 rendered rows applies, beyond which a notice row reports the truncation.
- Grouping and sorting are pure and O(n log n) in `git.remotes.ts`, computed once per snapshot and memoized in the selector.
- The filter runs client-side over the loaded refs and is case-insensitive against the full remote branch name (`<remote>/<branch>`).
- Row truncation uses `@/lib/text.ts` with a budget from `useTerminalDimensions`; the commit summary and date drop before the remote branch name.
- Refresh is coalesced by `RepositoryProvider`; the panel does not start its own git reads outside the repository refresh cycle.

## 11. Safety and confirmations

- Creating a local branch from a remote ref is non-destructive and requires no confirmation beyond the modal.
- Create with checkout is atomic. It uses `git switch -c <name> <remoteRef>` or `git checkout -b <name> <remoteRef>`, never `git branch` followed by `git checkout`, so a failed checkout cannot leave an orphan branch. Without checkout it uses `git branch <name> <remoteRef>`.
- The modal validates the name inline and keeps the modal open on error (F-15).
- Navigating the list, filtering, and focusing the region never mutate repository state.
- The panel never initiates a fetch, prune, or delete, so it cannot lose remote state as a side effect.
- The panel must not claim an out-of-scope remote branch is current or deleted; it shows the stale or unknown indicator instead (F-04, F-17).
- Freshness is based on the last successful remote check or fetch timestamp for that remote. A failed or never-run check is unknown, never absent, deleted, or unpushed. The panel never derives freshness from a ref commit date.
- Every command runs through `git.client.ts` with an argument array and no shell; credentials in remote URLs are redacted before any console or error rendering.

## 12. Acceptance mapping

| F-04 acceptance bullet | Implementing module or component |
| --- | --- |
| Space and double click both open the confirmation modal with an editable local name | `useRemotes.ts` maps `remote.createLocal` and double click to the modal; `CreateLocalBranchModal.tsx` |
| Creating from a remote branch does not require a fetch first, but uses the locally known remote ref | `git.remotes.ts` `createLocalBranchFromRemote()` targets the existing remote-tracking ref with one atomic `git switch -c` / `git checkout -b` or `git branch` command |
| A successful create with checkout never leaves an orphan branch on a failed checkout | Atomic create command in `git.remotes.ts`; `useCommandRunner.ts` reports the failure without a visible change |
| Invalid names keep the modal open with an inline error | `CreateLocalBranchModal.tsx` validation via `FormField` error text |
| A remote branch that was pruned from the remote disappears after Fetch --prune when in scope | F-02 prune flow removes the ref; `git.remotes.ts` list read drops it |
| Remote branches outside the fetch scope keep their last known state and are not removed by scoped Fetch --prune | Fetch scope rules in section 7; freshness classification in `repository.selectors.ts` |
| Local branches that tracked the pruned remote branch show `[?] remote branch deleted` until recreated or changed | F-03 `repository.upstream.ts` classification; not computed here |
| Filter field filters case-insensitively against the full remote branch name | `RemoteFilter.tsx` plus `useRemotes.ts` filter derivation |
| Scrollbar appears when the filtered list overflows | `ScrollableList` (`<scrollbox>`) |
| Rows show the remote branch, last known summary and date, and a stale or unknown indicator | `RemoteRow.tsx` plus `repository.selectors.ts` freshness from the last successful remote check timestamp |
| Remote branches are not checked out directly; selecting offers creation of a local branch | `useRemotes.ts` action wiring; no checkout command registered |
| Enter does nothing in v1 | `getAvailability` marks `nav.activate` unavailable in the remotes context |
| Empty repository gates remote-branch creation with "no commits yet" | `getAvailability` plus `gateRepository`; `useRemotes.ts` |
| Only `remote.createLocal`, `nav.activate`, and `list.filter` are owned by this feature | `useRemotes.ts` scoped `useAction` registrations; globals stay with `AppShellHost` or the top bar |

## 13. Tests to add

- `src/domain/git/git.remotes.test.ts`: grouping and sorting by remote then branch, `origin/HEAD` exclusion, deduplication, and argument construction for `createLocalBranchFromRemote` with and without checkout, asserting one atomic `git switch -c` / `git checkout -b` command when checkout is requested and plain `git branch` otherwise; no spawning in unit tests.
- `src/domain/git/git.remotes.integration.test.ts`: a failed checkout in the create-with-checkout path leaves no local branch behind; a successful remote read updates the per-remote check timestamp; a failed `ls-remote` leaves the timestamp and refs unchanged.
- `src/domain/repository/repository.selectors.test.ts`: freshness classification from a given per-remote successful-check timestamp set, never from ref commit dates; a failed, cancelled, timed-out, or never-run check yields `unknown`; out-of-scope refs are never marked deleted, absent, or unpushed.
- `src/domain/commands/commands.availability.test.ts` (shared): `remote.createLocal` is target-aware for the selected remote branch and returns "no commits yet" in an empty repository with no commits and no remote-tracking refs.
- `src/features/remotes/useRemotes.test.ts`: registers only the three `remotes`-scoped handlers, rejects a duplicate `(actionId, scope)`, never registers `app.refresh`, and computes availability for the selected remote branch or the no-selection reason.
- `src/features/remotes/RemoteFilter.test.tsx`: typing filters the list, and the first `Esc` clears the filter while a second `Esc` leaves the field.
- `src/features/remotes/RemoteRow.test.tsx`: rendered name, summary, date, and stale marker under a constrained width.
- `src/features/remotes/RemotesPanel.test.tsx`: Space and double click both open the modal with the prefilled name, `nav.activate` is unavailable with the reason, and the filter empty state appears.

## 14. Open questions

- Define the exact stale age. This doc treats a ref as stale when its remote's last successful check or fetch timestamp is older than a configured bound, and as `unknown` when that remote has no successful check in the session. Confirm the bound and whether it is time-based or check-cycle-based. Ref commit dates are not used.
- Should `Enter` show a transient status hint in addition to the disabled availability reason, or stay silent? The spec says it does nothing.
- Confirm that the filter matches only `<remote>/<branch>` and not the commit summary.
- Confirm whether a remote branch whose remote was removed from configuration should be hidden or shown as an orphan row.
