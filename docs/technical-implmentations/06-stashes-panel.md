# 06 Stashes Panel

## 1. Header

- Spec reference: `docs/product-spec.md` F-06 (lines 507-561), decision D7 (line 1875), action IDs (lines 1705-1742), key precedence (lines 113-123), config key `stash.includeUntrackedByDefault` (line 1203), stash flow (lines 1796-1802)
- Architecture contract: `docs/technical-implmentations/00-project-architecture.md`
- Region id: `stashes` (`src/features/shell/regions.ts`)
- Dependencies: F-01 (shell, focus, region order), F-08 (selection of the Pending Changes row versus a stash), F-09 (the composer area that the stash summary replaces), F-10 (the commit details area that the stash summary also replaces), F-11 (the read-only stash diff rendered by the Diff panel), F-15 (modal structure and destructive confirmations), F-16 (repository states), F-17 (freshness and refresh), F-18 (safety), F-19 (`stash.includeUntrackedByDefault`).
- Owned paths:
  - `src/features/stashes/StashesPanel.tsx`
  - `src/features/stashes/StashRow.tsx`
  - `src/features/stashes/StashDetails.tsx`
  - `src/features/stashes/CreateStashModal.tsx`
  - `src/features/stashes/DeleteStashModal.tsx`
  - `src/features/stashes/useStashes.ts`
  - `src/domain/git/git.stashes.ts`
- Co-owned paths: `src/domain/git/parsers/parse.stash.ts` owns stash-list parsing; `src/domain/repository/repository.selectors.ts` owns the merged selection and pending-count state that this panel reads.

## 2. Scope and non-goals

Scope: newest-first stash list; each row shows the stash index, the truncated message, the source branch when git records it, and the relative age; the immutable stash object name is the identity of every row and action; Create Stash modal with a required prefilled message and an Include untracked files checkbox whose default comes from `stash.includeUntrackedByDefault`; Apply without confirmation; Pop with a confirmation that drops the stash only after a successful apply; Delete with a confirmation that names the stash message; Enter selects the stash in `RepositoryProvider.selection`, renders the read-only `StashDetails` in the right pane, and shows the stash diff; conflict failures keep the stash; the `p` key resolves to Pop while the Stashes panel is focused.

Non-goals: editing or renaming a stash; partial stash of selected paths (`git stash push -- <paths>`); stash of only the index (`--staged`); `git stash branch`; applying only untracked content; dropping more than one stash at a time; stash browsing across worktrees; a full-screen stash details screen. The right-pane `StashDetails` summary plus the read-only diff is the v1 surface.

## 3. OpenTUI components used

| Component | Where used | Why it is right |
| --- | --- | --- |
| `<box>` | Panel frame, every stash row, modal layout, modal footer | The only layout primitive; rows combine an index, a message, a branch, and an age |
| `<text>` | Stash index, message, source branch, relative age, empty and error text | Every UI string is rendered through `<text>` |
| `<span>` | Inline index badge, source branch run, and relative age run inside one `<text>` | Inline styled runs inside a single `<text>` |
| `<scrollbox>` | The stash list container, with `viewportCulling` and a scrollbar when the list overflows | Scrollable region; the list is unbounded in principle |
| `<input>` | Message field in the Create Stash modal, through `FormField` | Single-line field; a stash message is one line |
| `<select>` | Not used; documented for completeness | Rows need custom content, so `<scrollbox>` of `<box>` rows is required (section 6 rule 3) |
| `<diff>` | Not rendered here; the read-only stash diff is rendered by F-11 `DiffPanel` | Architecture section 6 rule 5 assigns all diffs to `<diff>` |
| `Checkbox` primitive | Include untracked files in the Create Stash modal (`<box>` + `<text>` marker) | Toggle with `[x]`/`[ ]`, keyboard and mouse |
| Right-pane `StashDetails` composition | `src/features/stashes/StashDetails.tsx`, rendered by `AppShellHost` when `RepositoryProvider.selection.kind === "stash"` | Uses `Panel`, `<text>`, and `<span>` for a read-only summary; no diff content is duplicated here |

Hooks used:

| Hook | Where used | Why |
| --- | --- | --- |
| `useKeyboard` | Only inside `src/app/hooks/useHotkeys.ts` | Central dispatcher; this feature never calls it directly |
| `useAction` | `useStashCreateCommand.ts` registers `stash.create` and `useStashRowCommands.ts` registers `stash.apply`, `stash.pop`, and `stash.delete`, all with `scope: "stashes"`; `useStashes.ts` composes both hooks and owns rows, cursor, and selection state; `useListCursor` registers `nav.up`, `nav.down`, and `nav.activate` in the same scope | One handler per `(actionId, scope)`; global actions such as `app.refresh` and `focus.*` are owned by the app or shell and are never registered here |
| `useListCursor` | `useStashes.ts` navigation through `useStashSelection.ts`, and double click detection | Shared cursor and double click logic for custom rows |
| `useFocusRegion` | `useStashes.ts` refreshes the stash list when `focused` flips true | Region focus is derived from native focus; `useFocus` only reports terminal-window focus |
| `useTerminalDimensions` | `StashRow.tsx` computes the message truncation budget | Budget-aware truncation through `@/lib/text.ts` |
| `useOverlay` | `useStashCreateCommand.ts` opens the Create Stash modal and `useStashRowCommands.ts` opens the Pop and Delete modals | Modal stack lives in `OverlayProvider` |
| `useConfig` | `useStashCreateCommand.ts` reads `stash.includeUntrackedByDefault` for the Create Stash checkbox default | Config is the single source of the checkbox default |
| `useRepository`, `useStatus` | `useStashes.ts` reads the snapshot and publishes status | Provider state is never copied locally |

All icons and markers used by this feature come from `src/theme/icons.ts`; see architecture section 6.1. No glyph literal is written in feature code.

## 4. Component tree

```text
StashesPanel (body only; SidebarPanelFrame owns the Panel, border title, and scrollbox)
  StashRow (one per stash, newest first)
    ListRow (box)
      TextMarker (selection marker ">")
      text (index, for example stash@{0})
        span (source branch, when git records it)
        span (relative age)
      text (message, truncated)
  LoadingRow (while the first read is in flight)
  EmptyState (no stashes)
  ErrorState (read failed, with Retry)
```

The right pane is composed by `AppShellHost` from `RepositoryProvider.selection` (architecture section 9). A stash selection renders `StashDetails` instead of the composer or commit details:

```text
StashDetails (when selection.kind === "stash")
  Panel (title "Stash <message>")
    text (source branch, relative age, and short object name)
    text ("Read-only. The stash diff is shown in the Diff panel.")
```

The body has no title or count row: the shell border title carries `Stashes (<count>)`. Modals are pushed onto `OverlayProvider` (F-15), not nested in the panel:

```text
CreateStashModal
  ModalFrame
    text (explains that the message identifies the stash)
    FormField (message input, required, prefilled)
    Checkbox ("Include untracked files", default from stash.includeUntrackedByDefault)
    ModalActions (Create stash, Cancel)

DeleteStashModal
  ModalFrame
    text (stash index and message)
    text (consequence: drops the stash, keeps no copy)
    ModalActions ("Drop stash", Cancel focused by default)
```

The Pop confirmation uses the shared `ConfirmModal` from `src/features/overlays/` (F-15) with the title "Pop stash", the index and message named, and the confirm label "Drop stash", because Pop drops the stash after a successful apply.

## 5. Enforced files and folders

- `src/features/stashes/StashesPanel.tsx` - panel composition and region registration. The modal openers and the focus refresh live in the stash hooks (`useStashCreateCommand.ts`, `useStashRowCommands.ts`, `useStashes.ts`).
- `src/features/stashes/StashRow.tsx` - one stash row: index, message, source branch, relative age, selection marker.
- `src/features/stashes/StashDetails.tsx` - right-pane read-only summary for the selected stash, driven by `RepositoryProvider.selection.kind === "stash"`.
- `src/features/stashes/CreateStashModal.tsx` - required message, prefill, include-untracked checkbox, validation.
- `src/features/stashes/DeleteStashModal.tsx` - destructive confirmation that names the stash message.
- `src/features/stashes/useStashes.ts` - reads the stash snapshot, owns cursor, selection repair, and draft state, dispatches commands.
- `src/features/stashes/stash.prefill.ts` - pure message prefill and display-message helpers.
- `src/features/stashes/stash.resolve.ts` - pure resolution of the just-created stash from the refreshed list.
- `src/features/stashes/stash.age.ts` - pure relative-age formatter used until `@/lib/time.ts` lands.
- `src/domain/git/git.stashes.ts` - stash reads, ordering, and command builders for push, apply, pop, and drop.
- `src/domain/git/parsers/parse.stash.ts` - parses recorded `git stash list` output, including the source branch.
- Tests colocated: `src/domain/git/parsers/parse.stash.test.ts`, `src/domain/git/git.stashes.test.ts`, `src/features/stashes/StashesPanel.test.tsx`, `src/features/stashes/StashRow.test.tsx`, `src/features/stashes/StashDetails.test.tsx`, `src/features/stashes/CreateStashModal.test.tsx`, `src/features/stashes/DeleteStashModal.test.tsx`, `src/features/stashes/useStashes.test.tsx`, `src/features/stashes/stash.prefill.test.ts`, `src/features/stashes/stash.resolve.test.ts`, `src/features/stashes/stash.age.test.ts`, plus the shared `src/domain/commands/commands.availability.test.ts` matrix.

## 6. State model

Local view state (owned by `useStashes.ts` and the modals):

- Cursor index for the `stashes` region, stored through `useListCursor` and persisted per region by `FocusProvider`.
- Modal open flag and the selected stash object name that opened it, through `useOverlay`.
- Create Stash draft: the message string and the include-untracked boolean, initialized from config.

Provider state (read, never recomputed here):

- `RepositoryProvider` snapshot: the stash list, newest first, each entry carrying the display index (`stash@{n}`), the immutable object name (`%H`), the raw subject, the source branch when parsed, and the commit timestamp. The object name is the row identity and the target of every action; the index is display-only and may change after an external stash operation.
- `RepositoryProvider.selection`: the union that drives the right pane. `{ kind: "stash", objectName }` renders `StashDetails`; `{ kind: "pending" }` restores the composer; `{ kind: "commit", oid }` renders commit details. The feature never stores a second selection.
- `ConfigProvider`: `stash.includeUntrackedByDefault` and `git.path`.
- `StatusProvider`: operation progress and transient status.
- `FocusProvider`: derived active region and the cursor map.
- `OverlayProvider`: modal stack and the error overlay.
- `ConsoleProvider`: the bounded command log entry written by every command.

Rules: this feature never recomputes ordering or source branch. The row identity is always the immutable object name, never `stash@{n}`. Ordering comes from `git.stashes.ts`. `@/lib/time.ts` is still a planned shared module, so M7 keeps the pure `formatStashAge` helper in `stash.age.ts`; it moves to `@/lib/time.ts` when that module lands. `stash.prefill.ts` owns the message prefill and `stash.resolve.ts` owns created-stash resolution so the hook stays panel state only.

## 7. Data flow

Generic path (architecture section 9):

```text
key or click -> action ID -> useAction handler -> useCommandRunner.runCommand(request)
  -> command runner (availability + serialization) -> @/domain/git/git.stashes.ts -> git CLI
  -> CommandResult -> useCommandRunner applies RepositoryProvider refresh, console entry, status, and error overlay
  -> StashesPanel re-render
```

| Action ID or refresh | Domain module | Git subcommand |
| --- | --- | --- |
| repository refresh (stash list) | `git.stashes.ts` `readStashes()` -> `parsers/parse.stash.ts` `parseStashes()` | `git stash list --format=%gd%x00%H%x00%gs%x00%ct` |
| working tree and index state for create availability | `git.status.ts` -> `parsers/parse.status.ts` | `git status --porcelain=v2 --branch -z --untracked-files=all` |
| source branch extraction | `git.stashes.ts` `parseSourceBranch()` (pure) | none; reads the `WIP on <branch>:` or `On <branch>:` prefix of the subject |
| newest-first ordering | `git.stashes.ts` `sortStashesNewestFirst()` (pure) | none; orders by ascending index because `stash@{0}` is newest |
| `stash.create` (tracked only) | `planCreateStash()` -> `commands.stashes.ts` `executeStashCreate()` | `git stash push -m <message>` |
| `stash.create` (include untracked) | `planCreateStash()` with untracked -> `executeStashCreate()` | `git stash push -u -m <message>` |
| `stash.apply` | `planApplyStash()` after `resolveStashRef()` -> `executeStashApply()` | `git stash apply <current-index>` |
| `stash.pop` | `planPopStash()` after `resolveStashRef()` -> `executeStashPop()` | `git stash pop <current-index>` |
| `stash.delete` | `planDropStash()` after `resolveStashRef()` -> `executeStashDelete()` | `git stash drop <current-index>` |
| `nav.activate` (show stash diff) | deferred to F-11; `git.stashes.ts` `buildShowStashArgs()` is ready | `git stash show -p --no-color <current-index>` |
| `nav.activate` (selection) | sets the `RepositoryProvider` selection to `{ kind: "stash", objectName }` (the internal `stash.select` semantics) | none; no git call |

Command and handler model (architecture section 8.1):

- `useStashCreateCommand.ts` registers `stash.create` and `useStashRowCommands.ts` registers `stash.apply`, `stash.pop`, and `stash.delete`, all with `scope: "stashes"`, composed by `useStashes.ts`. Exactly one handler exists per `(actionId, scope)`. `useListCursor` owns the region's `nav.*` handlers. The feature never registers `app.refresh`, `focus.*`, or `overlay.close`; those are owned by the app, shell, or overlay host.
- Targets are explicit. `stash.apply`, `stash.pop`, and `stash.delete` use `{ kind: "stash", objectName }` for the selected row. `stash.create` always uses `{ kind: "none" }`; the initial modal open carries no target, and while the modal is open the draft travels in the form values as `message` and `includeUntracked` (the exact strings `"true"` or `"false"`).
- `nav.activate` sets the internal `stash.select` semantics by writing `RepositoryProvider.selection` to `{ kind: "stash", objectName }`, so `AppShellHost` renders `StashDetails` and F-11 can read the stash diff. `stash.select` remains a command ID only: it has no action ID and no default key.

Stash identity and action-time resolution: a row keeps the immutable object name from `%H`. Every apply, pop, drop, and stash-diff read resolves that object name against a fresh `git stash list` at action time. `git.stashes.ts` `resolveStashRef(objectName)` returns the current `stash@{n}` for the matching object name, or `{ status: "missing" }` when the stash no longer exists. The action aborts before any mutation when the object name is missing or when the current index at the resolved position holds a different object, and reports "stash changed externally; list refreshed" while refreshing the list. The app never reuses the index captured when the row was selected, so an external `git stash push` or `git stash drop` can never make Pop or Delete hit a different stash.

Create Stash prefill: `stash.prefill.ts` `buildStashMessagePrefill()` reads only snapshot facts. An attached HEAD produces exactly `WIP on <branch>: <short hash> <subject>` from `branch`, `headOid`, and `headSubject`, and drops the subject when it was not read. A detached HEAD produces `WIP at <short hash> <subject>`; an unborn HEAD keeps the branch-based `WIP at` fallback; and `WIP` alone is returned before the first snapshot. The modal starts from that string, and the user can edit it before submission.

Create Stash selection: after a successful `stash.create`, `useStashes` waits for the snapshot identity to change, resolves the created row with `stash.resolve.ts` `resolveCreatedStash()` (newest row matching the submitted message, with a newest-row fallback for a different git subject shape), moves the cursor to that row, and writes `RepositoryProvider.selection` to its immutable object name. An empty refreshed list leaves the selection untouched.

Create Stash availability: `commands.availability.ts` delegates to the pure `getStashCreateAvailability(status, includeUntracked)` in `git.stashes.ts`. It returns "no commits yet" in an empty repository, "nothing to stash" when there are no staged, unstaged, or untracked changes, and "only untracked changes; include untracked files to stash" when the only changes are untracked and Include untracked files is off. The panel's `stash.create` handler still opens the modal, because the checkbox is the remedy; the modal's Create stash confirm is the target-aware `stash.create` invocation and is disabled with the live reason until the checkbox is on. The palette's Create stash entry shows the same reason for the config default when it would open the modal with the checkbox off. This prevents the case where `git stash push` exits successfully without creating a stash while keeping the checkbox reachable.

`p` precedence: `stash.pop` and the global `remote.pull` both default to `p`. `src/domain/keymap/keymap.resolve.ts` resolves the focused-region context before global actions (architecture section 8; product spec lines 113-123), so while the `stashes` region is focused the effective action is `stash.pop` and `remote.pull` does not fire. The footer shows only Pop, and `src/domain/keymap/keymap.describe.ts` renders the context action.

Pop drop semantics: the app resolves the selected object name to the current `stash@{n}` and runs `git stash pop <current-index>`, which applies the stash and drops it only when the apply succeeds. On a conflict, git leaves the stash in place; the app reads that outcome from the command result and does not issue a separate drop. The app never issues `git stash drop` after a failed apply.

## 8. Keyboard and focus

| Action ID | Behavior in the Stashes region |
| --- | --- |
| `nav.up`, `nav.down` | Move the cursor one stash |
| `nav.activate` | Select the stash in `RepositoryProvider.selection`, render `StashDetails` in the right pane, and show the read-only stash diff in the Diff panel |
| `stash.create` | Open the Create Stash modal |
| `stash.apply` | Apply the selected stash and keep it; no confirmation |
| `stash.pop` | Open the Pop stash confirmation, then apply and drop on success; this ID overrides `remote.pull` while Stashes is focused |
| `stash.delete` | Open the Delete Stash confirmation |
| `focus.next`, `focus.previous` | Tab traversal (owned by `useFocusModel`) |
| `focus.region.stashes` | Direct jump to this panel (default `4`), shell-owned |

Notes: `app.refresh` is a global action owned by the app or shell; it is not registered by this feature. `nav.first` and `nav.last` are unbound in the Stashes context per spec section 6, so `g` and `G` are not claimed here. The footer shows Apply, Pop, Delete, and Stash (F-06). Modals are overlays and own all keys while open, with `overlay.close` cancelling. Availability comes from `@/domain/commands/commands.availability.ts` so the footer, help, and palette agree. Row identity in every handler is the object name, and the handler resolves it to the current index immediately before it runs a git command.

## 9. Loading, empty, error, and disabled states

- Loading: `LoadingRow` with the text marker `[..]` and "loading stashes" while the first read is in flight.
- Empty, no stashes: `EmptyState` with "No stashes" and the hint "s Stash changes".
- Error: `ErrorState` with "Could not read stashes" plus the git error text and a Retry button; the previous rows stay visible.
- Disabled, `stash.create`: unavailable with the reason "nothing to stash" when the working tree and index have no changes. The reason is computed from the status snapshot in `commands.availability.ts`.
- Disabled, the Create stash confirm and `stash.create` command with only untracked changes and Include untracked files off: unavailable with the reason "only untracked changes; include untracked files to stash", because `git stash push` otherwise exits successfully without creating a stash. The modal stays open and re-evaluates the reason when the checkbox changes.
- Disabled, `stash.create` in an empty repository: unavailable with the reason "no commits yet" (F-16).
- Disabled, `stash.apply`, `stash.pop`, `stash.delete`: unavailable with the reason "no stash selected" when the list is empty.
- Stale target: when the selected object name no longer resolves to a current stash index, the action aborts without a git mutation and shows "stash changed externally; list refreshed". The list and `StashDetails` refresh; selection repair moves the right-pane selection to the nearest surviving row at the last known position, or to `{ kind: "pending" }` when no row survives.
- Conflict, apply or pop: a persistent error overlay with the git output, the stash kept, and no silent discard. The console records the command and output.
- Right-pane `StashDetails` loading: the summary renders from the selected snapshot; the stash diff loads in F-11 with its own loading and error states.
- Right-pane `StashDetails` error: the pane can still render "Stash no longer exists" for a transient render, but `useStashes` repairs the selection to the nearest surviving row or Pending Changes after the snapshot changes, so the missing state is not the resting state.
- Operation in progress: the panel is read-only and a second mutation is blocked with the reason from the runner.
- Detached HEAD: stash creation stays available; the prefill uses the short hash in place of the branch name.

## 10. Performance and bounds

- Stashes render inside a `<scrollbox>` with `viewportCulling`; a soft cap of 2000 rendered rows applies, beyond which a notice row reports the truncation.
- The stash list read is cheap and runs on region focus, manual refresh, and after every mutation. It is never re-read on every render.
- Action-time index resolution reuses the fresh stash list from the refresh cycle when it is current; otherwise it performs one bounded `git stash list` read immediately before the mutation. Only one resolution is in flight per action. A resolution failure aborts the action instead of guessing an index.
- The stash diff is a read-only read that runs on `nav.activate`, not for every row. Only one stash diff read is in flight; a stale result is discarded by a generation token.
- Row truncation uses `@/lib/text.ts` with a budget from `useTerminalDimensions`; the message drops before the index and the age.
- Create, apply, pop, and delete are single writes serialized by `commands.runner.ts`; the panel does not optimistically mutate the list.

## 11. Safety and confirmations

- Apply requires no confirmation because it keeps the stash (F-06).
- Pop requires an explicit confirmation that names the stash message and the current index; the confirm label is "Drop stash". The stash is dropped only when the apply succeeds.
- Delete requires an explicit confirmation that names the stash message; the modal opens with Cancel focused.
- Pop and Delete resolve the immutable object name to the current index at action time and abort with "stash changed externally; list refreshed" when it no longer resolves. They never run against a different stash after an external `git stash push` or `git stash drop`.
- Deleting a stash never deletes reachable commits as a side effect (F-18).
- Navigation never triggers a destructive action; there is no automatic stash, reset, checkout, or clean (F-18).
- Failures preserve the stash, the draft message, and the current selection.
- Every command runs through `git.client.ts` with an argument array and no shell, so a stash message can never be interpreted as shell syntax; credentials in remote URLs are redacted before any console or error rendering.

## 12. Acceptance mapping

| F-06 acceptance bullet | Implementing module or component |
| --- | --- |
| Stash creation uses the entered message and optional untracked behavior | `CreateStashModal.tsx` message field and checkbox; `git.stashes.ts` `planCreateStash()` and `commands.stashes.ts` `executeStashCreate()` |
| Pop with confirmation drops the stash only after a successful apply | Pop confirmation through `ConfirmModal`; `git.stashes.ts` `planPopStash()` and `commands.stashes.ts` `executeStashPop()`; drop semantics in section 7 |
| Apply, pop, and delete failures preserve the stash | Command result handling in `useStashes.ts`; git leaves the stash on a failed pop; error overlay keeps the row |
| Stash action keys do not trigger Pull when the Stashes panel is focused | `src/domain/keymap/keymap.resolve.ts` context precedence; `useStashRowCommands.ts` registers `stash.pop` |
| The list is newest first with index, message, source branch, and relative age | `git.stashes.ts` `sortStashesNewestFirst()` and `parseSourceBranch()`; `StashRow.tsx` |
| Enter shows a read-only stash diff that replaces the composer area | `stash.select` command sets `RepositoryProvider.selection`; `StashDetails.tsx` renders the summary; F-11 `DiffPanel` read-only mode |
| Selecting the Pending Changes row returns to the composer | `RepositoryProvider` selection; F-08 and F-09 |
| Rows and actions are keyed by the immutable object name | `parse.stash.ts` `%H`; `resolveStashRef()` before every apply, pop, drop, or diff read |
| Only-untracked changes with Include untracked off are disabled with the exact reason | `getStashCreateAvailability()`; `CreateStashModal.tsx` checkbox re-evaluation |
| Stash creation is unavailable in an empty repository with "no commits yet" | `commands.availability.ts` and `repository.states.ts` gate; `CreateStashModal.tsx` |
| External changes cannot make pop or drop hit a different stash | `resolveStashRef()` mismatch or missing result aborts before mutation and refreshes the list |

## 13. Tests to add

- `src/domain/git/parsers/parse.stash.test.ts`: parse recorded `git stash list` fixtures covering `WIP on <branch>: <short hash> <subject>`, `On <branch>:`, a message without a branch prefix, multiple stashes with descending indices, and distinct object names for every entry.
- `src/domain/git/git.stashes.test.ts`: `sortStashesNewestFirst` ordering; `parseSourceBranch` for both prefixes and for a missing prefix; `resolveStashRef` returning the current index for a matching object name, a moved index, a missing object name, and an index whose object name changed; argument construction for `stash push`, `stash push -u`, `stash apply`, `stash pop`, `stash drop`, and `stash show`; no spawning in unit tests.
- `src/domain/git/git.stashes.test.ts`: `getStashCreateAvailability` returns "no commits yet", "nothing to stash", and "only untracked changes; include untracked files to stash" from the status snapshot, never from a spawn.
- `src/features/stashes/StashRow.test.tsx`: index, source branch, relative age, selection marker, object-name identity across an index shift, and message truncation behavior.
- `src/features/stashes/StashDetails.test.tsx`: renders only when `RepositoryProvider.selection.kind === "stash"`, shows the stash message, source branch, age, and read-only text, renders nothing for another selection, and explains a selected stash that no longer exists.
- `src/features/stashes/useStashes.test.tsx`: registers exactly the stash actions plus cursor navigation and no global action; selects the immutable object name without a git call; keeps the cursor on the same object name when the display index shifts; targets the double-clicked row; repairs the selection to the nearest surviving stash or Pending Changes; publishes availability and clears it on unmount; passes the deterministic prefill and config default to the create modal; selects the created stash and moves the cursor to it after the refresh; and covers apply, pop, delete, availability, and focus refresh.
- `src/app/providers/RepositoryProvider.test.tsx` (shared): a command-triggered refresh that joins an in-flight read performs exactly one follow-up read, starts no follow-up after unmount, and aborts a queued follow-up that has already started when the provider unmounts.
- `src/features/stashes/StashesPanel.test.tsx`: `stash.pop` overriding `remote.pull` while focused; the empty and read-error states; the create modal opening when the default checkbox would block; a failed pop keeping the row; and an external stash change aborting with "stash changed externally; list refreshed" and never dropping another stash.
- `src/features/stashes/CreateStashModal.test.tsx`: the message is required and the modal closes only after a valid submit; the checkbox starts from `stash.includeUntrackedByDefault`; the supplied prefill is rendered; and the confirm is blocked with the only-untracked, nothing-to-stash, and no-commits-yet reasons.
- `src/features/stashes/stash.prefill.test.ts`: the exact attached-HEAD pattern with the HEAD subject, the short attached form without a subject, the detached `WIP at` forms, the unborn-HEAD fallback, and `WIP` before the first snapshot.
- `src/features/stashes/stash.resolve.test.ts`: the newest message match, the newest-row fallback for another subject shape, and null for an empty list.
- `src/features/stashes/stash.age.test.ts`: unknown age, the small units, the day-to-month switch, and no "0y ago" around the year boundary.
- `src/features/stashes/DeleteStashModal.test.tsx`: the confirm label is "Drop stash", Cancel holds the default focus, and the target is the object name rather than a captured index.
- `src/domain/keymap/keymap.resolve.test.ts` (shared): `p` resolves to `stash.pop` in the `stashes` context and to `remote.pull` elsewhere.

## 14. Open questions

- Whether apply and pop should restore the staged state with `--index`. F-06 does not say; this doc uses the git default of not restoring the index and lists the choice as open.
- Whether the source branch should fall back to `git log -g refs/stash --format=%gs` for stashes created by older git versions that lack the `WIP on` prefix.
- Whether the stash diff should include untracked content when the stash was created with `-u`, which is stored in a third parent, or only the tracked diff from `git stash show -p`.
