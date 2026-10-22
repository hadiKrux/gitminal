# 06 Stashes Panel

## 1. Header

- Status: Draft for review
- Spec reference: `docs/product-spec.md` F-06 (lines 476-527), decision D7 (line 1741), action IDs (lines 1583-1611), key precedence (lines 109-119), config key `stash.includeUntrackedByDefault` (line 1157), stash flow (lines 1666-1672)
- Architecture contract: `docs/technical-implmentations/00-project-architecture.md`
- Region id: `stashes` (`src/features/shell/regions.ts`)
- Dependencies: F-01 (shell, focus, region order), F-08 (selection of the Pending Changes row versus a stash), F-09 (the composer area that the stash summary replaces), F-10 (the commit details area that the stash summary also replaces), F-11 (the read-only stash diff rendered by the Diff panel), F-15 (modal structure and destructive confirmations), F-16 (repository states), F-17 (freshness and refresh), F-18 (safety), F-19 (`stash.includeUntrackedByDefault`).
- Owned paths:
  - `src/features/stashes/StashesPanel.tsx`
  - `src/features/stashes/StashRow.tsx`
  - `src/features/stashes/CreateStashModal.tsx`
  - `src/features/stashes/DeleteStashModal.tsx`
  - `src/features/stashes/useStashes.ts`
  - `src/domain/git/git.stashes.ts`
- Co-owned paths: `src/domain/git/parsers/parse.stash.ts` owns stash-list parsing; `src/domain/repository/repository.selectors.ts` owns the merged selection and pending-count state that this panel reads.

## 2. Scope and non-goals

Scope: newest-first stash list; each row shows the stash index, the truncated message, the source branch when git records it, and the relative age; Create Stash modal with a required prefilled message and an Include untracked files checkbox whose default comes from `stash.includeUntrackedByDefault`; Apply without confirmation; Pop with a confirmation that drops the stash only after a successful apply; Delete with a confirmation that names the stash message; Enter shows a read-only stash diff that replaces the composer or commit details area; conflict failures keep the stash; the `p` key resolves to Pop while the Stashes panel is focused.

Non-goals: editing or renaming a stash; partial stash of selected paths (`git stash push -- <paths>`); stash of only the index (`--staged`); `git stash branch`; applying only untracked content; dropping more than one stash at a time; stash browsing across worktrees; a stash details screen separate from the read-only diff.

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

Hooks used:

| Hook | Where used | Why |
| --- | --- | --- |
| `useKeyboard` | Only inside `src/app/hooks/useHotkeys.ts` | Central dispatcher; this feature never calls it directly |
| `useAction` | `useStashes.ts` registers `stash.create`, `stash.apply`, `stash.pop`, `stash.delete`, `nav.activate`, `app.refresh` | Features receive action IDs, never raw key strings |
| `useListCursor` | `useStashes.ts` navigation and double click detection | Shared cursor and double click logic for custom rows |
| `useFocusRegion` | `StashesPanel.tsx` refreshes the stash list when `focused` flips true | Region focus is derived from native focus; `useFocus` only reports terminal-window focus |
| `useTerminalDimensions` | `StashRow.tsx` computes the message truncation budget | Budget-aware truncation through `@/lib/text.ts` |
| `useOverlay` | `StashesPanel.tsx` opens the Create, Pop, and Delete modals | Modal stack lives in `OverlayProvider` |
| `useConfig` | `useStashes.ts` reads `stash.includeUntrackedByDefault` | Config is the single source of the checkbox default |
| `useRepository`, `useStatus` | `useStashes.ts` reads the snapshot and publishes status | Provider state is never copied locally |

All icons and markers used by this feature come from `src/theme/icons.ts`; see architecture section 6.1. No glyph literal is written in feature code.

## 4. Component tree

```text
StashesPanel
  Panel
    PanelHeader (title "Stashes", count)
    ScrollableList (scrollbox, viewportCulling, scrollbar when overflowing)
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

Modals are pushed onto `OverlayProvider` (F-15), not nested in the panel:

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

- `src/features/stashes/StashesPanel.tsx` - panel composition, region registration, action wiring, focus refresh, modal opening.
- `src/features/stashes/StashRow.tsx` - one stash row: index, message, source branch, relative age, selection marker.
- `src/features/stashes/CreateStashModal.tsx` - required message, prefill, include-untracked checkbox, validation.
- `src/features/stashes/DeleteStashModal.tsx` - destructive confirmation that names the stash message.
- `src/features/stashes/useStashes.ts` - reads the stash snapshot, owns cursor and draft state, dispatches commands.
- `src/domain/git/git.stashes.ts` - stash reads, ordering, and command builders for push, apply, pop, and drop.
- `src/domain/git/parsers/parse.stash.ts` - parses recorded `git stash list` output, including the source branch.
- Tests colocated: `src/domain/git/parsers/parse.stash.test.ts`, `src/domain/git/git.stashes.test.ts`, `src/features/stashes/StashesPanel.test.tsx`, `src/features/stashes/StashRow.test.tsx`, `src/features/stashes/CreateStashModal.test.tsx`, `src/features/stashes/DeleteStashModal.test.tsx`.

## 6. State model

Local view state (owned by `useStashes.ts` and the modals):

- Cursor index for the `stashes` region, stored through `useListCursor` and persisted per region by `FocusProvider`.
- Modal open flag and which stash opened it, through `useOverlay`.
- Create Stash draft: the message string and the include-untracked boolean, initialized from config.

Provider state (read, never recomputed here):

- `RepositoryProvider` snapshot: the stash list, newest first, each entry carrying the index (`stash@{n}`), the object name, the raw subject, the source branch when parsed, and the commit timestamp; the selected item (Pending Changes, commit, or stash) that drives the right pane; and the pending-count state.
- `ConfigProvider`: `stash.includeUntrackedByDefault` and `git.path`.
- `StatusProvider`: operation progress and transient status.
- `FocusProvider`: derived active region and the cursor map.
- `OverlayProvider`: modal stack and the error overlay.
- `ConsoleProvider`: the bounded command log entry written by every command.

Rules: this feature never recomputes ordering, source branch, or relative age. Ordering comes from `git.stashes.ts`, and relative age comes from `@/lib/time.ts` (architecture section 9).

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
| repository refresh (stash list) | `git.stashes.ts` `listStashes()` -> `parsers/parse.stash.ts` | `git stash list --format=%gd%x00%H%x00%gs%x00%ct` |
| source branch extraction | `git.stashes.ts` `parseSourceBranch()` (pure) | none; reads the `WIP on <branch>:` or `On <branch>:` prefix of the subject |
| newest-first ordering | `git.stashes.ts` `sortStashesNewestFirst()` (pure) | none; orders by index descending |
| `stash.create` (tracked only) | `git.stashes.ts` `createStash()` | `git stash push -m <message>` |
| `stash.create` (include untracked) | `git.stashes.ts` `createStash()` with untracked | `git stash push -u -m <message>` |
| `stash.apply` | `git.stashes.ts` `applyStash()` | `git stash apply <ref>` |
| `stash.pop` | `git.stashes.ts` `popStash()` | `git stash pop <ref>` |
| `stash.delete` | `git.stashes.ts` `dropStash()` | `git stash drop <ref>` |
| `nav.activate` (show stash diff) | `git.stashes.ts` `showStash()` -> `parsers/parse.diff.ts`, rendered by F-11 | `git stash show -p --no-color <ref>` |
| `nav.activate` (selection) | command `stash.select` sets the `RepositoryProvider` selection to the stash | none; no git call |

`p` precedence: `stash.pop` and the global `remote.pull` both default to `p`. `src/domain/keymap/keymap.resolve.ts` resolves the focused-region context before global actions (architecture section 8; spec lines 109-119), so while the `stashes` region is focused the effective action is `stash.pop` and `remote.pull` does not fire. The footer shows only Pop, and `src/domain/keymap/keymap.describe.ts` renders the context action.

Pop drop semantics: the app runs `git stash pop <ref>`, which applies the stash and drops it only when the apply succeeds. On a conflict, git leaves the stash in place; the app reads that outcome from the command result and does not issue a separate drop. The app never issues `git stash drop` after a failed apply.

## 8. Keyboard and focus

| Action ID | Behavior in the Stashes region |
| --- | --- |
| `nav.up`, `nav.down` | Move the cursor one stash |
| `nav.pageUp`, `nav.pageDown` | Move by a screen |
| `nav.activate` | Show the read-only stash diff in the Diff panel and set the stash selection |
| `stash.create` | Open the Create Stash modal |
| `stash.apply` | Apply the selected stash and keep it; no confirmation |
| `stash.pop` | Open the Pop stash confirmation, then apply and drop on success; this ID overrides `remote.pull` while Stashes is focused |
| `stash.delete` | Open the Delete Stash confirmation |
| `app.refresh` | Manual refresh of repository state |
| `focus.next`, `focus.previous` | Tab traversal (owned by `useFocusModel`) |
| `focus.region.stashes` | Direct jump to this panel (default `4`), shell-owned |

Notes: `nav.first` and `nav.last` are unbound in the Stashes context per spec section 6, so `g` and `G` are not claimed here. The footer shows Apply, Pop, Delete, and Stash (F-06 line 495). Modals are overlays and own all keys while open, with `overlay.close` cancelling. Availability comes from `@/domain/commands/commands.availability.ts` so the footer, help, and palette agree.

## 9. Loading, empty, error, and disabled states

- Loading: `LoadingRow` with the text marker `[..]` and "loading stashes" while the first read is in flight.
- Empty, no stashes: `EmptyState` with "No stashes" and the hint "s Stash changes".
- Error: `ErrorState` with "Could not read stashes" plus the git error text and a Retry button; the previous rows stay visible.
- Disabled, `stash.create`: unavailable with the reason "nothing to stash" when the working tree and index have no changes (F-06 line 502). The reason is computed from the status snapshot in `commands.availability.ts`.
- Disabled, `stash.apply`, `stash.pop`, `stash.delete`: unavailable with the reason "no stash selected" when the list is empty.
- Conflict, apply or pop: a persistent error overlay with the git output, the stash kept, and no silent discard (F-06 line 509). The console records the command and output.
- Operation in progress: the panel is read-only and a second mutation is blocked with the reason from the runner.
- Detached HEAD: stash creation stays available; the prefill uses the short hash in place of the branch name.

## 10. Performance and bounds

- Stashes render inside a `<scrollbox>` with `viewportCulling`; a soft cap of 2000 rendered rows applies, beyond which a notice row reports the truncation.
- The stash list read is cheap and runs on region focus, manual refresh, and after every mutation. It is never re-read on every render.
- The stash diff is a read-only read that runs on `nav.activate`, not for every row. Only one stash diff read is in flight; a stale result is discarded by a generation token.
- Row truncation uses `@/lib/text.ts` with a budget from `useTerminalDimensions`; the message drops before the index and the age.
- Create, apply, pop, and delete are single writes serialized by `commands.runner.ts`; the panel does not optimistically mutate the list.

## 11. Safety and confirmations

- Apply requires no confirmation because it keeps the stash (F-06 line 507).
- Pop requires an explicit confirmation that names the stash index and message; the confirm label is "Drop stash". The stash is dropped only when the apply succeeds.
- Delete requires an explicit confirmation that names the stash message; the modal opens with Cancel focused.
- Deleting a stash never deletes reachable commits as a side effect (F-18 line 1093).
- Navigation never triggers a destructive action; there is no automatic stash, reset, checkout, or clean (F-18 line 1087).
- Failures preserve the stash, the draft message, and the current selection.
- Every command runs through `git.client.ts` with an argument array and no shell, so a stash message can never be interpreted as shell syntax; credentials in remote URLs are redacted before any console or error rendering.

## 12. Acceptance mapping

| F-06 acceptance bullet | Implementing module or component |
| --- | --- |
| Stash creation uses the entered message and optional untracked behavior | `CreateStashModal.tsx` message field and checkbox; `git.stashes.ts` `createStash()` |
| Pop with confirmation drops the stash only after a successful apply | Pop confirmation through `ConfirmModal`; `git.stashes.ts` `popStash()`; drop semantics in section 7 |
| Apply, pop, and delete failures preserve the stash | Command result handling in `useStashes.ts`; git leaves the stash on a failed pop; error overlay keeps the row |
| Stash action keys do not trigger Pull when the Stashes panel is focused | `src/domain/keymap/keymap.resolve.ts` context precedence; `useStashes.ts` registers `stash.pop` |
| The list is newest first with index, message, source branch, and relative age | `git.stashes.ts` `sortStashesNewestFirst()` and `parseSourceBranch()`; `StashRow.tsx` |
| Enter shows a read-only stash diff that replaces the composer area | `stash.select` command; F-11 `DiffPanel` read-only mode; F-06 summary text |
| Selecting the Pending Changes row returns to the composer | `RepositoryProvider` selection; F-08 and F-09 |

## 13. Tests to add

- `src/domain/git/parsers/parse.stash.test.ts`: parse recorded `git stash list` fixtures covering `WIP on <branch>: <short hash> <subject>`, `On <branch>:`, a message without a branch prefix, and multiple stashes with descending indices.
- `src/domain/git/git.stashes.test.ts`: `sortStashesNewestFirst` ordering; `parseSourceBranch` for both prefixes and for a missing prefix; argument construction for `stash push`, `stash push -u`, `stash apply`, `stash pop`, `stash drop`, and `stash show`; no spawning in unit tests.
- `src/domain/git/git.stashes.test.ts`: the nothing-to-stash decision is derived from the status snapshot and not from a spawn.
- `src/features/stashes/StashRow.test.tsx`: index, source branch, relative age, selection marker, and message truncation behavior.
- `src/features/stashes/StashesPanel.test.tsx`: `stash.pop` overriding `remote.pull` while focused; `stash.create` disabled with "nothing to stash"; a failed pop keeps the row.
- `src/features/stashes/CreateStashModal.test.tsx`: the message is required; the checkbox default follows `stash.includeUntrackedByDefault`; the prefill matches `WIP on <branch>: <short hash> <subject>`.
- `src/features/stashes/DeleteStashModal.test.tsx`: the confirm label is "Drop stash" and Cancel holds the default focus.
- `src/domain/keymap/keymap.resolve.test.ts` (shared): `p` resolves to `stash.pop` in the `stashes` context and to `remote.pull` elsewhere.

## 14. Open questions

- Whether apply and pop should restore the staged state with `--index`. F-06 does not say; this doc uses the git default of not restoring the index and lists the choice as open.
- Whether Delete should reuse the "Drop stash" label or use a distinct label such as "Delete stash". F-15 lists only "Drop stash".
- Whether the source branch should fall back to `git log -g refs/stash --format=%gs` for stashes created by older git versions that lack the `WIP on` prefix.
- Whether the stash diff should include untracked content when the stash was created with `-u`, which is stored in a third parent, or only the tracked diff from `git stash show -p`.
