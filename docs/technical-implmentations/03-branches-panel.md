# 03 Branches Panel

## 1. Header

- Status: Draft for review
- Spec reference: `docs/product-spec.md` F-03 (lines 294-375), fetch scope rules (lines 245-260), decisions D13 and D15 (lines 1747-1749), action IDs (lines 1583-1611)
- Architecture contract: `docs/technical-implmentations/00-project-architecture.md`
- Region id: `branches` (`src/features/shell/regions.ts`)
- Dependencies: F-01 (shell, focus, region order), F-02 (top bar sync state and Push/Pull), F-07 (worktree markers), F-08 (commit graph selection supplies an optional start point), F-15 (modal structure and destructive confirmations), F-16 (repository states), F-17 (freshness and refresh), F-18 (safety), F-19 (`remote.fetchScope`).
- Owned paths:
  - `src/features/branches/BranchesPanel.tsx`
  - `src/features/branches/BranchRow.tsx`
  - `src/features/branches/NewBranchModal.tsx`
  - `src/features/branches/DeleteBranchModal.tsx`
  - `src/features/branches/useBranches.ts`
  - `src/domain/git/git.branches.ts`
- Co-owned path: `src/domain/repository/repository.upstream.ts` owns upstream classification. This feature defines the classification consumed by the `[?]` indicators; F-02 and F-17 read the same selectors.

## 2. Scope and non-goals

Scope: list every local branch with a current marker, ahead/behind relative to the configured upstream, "no upstream", the two missing-upstream indicators, and the worktree checked-out marker; deterministic ordering; checkout on Enter and double click; New Branch modal; Delete Branch modal with local-only and local-and-remote scopes, remote resolution order, force-delete acknowledgement, delete order, and partial failure reporting; refresh behavior.

Non-goals: listing or checking out remote branches (F-04); adding, changing, or unsetting an upstream in v1; branch rename; branch filter behavior beyond registering `list.filter` (see Open questions); multi-select; auto-stash before checkout; merge, rebase, or cherry-pick; force push.

## 3. OpenTUI components used

| Component | Where used | Why it is right |
| --- | --- | --- |
| `<box>` | Panel frame, every row, modal layout, scope choice container, action row | The only layout primitive; rows need custom marker and column composition |
| `<text>` | Branch name, counts, marker glyphs, state text, validation errors, warnings | Every UI string must be rendered through `<text>` |
| `<span>` | Inline current `*`, worktree `+`, `[?]` indicator, "ahead N"/"behind N", and "no upstream" runs inside the name row | Inline styled runs inside a single `<text>`; badges are spans per architecture section 6 |
| `<scrollbox>` | The branch list container, with `viewportCulling` | Scrollable region; handles wheel scroll and scrollbars for long branch lists |
| `<select>` | Delete Branch scope choice (two uniform options) | Uniform option list with built-in up/down and Enter; scope is a fixed two-option choice |
| `<input>` | New Branch name field | Single-line text field; branch names are single line |

Hooks used:

| Hook | Where used | Why |
| --- | --- | --- |
| `useKeyboard` | Only inside `src/app/hooks/useHotkeys.ts` | Central dispatcher; this feature never calls it directly |
| `useAction` | `useBranches.ts` registers `branch.create`, `branch.delete`, `nav.activate`, `list.filter`, `app.refresh` | Features receive action IDs, never raw key strings |
| `useListCursor` | `useBranches.ts` navigation, `g`/`G`, and double click detection | Shared cursor and double click logic for custom rows |
| `useFocusRegion` | `BranchesPanel.tsx` refreshes when `focused` flips true (D10) | Region focus is derived from native focus; `useFocus` only reports terminal-window focus |
| `useTerminalDimensions` | `BranchRow.tsx` and `BranchesPanel.tsx` compute the truncation budget | Budget-aware truncation via `@/lib/text.ts` |

`<select>` versus `<scrollbox>` decision: the branch list uses a `<scrollbox>` of `<box>` rows, not `<select>`, because rows carry custom content that `<select>` cannot render: a leading current/worktree marker, an inline `[?]` indicator, separate ahead/behind columns, and a worktree path detail line. Architecture section 6 rule 3 requires custom-content rows to use a `<scrollbox>` with navigation from `useListCursor`. `<select>` is used only for the uniform two-option scope choice inside `DeleteBranchModal.tsx`.

All icons and markers used by this feature come from `src/theme/icons.ts`; see architecture section 6.1. No glyph literal is written in feature code.

## 4. Component tree

```text
BranchesPanel
  Panel
    PanelHeader (title "Branches", count, current-branch marker)
    ScrollableList (scrollbox, viewportCulling, scrollbar when overflowing)
      BranchRow (one per local branch)
        ListRow (box)
          TextMarker (* current, + worktree, blank)
          text (branch name)
            span (ahead/behind counts, "no upstream", "[?] upstream not found", "[?] remote branch deleted")
          text (worktree path detail, only for the selected row)
      LoadingRow (while the first read is in flight)
      EmptyState (no local branches)
      ErrorState (read failed, with Retry)
```

Modals are not nested inside `BranchesPanel`. The panel pushes them onto `OverlayProvider` (F-15):

```text
NewBranchModal
  ModalFrame
    FormField (name input, inline error text)
    text (read-only start point)
    Checkbox ("Check out after creating", default on)
    ModalActions (Create, Cancel)

DeleteBranchModal
  ModalFrame
    text (local branch name)
    SelectField (scope: "Delete local branch only" / "Delete local and remote branch")
    text (resolved remote and remote branch, or the disabled reason)
    Checkbox (force-delete acknowledgement, shown only for an unmerged branch)
    text (stronger warning when the local branch is behind its remote)
    ModalActions (confirm label by scope, Cancel focused by default)
```

## 5. Enforced files and folders

- `src/features/branches/BranchesPanel.tsx` - panel composition, region registration, action wiring, focus refresh.
- `src/features/branches/BranchRow.tsx` - one branch row with markers, counts, and detail text.
- `src/features/branches/NewBranchModal.tsx` - create-branch form and validation.
- `src/features/branches/DeleteBranchModal.tsx` - scope selection, remote resolution display, force acknowledgement.
- `src/features/branches/useBranches.ts` - derives rows from repository selectors, owns cursor and modal drafts, dispatches commands.
- `src/domain/git/git.branches.ts` - branch reads plus create, checkout, and delete command builders.
- `src/domain/repository/repository.upstream.ts` - upstream classification (co-owned, see section 1).
- Tests colocated: `src/domain/git/git.branches.test.ts`, `src/domain/repository/repository.upstream.test.ts`, `src/features/branches/BranchesPanel.test.tsx`, `src/features/branches/BranchRow.test.tsx`.

## 6. State model

Local view state (owned by `useBranches.ts` and the modals):

- Cursor index for the `branches` region, stored through `useListCursor` and persisted per region by `FocusProvider`.
- Modal open flags and which modal is active, through `useOverlay`.
- New Branch draft: name string, checkout checkbox boolean.
- Delete Branch draft: selected scope, force acknowledgement boolean.
- Row detail expansion for the selected row (worktree path or upstream detail).

Provider state (read, never recomputed here):

- `RepositoryProvider` snapshot: for each local branch the name, HEAD flag, tip objectname, committer date, configured upstream ref, ahead/behind counts, worktree path when checked out elsewhere, and upstream classification.
- `RepositoryProvider` selected commit: the New Branch start point when the modal is opened from a selected commit.
- Fetched and pruned remote set: drives the two missing-upstream states.
- `ConfigProvider`: `remote.fetchScope` and `git.path`.
- `StatusProvider`: operation progress and transient status.
- `FocusProvider`: derived active region and cursor map.

Rules: this feature never recomputes ahead/behind, upstream state, or the worktree map. It reads them from `@/domain/repository/repository.selectors.ts` and `@/domain/repository/repository.upstream.ts` (architecture section 9).

## 7. Data flow

Generic path (architecture section 9):

```text
key or click -> action ID -> useAction handler -> useCommandRunner.runCommand(request)
  -> command runner (availability + serialization) -> @/domain/git/git.branches.ts -> git CLI
  -> CommandResult -> useCommandRunner applies RepositoryProvider refresh, console entry, status, and error overlay
  -> BranchesPanel re-render
```

| Action ID or refresh | Domain module | Git subcommand |
| --- | --- | --- |
| repository refresh (list) | `git.branches.ts` `listLocalBranches()` | `git for-each-ref refs/heads --format=%(refname:short)%00%(objectname)%00%(HEAD)%00%(committerdate:iso-strict)%00%(upstream:short)` |
| ahead/behind | `git.branches.ts` `readAheadBehind()` | `git rev-list --left-right --count <branch>...<upstream>` per tracked branch, batched |
| worktree marker | `parsers/parse.worktrees.ts` via `git.worktrees.ts` | `git worktree list --porcelain` |
| upstream classification | `repository.upstream.ts` `classifyUpstream()` | none; derives from local branch upstream plus the fetched/pruned remote-ref snapshot |
| `nav.activate` (checkout) | `git.branches.ts` `checkoutBranch()` | `git checkout <branch>` |
| `branch.create` | `git.branches.ts` `createBranch()` | `git branch <name> <startPoint>` then `git checkout <name>` when checkout is requested |
| `branch.delete` (local only) | `git.branches.ts` `deleteLocalBranch()` | `git branch -d <name>`, or `git branch -D <name>` after force acknowledgement |
| `branch.delete` (local and remote) | `git.branches.ts` `deleteRemoteBranch()` then `deleteLocalBranch()` | `git push <remote> --delete <remoteBranch>` then the local delete above |

Upstream classification (in `repository.upstream.ts`) returns exactly one of:

- `none`: no configured upstream. The row shows "no upstream" and no `[?]`.
- `tracked`: a configured upstream whose remote-tracking ref exists. The row shows ahead/behind.
- `notFound`: a configured upstream whose remote-tracking ref is absent and no successful prune for that remote has confirmed the absence. The row shows `[?] upstream not found`; ahead/behind are hidden.
- `deleted`: a configured upstream whose remote-tracking ref is absent after a successful Fetch --prune, or a fetch with pruning enabled, for that remote. The row shows `[?] remote branch deleted`; ahead/behind are hidden.

The classification clears automatically when a later successful fetch finds the ref again. A branch with no configured upstream shows "no upstream" even when `origin/<local-branch-name>` exists; that ref is not treated as an upstream until Push or an explicit upstream change (F-02, D14).

Remote scope resolution for delete (in `DeleteBranchModal.tsx`, using selector output, in this order):

1. The configured upstream remote and branch.
2. When no upstream exists, `origin/<local-branch-name>` when that remote branch exists.
3. Otherwise the remote option is disabled with a reason. The app never guesses another remote in v1.

## 8. Keyboard and focus

| Action ID | Behavior in the Branches region |
| --- | --- |
| `nav.up`, `nav.down` | Move the cursor one row |
| `nav.first`, `nav.last` | Jump to the first or last branch |
| `nav.pageUp`, `nav.pageDown` | Move by a screen |
| `nav.activate` | Check out the selected branch; no confirmation |
| `branch.create` | Open New Branch modal |
| `branch.delete` | Open Delete Branch modal |
| `list.filter` | Registered for the region; reserved, see Open questions |
| `app.refresh` | Manual refresh of repository state |
| `focus.next`, `focus.previous` | Tab traversal (owned by `useFocusModel`) |
| `focus.region.branches` | Direct jump to this panel (default `1`), shell-owned |

Notes: double click on a row performs the same action as `nav.activate`. Modals are overlays and own all keys while open, with `overlay.close` cancelling. The footer, help, and palette read availability from `@/domain/commands/commands.availability.ts` so hints match the selected row.

## 9. Loading, empty, error, and disabled states

- Loading: `LoadingRow` with the text marker `[..]` and "loading branches" while the first read is in flight. Navigation stays responsive on the previous snapshot.
- Empty: `EmptyState` with "No local branches" and the hint "n New branch".
- Error: `ErrorState` with "Could not read branches" plus the git error text and a Retry button; the previous rows stay visible.
- Disabled, delete of the current branch: the action is unavailable with the reason "cannot delete the current branch". The confirm button stays visible with a `dim` token and the reason text.
- Disabled, delete of a branch checked out in another worktree: unavailable with the reason "checked out in <worktree path>".
- Disabled, remote scope with no resolvable remote: the remote option is unavailable with the reason "no matching remote branch" or "remote missing".
- Missing upstream: the row shows `[?]` plus the exact text `[?] upstream not found` or `[?] remote branch deleted`, with ahead/behind hidden. The selected row detail explains the state in words, never by color alone.
- No upstream: the row shows the text "no upstream".
- Worktree marker: the row shows `+` and the worktree path in the selected-row detail.
- Operation in progress: the panel is read-only; a second mutation is blocked with the reason from the runner.

## 10. Performance and bounds

- The branch list is normally small. It is still rendered inside a `<scrollbox>` with `viewportCulling`; a soft cap of 2000 rendered rows applies, beyond which a notice row reports the truncation.
- Ahead/behind is read in one batched pass (`readAheadBehind()`) rather than one process per branch where possible.
- Row truncation uses `@/lib/text.ts` with a budget from `useTerminalDimensions`; truncation never hides the current marker, the `[?]` indicator, or the selection.
- Refresh is coalesced by `RepositoryProvider`; a manual `app.refresh` while a refresh is running is ignored, not queued.
- Delete and create are single writes serialized by `commands.runner.ts`; the panel does not optimistically mutate the list.

## 11. Safety and confirmations

- Checkout requires no confirmation. If git rejects the checkout because of local changes, the git error is shown and the current branch is unchanged. No auto-stash.
- Delete always requires an explicit confirmation through `DeleteBranchModal`. The modal opens with Cancel focused; the user must choose a scope and confirm.
- The current branch and any branch checked out in another worktree cannot be deleted; the action is disabled with a reason.
- The modal always presents both scopes. The local-and-remote scope is never the default action.
- Deleting a merged local branch requires no extra warning. Deleting an unmerged local branch requires a force-delete acknowledgement that names the commits at risk. The commit list comes from `git log --oneline <upstream-or-head>..<branch>`, capped at a small bound, and applies to both scopes because both delete the local branch.
- When the local branch is behind its remote, the local-and-remote scope shows a stronger warning that the remote branch contains commits not present locally.
- Delete order for local and remote: delete the remote branch first, then the local branch.
  - If remote deletion fails: keep the local branch and show the error. The user can retry or delete locally only.
  - If remote deletion succeeds but local deletion fails: report a partial failure and keep the local branch visible with `[?] remote branch deleted`, because its upstream ref is now gone.
- Local-only deletion never touches a remote branch.
- Deleting a branch never deletes reachable commits as a side effect (F-18).
- Every command runs through `git.client.ts` with an argument array and no shell; credentials are redacted before any console or error rendering.

## 12. Acceptance mapping

| F-03 acceptance bullet | Implementing module or component |
| --- | --- |
| Current branch is visually marked and never deleted | `BranchRow.tsx` current marker; `DeleteBranchModal.tsx` and `commands.availability.ts` disable delete |
| Ahead/behind match the last fetched upstream state | `git.branches.ts` `readAheadBehind()`; `repository.selectors.ts` |
| Branch whose remote was deleted is marked `[?]` after Fetch --prune with the correct explanation | `repository.upstream.ts` `classifyUpstream()` returning `deleted`; `BranchRow.tsx` |
| A fetch that finds the ref again clears the indicator | `repository.upstream.ts` re-classification on refresh; F-17 fetch flow |
| Delete modal always shows local-only and local-and-remote choices, unavailable choices explained | `DeleteBranchModal.tsx` `SelectField` plus disabled reason text |
| Deleting local and remote deletes only the configured upstream, or `origin/<local-branch-name>` | Remote resolution order in section 7; `git.branches.ts` `deleteRemoteBranch()` |
| A partial failure leaves an accurate local state and message | Delete order and partial-failure handling in section 11 |
| Creating a branch can optionally check it out | `NewBranchModal.tsx` checkbox; `git.branches.ts` `createBranch()` |
| A failed checkout or delete reports the git error without changing visible state | `useCommandRunner.ts` result handling; no optimistic mutation in `useBranches.ts` |
| `[?] upstream not found` versus `[?] remote branch deleted` | `repository.upstream.ts` classification plus the fetched/pruned remote set |
| Worktree checked-out marker with the path available | `BranchRow.tsx` `+` marker and selected-row detail; `parse.worktrees.ts` |

## 13. Tests to add

- `src/domain/repository/repository.upstream.test.ts`: table-driven cases for `none`, `tracked`, `notFound`, `deleted`, and the transition back to `tracked` after a fetch finds the ref; assert ahead/behind are hidden for `notFound` and `deleted`.
- `src/domain/git/git.branches.test.ts`: argument construction for checkout, create with and without checkout, `-d` versus `-D`, and remote delete; no spawning in unit tests.
- `src/domain/git/parsers/parse.refs.test.ts` (shared with F-04 and F-05): parse recorded `for-each-ref` fixtures including branches with no upstream and with a missing remote-tracking ref.
- `src/features/branches/BranchRow.test.tsx`: rendered markers for current, worktree, `[?]` states, "no upstream", and truncation behavior.
- `src/features/branches/BranchesPanel.test.tsx`: ordering (current first, then most recent commit, then name), cursor persistence across focus changes, delete disabled reasons, and the delete partial-failure message.
- Ordering is stable across refreshes: assert the same row order for the same snapshot.

## 14. Open questions

- Product spec section 6 lists `/` Filter for the Branches region and section 6.1 defines `list.filter`, but F-03 does not describe branch filtering. Should v1 register `list.filter` for Branches, or is `/` in the keyboard map a leftover from the shared list-filtering table? This doc registers `list.filter` but leaves the behavior unspecified until resolved.
- Should ahead/behind be read through a single `for-each-ref` with `%(upstream:track)` instead of `rev-list` per branch for repositories with hundreds of branches? Decide after measuring.
- The New Branch start point comes from a selected commit. Confirm the exact rule when the graph selection is the Pending Changes row (fall back to HEAD).
- Confirm the cap for the unmerged-commit list shown in the force-delete acknowledgement.
