# 09 - Commit composer

## 1. Header

- Spec reference: `docs/product-spec.md` F-09 (lines 740-804), F-10 (lines 805-837), F-11 (lines 838-953), F-16 (lines 1067-1095), the keyboard map (lines 1539-1704), action IDs (lines 1705-1742).
- Architecture contract: `docs/technical-implmentations/00-project-architecture.md`.
- Region id: `right-pane` (`src/features/shell/regions.ts`), owned by `CommitComposer.tsx`, which renders the focusable frame. The composer is the right-pane mode when `RepositoryProvider.selection.kind === "pending"`. The other right-pane modes are commit details for a commit selection, stash details for a stash selection, and worktree details for a worktree selection (F-10).
- Dependencies: F-01 (shell, focus, region order, the quit confirmation that will read `hasUnsavedDraft` from `DraftProvider` once it lands), F-08 (the Pending Changes row selects the composer through `RepositoryProvider.selection`), F-10 (the right-pane mode switch), F-11 (staged file list and working tree diffs), F-15 (error overlay and the More menu overlay), F-16 (empty repository, missing git identity), F-17 (refresh after commit), F-18 (safety, hook execution), F-19 (keymap overrides for `commit.submit` and `commit.options`).
- Owned paths:
  - `src/features/composer/CommitComposer.tsx`
  - `src/features/composer/ComposerIdentity.tsx`
  - `src/features/composer/CommitOptionsMenu.tsx`
  - `src/features/composer/useComposer.ts`
  - `src/app/providers/DraftProvider.tsx`
  - `src/domain/git/git.commit.ts`
- Read-only references: `src/domain/git/git.log.ts` (amend message and short hash), `src/domain/git/git.repo.ts` (identity), `src/domain/git/git.status.ts` and `src/domain/git/parsers/parse.status.ts` (staged and pending counts), `src/app/hooks/commandRunner.report.ts` (commit hook-failure hint), `src/domain/repository/repository.selectors.ts`, `src/lib/text.ts` (`TEXT_INDENT_UNIT`).

## 2. Scope and non-goals

Scope: the composer panel shown in the right pane when the Pending Changes row is selected; the multiline message textarea with its placeholder; the read-only identity line; the More and Commit buttons; the enablement rules (no staged files, empty message, missing identity); auto-grow to 8 rows then scroll; `Enter` inserts a newline, `Tab` indents and `Shift+Tab` outdents inside the textarea, and `commit.submit` commits; committing exactly the staged files; success and failure behavior including preserving the message and staged files; pre-commit hook failure messaging with the `--no-verify` hint; and the commit options menu with the four variants exposed as the separate action IDs and commands `commit.submit`, `commit.submitNoVerify`, `commit.amend`, and `commit.amendNoVerify`, amend message loading, the "Amending <short hash>" indicator, amend without staged changes, and disabled reasons.

Non-goals: staging, unstaging, and discarding files (F-11); the working tree and commit diffs (F-11); the commit graph and its rows (F-08); commit details (F-10); configuration of git identity (the user resolves it outside the app, F-09); a setting to always skip hooks or always amend (product spec line 1201 forbids it).

## 3. OpenTUI components used

| Component | Where used | Why it is the right component |
| --- | --- | --- |
| `<textarea>` | The commit message field inside `CommitComposer.tsx`. | Multiline form fields use `<textarea>`; the message is multiline and auto-grows. |
| `<box>` | Composer panel frame, the identity row, the button row, the More menu modal frame, and each option row container. | The only layout, border, focus-ring, and hit-test primitive. |
| `<text>` | Identity line, staged count, button labels, validation and disabled reasons, the "Amending <short hash>" indicator, and progress text. | Every UI string is rendered through `<text>`. |
| `<span>` | The "Amending <short hash>" indicator run, the staged count emphasis, and the missing-identity value inside the identity line. | Inline styled runs inside a single `<text>`. |
| `<select>` | The four commit variants inside `CommitOptionsMenu.tsx`. | Uniform vertical option list with built-in up/down and Enter; architecture section 6 names commit options as a `<select>` use. |
| `<scrollbox>` | The auto-grown textarea scroll region once the message exceeds 8 rows. | Scrollable bounded region; handles wheel scroll and scrollbars. |
| `<code>`, `<diff>`, `<line-number>`, `<markdown>`, `<ascii-font>`, `<input>` | Not owned here. | N/A for this feature. The identity line is read-only text, not an input. |

Hooks used:

| Hook | Where used | Why |
| --- | --- | --- |
| `useKeyboard` | Only inside `src/app/hooks/useHotkeys.ts`. | Central dispatcher; this feature never calls it directly. |
| `useAction` | `useComposer.ts` registers only composer-scoped handlers (`scope: "right-pane"`): `commit.submit`, `commit.submitNoVerify`, `commit.amend`, `commit.amendNoVerify`, `commit.options`, `form.submit`, and the composer's own `nav.left`, `nav.right`, and `nav.activate`. | Features receive action IDs, never raw key strings. Global actions such as `app.quit`, `commit.focus`, `focus.next`, `focus.previous`, `overlay.close`, and `app.refresh` are owned by the app, the shell, or `useRepository`, never by this feature. |
| `useDraft` | `useComposer.ts` reads and writes the message through `DraftProvider`; once draft-based quit lands the shell quit handler will read `hasUnsavedDraft` from the same provider. | The draft has exactly one owner, so the composer and the future quit confirmation cannot disagree. |
| `usePaste` | `CommitComposer.tsx` for paste into the textarea. | Commit message and field paste handling is a named `usePaste` use in architecture section 6. |
| `useBoxRows` | `CommitComposer.tsx` measures the laid-out panel body and derives the message row cap. | The right-pane slot changes with the terminal height and the console drawer, so the field budget follows the measured body rather than estimating it. |
| `useFocusRegion` | `CommitComposer.tsx` reads `focused` and calls `focus()` for `right-pane`. | Region focus is derived from native focus; cursor persistence per region. |
| `useOverlay` | `useComposer.ts` pushes `CommitOptionsMenu` and the error overlay. | Modal stack and error overlay ownership. |
| `useStatus` | `CommitComposer.tsx` renders progress and the success status. | Transient status and operation progress. |
| `useTimeline` | The `Spinner` shown while committing. | Animation only. |

`<textarea>` versus `<input>`: the message is multiline and must insert newlines on `Enter`, so it uses `<textarea>`. The More menu is a uniform option list, so it uses `<select>`; a `<scrollbox>` of rows is not needed there.

All icons and markers used by this feature come from `src/theme/icons.ts`; see architecture section 6.1. No glyph literal is written in feature code.

## 4. Component tree

```text
MainArea                            (src/features/shell/MainArea.tsx)
-> CommitComposer                   (src/features/composer/CommitComposer.tsx, rendered when `RepositoryProvider.selection.kind === "pending"`)
   Panel                            (ui/Panel.tsx, region frame for `right-pane`)
     PanelHeader                    (title "Commit", staged count, "Amending <short hash>")
     ComposerIdentity               (author name and email, or the missing-identity reason)
     FormField                      (label + textarea + inline error text)
       textarea                     (message, placeholder "Commit message...")
     ButtonRow
       Button (More, icon only)
       Button (Commit, or "Nothing to commit")
     Spinner                        (while committing)
```

The options menu is an overlay, not nested in the panel:

```text
CommitOptionsMenu
  ModalFrame
    select (Commit, Commit --no-verify, Commit --amend, Amend --no-verify)
    text (disabled reason for the highlighted variant, for example "no previous commit")
    ModalActions (Run, Cancel; Cancel focused by default)
```

## 5. Enforced files and folders

- `src/features/composer/CommitComposer.tsx` - composer panel composition, textarea, buttons, auto-grow, progress, and region registration.
- `src/features/composer/ComposerIdentity.tsx` - the read-only identity line and the missing-identity reason.
- `src/features/composer/CommitOptionsMenu.tsx` - the four variants, disabled reasons, amend selection, and cancel behavior.
- `src/features/composer/useComposer.ts` - enablement rules, menu state, amend selection, amend message loading, command dispatch, and draft reads and writes through `DraftProvider`.
- `src/app/providers/DraftProvider.tsx` - the single owner of the composer draft string and `hasUnsavedDraft`, read by this feature today and by the shell quit handler once draft-based quit lands.
- `src/domain/git/git.commit.ts` - commit command builders for the four variants.
- Tests colocated: `src/domain/git/git.commit.test.ts`, `src/app/providers/DraftProvider.test.tsx`, `src/features/composer/useComposer.test.tsx`, `src/features/composer/CommitComposer.test.tsx`, `src/features/composer/CommitOptionsMenu.test.tsx`.

## 6. State model

View state, owned by `useComposer.ts` and `CommitOptionsMenu.tsx`:

- The focused composer control index (textarea, More, Commit) when the `right-pane` region frame is focused. `nav.left` and `nav.right` change it.
- More menu open flag, the highlighted variant, and the pending amend target: the HEAD OID and its short hash, whether the amend message was loaded, and a one-shot snapshot used to restore the draft when the menu is cancelled.
- Textarea focus is native; the feature reads it from `useFocusRegion` and the focused renderable rather than keeping a local flag. The visible-row height (auto-grow result, capped at 8) is local.
- Last commit error, if any, shown through the overlay.

Provider state, read and never recomputed here:

- `DraftProvider`: the composer draft string and `hasUnsavedDraft`. This is the single owner of the draft. `useComposer` reads and writes it through `useDraft` and does not keep a second copy. The shell quit handler will read the same provider once draft-based quit lands, so no feature imports another feature to answer the unsaved-work question.
- `RepositoryProvider`: staged file list and staged count, pending count, HEAD OID, the repository refresh generation, and the right-pane selection union. The right-pane mode is derived from `selection` (`pending` renders the composer, `commit` renders commit details, `stash` renders stash details, `worktree` renders worktree details), never from a second sub-mode flag.
- `StatusProvider`: operation progress and the transient success status.
- `OverlayProvider`: the More menu modal and the persistent error overlay.
- `ConfigProvider`: git identity values and the resolved keymap for hint text.
- `FocusProvider`: derived active region and cursor map.

Rules: this feature never recomputes staged or pending counts; it reads them from `@/domain/repository/repository.selectors.ts`. The draft is never cleared by a failure (architecture section 9: failures never clear drafts or staged files). The cancel snapshot is the only transient second copy, and it is discarded when the menu closes.

## 7. Data flow

Generic path (architecture section 9):

```text
key or click -> action ID -> useAction handler -> useCommandRunner.runCommand(request)
  -> command runner (availability + serialization) -> @/domain/git/git.commit.ts -> git CLI
  -> CommandResult -> useCommandRunner applies RepositoryProvider refresh, console entry, status, and error overlay
  -> CommitComposer re-render
```

| Action ID or trigger | Domain module | Git subcommand |
| --- | --- | --- |
| `commit.submit` (`Ctrl/Cmd+S`, the Commit button, and the Commit menu row) | `git.commit.ts` `commitStaged()` | `git commit -m <message>` |
| `commit.submitNoVerify` (More menu and palette only, no default key) | `git.commit.ts` `commitStaged({ noVerify: true })` | `git commit --no-verify -m <message>` |
| `commit.amend` (More menu and palette only, no default key) | `git.commit.ts` `amendCommit()` | `git commit --amend -m <message>` |
| `commit.amendNoVerify` (More menu and palette only, no default key) | `git.commit.ts` `amendCommit({ noVerify: true })` | `git commit --amend --no-verify -m <message>` |
| `form.submit` (`Ctrl/Cmd+Enter` in the composer) | the same builder as `commit.submit` | `git commit -m <message>` |
| amend message load | `git.log.ts` `readMessage()` | `git log -1 --format=%B HEAD` |
| amend short hash for the indicator | `git.log.ts` `readShortHash()` | `git log -1 --format=%h HEAD` |
| identity line | `git.repo.ts` `readIdentity()` | `git config --get user.name` and `git config --get user.email` |
| staged count and file list | `parsers/parse.status.ts` via `git.status.ts` | `git status --porcelain=v2 --branch -z --untracked-files=all` |
| refresh after commit | `RepositoryProvider.refresh()` | re-reads status and the loaded graph window (the same page count) |

The four menu rows are separate action IDs and commands, not parameters of `commit.submit`. `commit.submit` stays the `Ctrl/Cmd+S` default and always runs a normal commit; the menu's Run button dispatches the highlighted row's action ID, and the palette exposes each row as its own command. `form.submit` is the multiline-form action (`Ctrl/Cmd+Enter`); in the composer it runs the same normal commit as `commit.submit`.

An amend variant prepares through one path regardless of where it is dispatched. The menu's Run button, a directly bound `commit.amend` or `commit.amendNoVerify` action, and a palette dispatch all ensure an amend session exists, load HEAD's message and short hash, apply the message when the live draft is empty, set the "Amending <short hash>" indicator, and only then start the write. When the load is already in flight, Run awaits it instead of aborting it. A cancelled or superseded load stays silent; a real load failure reports a warning and sends no amend write. The menu's Cancel still restores the pre-menu draft snapshot.

The message is passed as a single argument with embedded newlines; git's default `whitespace` cleanup for `-m` strips leading and trailing blank lines and trailing whitespace. Only staged files are committed: the builder passes no pathspec and no `-a` or `-A` flag, so untracked and unstaged files are never included. `--no-verify` is added only for the two variants that request it; there is no setting that applies it by default (product spec line 1201). The status read uses `--untracked-files=all` so staged and pending counts include files inside untracked directories.

After a successful commit `useCommandRunner` refreshes `RepositoryProvider`, which re-reads status, staged files, and the loaded graph window at its current page count. The runner itself does not refresh. The new commit appears at the top of the commit list even when a graph-window reload was already in flight when it landed: the tips path reloads the window again while the current tip key differs from the recorded key, bounded to three attempts per loop and one re-arm. If the tip keeps changing past that bound, the graph may stay behind the newest tips until the next page append, search toggle, successful external window reload, or manual refresh, which reset the bound. The Pending Changes row stays first, so Pending Changes remains selected while the composer clears, including after amend.

The `--no-verify` hint is applied in `src/app/hooks/commandRunner.report.ts`. It is restricted to the four commit commands (`commit.submit`, `commit.submitNoVerify`, `commit.amend`, `commit.amendNoVerify`) and to output that names a commit hook (`pre-commit`, `prepare-commit-msg`, `commit-msg`, `post-commit`) or the `.git/hooks/` path those runners print. A failed push with a `pre-push` hook receives no commit advice, and a bare `hook` or `husky` word does not trigger the hint. `git.errors.ts` performs no hook classification. The error overlay names the hook output and states that `--no-verify` can bypass the commit hook. The draft message and staged files are preserved in every failure case, and the command plus its output are recorded in the console (F-13).

### Command registration and targets

`useComposer.ts` registers handlers with `useAction(actionId, { scope: "right-pane", targetKind: "none" }, handler)`. Exactly one handler may exist per `(actionId, scope)`; a duplicate registration is a development error and the later one is rejected, never last-mounted-wins. The composer registers only composer-scoped handlers (`scope: "right-pane"`): the four commit variants, `commit.options`, `form.submit`, and its own `nav.left`, `nav.right`, and `nav.activate`. It never registers global actions such as `app.quit`, `commit.focus`, `focus.next`, `focus.previous`, `overlay.close`, or `app.refresh`; those have a single owner in the app, the shell, or `useRepository`. `commit.focus` focuses the composer textarea through `focusRenderable`, and `app.quit` reads `hasUnsavedDraft` from `DraftProvider` before it opens the quit confirmation. The palette dispatches each variant as its own command with an explicit target, and availability, footer hints, help, and the menu all read the same registry result.

## 8. Keyboard and focus

Action IDs only (product spec section 6.1). Raw key strings never appear outside `@/domain/keymap/**` and `src/app/hooks/useHotkeys.ts`.

| Action ID | Behavior in the composer |
| --- | --- |
| `commit.submit` (`Ctrl/Cmd+S`) | Commit the current message against exactly the staged files as a normal commit. The Commit button dispatches the same ID. Works while the textarea is focused. |
| `commit.submitNoVerify` (no default key; menu and palette only) | Commit with `--no-verify` using the current message and staged files. |
| `commit.amend` (no default key; menu and palette only) | Amend the last commit with the current message and staged files, and show the "Amending <short hash>" indicator while the menu selection is pending. |
| `commit.amendNoVerify` (no default key; menu and palette only) | Amend the last commit with `--no-verify` using the current message and staged files. |
| `form.submit` (`Ctrl/Cmd+Enter`) | Submit the focused form; in the composer it runs the same normal commit as `commit.submit`. |
| `commit.options` (`Alt+.` while the textarea is focused; plain `.` only while the `right-pane` region frame is focused) | Open `CommitOptionsMenu`. The text-input allowlist only fires an action whose effective binding uses `Ctrl`, `Cmd`, or `Alt`, so `Alt+.` works while typing and plain `.` types a period; plain `.` opens the menu only when focus is on the region frame outside the textarea. `Ctrl/Cmd+.` stays OpenTUI redo. |
| `commit.focus` (`c`) | Focus the composer textarea when the composer is visible (the Pending Changes row or the diff-file fallback keeps it mounted); shell-owned. The palette and help report the shared `composer-hidden` reason when commit, stash, or worktree details replace it. |
| `overlay.close` (`Esc`) | In the textarea: leave the textarea and focus the `right-pane` region frame; the draft is kept. In the More menu: cancel and restore the draft snapshot. |
| `nav.up`, `nav.down` | Move the highlighted variant inside the More menu. |
| `nav.left`, `nav.right` | With the `right-pane` region frame focused, move between the textarea, More, and Commit controls. |
| `nav.activate` (`Enter`) | Run the highlighted variant in the More menu. In the textarea, `Enter` inserts a newline, not a commit. |
| `focus.next`, `focus.previous` (`Tab` / `Shift+Tab`) | In the textarea, `Tab` inserts the two-space indent unit and `Shift+Tab` removes up to one indent unit from the start of the current line; neither moves focus. With the `right-pane` region frame focused, Tab moves to the next or previous region. |
| `focus.region.rightPane` (`7`) | Direct jump to the `right-pane` region and into the active mode, composer or details; shell-owned. |
| `app.quit` (`q`) | Quit; today it aborts the in-flight command and tears down without a draft prompt. Draft-based quit confirmation is deferred; when it lands the shell will open the confirmation when `hasUnsavedDraft` is true in `DraftProvider` (F-01). |

`Enter` inserts a newline; `Tab` inserts the two-space indent unit at the cursor (replacing a selection) and `Shift+Tab` outdents the current line by up to one indent unit; neither leaves the textarea. The Commit button and `Ctrl/Cmd+S` run `commit.submit`; `form.submit` runs the same operation from a multiline form. The four menu variants are separate commands with no default keys, so only `commit.submit` is bound to `Ctrl/Cmd+S`. With the `right-pane` region frame focused, `nav.left` and `nav.right` move between the textarea, More, and Commit. While the textarea is focused, every unmodified printable key belongs to the textarea until `Esc` leaves it. The footer shows `commit.submit` and `commit.options` hints for the `right-pane` region when the composer mode is active, so footer, help, and palette agree through `@/domain/keymap/keymap.describe.ts`.

The textarea indent unit is `TEXT_INDENT_UNIT` in `src/lib/text.ts`, two spaces. The Tab handler reads the textarea ref, calls `insertText(TEXT_INDENT_UNIT)`, and calls `preventDefault()` so focus does not move. `insertText` replaces the current selection when one exists. `Shift+Tab` removes up to `TEXT_INDENT_UNIT.length` leading spaces from the current line through the edit-buffer line edit API and then calls `preventDefault()`.

## 9. Loading, empty, error, and disabled states

- Disabled, no staged files: the textarea is disabled with the `dim` token and the Commit button label is "Nothing to commit"; clicking it does nothing. The footer shows the reason. The row still shows the staged count when staged-only changes exist.
- Disabled, empty message: with files staged but an empty or whitespace-only message, the Commit button is disabled and the footer shows "message required".
- Disabled, missing identity: `ComposerIdentity` shows "Git identity not configured" with the missing value (the missing `user.name` or `user.email`) and commit is disabled. The user resolves it in git configuration outside the app.
- Disabled, committing: the composer is disabled and shows a `Spinner` with "Committing...".
- Disabled, operation in progress: a second mutation is blocked by the runner's write latch, and `useCommandRunner` surfaces the result reason.
- Empty staged but amend pending: commit is allowed, because amend replaces the last commit and the "Nothing to commit" rule applies to normal commits only (product spec line 782).
- Success: clear the message in `DraftProvider`, return to the default state, keep the Pending Changes row selected, refresh status, staged files, and graph, show a success status, and disable the textarea if no files remain staged.
- Failure: keep the message in `DraftProvider` and keep staged files, show the git error in a persistent overlay, and record the command and output in the console.
- Pre-commit hook failure: the error overlay names the hook output and makes clear that `--no-verify` can bypass it.
- More menu disabled variant: the highlighted variant shows its reason, for example "no previous commit" when there is no HEAD to amend. The three non-default variants are reachable from the menu and the palette even though they have no keybinding.
- Empty repository: the composer becomes editable after the first file is staged; until then it shows the no-staged-files state (F-16).

Every state carries a text marker; color is never the only signal.

## 10. Performance and bounds

- The textarea auto-grows up to 8 rows and then scrolls inside a `<scrollbox>`; the height is `min(8, messageLineCount)` capped by the rows the right-pane slot actually leaves for the field. `MainArea` reserves 11 rows for the composer whenever the column can spare them and clamps the reservation when the console drawer leaves less room than both surfaces need, and the composer panel fills the slot it is given instead of enforcing its own minimum. `CommitComposer` reads the laid-out body height through `useBoxRows` (one row before the first layout) and subtracts the staged, identity, label, button, and reason rows, so the cap drops to one row in the 8-row slot the console leaves at 80x24. The identity line, message label, More, and Commit therefore stay inside the panel, and the diff keeps its one-cell gutter, at 80x24, 80x25, and 100x30.
- No git call runs per keystroke. Identity is read once per repository refresh, and the amend message and short hash are read once when amend is selected.
- The identity and counts come from the repository snapshot, so the composer does not add a read per render.
- Commit is a single write serialized by `commands.runner.ts`; a second write while one is running returns a blocked result with a reason. The composer does not optimistically mutate the graph or the staged list.
- The More menu is a fixed four-option list, so it needs no pagination or virtualization.

## 11. Safety and confirmations

- A normal commit is the explicit primary action and requires no extra confirmation; it is the user's stated intent.
- `--no-verify` is never applied by default and is reachable only through the explicit `commit.submitNoVerify` or `commit.amendNoVerify` command (product spec line 1201). The hook output is always named when a hook fails.
- Amend is a history rewrite. It is reachable only through the explicit `commit.amend` or `commit.amendNoVerify` command from the menu or palette, and the composer always shows the "Amending <short hash>" indicator naming the commit being replaced.
- Amend is allowed without staged changes because it replaces the last commit. The normal "Nothing to commit" rule does not apply to amend.
- Commits include exactly the staged files. Untracked and unstaged files are never included.
- On any failure the message and staged files are preserved; no failure path clears the draft.
- Every command runs through `git.client.ts` with an argument array and no shell; credentials are redacted before any console or error rendering (F-18).

## 12. Acceptance mapping

| F-09 acceptance bullet | Implementing module or component |
| --- | --- |
| A user can stage one file, type a message, press `Ctrl/Cmd+S`, and see the commit at the top of the graph | `commit.submit` handler in `useComposer.ts`; `git.commit.ts` `commitStaged()`; `RepositoryProvider.refresh()` |
| Nothing is committed while no files are staged | Enablement rule in `useComposer.ts`; `commitStaged()` passes no pathspec and no `-a` |
| The button reads "Nothing to commit" and does nothing in that state | `CommitComposer.tsx` button label and disabled handler |
| Author identity comes from git configuration | `ComposerIdentity.tsx`; `git.repo.ts` `readIdentity()` |
| `--no-verify` and amend variants work and are visible in the console | `CommitOptionsMenu.tsx` dispatches `commit.submitNoVerify`, `commit.amend`, and `commit.amendNoVerify` as separate commands; `git.commit.ts` builders; console entry from `useCommandRunner.ts` |
| A failed commit preserves the message and staged state | `DraftProvider` keeps the draft; no clear on failure; error overlay from `OverlayProvider` |
| Quitting with an unsent message shows the quit confirmation | Deferred. `app.quit` aborts the in-flight command and tears down without a draft prompt today; the shell quit handler will read `hasUnsavedDraft` from `DraftProvider` once the confirmation lands (F-01) |
| Multiline textarea with placeholder and auto-grow to 8 rows | `CommitComposer.tsx` `<textarea>` and height rule |
| Enter inserts a newline; `Ctrl/Cmd+S` commits; Tab indents and Shift+Tab outdents inside the textarea | `CommitComposer.tsx` textarea handling; `commit.submit` handler; `TEXT_INDENT_UNIT` from `src/lib/text.ts` |
| Amend loads the previous message and shows "Amending <short hash>" | `useComposer.ts` amend load via `git.log.ts`; indicator span in `CommitComposer.tsx` |
| The menu shows why an option is unavailable | `CommitOptionsMenu.tsx` disabled reason text, for example "no previous commit" |

## 13. Tests to add

- `src/domain/git/git.commit.test.ts`: argument construction for one builder per action ID, asserting exactly the staged-only form (no pathspec, no `-a`), `commit.submit` has neither `--no-verify` nor `--amend`, `commit.submitNoVerify` adds only `--no-verify`, `commit.amend` adds only `--amend`, and `commit.amendNoVerify` adds both; no spawning in unit tests.
- `src/domain/git/parsers/parse.status.test.ts` (shared with F-11): the status invocation uses `git status --porcelain=v2 --branch -z --untracked-files=all`, and `-z` output with spaces and newlines in paths parses correctly.
- `src/app/providers/DraftProvider.test.tsx`: the provider is the single owner of the draft and `hasUnsavedDraft`; writing, clearing, and failure-preserving updates are visible to both the composer and the quit confirmation; once draft-based quit lands the shell confirmation will open only when `hasUnsavedDraft` is true.
- `src/features/composer/useComposer.test.tsx`: enablement matrix for no staged files, empty and whitespace-only messages, missing `user.name` and `user.email`, and amend with no staged changes; draft survives a simulated failure through `DraftProvider`; amend message load and cancel restoring the snapshot; the right-pane mode is derived from `selection.kind` (`pending`, `commit`, `stash`, `worktree`) with no second flag; duplicate `(actionId, scope)` registration is rejected; no global action such as `app.quit`, `commit.focus`, `focus.next`, or `app.refresh` is registered by the feature.
- `src/features/composer/CommitComposer.test.tsx`: placeholder "Commit message...", identity line, "Nothing to commit" label, auto-grow to 8 rows then scroll, `Enter` newline, `Tab` inserts two spaces without moving focus, `Shift+Tab` removes up to two leading spaces from the current line, `Alt+.` opens options while typing, plain `.` inserts a period in the textarea and opens options only when the region frame is focused, the allowlist fires only modified effective bindings while `Ctrl+.` remains redo, `Ctrl/Cmd+S` dispatches `commit.submit`, `Ctrl/Cmd+Enter` dispatches `form.submit`, the four menu rows dispatch four distinct action IDs, success clears `DraftProvider`, and the hook-failure overlay text includes the `--no-verify` hint.
- `src/features/composer/CommitOptionsMenu.test.tsx`: the four variants in order, disabled reason "no previous commit" when there is no HEAD, amend selection indicator, Cancel restoring the previous draft, and the absence of default keys for the three menu-only variants.
- An integration-style test that runs the commit command against a temporary repository fixture and asserts that a new commit appears and that untracked and unstaged files are excluded.

## 14. Open questions

- Product spec does not require a confirmation for amend. Should the app warn when the commit being amended is already contained in an upstream remote branch, since amend rewrites published history? This doc requires only the "Amending <short hash>" indicator. Confirm.
- Should `--no-verify` be gated behind an extra confirmation, given it bypasses hooks? The spec makes it an explicit menu choice and forbids an always-no-verify setting, so this doc treats the menu selection as sufficient. Confirm.
- Message passing: this doc uses `-m` with embedded newlines and git's default `whitespace` cleanup. Confirm this is preferred over `--file=-` with stdin, which `git.client.ts` would need to support.
- Should a whitespace-only message be trimmed before validation, or is it rejected as empty? This doc rejects it as empty.
- Should the draft message survive a region focus change and a graph selection change? This doc keeps it in `DraftProvider` so it survives both, and only Esc in the textarea leaves the field without clearing it.
