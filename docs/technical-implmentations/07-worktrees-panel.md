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
| `useAction` | `useWorktrees.ts` registers the region-scoped handlers `worktree.create`, `worktree.delete`, `nav.activate`, and `list.filter` with `scope: "worktrees"` | One handler per `(actionId, scope)`; global actions such as `app.refresh` and `focus.*` are owned by the app or shell and are never registered here |
| `useListCursor` | `useWorktrees.ts` navigation and double click detection | Shared cursor and double click logic for custom rows |
| `useFocusRegion` | `WorktreesPanel.tsx` refreshes the worktree list when `focused` flips true | Region focus is derived from native focus; `useFocus` only reports terminal-window focus |
| `useTerminalDimensions` | `WorktreeRow.tsx` computes the path truncation budget | Budget-aware truncation through `@/lib/text.ts` |
| `useOverlay` | `WorktreesPanel.tsx` opens the New and Delete modals | Modal stack lives in `OverlayProvider` |
| `useRepository`, `useStatus` | `useWorktrees.ts` reads the snapshot and publishes status | Provider state is never copied locally |

`<scrollbox>` versus `<select>` decision: the worktree list uses a `<scrollbox>` of `<box>` rows because each row combines a branch or hash, an inline marker set, and a shortened path, which `<select>` cannot render (architecture section 6 rule 3). `<select>` is used only for the uniform branch-mode and existing-branch choices inside `NewWorktreeModal.tsx`.

All icons and markers used by this feature come from `src/theme/icons.ts`; see architecture section 6.1. No glyph literal is written in feature code.

## 4. Component tree

```text
WorktreesPanel
  Panel
    PanelHeader (title "Worktrees", count)
    SearchField (filter, focused by list.filter)
    ScrollableList (scrollbox, viewportCulling, scrollbar when overflowing)
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
  Panel
    PanelHeader (title "Worktree")
    text (branch name or detached short hash)
    text (full path and the shortened display path)
    text (HEAD short hash, current/locked/prunable/dirty state, and lock or prune reason)
    text ("Read-only. This panel never switches the active repository.")
```

Modals are pushed onto `OverlayProvider` (F-15), not nested in the panel:

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

- `src/features/worktrees/WorktreesPanel.tsx` - panel composition, region registration, action wiring, filter, focus refresh, modal opening.
- `src/features/worktrees/WorktreeRow.tsx` - one worktree row: branch or hash, markers, shortened path, selection marker.
- `src/features/worktrees/WorktreeDetails.tsx` - right-pane read-only summary for the selected worktree, driven by `RepositoryProvider.selection.kind === "worktree"`.
- `src/features/worktrees/NewWorktreeModal.tsx` - path prefill, branch mode, branch-name or existing-branch input, validation.
- `src/features/worktrees/DeleteWorktreeModal.tsx` - clean confirmation and the dirty or locked force confirmation.
- `src/features/worktrees/useWorktrees.ts` - reads the worktree snapshot, owns filter, cursor, and draft state, dispatches commands.
- `src/domain/git/git.worktrees.ts` - worktree reads, the branch map, validation, and command builders for add and remove.
- `src/domain/git/parsers/parse.worktrees.ts` - parses recorded `git worktree list --porcelain` output.
- Tests colocated: `src/domain/git/parsers/parse.worktrees.test.ts`, `src/domain/git/git.worktrees.test.ts`, `src/features/worktrees/WorktreesPanel.test.tsx`, `src/features/worktrees/WorktreeRow.test.tsx`, `src/features/worktrees/WorktreeDetails.test.tsx`, `src/features/worktrees/NewWorktreeModal.test.tsx`, `src/features/worktrees/DeleteWorktreeModal.test.tsx`, plus the shared `src/domain/commands/commands.availability.test.ts` matrix.

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
| repository refresh (worktree list) | `git.worktrees.ts` `listWorktrees()` -> `parsers/parse.worktrees.ts` | `git worktree list --porcelain` |
| current worktree resolution | `git.worktrees.ts` `markCurrentWorktree()` (pure) | none; compares each path with the repository root |
| branch map for F-03 | `git.worktrees.ts` `buildWorktreeBranchMap()` (pure) | none |
| path shortening | `@/lib/paths.ts` `shortenPath()` (pure) | none; repository-relative or `~`-shortened home path |
| dirty marker (cheap, cached) | `git.worktrees.ts` `readWorktreeDirty(path)` -> `parsers/parse.status.ts` | `git -C <path> status --porcelain=v2 --branch -z --untracked-files=all` |
| `worktree.create` (new branch from HEAD) | `git.worktrees.ts` `addWorktreeWithNewBranch()` | `git worktree add -b <branch> <path> HEAD` |
| `worktree.create` (existing branch) | `git.worktrees.ts` `addWorktreeWithExistingBranch()` | `git worktree add <path> <branch>` |
| `worktree.delete` (clean) | `git.worktrees.ts` `removeWorktree()` | `git worktree remove <path>` |
| `worktree.delete` (dirty, one force) | `git.worktrees.ts` `removeWorktree({ force: 1 })` | `git worktree remove --force <path>` |
| `worktree.delete` (locked, two forces) | `git.worktrees.ts` `removeWorktree({ force: 2 })` | `git worktree remove -f -f <path>` |
| create validation (branch name) | `git.worktrees.ts` `validateNewWorktree()` (pure) plus a format check | `git check-ref-format --branch <name>` |
| create validation (branch exists) | `git.worktrees.ts` `validateNewWorktree()` (pure) | `git rev-parse --verify refs/heads/<branch>` |
| `nav.activate` (details) | internal command `worktree.select` sets `RepositoryProvider.selection` to `{ kind: "worktree", path }` | none; no git call |
| `list.filter` | local view state in `useWorktrees.ts` | none |

Command and handler model (architecture section 8.1):

- `useWorktrees.ts` registers `worktree.create`, `worktree.delete`, `nav.activate`, and `list.filter` with `scope: "worktrees"`. Exactly one handler exists per `(actionId, scope)`. The feature never registers `app.refresh`, `focus.*`, or `overlay.close`; those are owned by the app, shell, or overlay host.
- Targets are explicit. `worktree.delete` uses `{ kind: "worktree", path }`. `worktree.create` uses `{ kind: "form", formId: "new-worktree" }` while the modal is open and `{ kind: "none" }` for the initial open. The path is the worktree identity; the row's branch or hash is display-only.
- `nav.activate` dispatches the internal command `worktree.select`. `worktree.select` is a command ID only: it has no action ID, no default key, and it sets `RepositoryProvider.selection` so `AppShellHost` renders `WorktreeDetails`.
- Availability is target-aware through `@/domain/commands/commands.availability.ts`. `worktree.create` is unavailable in an empty repository with the reason "no commits yet", because there is no HEAD to branch from. `worktree.delete` is unavailable for the current worktree with the reason "current worktree" and for a missing target with "worktree no longer exists".

Validation rules in `validateNewWorktree()`: the path must be non-empty and must not exist; the branch name must be a valid ref; the branch must not already be checked out in another worktree; the parent directory must be writable. The first three are pure against the snapshot; the writability and existence checks run through `git.client.ts` (the only spawn point) or a bounded filesystem check in the domain layer, never in a component.

Delete semantics: `git worktree remove` removes the worktree directory and its administrative entry only. The branch ref is left untouched, so deleting a worktree never deletes its branch (F-07, F-18). The app computes the exact flag set from the reported state: no flag for a clean worktree, one `--force` for a dirty worktree, and two force flags (`-f -f`) for a locked worktree. A locked worktree also requires the stronger confirmation even when it is clean, because git rejects removal with a single force and exits 128. A worktree that is both locked and dirty uses the two-force form, which covers both conditions. The flags are chosen in `git.worktrees.ts` from `locked` and `dirty`, never from a user-supplied raw argument.

Repository switching: this feature never runs `cd` or changes the repository root. The app remains on the current repository after every worktree operation (D8). Enter only sets `RepositoryProvider.selection` for the right pane.

## 8. Keyboard and focus

| Action ID | Behavior in the Worktrees region |
| --- | --- |
| `nav.up`, `nav.down` | Move the cursor one worktree |
| `nav.pageUp`, `nav.pageDown` | Move by a screen |
| `nav.activate` | Select the worktree in `RepositoryProvider.selection` and render read-only `WorktreeDetails`; never switches the repository |
| `worktree.create` | Open the New Worktree modal |
| `worktree.delete` | Open the Delete Worktree confirmation for the selected path |
| `list.filter` | Focus the worktree filter field |
| `focus.next`, `focus.previous` | Tab traversal (owned by `useFocusModel`) |
| `focus.region.worktrees` | Direct jump to this panel (default `5`), shell-owned |

Notes: `app.refresh` is a global action owned by the app or shell; it is not registered by this feature. `nav.first` and `nav.last` are unbound in the Worktrees context per product spec section 6, so `g` and `G` are not claimed here. Double click does not change the active repository (F-07); it only performs the row primary action, which is showing details. Modals are overlays and own all keys while open, with `overlay.close` cancelling. Availability comes from `@/domain/commands/commands.availability.ts` so the footer, help, and palette agree.

## 9. Loading, empty, error, and disabled states

- Loading: `LoadingRow` with the text marker `[..]` and "loading worktrees" while the first read is in flight.
- Empty, no worktrees: `EmptyState` with "No worktrees" and the hint "n New worktree". A normal repository always has at least the main worktree, so this state is rare.
- Empty, filter matches nothing: `EmptyState` with "No worktrees match <filter>".
- Error: `ErrorState` with "Could not read worktrees" plus the git error text and a Retry button; the previous rows stay visible.
- Disabled, `worktree.delete` on the current worktree: unavailable with the reason "current worktree" (F-07).
- Disabled, `worktree.create` in an empty repository: unavailable with the reason "no commits yet", because there is no HEAD to branch from.
- Dirty or locked: the Delete confirmation requires the force checkbox before the confirm button becomes active, and the risk text names the state. Removing a dirty worktree uses one `--force`; removing a locked worktree uses `-f -f`.
- Right-pane `WorktreeDetails` empty or missing: when the selected path disappears, the pane shows "Worktree no longer exists" and the selection falls back to the nearest row.
- Right-pane `WorktreeDetails` loading: the summary renders from the selected snapshot; dirty state that is still being read shows "checking..." without blocking the rest of the details.
- Permission or filesystem error on delete: the git or filesystem error is shown, the row is kept, and no success is claimed (F-16).
- Operation in progress: the panel is read-only and a second mutation is blocked with the reason from the runner.

## 10. Performance and bounds

- Worktrees render inside a `<scrollbox>` with `viewportCulling`; a soft cap of 500 rendered rows applies, beyond which a notice row reports the truncation. Worktree counts are normally small.
- The worktree list read is cheap and runs on region focus, manual refresh, and after every mutation. It is never re-read on every render.
- Dirty-marker reads are opt-in and bounded. `git -C <path> status --porcelain=v2 --branch -z --untracked-files=all` runs per worktree with bounded concurrency and a last-checked timestamp, and is skipped for a missing or prunable path. The marker shows only when the read has completed, matching "when cheaply available" (F-07). The `-z` form keeps rename pairs and unusual paths unambiguous.
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
| Creating a worktree with a new branch makes that branch appear in the Branches panel with the worktree marker | `git.worktrees.ts` `addWorktreeWithNewBranch()`; the refresh rebuilds the branch map for F-03 |
| Worktree operations never silently remove a directory | `DeleteWorktreeModal.tsx` confirmation; `git.worktrees.ts` `removeWorktree()`; failure keeps the row |
| A locked worktree requires two force flags and a dirty worktree requires one | `git.worktrees.ts` computes the flag set from `locked` and `dirty`; `DeleteWorktreeModal.tsx` requires the force acknowledgement |
| Enter shows worktree details without switching repositories | internal command `worktree.select` sets `RepositoryProvider.selection`; `WorktreeDetails.tsx`; no repository switch |
| Worktree creation is unavailable in an empty repository | `commands.availability.ts` returns "no commits yet"; `NewWorktreeModal.tsx` keeps the reason visible |
| Each row shows branch or detached hash, shortened path, current, locked, prunable, and dirty markers | `parse.worktrees.ts`; `@/lib/paths.ts` `shortenPath()`; `WorktreeRow.tsx` |
| Delete never deletes the branch | `git.worktrees.ts` `removeWorktree()`; the branch-kept text in `DeleteWorktreeModal.tsx` |
| The app never switches repositories in v1 | `useWorktrees.ts`; `nav.activate` only sets a selection (D8) |

## 13. Tests to add

- `src/domain/git/parsers/parse.worktrees.test.ts`: parse recorded `git worktree list --porcelain` fixtures covering the main worktree, a linked worktree, a detached HEAD entry, a locked entry with a reason, a prunable entry with a reason, and a bare entry.
- `src/domain/git/git.worktrees.test.ts`: argument construction for `worktree add -b`, `worktree add` with an existing branch, `worktree remove` with no force, `--force` for a dirty worktree, and `-f -f` for a locked worktree; `markCurrentWorktree` and `buildWorktreeBranchMap`; `validateNewWorktree` for an existing path, an invalid branch name, and a branch checked out elsewhere; no spawning in unit tests.
- `src/domain/commands/commands.availability.test.ts` (shared): `worktree.create` returns "no commits yet" in an empty repository; `worktree.delete` returns "current worktree" for the current path and "worktree no longer exists" for a stale target.
- `src/lib/paths.test.ts` (shared): path shortening for a repository-relative path, a home-relative path, and an absolute path on macOS, Linux, and Windows separators.
- `src/features/worktrees/WorktreeRow.test.tsx`: branch versus detached short hash, current marker, locked, prunable, and dirty markers, and truncation behavior.
- `src/features/worktrees/WorktreeDetails.test.tsx`: renders only when `RepositoryProvider.selection.kind === "worktree"`, shows path, branch or detached hash, lock and prune reasons, and the read-only text; never switches the repository.
- `src/features/worktrees/WorktreesPanel.test.tsx`: `worktree.delete` disabled on the current worktree with the reason "current worktree"; the filter narrows the list; a failed delete keeps the row; exactly one handler per `(actionId, worktrees)` with no `app.refresh` registration.
- `src/features/worktrees/NewWorktreeModal.test.tsx`: path prefill, the branch-mode switch, inline validation errors, an existing-branch picker that excludes branches checked out elsewhere, and the empty-repository reason.
- `src/features/worktrees/DeleteWorktreeModal.test.tsx`: force is required for a dirty or locked worktree; the flag set is one `--force` for dirty and `-f -f` for locked; the branch-kept text is present; Cancel holds the default focus.

## 14. Open questions

- How to detect dirty cheaply. This doc reads `git -C <path> status --porcelain=v2 --branch -z --untracked-files=all` per worktree with bounded concurrency and caching; confirm that policy and whether the marker should be omitted when the read is slow or the path is on a different filesystem.
- Whether the existing-branch picker lists only local branches not checked out elsewhere, or also remote branches. F-07 says an existing branch not already checked out elsewhere; this doc uses local branches only.
- Whether to offer `git worktree prune` for prunable entries in v1. The spec lists prunable as a state to show but defers pruning.
- The path prefill rule. This doc prefills a sibling directory named after the branch under the repository parent; confirm the base directory and the sanitization of branch names for filesystem paths.
- Whether the New Worktree modal should also offer a detached-HEAD start point. F-07 lists only new branch from HEAD and existing branch.
