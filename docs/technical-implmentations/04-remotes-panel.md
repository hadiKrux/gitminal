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
  - `src/domain/git/git.remote-branches.ts`
  - `src/domain/git/git.remotes.ts`
- Co-owned path: `src/domain/repository/repository.selectors.ts` owns the freshness classification and the grouping inputs consumed by this panel.

## 2. Scope and non-goals

Scope: list remote-tracking branches grouped and sorted by remote name and then branch name; a filter field at the top; a stale indicator derived from the last successful remote check or fetch timestamp; Space and double click open the Create Local Branch modal; atomic create-and-checkout; Enter does nothing in v1; the fetch-scope interaction where only fetched upstream refs change and unrelated refs keep their last known state; an `unknown` state that never claims a ref is absent, deleted, or unpushed.

Non-goals: checking out a remote branch directly; adding, removing, or renaming a remote; initiating Fetch or Fetch --prune from this panel (F-02 owns those actions); pushing; deleting a remote branch from this panel (F-03 owns remote deletion as a delete scope); any Enter behavior.

## 3. OpenTUI components used

| Component | Where used | Why it is right |
| --- | --- | --- |
| `<box>` | Panel frame, group header rows, every remote-branch row, modal layout | The only layout primitive; rows need custom columns and a grouping header |
| `<text>` | Remote branch name, group header label, inline stale or unknown marker, empty and error text | Every UI string must be rendered through `<text>` |
| `<span>` | Inline stale or unknown marker and the remote-name versus branch-name split inside one `<text>` | Inline styled runs inside a single `<text>` |
| `<scrollbox>` | The remote-branch list container, with `viewportCulling` and a scrollbar when the filtered list overflows | Scrollable region; required by F-04 for overflowing filtered lists |
| `<input>` | The filter field, composed through the `SearchField` primitive in `RemoteFilter.tsx` | Single-line field; the filter is a single-line, case-insensitive text match |
| `<select>` | Not used | Rows need grouping and multi-column content, so the list uses a scrollbox of box rows |

Hooks used:

| Hook | Where used | Why |
| --- | --- | --- |
| `useKeyboard` | Only inside `src/app/hooks/useHotkeys.ts` | Central dispatcher; this feature never calls it directly |
| `useAction` | `useRemoteActions.ts` registers only the region-scoped handlers `remote.createLocal` and `list.filter` with `scope: "remotes"`; `useRemotes.ts` composes that hook and owns rows, filter, and cursor state; `useListCursor` registers `nav.up`, `nav.down`, `nav.activate`, `nav.first`, and `nav.last` in the same scope; none registers `app.refresh` or another global action | Features receive action IDs, never raw key strings; exactly one handler exists per `(actionId, scope)` |
| `useListCursor` | `useRemotes.ts` navigation, `g`/`G`, and double click detection | Shared cursor and double click logic for custom rows |
| `useFocusRegion` | `useRemotes.ts` refreshes the remote refs when `focused` flips true (D10) | Region focus is derived from native focus; `useFocus` only reports terminal-window focus |
| `useScrollSelectedRow` | `useRemotes.ts` keeps the active row inside the shell scroll container | The shell owns the single scrollbox and exposes `scrollChildIntoView` |
| `useInputEscapeClear` | `useRemoteFilter.ts` registers the first-`Esc` clear while the filter is non-empty, composed through `useRemotes.ts` | The dispatcher consumes the first `Esc` before `overlay.close` |

`<scrollbox>` versus `<select>` decision: the remote list uses a `<scrollbox>` of `<box>` rows because F-04 requires grouping by remote and an inline stale or unknown indicator. `<select>` cannot render group headers or custom row content. Navigation, selection, and `g`/`G` come from `useListCursor` (architecture section 6 rule 3). The row is deliberately one line (see section 4).

All icons and markers used by this feature come from `src/theme/icons.ts`; see architecture section 6.1. No glyph literal is written in feature code.

## 4. Component tree

```text
RemotesPanel (body only; SidebarPanelFrame owns the Panel, border title, and scrollbox)
  RemoteFilter (SearchField -> input, placeholder "filter remote branches", focused by list.filter)
  text (group header per remote)
  RemoteRow (one per remote-tracking branch)
    ListRow (box)
      TextMarker
      text (remote name and branch name)
        span (stale or unknown indicator when present)
  LoadingRow (while the first read is in flight)
  EmptyState (no remote branches, or no matches for the filter)
  ErrorState (read failed, with Retry)
```

The panel has no title or count row: the shell border title carries `Remotes (<count>)`, and the body never duplicates it. Remote rows are deliberately one line, naming `<remote>/<branch>` plus an inline stale or unknown marker. The earlier tree also showed a last-known commit summary and date line; dropping it is a deliberate deviation, because the row must never lose the branch identity and the commit date is not what F-04 asks the row to prove. Freshness remains visible through the marker.

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

- `src/features/remotes/RemotesPanel.tsx` - panel composition, region registration, and action wiring. Focus refresh lives in `useRemotes.ts`.
- `src/features/remotes/RemoteRow.tsx` - one remote-branch row with columns and the stale indicator.
- `src/features/remotes/RemoteFilter.tsx` - the filter field and its clear-on-Esc behavior.
- `src/features/remotes/CreateLocalBranchModal.tsx` - prefilled name, read-only base ref, checkout checkbox, validation.
- `src/features/remotes/useRemotes.ts` - derives grouped rows and freshness from repository selectors, owns filter and cursor state, calls `getAvailability(commandId, context)` with the selected remote branch target, composes `useRemoteActions.ts` for the two scoped handlers `remote.createLocal` and `list.filter`, and dispatches commands.
- `src/features/remotes/useRemoteActions.ts` - registers `remote.createLocal` and `list.filter` with `scope: "remotes"`, publishes the selected-target availability, and builds the Retry handler.
- `src/domain/git/git.remote-branches.ts` - the remote-tracking branch read, parse, grouping, and the atomic create-local planner.
- `src/domain/git/git.remotes.ts` - remote configuration reads plus the push, fetch, and prune planners and helpers.
- Tests colocated: `src/domain/git/git.remote-branches.test.ts`, `src/domain/git/git.remotes.test.ts`, `src/domain/git/git.remotes.integration.test.ts`, `src/domain/repository/repository.selectors.test.ts`, `src/features/remotes/useRemotes.test.tsx`, `src/features/remotes/RemotesPanel.test.tsx`, `src/features/remotes/RemoteRow.test.tsx`, `src/features/remotes/RemoteFilter.test.tsx`.

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

Rules: this feature never recomputes grouping, sorting, or freshness itself. It reads the grouped rows from `@/domain/git/git.remote-branches.ts` through `@/domain/repository/repository.selectors.ts`, and freshness from the selector (architecture section 9). Freshness is based on the last successful remote check or fetch timestamp, not on the ref commit date. A remote with no successful check in this session is `unknown`; a failed, cancelled, or timed-out check leaves the previous timestamp and state in place. `unknown` is never rendered as absent, deleted, or unpushed.

## 7. Data flow

Generic path (architecture section 9):

```text
key or click -> action ID -> useAction handler -> useCommandRunner.runCommand(request)
  -> command runner (availability + serialization) -> @/domain/git/git.remote-branches.ts -> git CLI
  -> CommandResult -> useCommandRunner applies RepositoryProvider refresh, console entry, status, and error overlay
  -> RemotesPanel re-render
```

| Action ID or refresh | Domain module | Git subcommand |
| --- | --- | --- |
| repository refresh (list) | `git.remote-branches.ts` `readRemoteBranches()` -> `parseRemoteBranches()` | `git for-each-ref refs/remotes --format=%(refname)%00%(objectname)%00%(committerdate:iso-strict)%00%(subject)%00%(symref)` |
| grouping and sorting | `git.remote-branches.ts` `groupByRemote()` (pure) | none; sorts by remote name, then branch name, and drops the `origin/HEAD` symbolic ref |
| freshness classification | `repository.selectors.ts` | none; derived from each remote's last successful remote check or fetch timestamp compared with the current clock, never from ref committer dates |
| `remote.createLocal` with checkout | `git.remote-branches.ts` `planCreateLocalBranchFromRemote()` | One atomic command: `git switch -c <name> <remoteRef>`. The documented Git floor is 2.30, so there is no `checkout -b` fallback and a failed checkout leaves no branch behind. |
| `remote.createLocal` without checkout | `git.remote-branches.ts` `planCreateLocalBranchFromRemote()` | `git branch <name> <remoteRef>` |
| `nav.activate` | none | none; the action is unavailable in v1 (see section 9) |
| repository refresh | `git.remote-branches.ts` `readRemoteBranches()` via repository refresh | the list read above; `app.refresh` is a global action owned outside this feature |

Fetch scope interaction (owned by F-02, observed here):

- Fetch updates only remote refs that are upstreams of local branches, grouped by remote and deduplicated (D15).
- After a successful Fetch, only the fetched upstream refs change. Unrelated remote branches keep their last known state.
- Fetch --prune removes stale refs only inside the fetched upstream scope. Unrelated remote branches are not removed.
- The panel never claims an out-of-scope ref is current or deleted; those rows show the stale or unknown indicator instead.
- Remote branches outside the fetch scope remain visible until they are fetched or pruned by another means.
- A failed, cancelled, timed-out, or never-run `ls-remote` or fetch leaves the remote's freshness `unknown` and preserves its previous refs and timestamps. It never produces `absent`, `deleted`, or `unpushed`.
- A successful remote-delete event from F-03 removes the matching remote-tracking ref and records the confirmed deletion, so the panel drops the row after the repository refresh without claiming that out-of-scope refs changed.

Availability is target-aware and scoped. `useRemotes` calls `getAvailability(commandId, { state, signals, target: { kind: "remoteBranch", remote, branch }, region: "remotes", operation })`. `remote.createLocal` requires a selected remote branch and a valid local name; in an empty repository with no commits and no remote-tracking refs it is unavailable with the reason "no commits yet". `nav.activate` is a region navigation action with no registry command, so the panel keeps the exact "Enter does nothing in v1; press Space to create a local branch" reason visible instead of asking the command layer. Repository-wide gates from `gateRepository` cover no remote, no commits, and operation in progress. The panel registers only `remote.createLocal` and `list.filter` through `useRemoteActions.ts`; `app.refresh` and global remote operations stay with their designated owners.

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

Notes: double click on a row performs the same action as `remote.createLocal`, using the clicked row index so the previous cursor cannot be targeted before a render. `useRemotes` registers only `remote.createLocal` and `list.filter` through `useRemoteActions`, all with `scope: "remotes"`; `useListCursor` registers the region's `nav.*` actions; `app.refresh`, `focus.*`, and every `remote.*` global operation stay with their designated owner. While the filter field is focused, printable keys, Backspace, Delete, and Left/Right stay in the field. Declared `search` input mode is deferred with the shell input-mode work, so Up/Down currently stay in the field too and row navigation resumes after `Esc` leaves it. The first `Esc` clears a non-empty filter and keeps focus in the field; the next `Esc` leaves it and returns focus to the `remotes` region frame. The footer and help read `getAvailability(commandId, context)` for the selected remote branch and hide an unavailable `remote.createLocal`.

## 9. Loading, empty, error, and disabled states

- Loading: `LoadingRow` with the text marker `[..]` and "loading remote branches" while the first read is in flight.
- Empty, no remote branches: `EmptyState` with "No remote branches" and the hint "Fetch updates upstream refs only".
- Empty, no remotes configured: `EmptyState` with "No remotes configured".
- Empty repository, no commits and no remote-tracking refs: `EmptyState` with "No remote branches" and the reason "no commits yet" for `remote.createLocal`; no action claims a ref was deleted or unpushed.
- Empty, filter matches nothing: `EmptyState` with "No remote branches match <filter>" and the hint "Esc clears the filter". The first `Esc` clears the filter and keeps focus in the field; the second leaves it.
- Error: `ErrorState` with "Could not read remote branches" plus the git error text and a Retry button; the previous rows stay visible.
- Disabled, Enter: `nav.activate` is unavailable with the reason "Enter does nothing in v1; press Space to create a local branch". The footer hides it and the palette shows the reason.
- Disabled, `remote.createLocal` with no selected row: unavailable with the reason "no remote branch selected".
- Stale: the one-line row shows the inline `[stale]` marker. The classification comes from the last successful remote check or fetch timestamp for that remote, not from the ref commit date, and the marker is never color-only.
- Unknown: the one-line row shows the `[?]` marker. A failed, cancelled, timed-out, or never-run check never renders as absent, deleted, or unpushed.
- Operation in progress: the panel is read-only; a second mutation is blocked with the reason from the runner.

## 10. Performance and bounds

- Remote-tracking refs are rendered inside a `<scrollbox>` with `viewportCulling`; the panel caps rendered rows at 5000 after filtering, beyond which a notice row reports the visible and hidden counts.
- Grouping and sorting are pure and O(n log n) in `git.remote-branches.ts`, computed once per snapshot and memoized in the selector.
- The filter runs client-side over the loaded refs and is case-insensitive against the full remote branch name (`<remote>/<branch>`).
- The row is one line. When the full `<remote>/<branch>` does not fit the sidebar budget, the branch name is truncated through `@/lib/text.ts` while room for the inline stale or unknown marker is reserved, so the marker is never the part dropped. The budget is the drawable width the panel frame provides, which already excludes the border and the column the vertical scrollbar reserves, so an overflowing filtered list never clips the separator or the marker. There is no commit summary or date line to budget, and `viewportCulling` bounds paint cost.
- A manual `app.refresh` refreshes the repository reads only. It does not refresh remote tag knowledge; the Tags panel refreshes that on region focus and after a successful remote tag operation.
- Refresh is coalesced by `RepositoryProvider`; the panel does not start its own git reads outside the repository refresh cycle.

## 11. Safety and confirmations

- Creating a local branch from a remote ref is non-destructive and requires no confirmation beyond the modal.
- Create with checkout is atomic. It uses `git switch -c <name> <remoteRef>`, never `git branch` followed by `git checkout`, so a failed checkout cannot leave an orphan branch. The documented Git floor is 2.30, so no `checkout -b` fallback exists. Without checkout it uses `git branch <name> <remoteRef>`.
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
| Creating from a remote branch does not require a fetch first, but uses the locally known remote ref | `git.remote-branches.ts` `planCreateLocalBranchFromRemote()` targets the existing remote-tracking ref with one atomic `git switch -c` or `git branch` command |
| A successful create with checkout never leaves an orphan branch on a failed checkout | Atomic create plan in `git.remote-branches.ts`; `useCommandRunner.ts` reports the failure without a visible change |
| Invalid names keep the modal open with an inline error | `CreateLocalBranchModal.tsx` validation via `FormField` error text |
| A remote branch that was pruned from the remote disappears after Fetch --prune when in scope | F-02 prune flow removes the ref; the `git.remote-branches.ts` list read drops it |
| Remote branches outside the fetch scope keep their last known state and are not removed by scoped Fetch --prune | Fetch scope rules in section 7; freshness classification in `repository.selectors.ts` |
| Local branches that tracked the pruned remote branch show `[?] remote branch deleted` until recreated or changed | F-03 `repository.upstream.ts` classification; not computed here |
| Filter field filters case-insensitively against the full remote branch name | `RemoteFilter.tsx` plus `useRemotes.ts` filter derivation |
| Scrollbar appears when the filtered list overflows | the shell's sidebar scroll container (`SidebarPanelFrame`) |
| Rows show the remote branch and a stale or unknown indicator | `RemoteRow.tsx` one-line row plus `repository.selectors.ts` freshness from the last successful remote check timestamp; the commit summary and date line is a recorded deviation |
| Remote branches are not checked out directly; selecting offers creation of a local branch | `useRemotes.ts` action wiring; no checkout command registered |
| Enter does nothing in v1 | the panel keeps the exact reason visible for `nav.activate` |
| Empty repository gates remote-branch creation with "no commits yet" | `getAvailability` plus `gateRepository`; `useRemotes.ts` |
| Only `remote.createLocal` and `list.filter` are owned by this feature, with navigation from `useListCursor` | `useRemoteActions.ts` scoped `useAction` registrations composed by `useRemotes.ts`; globals stay with `AppShellHost` or the top bar |

## 13. Tests to add

- `src/domain/git/git.remote-branches.test.ts`: grouping and sorting by remote then branch, `origin/HEAD` exclusion, deduplication, and argument construction for `planCreateLocalBranchFromRemote` with and without checkout, asserting one atomic `git switch -c` command when checkout is requested and plain `git branch` otherwise; no spawning in unit tests.
- `src/domain/git/git.remotes.integration.test.ts`: a failed checkout in the create-with-checkout path leaves no local branch behind; a successful remote read updates the per-remote check timestamp; a failed `ls-remote` leaves the timestamp and refs unchanged.
- `src/domain/repository/repository.selectors.test.ts`: freshness classification from a given per-remote successful-check timestamp set, never from ref commit dates; a failed, cancelled, timed-out, or never-run check yields `unknown`; out-of-scope refs are never marked deleted, absent, or unpushed.
- `src/domain/commands/commands.availability.test.ts` (shared): `remote.createLocal` is target-aware for the selected remote branch and returns "no commits yet" in an empty repository with no commits and no remote-tracking refs.
- `src/features/remotes/useRemotes.test.tsx`: registers only the two `remotes`-scoped handlers, rejects a duplicate `(actionId, scope)`, never registers `app.refresh`, keeps `nav.activate` a no-op with its reason, computes availability for the selected remote branch or the no-selection reason, keeps create-local available in an empty repository that still has remote-tracking refs, targets the double-clicked row, covers the first-`Esc` clear, and covers the 5000-row cap.
- `src/features/remotes/RemoteFilter.test.tsx`: typing filters the list, and the first `Esc` clears the filter while a second `Esc` leaves the field.
- `src/features/remotes/RemoteRow.test.tsx`: the one-line `<remote>/<branch>` row, the inline stale or unknown marker, and branch-name truncation with the marker and its separator reserved at both the full and narrow sidebar content widths inside the real `SidebarPanelFrame` with enough rows to show the scrollbar.
- `src/features/remotes/RemotesPanel.test.tsx`: Space and double click both open the modal with the prefilled name, `nav.activate` is unavailable with the reason, the filter empty state appears, the render cap names the hidden count, the read error keeps Retry, and the body renders no second title row.

## 14. Open questions

- Define the exact stale age. This doc treats a ref as stale when its remote's last successful check or fetch timestamp is older than a configured bound, and as `unknown` when that remote has no successful check in the session. Confirm the bound and whether it is time-based or check-cycle-based. Ref commit dates are not used.
- Should `Enter` show a transient status hint in addition to the disabled availability reason, or stay silent? The spec says it does nothing.
- Confirm that the filter matches only `<remote>/<branch>`. The row carries no commit summary, so there is nothing else to match.
- Confirm whether a remote branch whose remote was removed from configuration should be hidden or shown as an orphan row.
