# 07 Worktrees Panel

## 1. Header

- Spec reference: `docs/product-spec.md` F-07 (lines 562-609), decision D8 (line 1876), action IDs (lines 1705-1742), branch worktree marker (lines 331 and 365), key precedence (lines 113-123)
- Architecture contract: `docs/technical-implmentations/00-project-architecture.md`
- Region id: `worktrees` (`src/features/shell/regions.ts`)
- Dependencies: F-03 (the Branches panel reads the same worktree map for its checked-out marker and its delete guard), F-15 (modal structure and destructive confirmations), F-16 (repository states), F-17 (freshness and performance), F-18 (safety), F-19 (`git.path`).
- Owned paths:
  - `src/features/worktrees/WorktreesPanel.tsx`
  - `src/features/worktrees/WorktreeRow.tsx`
  - `src/features/worktrees/WorktreeDetails.tsx`
  - `src/features/worktrees/NewWorktreeModal.tsx`
  - `src/features/worktrees/DeleteWorktreeModal.tsx`
  - `src/features/worktrees/useWorktrees.ts`
  - `src/domain/git/git.worktrees.ts`
  - `src/domain/git/parsers/parse.worktrees.ts`
- Co-owned paths: `src/domain/repository/repository.selectors.ts` owns the worktree map that F-03 consumes; `src/lib/paths.ts` owns path shortening.

## 2. Scope and non-goals

Scope: list every worktree known to the repository; each row shows the branch name or the detached short hash, the repository-relative or home-shortened path, the current worktree marker, the locked or prunable state when git reports it, and a dirty marker when it is cheaply available; `n` opens the New Worktree modal with a prefilled path and a branch mode of new branch from HEAD or existing branch not checked out elsewhere; `d` opens the Delete Worktree confirmation with a clean path and a dirty-or-locked force path that computes the exact flag set; `/` filters the list; Enter selects the worktree in `RepositoryProvider.selection` and renders read-only `WorktreeDetails` in the right pane; deleting a worktree never deletes its branch; the app never switches repositories in v1.

Non-goals: switching the app to another worktree (D8); `git worktree prune`; `git worktree lock` and `unlock`; `git worktree move`; `git worktree repair`; submodules, Git LFS, sparse checkout, and advanced worktree cases (product spec line 41); removing a worktree directory outside git; browsing or editing files in another worktree; a full-screen worktree details screen. The right-pane `WorktreeDetails` summary is the v1 surface.

## 3. OpenTUI components used

| Component | Where used | Why it is right |
| --- | --- | --- |
| `<box>` | Panel frame, every worktree row, modal layout, modal footer | The only layout primitive; rows combine a branch, markers, and a path |
| `<text>` | Branch name or detached hash, path, markers, empty and error text | Every UI string is rendered through `<text>` |
| `<span>` | Inline current, locked, prunable, and dirty markers inside the branch `<text>` | Inline styled runs inside a single `<text>` |
| `<scrollbox>` | The worktree list container, with `viewportCulling` and a scrollbar when the filtered list overflows | Scrollable region; custom rows rule out `<select>` |
| `<input>` | Path field and branch-name field in the New Worktree modal, through `FormField`; filter through `SearchField` | Single-line fields; paths and branch names are single line |
| `<select>` | Branch mode choice in the New Worktree modal, through `SelectField`; existing-branch picker | Uniform option lists with built-in up/down and Enter |
| `Checkbox` primitive | Force acknowledgement in the Delete Worktree modal (`<box>` + `<text>` marker) | Required for the dirty or locked stronger confirmation |
| `<diff>` | Not used | This feature shows worktree details as text, not a diff |
| Right-pane `WorktreeDetails` composition | `src/features/worktrees/WorktreeDetails.tsx`, rendered by `AppShellHost` when `RepositoryProvider.selection.kind === "worktree"` | Uses `Panel`, `<text>`, and `<span>` for a read-only summary; never switches the repository |

Hooks used:

| Hook | Where used | Why |
| --- | --- | --- |
| `useKeyboard` | Only inside `src/app/hooks/useHotkeys.ts` | Central dispatcher; this feature never calls it directly |
| `useAction` | `useWorktreeActions.ts` registers the region-scoped handlers `worktree.create`, `worktree.delete`, and `list.filter` with `scope: "worktrees"`; `useWorktrees.ts` composes that hook and owns rows, filter, and cursor state; `useListCursor` registers `nav.up`, `nav.down`, and `nav.activate` in the same scope | One handler per `(actionId, scope)`; global actions such as `app.refresh` and `focus.*` are owned by the app or shell and are never registered here |
| `useListCursor` | `useWorktrees.ts` navigation and double click detection | Shared cursor and double click logic for custom rows |
| `useFocusRegion` | `useWorktrees.ts` refreshes the worktree list when `focused` flips true | Region focus is derived from native focus; `useFocus` only reports terminal-window focus |
| `useTerminalDimensions` | `WorktreeRow.tsx` computes the path truncation budget | Budget-aware truncation through `@/lib/text.ts` |
| `useOverlay` | `WorktreesPanel.tsx` opens the New and Delete modals | Modal stack lives in `OverlayProvider` |
| `useRepository`, `useStatus` | `useWorktrees.ts` reads the snapshot and publishes status | Provider state is never copied locally |

`<scrollbox>` versus `<select>` decision: the worktree list uses a `<scrollbox>` of `<box>` rows because each row combines a branch or hash, an inline marker set, and a shortened path, which `<select>` cannot render (architecture section 6 rule 3). `<select>` is used only for the uniform branch-mode and existing-branch choices inside `NewWorktreeModal.tsx`.

All icons and markers used by this feature come from `src/theme/icons.ts`; see architecture section 6.1. No glyph literal is written in feature code.

## 4. Component tree

```text
WorktreesPanel (body only; SidebarPanelFrame owns the Panel, border title, and scrollbox)
  SearchField (filter, focused by list.filter)
  WorktreeRow (one per worktree)
    ListRow (box)
      TextMarker (selection marker ">"; current marker "*")
      text (branch name, or detached short hash)
        span (current marker)
        span (locked marker)
        span (prunable marker)
        span (dirty marker)
      text (shortened path, truncated)
  LoadingRow (while the first read is in flight)
  EmptyState (no worktrees, or no matches)
  ErrorState (read failed, with Retry)
```

The right pane is composed by `AppShellHost` from `RepositoryProvider.selection` (architecture section 9). A worktree selection renders `WorktreeDetails` instead of the composer or commit details:

```text
WorktreeDetails (when selection.kind === "worktree")
  Panel (title "Worktree")
    text (branch name or detached short hash)
    text (full path and the shortened display path)
    text (HEAD short hash, current/locked/prunable/dirty state, and lock or prune reason)
    text ("Read-only. This panel never switches the active repository.")
```

The body has no title or count row: the shell border title carries `Worktrees (<count>)`. Modals are pushed onto `OverlayProvider` (F-15), not nested in the panel:

```text
NewWorktreeModal
  ModalFrame
    FormField (path input, required, prefilled with a sibling directory)
    SelectField (branch mode: "New branch from HEAD" / "Existing branch")
    FormField (branch name input, editable in new-branch mode)
    SelectField (existing branch picker, shown in existing-branch mode)
    text (inline validation error)
    ModalActions (Create worktree, Cancel)

DeleteWorktreeModal
  ModalFrame
    text (branch name or detached short hash, and the path)
    text (risk text: names the dirty or locked state when present)
    Checkbox ("Force remove", shown only for a dirty or locked worktree)
    text ("The branch is kept; only the worktree directory is removed.")
    ModalActions ("Delete worktree", Cancel focused by default)
```

## 5. Enforced files and folders

- `src/features/worktrees/WorktreesPanel.tsx` - panel composition, region registration, and the overlay entries for the two modals. Focus refresh lives in `useWorktrees.ts`.
- `src/features/worktrees/WorktreeRow.tsx` - one worktree row: branch or hash, markers, shortened path, selection marker.
- `src/features/worktrees/WorktreeDetails.tsx` - right-pane read-only summary for the selected worktree, driven by `RepositoryProvider.selection.kind === "worktree"`.
- `src/features/worktrees/NewWorktreeModal.tsx` - path prefill, branch mode, branch-name or existing-branch input, validation.
- `src/features/worktrees/DeleteWorktreeModal.tsx` - clean confirmation and the dirty or locked force confirmation.
- `src/features/worktrees/useWorktrees.ts` - reads the worktree snapshot, owns filter, cursor, selection repair, and draft state, dispatches commands.
- `src/features/worktrees/useWorktreeActions.ts` - registers `worktree.create`, `worktree.delete`, and `list.filter` with `scope: "worktrees"`, refuses an unavailable create or delete before opening a modal, and focuses the filter, composed by `useWorktrees.ts`.
- `src/features/worktrees/worktree.path.ts` - pure path derivation, parent lookup, and branch-to-directory sanitization extracted from the modal.
- `src/domain/git/git.worktrees.ts` - worktree reads, the branch map, validation, and command builders for add and remove.
- `src/domain/git/parsers/parse.worktrees.ts` - parses recorded `git worktree list --porcelain` output.
- Tests colocated: `src/domain/git/parsers/parse.worktrees.test.ts`, `src/domain/git/git.worktrees.test.ts`, `src/features/worktrees/WorktreesPanel.test.tsx`, `src/features/worktrees/WorktreeRow.test.tsx`, `src/features/worktrees/WorktreeDetails.test.tsx`, `src/features/worktrees/NewWorktreeModal.test.tsx`, `src/features/worktrees/DeleteWorktreeModal.test.tsx`, `src/features/worktrees/useWorktrees.test.tsx`, `src/features/worktrees/worktree.path.test.ts`, plus the shared `src/domain/commands/commands.availability.test.ts` matrix.

## 6. State model

Local view state (owned by `useWorktrees.ts` and the modals):

- Filter string for the worktree list.
- Cursor index for the `worktrees` region, stored through `useListCursor` and persisted per region by `FocusProvider`.
- Modal open flag and which worktree opened it, through `useOverlay`.
- New Worktree draft: the path string, the branch mode, the new branch name, and the selected existing branch.
- Delete Worktree draft: the force acknowledgement boolean.

Provider state (read, never recomputed here):

- `RepositoryProvider` snapshot: the worktree list, each entry carrying the absolute path, the HEAD object name, the checked-out branch ref or a detached flag, the bare flag, the locked flag and reason, the prunable flag and reason, and a cached dirty flag when it has been read; the current worktree path; the repository root and the home directory.
- `RepositoryProvider.selection`: the union that drives the right pane. `{ kind: "worktree", path }` renders `WorktreeDetails`; `{ kind: "pending" }` restores the composer; `{ kind: "commit", oid }` renders commit details. The feature never stores a second worktree selection.
- The worktree map from `@/domain/repository/repository.selectors.ts`, keyed by branch name, which F-03 reads for its checked-out marker and delete guard.
- `ConfigProvider`: `git.path`.
- `StatusProvider`: operation progress and transient status.
- `FocusProvider`: derived active region and the cursor map.
- `OverlayProvider`: modal stack and the error overlay.
- `ConsoleProvider`: the bounded command log entry written by every command.

Rules: this feature never recomputes the current worktree, the branch map, or path shortening. It reads them from `@/domain/git/git.worktrees.ts`, `@/domain/repository/repository.selectors.ts`, and `@/lib/paths.ts` (architecture section 9).

## 7. Data flow

Generic path (architecture section 9):

```text
key or click -> action ID -> useAction handler -> useCommandRunner.runCommand(request)
  -> command runner (availability + serialization) -> @/domain/git/git.worktrees.ts -> git CLI
  -> CommandResult -> useCommandRunner applies RepositoryProvider refresh, console entry, status, and error overlay
  -> WorktreesPanel re-render
```

| Action ID or refresh | Domain module | Git subcommand |
| --- | --- | --- |
| repository refresh (worktree list) | `git.worktrees.ts` `readWorktrees()` -> `parsers/parse.worktrees.ts` | `git worktree list --porcelain` |
| current worktree resolution | `git.worktrees.ts` `markCurrentWorktree()` (pure) | none; compares each path with the repository root |
| branch map for F-03 | `git.worktrees.ts` `buildWorktreeBranchMap()` (pure) | none |
| path shortening | `@/lib/paths.ts` `shortenPath()` (pure) | none; repository-relative or `~`-shortened home path |
| dirty marker (cheap, cached) | `git.worktrees.ts` `readWorktreeDirty(path)` -> `parsers/parse.status.ts` | `git -C <path> status --porcelain=v2 --branch -z --untracked-files=all` |
| `worktree.create` (new branch from HEAD) | `planAddWorktreeNewBranch()` -> `commands.worktrees.ts` `executeWorktreeCreate()` | `git worktree add -b <branch> <path> HEAD` |
| `worktree.create` (existing branch) | `planAddWorktreeExistingBranch()` -> `commands.worktrees.ts` `executeWorktreeCreate()` | `git worktree add <path> <branch>` |
| `worktree.delete` (clean) | `planRemoveWorktree()` -> `commands.worktrees.ts` `executeWorktreeDelete()` | `git worktree remove <path>` |
| `worktree.delete` (dirty, one force) | `planRemoveWorktree(path, { force: 1 })` -> `executeWorktreeDelete()` | `git worktree remove --force <path>` |
| `worktree.delete` (locked, two forces) | `planRemoveWorktree(path, { force: 2 })` -> `executeWorktreeDelete()` | `git worktree remove -f -f <path>` |
| create validation (branch name) | `NewWorktreeModal.tsx` `validateNewWorktree()` plus the shared `git.branches.ts` `isValidBranchName()` | none; both are pure and no git process runs while typing or submitting |
| create validation (branch exists and is free) | `NewWorktreeModal.tsx` against the snapshot branch list and worktree branch map | none; a branch checked out elsewhere or a duplicate new name is refused from the snapshot, and git remains the final authority at execution |
| `nav.activate` (details) | sets the `RepositoryProvider` selection to `{ kind: "worktree", path }` (the internal `worktree.select` semantics) | none; no git call |
| `list.filter` | local view state in `useWorktrees.ts` | none |

Command and handler model (architecture section 8.1):

- `useWorktreeActions.ts` registers `worktree.create`, `worktree.delete`, and `list.filter` with `scope: "worktrees"`, composed by `useWorktrees.ts`. Exactly one handler exists per `(actionId, scope)`. `useListCursor` owns the region's `nav.*` handlers. The feature never registers `app.refresh`, `focus.*`, or `overlay.close`; those are owned by the app, shell, or overlay host.
- Targets are explicit. `worktree.delete` uses `{ kind: "worktree", path }`. `worktree.create` always uses `{ kind: "none" }`; the path, the branch mode, and the branch name or selected existing branch travel in the form values (`path`, `mode`, `branch`). The path is the worktree identity; the row's branch or hash is display-only.
- `nav.activate` writes the internal `worktree.select` semantics by setting `RepositoryProvider.selection` to `{ kind: "worktree", path }`, so `AppShellHost` renders `WorktreeDetails`. `worktree.select` remains a command ID only: it has no action ID and no default key.
- Availability is target-aware through `@/domain/commands/commands.availability.ts`. `worktree.create` is unavailable in an empty repository with the reason "no commits yet", because there is no HEAD to branch from. `worktree.delete` is unavailable for the current worktree with the reason "current worktree" and for a missing target with "worktree no longer exists".

Validation rules in `NewWorktreeModal.tsx`: the path must be non-empty and must not be a snapshot-known path; the branch name must pass the shared domain `isValidBranchName()` git-ref rules; a new branch must not duplicate a local branch; and an existing branch must not already be checked out in another worktree. All of this is pure against the snapshot and none of it runs git. Two product checks are deliberately deferred and recorded in the M7 index: the parent directory's writability is not probed, and an arbitrary directory that exists on disk but is absent from the snapshot cannot be detected. Git rejects such a path at execution time instead of the form guessing, and no component touches the filesystem.

Delete semantics: `git worktree remove` removes the worktree directory and its administrative entry only. The branch ref is left untouched, so deleting a worktree never deletes its branch (F-07, F-18). The app computes the exact flag set from the reported state: no flag for a clean worktree, one `--force` for a dirty worktree, and two force flags (`-f -f`) for a locked worktree. A locked worktree also requires the stronger confirmation even when it is clean, because git rejects removal with a single force and exits 128. A worktree that is both locked and dirty uses the two-force form, which covers both conditions. The flags are chosen in `git.worktrees.ts` from `locked` and `dirty`, never from a user-supplied raw argument.

Repository switching: this feature never runs `cd` or changes the repository root. The app remains on the current repository after every worktree operation (D8). Enter only sets `RepositoryProvider.selection` for the right pane.

## 8. Keyboard and focus

| Action ID | Behavior in the Worktrees region |
| --- | --- |
| `nav.up`, `nav.down` | Move the cursor one worktree |
| `nav.activate` | Select the worktree in `RepositoryProvider.selection` and render read-only `WorktreeDetails`; never switches the repository |
| `worktree.create` | Open the New Worktree modal |
| `worktree.delete` | Open the Delete Worktree confirmation for the selected path |
| `list.filter` | Focus the worktree filter field |
| `focus.next`, `focus.previous` | Tab traversal (owned by `useFocusModel`) |
| `focus.region.worktrees` | Direct jump to this panel (default `5`), shell-owned |

Notes: `app.refresh` is a global action owned by the app or shell; it is not registered by this feature. `nav.first` and `nav.last` are unbound in the Worktrees context per product spec section 6, so `g` and `G` are not claimed here. Double click does not change the active repository (F-07); it only performs the row primary action, which is showing details, using the clicked row index so a double click before a render cannot target the previous cursor row. Modals are overlays and own all keys while open, with `overlay.close` cancelling. New Worktree has an explicit keyboard control cycle: `nav.up` and `nav.down` move through the path field, branch mode, the new-branch field or existing-branch picker, Cancel, and Create; `nav.activate` focuses the selected field or select, so typing and a select's native Up/Down and Enter stay native. Delete Worktree has its own cycle over the force checkbox when it is shown, Cancel, and Delete, with Left and Right between Cancel and Delete. Availability comes from `@/domain/commands/commands.availability.ts`, and the panel publishes the selected target's availability so the footer agrees.

## 9. Loading, empty, error, and disabled states

- Loading: `LoadingRow` with the text marker `[..]` and "loading worktrees" while the first read is in flight.
- Empty, no worktrees: `EmptyState` with "No worktrees" and the hint "n New worktree". A normal repository always has at least the main worktree, so this state is rare.
- Empty, filter matches nothing: `EmptyState` with "No worktrees match <filter>".
- Error: `ErrorState` with "Could not read worktrees" plus the git error text and a Retry button; the previous rows stay visible.
- Disabled, `worktree.delete` on the current worktree: unavailable with the reason "current worktree" (F-07).
- Disabled, `worktree.create` in an empty repository: unavailable with the reason "no commits yet", because there is no HEAD to branch from.
- Dirty or locked: the Delete confirmation requires the force checkbox before the confirm button becomes active, and the risk text names the state. Removing a dirty worktree uses one `--force`; removing a locked worktree uses `-f -f`.
- Right-pane `WorktreeDetails` empty or missing: production never rests on a missing selection, because `useWorktrees` repairs it to the nearest surviving path or `{ kind: "pending" }` when the selected path disappears. `WorktreeDetails` still renders "Worktree no longer exists" for a transient render before the repair lands.
- Right-pane `WorktreeDetails` loading: the summary renders from the selected snapshot; the dirty state is part of that snapshot and needs no separate loading state.
- Permission or filesystem error on delete: the git or filesystem error is shown, the row is kept, and no success is claimed (F-16).
- Operation in progress: the panel is read-only and a second mutation is blocked with the reason from the runner.

## 10. Performance and bounds

- Worktrees render inside a `<scrollbox>` with `viewportCulling`; a soft cap of 500 rendered rows applies, beyond which a notice row reports the truncation. Worktree counts are normally small.
- The worktree list read is cheap and runs on region focus, manual refresh, and after every mutation. It is never re-read on every render.
- Dirty-marker reads are bounded and part of the repository read. `git -C <path> status --porcelain=v2 --branch -z --untracked-files=all` runs per worktree with a maximum of four probes in flight; the current worktree and prunable worktrees are skipped. A failed probe leaves that worktree's dirty flag false and never fails the snapshot, so an unreadable worktree is not claimed dirty. The marker shows only a completed true read, matching "when cheaply available" (F-07). The `-z` form keeps rename pairs and unusual paths unambiguous.
- Row truncation uses `@/lib/text.ts` with a budget from `useTerminalDimensions`; the path drops before the branch name and the markers.
- Create and delete are single writes serialized by `commands.runner.ts`; the panel does not optimistically mutate the list.

## 11. Safety and confirmations

- The current worktree can never be deleted; the action is disabled with a reason and the delete modal does not open for it (F-07).
- A clean worktree requires one confirmation. The confirm label is "Delete worktree".
- A dirty or locked worktree requires a stronger confirmation that names the risk and requires the force checkbox before the confirm button activates. The exact flag set is one `--force` for dirty and `-f -f` for locked; the app never asks the user to type flags.
- Deleting a worktree never deletes its branch (F-07, F-18).
- Worktree operations never silently remove a directory: every removal goes through the modal, and a failure keeps the row and shows the error (F-07).
- The app never runs `git worktree prune`, `lock`, `unlock`, `move`, or `repair` in v1.
- The app never switches repositories in v1 (D8).
- Every command runs through `git.client.ts` with an argument array and no shell, so a worktree path can never be interpreted as shell syntax; credentials in remote URLs are redacted before any console or error rendering.

## 12. Acceptance mapping

| F-07 acceptance bullet | Implementing module or component |
| --- | --- |
| The current worktree is marked and cannot be deleted | `git.worktrees.ts` `markCurrentWorktree()`; `WorktreeRow.tsx` current marker; `commands.availability.ts` "current worktree" reason |
| Branches checked out in another worktree are marked in the Branches panel and cannot be deleted there | `git.worktrees.ts` `buildWorktreeBranchMap()` consumed by F-03 through `repository.selectors.ts` |
| Creating a worktree with a new branch makes that branch appear in the Branches panel with the worktree marker | `git.worktrees.ts` `planAddWorktreeNewBranch()` and `commands.worktrees.ts` `executeWorktreeCreate()`; the refresh rebuilds the branch map for F-03 |
| Worktree operations never silently remove a directory | `DeleteWorktreeModal.tsx` confirmation; `git.worktrees.ts` `planRemoveWorktree()` and `commands.worktrees.ts` `executeWorktreeDelete()`; failure keeps the row |
| A locked worktree requires two force flags and a dirty worktree requires one | `git.worktrees.ts` computes the flag set from `locked` and `dirty`; `DeleteWorktreeModal.tsx` requires the force acknowledgement |
| Enter shows worktree details without switching repositories | internal command `worktree.select` sets `RepositoryProvider.selection`; `WorktreeDetails.tsx`; no repository switch |
| Worktree creation is unavailable in an empty repository | `commands.availability.ts` returns "no commits yet"; `NewWorktreeModal.tsx` keeps the reason visible |
| Each row shows branch or detached hash, shortened path, current, locked, prunable, and dirty markers | `parse.worktrees.ts`; `@/lib/paths.ts` `shortenPath()`; `WorktreeRow.tsx` |
| Delete never deletes the branch | `git.worktrees.ts` `planRemoveWorktree()`; the branch-kept text in `DeleteWorktreeModal.tsx` |
| The app never switches repositories in v1 | `useWorktrees.ts`; `nav.activate` only sets a selection (D8) |

## 13. Tests to add

- `src/domain/git/parsers/parse.worktrees.test.ts`: parse recorded `git worktree list --porcelain` fixtures covering the main worktree, a linked worktree, a detached HEAD entry, a locked entry with a reason, a prunable entry with a reason, and a bare entry.
- `src/domain/git/git.worktrees.test.ts`: argument construction for `worktree add -b`, `worktree add` with an existing branch, `worktree remove` with no force, `--force` for a dirty worktree, and `-f -f` for a locked worktree; `markCurrentWorktree` and `buildWorktreeBranchMap`; `validateNewWorktree` for an existing path, an invalid branch name, and a branch checked out elsewhere; no spawning in unit tests.
- `src/domain/commands/commands.availability.test.ts` (shared): `worktree.create` returns "no commits yet" in an empty repository; `worktree.delete` returns "current worktree" for the current path and "worktree no longer exists" for a stale target.
- `src/lib/paths.test.ts` (shared): path shortening for a repository-relative path, a home-relative path, and an absolute path on macOS, Linux, and Windows separators.
- `src/features/worktrees/WorktreeRow.test.tsx`: branch versus detached short hash, current marker, locked, prunable, and dirty markers, and truncation behavior.
- `src/features/worktrees/WorktreeDetails.test.tsx`: renders only when `RepositoryProvider.selection.kind === "worktree"`, shows path, branch or detached hash, lock and prune reasons, and the read-only text, explains a missing selected path, and never switches the repository.
- `src/features/worktrees/WorktreesPanel.test.tsx`: `worktree.delete` disabled on the current worktree with the reason "current worktree"; the filter narrows the list and the no-match state; the read error keeps Retry; the truncation notice appears; a failed delete keeps the row; and the panel registers the worktree actions plus cursor navigation without `app.refresh`.
- `src/features/worktrees/useWorktrees.test.tsx`: the filter narrows the list, the selected worktree availability is published and cleared, the selection is repaired to the nearest surviving path or Pending Changes, and the region refresh runs on focus.
- `src/features/worktrees/NewWorktreeModal.test.tsx`: path prefill, the branch-mode switch, inline validation errors, an existing-branch picker that excludes branches checked out elsewhere, the empty-repository reason, the explicit control cycle, and the derived path staying in sync until the user edits it.
- `src/features/worktrees/DeleteWorktreeModal.test.tsx`: force is required for a dirty or locked worktree; the flag set is one `--force` for dirty and `-f -f` for locked; the branch-kept text is present; Cancel holds the default focus.
- `src/features/worktrees/worktree.path.test.ts`: sibling-path derivation, the empty base path, branch sanitization for slashes and unsafe characters, and the fallback directory name.

## 14. Open questions

- How to detect dirty cheaply. This doc reads `git -C <path> status --porcelain=v2 --branch -z --untracked-files=all` per worktree with a maximum of four probes in flight, skipping the current and prunable worktrees, and leaves a failed probe at `dirty: false`; confirm that policy and whether the marker should instead be omitted when the read is slow or the path is on a different filesystem.
- Whether the New Worktree modal should also offer a detached-HEAD start point. F-07 lists only new branch from HEAD and existing branch.
