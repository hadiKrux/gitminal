# 03 Branches Panel

## 1. Header

- Spec reference: `docs/product-spec.md` F-03 (lines 320-407), F-02 fetch scope rules (lines 260-273), decisions D13 and D15 (lines 1865-1889), action IDs (lines 1705-1742)
- Architecture contract: `docs/technical-implmentations/00-project-architecture.md`
- Region id: `branches` (`src/features/shell/regions.ts`)
- Dependencies: F-01 (shell, focus, region order), F-02 (top bar sync state and Push/Pull), F-07 (worktree markers), F-08 (commit graph selection supplies an optional start point), F-15 (modal structure and destructive confirmations), F-16 (repository states), F-17 (freshness and refresh), F-18 (safety), F-19 (`remote.fetchScope`).
- Owned paths:
  - `src/features/branches/BranchesPanel.tsx`
  - `src/features/branches/BranchRow.tsx`
  - `src/features/branches/NewBranchModal.tsx`
  - `src/features/branches/DeleteBranchModal.tsx`
  - `src/features/branches/DeleteBranchModalBody.tsx`
  - `src/features/branches/DeleteBranchRiskSection.tsx`
  - `src/features/branches/deleteBranch.layout.ts`
  - `src/features/branches/deleteBranch.risk.ts`
  - `src/features/branches/useDeleteBranchRisk.ts`
  - `src/features/branches/useBranchRows.ts`
  - `src/features/branches/useBranchActions.ts`
  - `src/features/branches/useBranches.ts`
  - `src/domain/git/git.branches.ts`
- Co-owned path: `src/domain/repository/repository.upstream.ts` owns upstream classification. This feature defines the classification consumed by the `[?]` indicators; F-02 and F-17 read the same selectors.

## 2. Scope and non-goals

Scope: list every local branch with a current marker, ahead/behind relative to the configured upstream, "no upstream", the two missing-upstream indicators, and the worktree checked-out marker; deterministic ordering; checkout on Enter and double click; New Branch modal with atomic create-and-checkout; Delete Branch modal with local-only and local-and-remote scopes, remote resolution order, force-delete acknowledgement that selects `-d` or `-D`, local-first delete order, and partial failure reporting; upstream classification after a successful remote deletion without a second prune; empty-repository gating; refresh behavior.

Non-goals: listing or checking out remote branches (F-04); adding, changing, or unsetting an upstream in v1; branch rename; branch filter behavior beyond registering `list.filter` (see Open questions); multi-select; auto-stash before checkout; merge, rebase, or cherry-pick; force push.

## 3. OpenTUI components used

| Component | Where used | Why it is right |
| --- | --- | --- |
| `<box>` | Panel frame, every row, modal layout, scope choice container, action row | The only layout primitive; rows need custom marker and column composition |
| `<text>` | Branch name, counts, marker glyphs, state text, validation errors, warnings | Every UI string must be rendered through `<text>` |
| `<span>` | Inline current `*`, worktree `+`, `[?]` indicator, "ahead N"/"behind N", and "no upstream" runs inside the name row | Inline styled runs inside a single `<text>`; badges are spans per architecture section 6 |
| `<scrollbox>` | The branch list container, with `viewportCulling`, and the bounded at-risk commit list inside Delete Branch | Scrollable region; handles wheel scroll and scrollbars for the panel branch list. The at-risk list also binds PageUp/PageDown through its overlay actions while the modal is open; the panel branch list has no keyboard paging action |
| `<select>` | Delete Branch scope choice (two uniform options) | Uniform option list with built-in up/down and Enter; scope is a fixed two-option choice |
| `<input>` | New Branch name field | Single-line text field; branch names are single line |

Hooks used:

| Hook | Where used | Why |
| --- | --- | --- |
| `useKeyboard` | Only inside `src/app/hooks/useHotkeys.ts` | Central dispatcher; this feature never calls it directly |
| `useAction` | `useBranchActions.ts` registers only the region-scoped handlers `branch.create` and `branch.delete` with `scope: "branches"`; `useListCursor` registers `nav.up`, `nav.down`, `nav.activate`, `nav.first`, and `nav.last` in the same scope; neither registers `app.refresh` or another global action. `useModalControlCycle` owns the modal Up/Down/Left/Right cycle | Features receive action IDs, never raw key strings; exactly one handler exists per `(actionId, scope)` |
| `useListCursor` | `useBranchRows.ts` navigation, `g`/`G`, and double click detection | Shared cursor and double click logic for custom rows |
| `useFocusRegion` | `useBranches.ts` passes focus to `useBranchActions.ts`, which refreshes when `focused` flips true (D10) | Region focus is derived from native focus; `useFocus` only reports terminal-window focus |
| `useTerminalDimensions` | `BranchRow.tsx` computes the name budget, and `DeleteBranchModal.tsx` passes the terminal size to `deleteBranch.layout.ts` | Budget-aware truncation via `@/lib/text.ts`, and a bounded at-risk list that cannot consume the rows reserved for the controls and footer |
| `useModalControlCycle` | `DeleteBranchModal.tsx` for the Up/Down/Left/Right control cycle | One reviewed cycle shared with the other destructive modals instead of three copies |

`<select>` versus `<scrollbox>` decision: the branch list uses a `<scrollbox>` of `<box>` rows, not `<select>`, because rows carry custom content that `<select>` cannot render: a leading current/worktree marker, an inline `[?]` indicator, separate ahead/behind columns, and a worktree path detail line. Architecture section 6 rule 3 requires custom-content rows to use a `<scrollbox>` with navigation from `useListCursor`. `<select>` is used only for the uniform two-option scope choice inside `DeleteBranchModal.tsx`.

All icons and markers used by this feature come from `src/theme/icons.ts`; see architecture section 6.1. No glyph literal is written in feature code.

## 4. Component tree

```text
BranchesPanel (body only; SidebarPanelFrame owns the Panel, border title, and scrollbox)
  BranchRow (one per local branch)
    ListRow (box)
      TextMarker (* current, + worktree, blank)
      text (branch name)
        span (ahead/behind counts, "no upstream", "[?] upstream not found", "[?] remote branch deleted")
      text (worktree path detail and upstream explanation, only for the selected row)
  LoadingRow (while the first read is in flight)
  EmptyState (no local branches)
  ErrorState (read failed, with Retry)
```

The body has no title or count row: the shell border title carries `Branches (<count>)`. Modals are not nested inside `BranchesPanel`. The panel pushes them onto `OverlayProvider` (F-15):

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
    DeleteBranchRiskSection
      text (reading, unreadable, merged, or empty state)
      text (heading: commits that only exist on this branch)
      scrollbox (bounded at-risk commit list; one truncated subject per row; PageUp/PageDown scrolls it while it is taller than the viewport)
      text (cap notice when older commits are not listed)
    Checkbox (force-delete acknowledgement, shown while the branch is unmerged or its merge state is unknown)
    text (stronger warning when the local branch is behind its remote)
    ModalActions (confirm label by scope, Cancel focused by default)
```

## 5. Enforced files and folders

- `src/features/branches/BranchesPanel.tsx` - panel composition, region registration, and action wiring. Focus refresh lives in `useBranches.ts` through `useBranchActions.ts`.
- `src/features/branches/BranchRow.tsx` - one branch row with markers, counts, and detail text.
- `src/features/branches/NewBranchModal.tsx` - create-branch form and shared branch-name validation.
- `src/features/branches/DeleteBranchModal.tsx` - scope selection, remote resolution display, and force acknowledgement controller.
- `src/features/branches/DeleteBranchModalBody.tsx` - modal frame, scope select, risk section, force control, and footer rendering.
- `src/features/branches/DeleteBranchRiskSection.tsx` - at-risk evidence states and the bounded, truncated commit list.
- `src/features/branches/deleteBranch.layout.ts` - modal and at-risk scrollbox budgets from the terminal size.
- `src/features/branches/deleteBranch.risk.ts` - force gating and explanatory text for the current risk read.
- `src/features/branches/useDeleteBranchRisk.ts` - lazy at-risk read when the modal opens.
- `src/features/branches/useBranchRows.ts` - derives rows from repository selectors, owns cursor, scrolling, and checkout activation.
- `src/features/branches/useBranchActions.ts` - `getAvailability(commandId, context)` with the selected branch target, the two scoped handlers `branch.create` and `branch.delete`, modal dispatch, and focus refresh.
- `src/features/branches/useBranches.ts` - composes the row and action hooks and derives the panel read states.
- `src/domain/git/git.branches.ts` - branch reads plus atomic create-and-checkout, checkout, local/remote delete command builders, the shared branch-name validator, and the lazy at-risk read.
- `src/domain/repository/repository.upstream.ts` - upstream classification (co-owned, see section 1).
- Tests colocated: `src/domain/git/git.branches.test.ts`, `src/domain/git/git.branches.integration.test.ts`, `src/domain/repository/repository.upstream.test.ts`, `src/features/branches/useBranches.test.tsx`, `src/features/branches/BranchesPanel.test.tsx`, `src/features/branches/BranchRow.test.tsx`, `src/features/branches/NewBranchModal.test.tsx`, `src/features/branches/DeleteBranchModal.test.tsx`.

## 6. State model

Local view state (owned by `useBranchRows.ts`, `useBranchActions.ts`, and the modals):

- Cursor index for the `branches` region, stored through `useListCursor` and persisted per region by `FocusProvider`.
- Modal open flags and which modal is active, through `useOverlay`.
- New Branch draft: name string, checkout checkbox boolean.
- Delete Branch draft: selected scope, force acknowledgement boolean.
- Row detail expansion for the selected row (worktree path or upstream detail).

Provider state (read, never recomputed here):

- `RepositoryProvider` snapshot: for each local branch the name, HEAD flag, tip objectname, committer date, configured upstream ref, ahead/behind counts, worktree path when checked out elsewhere, and upstream classification.
- `RepositoryProvider` selected commit: the New Branch start point when the modal is opened from a selected commit.
- Per-remote remote-check state: the last successful `ls-remote` or fetch timestamp and the confirmed absence set from the last successful prune or remote deletion. This drives `notFound` versus `deleted`.
- `ConfigProvider`: `remote.fetchScope` and `git.path`.
- `StatusProvider`: operation progress and transient status.
- `FocusProvider`: derived active region and cursor map.

Rules: this feature never recomputes ahead/behind, upstream state, or the worktree map. It reads them from `@/domain/repository/repository.selectors.ts` and `@/domain/repository/repository.upstream.ts` (architecture section 9). Classification is based on the last successful remote check or fetch for that remote, never on a ref commit date. A failed, cancelled, timed-out, or never-run check yields `notFound` or `unknown` for display purposes and can never yield `deleted`.

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
| repository refresh (list) | `git.branches.ts` `readLocalBranches()` -> `parseLocalBranches()` | `git for-each-ref refs/heads --format=%(refname:short)%00%(objectname)%00%(HEAD)%00%(committerdate:iso-strict)%00%(upstream:remotename)%00%(upstream:remoteref)%00%(upstream:track)` |
| ahead/behind | `git.branches.ts` `parseLocalBranches()` | none; the `%(upstream:track)` atom in the same batched `for-each-ref` read supplies the counts, so no `git rev-list` runs per branch |
| worktree marker | `parsers/parse.worktrees.ts` via `git.worktrees.ts` | `git worktree list --porcelain` |
| delete merge and risk state (modal open) | `useRepositoryBranchRisk.ts` resolves the base through `git.branches.ts` `resolveBranchMergeTarget()`, then `readBranchRisk()` reads the evidence | `git log --format=%H%x00%s --max-count=21 <upstream-or-HEAD>..<branch>` |
| upstream classification | `repository.upstream.ts` `classifyUpstream()` | none; derives from the local branch upstream, the remote-tracking ref snapshot, the last successful remote-check or fetch timestamp, and confirmed deletion records |
| `nav.activate` (checkout) | `commands.branches.ts` `executeBranchCheckout()` -> `git.branches.ts` `planCheckoutBranch()` | `git checkout <branch>` |
| `branch.create` with checkout | `git.branches.ts` `planCreateBranch()` | One atomic command: `git switch -c <name> <startPoint>`. The documented Git floor is 2.31, so there is no `checkout -b` fallback and a failed checkout leaves no branch behind. |
| `branch.create` without checkout | `git.branches.ts` `planCreateBranch()` | `git branch <name> <startPoint>` |
| `branch.delete` (local only) | `git.branches.ts` `planDeleteLocalBranch()` | `git branch -d <name>`, or `git branch -D <name>` when the force acknowledgement is set |
| `branch.delete` (local and remote) | `git.branches.ts` `planDeleteLocalBranch()` then `planDeleteRemoteBranch()` | Preflight local deletability, then `git branch -d`/`-D <name>`, then `git push --progress --delete -- <remote> <remoteBranch>` |

Upstream classification (in `repository.upstream.ts`) returns exactly one of:

- `none`: no configured upstream. The row shows "no upstream" and no `[?]`.
- `tracked`: a configured upstream whose remote-tracking ref exists. The row shows ahead/behind.
- `notFound`: a configured upstream whose remote-tracking ref is absent, but no successful remote check or prune has confirmed the absence. The row shows `[?] upstream not found`; ahead/behind are hidden.
- `unknown`: the remote check for this upstream failed, timed out, was cancelled, or has never run. The row keeps the last known indicator and explains that the state is unknown; it is never shown as `deleted` or as a deleted remote branch.
- `deleted`: a configured upstream whose remote-tracking ref is absent after a successful Fetch --prune confirmation for that remote, or after a successful remote deletion through this panel. The row shows `[?] remote branch deleted`; ahead/behind are hidden.

Classification uses the last successful remote check or fetch timestamp for the remote, not the ref commit date. The classification clears automatically when a later successful fetch finds the ref again. A branch with no configured upstream shows "no upstream" even when `origin/<local-branch-name>` exists; that ref is not treated as an upstream until Push or an explicit upstream change (F-02, D14).

A successful remote deletion through `branch.delete` removes the matching remote-tracking ref from the refreshed snapshot and records a confirmed deletion for the remote and branch in `repository.upstream.ts`, so any local branch that tracked it becomes `deleted` immediately without a second Fetch --prune. A failed or cancelled remote delete records nothing and does not change the classification.

Delete merge and risk base (in `useRepositoryBranchRisk.ts`, at modal-open time): the base is the branch's configured upstream only while its remote-tracking ref still exists in the current snapshot. When that ref is gone, or the branch has no upstream, the base is `HEAD`. The same base supplies both the merge state and the at-risk range, and a failed read reports an unknown merge state rather than claiming the branch is merged.

Remote scope resolution for delete (in `useBranches.ts`, from selector and signal output, in this order):

1. The configured upstream remote and branch, but only while the snapshot still classifies the upstream `tracked` and the remote is still configured.
2. When no upstream exists, `origin/<local-branch-name>` when that remote branch exists and `origin` is configured.
3. Otherwise the remote option is disabled with a reason. A confirmed `notFound` or `deleted` upstream, a missing configured remote, and an `unknown` check each get the documented reason, and an unconfirmed state never reads as a confirmed absence. The app never guesses another remote in v1.

Delete execution order and partial failure:

1. Preflight the local branch before any mutation. It must not be the current branch and must not be checked out in another worktree. An unmerged branch requires the force acknowledgement; that acknowledgement selects `git branch -D`. A merged branch uses `git branch -d`.
2. For the local-only scope, delete the local branch and stop.
3. For the local-and-remote scope, delete the local branch first, then delete the resolved remote branch with `git push --progress --delete -- <remote> <remoteBranch>`.
4. If the local delete fails, no remote delete runs. The local branch, the remote branch, and the classification are unchanged, and the git error is shown.
5. If the local delete succeeds but the remote delete fails, report a partial failure that names the remaining remote branch. The local branch is gone, the remote branch remains, and no success is claimed for the remote half.
6. If the remote delete succeeds, record the confirmed deletion in `repository.upstream.ts` and classify any local branch that tracked it as `[?] remote branch deleted`. No second Fetch --prune is required.

Both `branch.create` and `branch.delete` are gated in an empty repository with the reason "no commits yet". `branch.create` requires at least one commit when the start point is HEAD; a create from a selected commit is available because that commit exists. `branch.delete` has no deletable branch before the first commit. Each command calls `getAvailability(commandId, { state, signals, target: { kind: "branch", name: selectedBranch }, region: "branches", operation })`, so repository-wide gates from `gateRepository` and selected-branch gates such as "cannot delete the current branch" and "checked out in <worktree path>" come from one call.

## 8. Keyboard and focus

| Action ID | Behavior in the Branches region |
| --- | --- |
| `nav.up`, `nav.down` | Move the cursor one row |
| `nav.first`, `nav.last` | Jump to the first or last branch |
| `nav.activate` | Check out the selected branch through the `branch.checkout` command; no confirmation |
| `branch.create` | Open New Branch modal |
| `branch.delete` | Open Delete Branch modal |
| `list.filter` | Not registered in v1; see Open questions |
| `focus.next`, `focus.previous` | Tab traversal (owned by `useFocusModel`, not registered here) |
| `focus.region.branches` | Direct jump to this panel (default `1`), shell-owned |

Notes: double click on a row performs the same action as `nav.activate` and runs `branch.checkout` through the command runner. Modals are overlays and own all keys while open, with `overlay.close` cancelling. `useBranchActions` registers only `branch.create` and `branch.delete`, all with `scope: "branches"`; `useListCursor` registers `nav.up`, `nav.down`, `nav.activate`, `nav.first`, and `nav.last` for the region; `app.refresh`, `focus.*`, and every other global action stay with their designated owner. `list.filter` is not registered in v1 because branch filtering is undefined (Open questions). The footer, help, and palette read `getAvailability(commandId, context)` so hints and reasons match the selected branch, including its current-branch, worktree, and empty-repository conditions.

## 9. Loading, empty, error, and disabled states

- Loading: `LoadingRow` with the text marker `[..]` and "loading branches" while the first read is in flight. Navigation stays responsive on the previous snapshot.
- Empty: `EmptyState` with "No local branches" and the hint "n New branch". In a repository with no commits, the hint explains that the first commit is required and `branch.create` and `branch.delete` are unavailable with the reason "no commits yet".
- Unknown upstream: the row keeps its last known indicator and the detail explains that the remote check did not complete. It never shows `[?] remote branch deleted` from a failed, cancelled, timed-out, or never-run check.
- Error: `ErrorState` with "Could not read branches" plus the git error text and a Retry button; the previous rows stay visible.
- Disabled, delete of the current branch: the action is unavailable with the reason "cannot delete the current branch". The confirm button stays visible with a `dim` token and the reason text.
- Disabled, delete of a branch checked out in another worktree: unavailable with the reason "checked out in <worktree path>".
- Disabled, remote scope with no resolvable remote: the remote option is unavailable with the reason "no matching remote branch" or "remote missing".
- Missing upstream: the row shows `[?]` plus the exact text `[?] upstream not found` or `[?] remote branch deleted`, with ahead/behind hidden. The selected row detail explains the state in words, never by color alone.
- No upstream: the row shows the text "no upstream".
- Worktree marker: the row shows `+` and the worktree path in the selected-row detail. The attribution is re-derived from the retained worktree list when a worktree read fails, so a visible worktree row never disagrees with the branch marker or the delete guard.
- Operation in progress: the panel is read-only; a second mutation is blocked with the reason from the runner.

## 10. Performance and bounds

- The branch list is normally small. It is still rendered inside a `<scrollbox>` with `viewportCulling`; a soft cap of 2000 rendered rows applies, beyond which a notice row reports the truncation.
- Ahead/behind comes from the `%(upstream:track)` atom in the single batched `for-each-ref refs/heads` read, so listing branches never costs one process per tracked branch.
- Merge state is not read while listing branches. The delete confirmation reads `<upstream-or-HEAD>..<branch>` once when the modal opens, with `--max-count=21`, so the refresh hot path has no per-branch `for-each-ref --merged` process and a repository with hundreds of branches pays nothing until a delete is requested.
- The at-risk list is capped at 20 displayed commits. The 21st row is the cap evidence: when it exists, the modal says older commits at risk are not listed instead of implying the list is complete.
- Row truncation uses `@/lib/text.ts` with a budget from `useTerminalDimensions`; truncation never hides the current marker, the `[?]` indicator, or the selection. At-risk subjects use the same budget, and the commit list sits in a scrollbox whose height is the modal height minus the fixed controls, with PageUp/PageDown scrolling it by one viewport, so the force control and footer stay on screen and every listed commit is reachable from the keyboard.
- Refresh is coalesced by `RepositoryProvider`; a manual `app.refresh` while a refresh is running is ignored, not queued.
- Delete and create are single writes serialized by `commands.runner.ts`; the panel does not optimistically mutate the list.

## 11. Safety and confirmations

- Checkout requires no confirmation. If git rejects the checkout because of local changes, the git error is shown and the current branch is unchanged. No auto-stash.
- Delete always requires an explicit confirmation through `DeleteBranchModal`. The modal opens with Cancel focused; the user must choose a scope and confirm.
- The current branch and any branch checked out in another worktree cannot be deleted; the action is disabled with a reason.
- The modal always presents both scopes. The local-and-remote scope is never the default action.
- Deleting a merged local branch requires no extra warning. Deleting an unmerged local branch requires a force-delete acknowledgement that names the commits at risk. The commit list comes from `git log --format=%H%x00%s --max-count=21 <upstream-or-head>..<branch>` when the modal opens: the configured upstream is used only while its remote-tracking ref exists, otherwise `HEAD` is the base. At most 20 commits are displayed, inside a bounded scrollbox with truncated subjects that PageUp/PageDown scroll while it is taller than its viewport, and a cap notice says when older commits are not listed. The confirm action cannot run while a non-empty list is unacknowledged; a read whose base already contains the branch hides the acknowledgement and submits `force: false`.
- The at-risk list is read once when the modal opens and is not re-read while the modal stays open, so a commit added to the branch from another terminal after that read is not named before `-D`. This TOCTOU window is accepted: the preflight still runs against the current repository, git remains the authority on whether `-D` succeeds, and the modal never claims the shown list is the complete set.
- When the local branch is behind its remote, the local-and-remote scope shows a stronger warning that the remote branch contains commits not present locally.
- Create with checkout is atomic. It uses `git switch -c <name> <startPoint>`, never `git branch` followed by `git checkout`, so a failed checkout cannot leave an orphan branch. The documented Git floor is 2.31, so no `checkout -b` fallback exists.
- Delete order for local and remote: preflight the local branch, then delete the local branch first, then the remote branch.
  - If preflight fails or local deletion fails: keep the local branch and the remote branch, show the error, and claim nothing as deleted.
  - If local deletion succeeds but remote deletion fails: report a partial failure that names the remaining remote branch. The local branch is gone and the remote branch remains; the user can retry the remote half.
- The force-delete acknowledgement selects `git branch -D` for an unmerged branch; a merged branch uses `git branch -d` without it. The same rule applies to both scopes because both delete the local branch. A failed at-risk read leaves the merge state unknown, so the acknowledgement stays visible and the user must still acknowledge; the app never silently removes the force path or forces from an acknowledged unchecked box.
- A successful remote deletion records a confirmed deletion so local branches that tracked it are classified `[?] remote branch deleted` immediately, without waiting for another Fetch --prune.
- Local-only deletion never touches a remote branch.
- Deleting a branch never deletes reachable commits as a side effect (F-18).
- Every command runs through `git.client.ts` with an argument array and no shell; credentials are redacted before any console or error rendering.

## 12. Acceptance mapping

| F-03 acceptance bullet | Implementing module or component |
| --- | --- |
| Current branch is visually marked and never deleted | `BranchRow.tsx` current marker; `DeleteBranchModal.tsx` and `commands.availability.ts` disable delete |
| Ahead/behind match the last fetched upstream state | `git.branches.ts` `parseLocalBranches()` reading `%(upstream:track)`; `repository.selectors.ts` |
| Branch whose remote was deleted is marked `[?]` after Fetch --prune with the correct explanation | `repository.upstream.ts` `classifyUpstream()` returning `deleted`; `BranchRow.tsx` |
| A fetch that finds the ref again clears the indicator | `repository.upstream.ts` re-classification on refresh; F-17 fetch flow |
| Delete modal always shows local-only and local-and-remote choices, unavailable choices explained | `DeleteBranchModal.tsx` `SelectField` plus disabled reason text |
| Deleting local and remote deletes only the configured upstream, or `origin/<local-branch-name>` | Remote resolution order in section 7; `git.branches.ts` `planDeleteLocalBranch()` then `planDeleteRemoteBranch()` in `commands.branches.ts` `executeBranchDelete()` |
| A partial failure leaves an accurate local state and message | Local-first delete order and partial-failure handling in sections 7 and 11 |
| Creating a branch can optionally check it out | `NewBranchModal.tsx` checkbox; atomic `git switch -c` in `git.branches.ts` `planCreateBranch()` |
| A failed checkout or delete reports the git error without changing visible state | `useCommandRunner.ts` result handling; no optimistic mutation in `useBranches.ts`; local-first delete order |
| A successful remote deletion marks tracked local branches `[?] remote branch deleted` without another prune | `repository.upstream.ts` confirmed-deletion record written by `recordBranchDeleteEvidence()` in `usePanelCommands.ts` |
| Empty repository gates branch creation and deletion with "no commits yet" | `getAvailability` plus `gateRepository`; `NewBranchModal.tsx` and `useBranches.ts` |
| Only `branch.create` and `branch.delete` are owned by this feature, with navigation from `useListCursor` | `useBranchActions.ts` scoped `useAction` registrations composed by `useBranches.ts`, plus the region cursor hook; globals stay with `AppShellHost` or the top bar |
| `[?] upstream not found` versus `[?] remote branch deleted` | `repository.upstream.ts` classification plus the last successful remote-check timestamp and confirmed deletion records; unknown checks are never `deleted` |
| Worktree checked-out marker with the path available | `BranchRow.tsx` `+` marker and selected-row detail; `parse.worktrees.ts` |

## 13. Tests to add

- `src/domain/repository/repository.upstream.test.ts`: table-driven cases for `none`, `tracked`, `notFound`, `unknown`, `deleted`, and the transition back to `tracked` after a fetch finds the ref; assert ahead/behind are hidden for `notFound` and `deleted`; a failed, cancelled, timed-out, or never-run remote check is `unknown` or `notFound` and never `deleted`; a confirmed remote-delete event produces `deleted` without a prune timestamp; ref commit dates never affect classification.
- `src/domain/git/git.branches.test.ts`: argument construction for checkout; atomic `git switch -c` when checkout is requested and plain `git branch` when it is not; `-d` versus `-D` from the force acknowledgement; `%(upstream:track)` parsing; the shared branch-name rules including `HEAD` and a composite `.lock` component; the base resolution that falls back to `HEAD` when the configured upstream ref is missing; the capped branch-risk read with `merged` and `hasMore`; local-first delete order; no spawning in unit tests.
- `src/domain/git/git.branches.integration.test.ts`: a create with checkout whose checkout fails leaves no branch; a local delete failure performs no remote delete and leaves both branches; a local success plus remote failure reports a partial failure and leaves the remote branch; a successful remote delete classifies the tracked upstream as `deleted` without a second prune; a branch whose configured upstream ref was deleted resolves to `HEAD`, reads its at-risk commits, and deletes through `-D`.
- `src/domain/repository/repository.states.test.ts` (shared): `gateRepository` returns "no commits yet" for `branch.create` and `branch.delete` in an empty repository, and `getAvailability` combines it with the selected branch target.
- `src/features/branches/useBranches.test.tsx`: registers only the two `branches`-scoped handlers, never registers `app.refresh`, computes availability for the selected branch including current-branch and worktree reasons, disables the remote scope for a confirmed-absent upstream or a missing remote, runs `branch.checkout` on `nav.activate`, targets the clicked row on a double click that lands before a render, and selects the created branch after a successful create.
- `src/domain/git/parsers/parse.refs.test.ts` (shared with F-04 and F-05): parse recorded `for-each-ref` fixtures including branches with no upstream and with a missing remote-tracking ref.
- `src/features/branches/BranchRow.test.tsx`: rendered markers for current, worktree, `[?]` states, "no upstream", and truncation behavior.
- `src/features/branches/BranchesPanel.test.tsx`: ordering (current first, then most recent commit, then name), the loading, empty, and error states, the previous rows staying visible above a later read failure, delete disabled reasons, and the two registered branch actions plus cursor navigation.
- `src/features/branches/deleteBranch.layout.test.ts`: the modal height, content width, and bounded-list height at 80x24 and 100x32 for 0, 2, 20, and a capped 21 commits, asserting that the reserved fixed rows plus the list never exceed the modal; and that the footer labels are truncated into the content width.
- `src/features/branches/DeleteBranchModal.test.tsx`: Cancel as the default action, the local scope submitting `force: false` when the branch is merged, the acknowledgement gating a local-and-remote force delete, the force control hidden for a merged branch, the loading and read-error states, the force path remaining available after a failed read, a capped list on a short terminal keeping the force control and footer visible, a long branch name with a capped list keeping the force row on its own line and the footer inside the modal border, an unacknowledged footer that begins and ends with the border at 80x24, PageDown scrolling the bounded list by one viewport to a commit beyond the first viewport, a long subject truncated with an ellipsis, the disabled confirm reason, the remote scope disabled with the local-only explanation, and the behind-remote warning.
- `src/features/branches/NewBranchModal.test.tsx`: inline name validation through the shared validator, including `HEAD`, `foo.lock/bar`, `a/b.lock`, and `@{`; the checkout checkbox; the read-only start point; and the unavailable reason keeping Create visible with its reason.
- Ordering is stable across refreshes: assert the same row order for the same snapshot.

## 14. Open questions

- Product spec section 6 lists `/` Filter for the Branches region and section 6.1 defines `list.filter`, but F-03 does not describe branch filtering. v1 does not register `list.filter` for Branches; the key stays unbound in the Branches context until filtering is defined.
- The New Branch start point comes from a selected commit. Confirm the exact rule when the graph selection is the Pending Changes row (fall back to HEAD).
