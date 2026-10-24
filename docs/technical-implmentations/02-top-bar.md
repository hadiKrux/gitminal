# 02 - Top bar

## 1. Header

Spec reference: `docs/product-spec.md` section 3 "Application shell" (lines 67-162), section 5 F-02 (lines 207-319), section 6 "Keyboard map" Top bar (lines 1539-1704), section 6.1 "Action IDs" (lines 1705-1742), section 9 "Resolved product decisions" D4, D14, and D15 (lines 1865-1889), and section 10 "Assumed defaults" (lines 1890-1908).
Dependencies: F-01 `01-app-shell-and-focus.md` (the `top-bar` region and `nav.left` / `nav.right`), F-04 `04-remotes-panel.md` (fetch scope and remote list), F-05 `05-tags-panel.md` (`tag.push` shadowing `remote.push`), F-13 `13-console.md` (command log), F-15 `15-overlays-and-confirmations.md` (force push confirmations and error overlay), F-16 `16-repository-states.md` (detached, no upstream, upstream gone, no remote, no origin), F-17 `17-freshness-and-performance.md` (refresh after operations), F-18 `18-safety-and-platform-behavior.md` (redaction, no prompts), F-20 `20-theme-and-colors.md` (progress bar colors).
Owned paths: `src/features/top-bar/TopBar.tsx`, `src/features/top-bar/TopBar.constants.ts`, `src/features/top-bar/TopBarStatus.tsx`, `src/features/top-bar/TopBarStatus.constants.ts`, `src/features/top-bar/SyncStateBadge.tsx`, `src/features/top-bar/SyncStateBadge.constants.ts`, `src/features/top-bar/TopBarActions.tsx`, `src/features/top-bar/MoreMenu.tsx`, `src/features/top-bar/MoreMenuLive.tsx`, `src/features/top-bar/MoreMenu.constants.ts`, `src/features/top-bar/topBar.budgets.ts`, `src/features/top-bar/topBar.budgets.types.ts`, `src/features/top-bar/topBar.controls.ts`, `src/features/top-bar/topBar.status.ts`, `src/features/top-bar/useTopBar.ts`, `src/features/top-bar/useTopBar.types.ts`, `src/features/top-bar/useTopBarAvailability.ts`, `src/features/top-bar/useTopBarCommands.ts`, `src/features/top-bar/useTopBarMenu.ts`.
Referenced shared modules (not owned here): `src/domain/commands/commands.registry.ts`, `src/domain/commands/commands.runner.ts`, `src/domain/commands/commands.availability.ts`, `src/domain/commands/commands.reasons.ts`, `src/domain/commands/commands.remote.ts`, `src/app/hooks/useCommandRunner.ts`, `src/app/hooks/useRemoteCommands.ts`, `src/domain/repository/repository.upstream.ts`, `src/domain/repository/repository.selectors.ts`, `src/domain/git/git.remotes.ts`, `src/domain/git/git.progress.ts`, `src/domain/git/git.client.ts`, `src/ui/ProgressBar.tsx`, `src/ui/Spinner.tsx`.

This document follows the 14-section contract in `00-project-architecture.md` section 14. Where it and the architecture contract disagree, the architecture contract wins.

## 2. Scope and non-goals

In scope: rendering the app identity, current branch or detached short hash, upstream name, ahead and behind counts, and the sync state badge; the Pull and Push buttons; the More menu with Fetch, Fetch --prune, Push force (safe), Push force (overwrite), and Push --no-verify; the `remote.*` action IDs `remote.pull`, `remote.push`, `remote.pushForceSafe`, `remote.pushForceOverwrite`, `remote.pushNoVerify`, `remote.fetch`, `remote.fetchPrune`, and `remote.more`; scoped fetch behavior; the two-phase Fetch --prune confirmation; push with no upstream auto-create; force push variants and their confirmations; detached HEAD, no-remote, and no-origin states; operation progress with an OpenTUI FrameBuffer progress bar; and transient success, warning, error, and informational status messages in the top bar middle section.
Non-goals: the keymap format (F-19 `19-configuration-and-keybindings.md`); the remote branch list and filter (F-04 `04-remotes-panel.md`); tag push (F-05 `05-tags-panel.md`); the confirmation modal structure itself (F-15 `15-overlays-and-confirmations.md`); repository state detection primitives (F-16 `16-repository-states.md`); console rendering (F-13 `13-console.md`); footer hints and contextual disabled reasons (F-01 `01-app-shell-and-focus.md`).

## 3. OpenTUI components used

| Component | Where used | Why it is the right component |
| --- | --- | --- |
| `<box>` | `TopBar` frame, the identity block, the middle status strip, `TopBarActions`, each `Button`, and the `MoreMenu` frame. | The only layout, border, and hit-test primitive. |
| `<text>` | App identity "Gitminal", branch name, detached short hash plus "detached" label, upstream name, ahead and behind text, operation phase, status message, percentage, and disabled reasons. | Every string. |
| `<span>` | The sync state badge inside `SyncStateBadge`, the ahead/behind counts, the status marker, the percentage, and the button label runs. | Inline runs inside `<text>`. |
| `<frame-buffer>` | The one-row progress bar inside `TopBarStatus`, rendered only through the `ProgressBar` primitive. | OpenTUI's cell-level drawing surface gives an exact-width bar with theme colors and no dependence on glyph widths. |
| `<select>` | The `MoreMenu` modal option list. | Vertical option list with built-in up/down and Enter, and `description` carrying the disabled reason. |
| `<tab-select>` | Not used for the buttons; documented in section 3.1. | N/A here. |
| `<scrollbox>` | Not needed; the More menu has five fixed rows. | N/A here. |
| `<ascii-font>`, `<input>`, `<diff>`, `<code>`, `<line-number>`, `<markdown>`, `<textarea>` | Not used here. | N/A here. |

Hooks used: `useTerminalDimensions` for truncation and status-strip width budgets, `useActions` to register the `remote.*` global action IDs from the top bar as their single designated owner plus the top-bar `nav.*` handlers, `useStatus` for transient status and operation progress, `useOverlay` for the More menu and force push confirmations, and `useRepository` through `useTopBarAvailability` for the snapshot and target-aware availability. `useTimeline` is used only by `src/ui/Spinner.tsx` for its animation; the top-bar hook and components do not call it. `useFocusRegion` is not called by this feature either: `AppShell.tsx` owns the `top-bar` region frame and `useTopBar` receives derived repository data. `useKeyboard` is never called here; all keys arrive through `useHotkeys` in `src/app/hooks/useHotkeys.ts`. Features never register `remote.pull`, `remote.push`, `remote.fetch`, `remote.fetchPrune`, `remote.more`, or the force and no-verify variants.

### 3.1 Pull and Push button composition

Pull and Push are explicit text buttons, never icon-only, and their order is Pull then Push. They are composed from `box` plus `text` through the `ui/Button.tsx` and `ui/ButtonRow.tsx` primitives, because the strip mixes static content (branch info and the sync badge) with focusable controls, and because the focused control kind is app state that `ButtonRow` renders with `nav.left` and `nav.right`. `<tab-select>` is not used for these buttons: it cannot render the sync badge alongside the labels, and it would force a uniform-row model onto a mixed strip. `<tab-select>` remains the right component only where a horizontal selector with native Left/Right is the whole control, as in the collapsed sidebar switcher in F-01.

The mockup shows up and down arrows for Push and Pull. The repo's ASCII-only rule forbids Unicode arrows, so the icons are ASCII `^` for Push and `v` for Pull from `src/theme/icons.ts`. They render as the explicit text buttons `v Pull`, `^ Push`, and `... More`; the More button reuses `ICONS.ellipsis`. In `gitminal.png` the identity is the top border title and there is one content row with `master` and the three icon buttons. The implementation deliberately uses two content rows instead: row one is the bold identity, and row two is the status strip on the left with the action buttons on the right. The bar stays two fixed rows and never wraps. This two-row deviation keeps the identity visible while the operational row carries focus, progress, and disabled reasons.

The status strip is the middle of the second row. It is the single surface for branch information, operation progress, and transient status, and it is not focusable. When it is idle it is also a `nav.left`/`nav.right` stop for the branch info, as section 8 describes; while a message or operation is showing, the branch info stop disappears. Focus is stored as a control kind, not a position, so hiding that stop cannot move focus from Pull to Push.

### 3.2 Status strip and progress bar

The top bar middle section is `TopBarStatus`. It renders exactly one of three modes: branch info when idle, operation progress while a command runs, or a transient status message after a command finishes. It sits at the left of the second row, between the frame's focus marker and `TopBarActions`, with a width budget from `useTerminalDimensions`. `topBar.budgets.ts` splits the row between the strip and the disabled reasons. It reserves the actual reason text plus the focus marker, shrinks reasons first, and gives the strip a 20-cell minimum, so the branch, the sync badge, and the action labels survive at 80 and 100 columns.

The progress bar is `ProgressBar` from `src/ui/ProgressBar.tsx`. OpenTUI 0.6.6 has no React intrinsic for `FrameBufferRenderable`, so `ProgressBar` registers OpenTUI's own renderable once with `extend({ "frame-buffer": FrameBufferRenderable })` and augments `OpenTUIComponents` for JSX typing. The registered `<frame-buffer>` is one row high and as wide as the strip budget allows, between 8 and 24 cells.

`ProgressBar` draws the track with the `surface` token and the filled portion with the `accent` token through `fillRect`. This follows the one-row cell-buffer approach of the [OpenTUI FrameBuffer progress-bar example](https://opentui.com/docs/components/frame-buffer/#example-progress-bar), but draws colored cells instead of block glyphs so the output stays ASCII-safe. It clamps progress to `0` to `100`, rounds the filled cell count, calls `requestRender()` after a change, and subscribes to `useTerminalDimensions` so a height-only resize also redraws the cleared buffer. The bar contains no text. The phase, operation label, and percentage are ordinary `<text>` and `<span>` siblings, so the display still carries meaning with `NO_COLOR`. When no percentage is known, `TopBarStatus` renders the spinner instead and passes a zero width, so no empty 0 percent bar is drawn.

The status strip is not focusable. `nav.left` and `nav.right` skip it and move between the branch info when shown, Pull, Push, and More. It has no mouse handlers and no keybindings.

All icons and markers used by this feature come from `src/theme/icons.ts`; see architecture section 6.1. No glyph literal is written in feature code.

## 4. Component tree

```text
TopBar                          (src/features/top-bar/TopBar.tsx)
-> box (column, two fixed rows)
   -> box (row 1: identity)
      -> text                    "Gitminal", bold
   -> box (row 2)
      -> box (grow)
         -> TopBarStatus         (src/features/top-bar/TopBarStatus.tsx)
            -> text (phase + percentage)     when an operation runs or a status is active
            -> Spinner                        when an operation runs without a percentage
            -> ProgressBar                    when an operation runs with a percentage
               -> frame-buffer                (FrameBufferRenderable via src/ui/ProgressBar.tsx)
            -> branch info                    when idle
               -> text (branch name)          or short hash + "detached"
               -> span (upstream name)        when an upstream exists
               -> span ("ahead N")            when an upstream exists
               -> span ("behind N")           when an upstream exists
               -> SyncStateBadge              (src/features/top-bar/SyncStateBadge.tsx)
      -> TopBarActions              (src/features/top-bar/TopBarActions.tsx)
         -> ButtonRow
            -> Button (v Pull)
            -> Button (^ Push)
            -> Button (... More)
   -> MoreMenu (modal, conditionally)   (src/features/top-bar/MoreMenu.tsx)
      -> ModalFrame
         -> select
```

`useTopBar.ts` supplies branch text, upstream text, ahead and behind counts, sync state, availability, and the focused control kind. The More menu open state lives in `OverlayProvider`, not in a local flag. `useTopBar` combines repository data with status and progress from `useStatus` to select the `TopBarStatus` mode. It reads repository data from `@/domain/repository` and never recomputes ahead/behind or upstream state itself.

`MoreMenuLive` rebuilds the menu options from the repository and status providers on every render, so a read that settles while the menu is open updates the visible reasons. `MoreMenu` reports only the selected command ID, never a raw key or an ambient cursor. `useTopBarCommands` resolves the explicit target (`{ kind: "none" }` for fetch and Fetch --prune, `{ kind: "branch", name: currentBranch }` for the force and no-verify variants), pre-checks availability, and opens the force confirmations through `OverlayProvider` before the command runner is invoked; an unavailable item keeps the menu open and shows its reason.

## 5. Enforced files and folders

| File | Responsibility |
| --- | --- |
| `src/features/top-bar/TopBar.tsx` | Two-row top-bar frame, app identity, and composition of `TopBarStatus`, `TopBarActions`, and the More menu overlay entry. |
| `src/features/top-bar/TopBar.constants.ts` | Identity text, budget constants, overlay ids, and the exact force-push confirm labels. |
| `src/features/top-bar/TopBarStatus.tsx` | Renders the middle status strip from the mode selected by `useTopBar`: branch info, progress, or transient status; renders the phase, percentage, `Spinner`, and `ProgressBar`. |
| `src/features/top-bar/TopBarStatus.constants.ts` | Spinner, phase, and separator widths used by the status strip. |
| `src/features/top-bar/SyncStateBadge.tsx` | Renders "up to date", "ahead", "behind", "diverged", "no upstream", or "upstream gone" as a span plus a text marker. |
| `src/features/top-bar/SyncStateBadge.constants.ts` | Marker, label, and color token for every sync state. |
| `src/features/top-bar/TopBarActions.tsx` | Renders the Pull, Push, and More text buttons, their disabled reasons, and the focused control kind. |
| `src/features/top-bar/MoreMenu.tsx` | Presentational modal `<select>` with Fetch, Fetch --prune, Push force (safe), Push force (overwrite), and Push --no-verify. Each option carries its availability reason and reports only its command ID, never a raw key. |
| `src/features/top-bar/MoreMenuLive.tsx` | Live container used by the overlay entry; reads repository and status state and rebuilds the options on every render. |
| `src/features/top-bar/MoreMenu.constants.ts` | Menu title, option-list id, and requested size. |
| `src/features/top-bar/topBar.budgets.ts` | Splits the top-bar width between the status strip and the disabled action reasons using their actual text. |
| `src/features/top-bar/topBar.budgets.types.ts` | Type-only `TopBarBudgets` interface. |
| `src/features/top-bar/topBar.controls.ts` | Pure control and More-option builders with the explicit command target resolution. |
| `src/features/top-bar/topBar.status.ts` | Pure status-mode selection with the documented precedence. |
| `src/features/top-bar/useTopBar.ts` | Selects display data from `@/domain/repository`, reads availability, holds the focused control kind, derives its index from the visible list, derives the status-strip mode, and registers the single global `remote.*` handler for each action plus the top-bar `nav.*` handlers. |
| `src/features/top-bar/useTopBar.types.ts` | Type-only controls, options, status modes, and hook contracts. |
| `src/features/top-bar/useTopBarAvailability.ts` | Branch and target-aware availability reader shared by the buttons and the live More menu. |
| `src/features/top-bar/useTopBarCommands.ts` | Dispatch, availability pre-check, the auto-create success text derived from the actual argv, and the branch-bound force-push confirmation routing. |
| `src/features/top-bar/useTopBarMenu.ts` | The More menu overlay entry and its toggle. |

## 6. State model

Provider state: the repository snapshot, the selected commit, and the right-pane selection live in `RepositoryProvider`. Transient status and operation progress live in `StatusProvider`. The modal stack, including the More menu and the force push confirmation, lives in `OverlayProvider`. The resolved keymap lives in `KeymapProvider`.

View state (local, in `useTopBar.ts`): only the focused control kind for `nav.left` and `nav.right`; its index is derived from the visible control list. The More menu open state is overlay state, not a second local flag. No component keeps a copy of ahead/behind, upstream state, sync state, or availability; all of those are derived in `@/domain/repository/repository.selectors.ts` and `@/domain/commands/commands.availability.ts`.

Availability is target-aware. `useTopBar` calls `getAvailability(commandId, { state, signals, target, region, operation })` for each control, where `push`, force push, and pull use `{ kind: "branch", name: currentBranch }` and fetch uses `{ kind: "none" }` because its scope spans the upstreams of all local branches. Repository-wide gates such as detached HEAD, empty repository, no remote, and operation in progress come from `gateRepository(actionId, state, signals)` inside that call. The buttons, More menu options, footer, help, and palette all render the same result and reason.

Derived display: `useTopBar` calls selectors for the branch label (branch name or detached short hash plus "detached"), the upstream ref name, the ahead and behind counts, and the sync state. It never computes these from raw refs.

Status mode: `TopBarStatus` renders the first matching mode in this order:

1. Running operation: phase, `Spinner` or `ProgressBar`, and percentage when known.
2. Error or warning summary: text marker plus the short message; warning and error statuses stay until another status replaces them. The persistent `ErrorOverlay` lands in M6.
3. Success or informational status: text marker plus the short message, for a bounded timeout of about five seconds.
4. Idle: branch name or detached label, upstream, ahead and behind counts, and `SyncStateBadge`.

The timeout is owned by `StatusProvider`, not by `TopBarStatus`. `TopBarStatus` is a pure projection of `StatusProvider` plus the repository snapshot, so a re-render never resets a message's lifetime.

## 7. Data flow

Pull: action ID `remote.pull` -> the single global `useAction` handler in `useTopBar` -> `useCommandRunner.runCommand({ commandId: "remote.pull", target: { kind: "branch", name: currentBranch } })` -> `commands.runner.ts` checks availability and serialization -> `@/domain/git/git.client.ts` runs `git pull --progress --no-edit` for the current branch and upstream -> output parsed into a `CommandResult` -> the orchestrator refreshes `RepositoryProvider`, appends a console entry, and sets status -> `TopBar` re-renders.

Push: action ID `remote.push` -> the single global handler -> `useCommandRunner.runCommand({ commandId: "remote.push", target: { kind: "branch", name: currentBranch } })` -> the executor reads `git branch --show-current` and refuses to push if it differs from `currentBranch` -> it reads the configured upstream with `git for-each-ref --format=%(upstream:remotename)%09%(upstream:remoteref) refs/heads/<branch>` -> `git push --progress -- <upstream.remote> refs/heads/<branch>:refs/heads/<upstream.branch>`. The explicit remote and the captured-branch refspec are deliberate: a bare `git push` obeys the user's `push.default`, so `matching` could update unrelated branches, a differently named configured upstream would fail or go to the wrong remote, and `HEAD` could have moved after the snapshot. The remotename/remoteref atoms are deliberate too: `%(upstream:short)` is ambiguous when a remote name contains `/`, and splitting it would push to a different remote. When there is no upstream, the command runs `git push --progress --set-upstream origin refs/heads/<branch>:refs/heads/<branch>`, which creates `origin/<branch>` and sets the upstream without an extra modal. The operation phase shows `creating origin/<branch>` before the invocation, and the success text is derived from the argv that actually ran (`--set-upstream`), not from a stale snapshot. If no `origin` remote exists, the command fails with an error listing the configured remotes and never guesses another remote. If the configured upstream exists but its remote branch is gone, Push recreates that configured upstream branch, not `origin/<branch>` under a different name.

Push --no-verify: action ID `remote.pushNoVerify`, dispatched by the More menu with an explicit command ID and `{ kind: "branch", name: currentBranch }` target -> `git push --progress --no-verify -- <upstream.remote> refs/heads/<branch>:refs/heads/<upstream.branch>` with the same captured-branch check, explicit-refspec, and auto-create behavior as Push. It has no default key and is also palette-invocable.

Force push (safe): action ID `remote.pushForceSafe` -> `git push --progress --force-with-lease -- <upstream.remote> refs/heads/<branch>:refs/heads/<upstream.branch>` -> requires an existing upstream.
Force push (overwrite): action ID `remote.pushForceOverwrite` -> `git push --progress --force -- <upstream.remote> refs/heads/<branch>:refs/heads/<upstream.branch>` -> requires an existing upstream.
Both are disabled when there is no upstream with the reason "no upstream; use Push to create it first." Both open a confirmation that names the branch and remote and capture the branch, upstream ref, command, and target it authorises. On confirm those values are compared with the latest repository state; a branch or upstream change closes the confirmation with "branch or upstream changed; open the confirmation again" and runs nothing. The safe option is visually primary and the overwrite option is never the default focused action. Neither has a default key; the More menu and the palette are their entry points.

Fetch: action ID `remote.fetch` -> the single global handler -> `useCommandRunner.runCommand({ commandId: "remote.fetch", target: { kind: "none" } })` -> scoped fetch. The scope is the upstream refs of all local branches, grouped by remote and deduplicated. It is read with `git for-each-ref --format=%(refname:short)%09%(upstream:remotename)%09%(upstream:remoteref) refs/heads`, so the remote and branch come from git's explicit atoms and a slash-named remote is never split. For each remote group the command runs `git fetch --progress -- <remote> <refspec>` with the deduplicated refspecs. A truncated upstream-scope read is a failed command; it never becomes an empty scope. Local branches without an upstream are skipped. Remote branches that are not the upstream of a local branch are not updated. If no local branch has an upstream, Fetch is unavailable with the reason "no local branches with upstreams". A failure for one remote does not stop the other groups, and a missing upstream ref is non-fatal and marks the branch `[?] upstream not found`, with a warning that names the upstream ref, for example `origin/feature`. The result reports partial success, for example "Fetched 4 upstreams; 1 upstream missing; 1 remote failed."

Fetch --prune: action ID `remote.fetchPrune` -> `useCommandRunner.runCommand({ commandId: "remote.fetchPrune", target: { kind: "none" } })`. It uses the same scope, read from the tab-separated `remotename`/`remoteref` atoms, so each group's remote and branch are exact even when a remote name contains `/`. It runs in two phases so a failed remote check can never be mistaken for a deleted branch:

1. Confirm absence. For each affected remote, emit the phase `checking <remote>` and run `git ls-remote --heads -- <remote>` to build the set of advertised heads. A non-zero exit, timeout, cancellation, truncated output, or unparsable output makes that remote's result `unknown`; no ref from that remote is pruned. Truncation matters because the client keeps only the head and tail of a stream, so a branch in the dropped middle would otherwise look absent.
2. Update and delete confirmed refs. For each advertised in-scope ref, run `git fetch --progress -- <remote> <ref>` without `--prune`; a ref that was not advertised is never fetched by name. Then delete each in-scope remote-tracking ref that is still present locally and absent from the confirmed head set with `git update-ref -d -- refs/remotes/<remote>/<branch>`. Only confirmed stale tracking refs are deleted, and unrelated out-of-scope refs are never touched. If the fetch for a group fails, times out, or is cancelled, that group is `unknown` and the delete phase does not run for it.

A confirmed missing upstream is classified `[?] remote branch deleted`. A failed or timed-out remote check keeps the prior classification as `[?] upstream not found` or `unknown`, never `deleted`. Local branches whose upstream ref disappeared are re-evaluated after the delete phase, and a branch whose upstream ref was found again clears the indicator. Remote branches without a local upstream keep their last known state.

More menu: action ID `remote.more` -> the single global handler opens `MoreMenuLive` through `OverlayProvider`. Each `<select>` option has a `description` equal to the display text of `getAvailability(commandId, context).reason`, rebuilt on every render, and selecting it reports its command ID. `useTopBarCommands` resolves the target as described in section 4. The menu never replays a raw key and never reads a hidden panel cursor.

Progress: remote operations pass `--progress` and stream stderr through `@/domain/git/git.progress.ts`, which publishes percentage and phase. `commands.runner.ts` forwards each event to its progress callback; `useCommandRunner` calls `StatusProvider.beginOperation` before execution and `StatusProvider.updateOperation` for each event. `TopBarStatus` renders the phase text, a `Spinner` when no percentage is known, and a `ProgressBar` plus percentage when git reports one. Completion replaces the running state with a success or warning status, or an error status; the persistent `ErrorOverlay` lands in M6.

Network operations use the 120 second network timeout from `git.client.ts` and the `AbortSignal` owned by `useCommandRunner`. A timeout sends the same `SIGTERM`, then `SIGKILL` path as a cancel and returns a result with `timedOut: true`; a quit or explicit cancel returns `cancelled: true`. Both are warning results: they refresh the repository so partial local effects are visible, append one console entry, set a warning status such as "cancelled" or "timed out after 120 seconds" when the client reported the timeout duration, and never open a success status or claim a pruned or pushed ref. A failed Fetch --prune confirmation leaves the affected remote group `unknown` and reports it in the partial-success status. A run where every remote group failed and nothing was fetched or pruned is a failed command, not a success with warnings.

Availability agreement: `TopBarActions`, `MoreMenuLive`/`MoreMenu`, and the footer all read `getAvailability(commandId, context)` from `@/domain/commands/commands.availability.ts`, which combines repository-wide gates from `gateRepository(actionId, state, signals)` (detached HEAD, no remote, empty repository, operation in progress) with target validation. The footer resolves the same branch or `none` target and filters its `remote.*` hints by that result, falling back to handler presence only when no repository provider is mounted. The palette and help are not built yet and will read the same result when they land; the footer already agrees with the top bar instead of advertising a blocked action.

## 8. Keyboard and focus

Action IDs only (product spec section 6.1). No raw key strings.

| Context | Action IDs | Behavior |
| --- | --- | --- |
| Top bar | `nav.left`, `nav.right` | Move between branch info when idle, Pull, Push, and More. The status strip is skipped. |
| Top bar | `nav.activate` | Activate the focused control. |
| Global | `remote.pull` | Pull. |
| Global | `remote.push` | Push. |
| Global | `remote.fetch` | Fetch. |
| Global | `remote.fetchPrune` | Fetch --prune, with the two-phase confirmation and delete. |
| Global | `remote.more` | Open the More menu. |
| Global | `remote.pushForceSafe` | Push force (safe), no default key; More menu and palette only. |
| Global | `remote.pushForceOverwrite` | Push force (overwrite), no default key; More menu and palette only. |
| Global | `remote.pushNoVerify` | Push --no-verify, no default key; More menu and palette only. |
| Direct focus | `focus.region.topBar` | Shell-owned action that focuses the top bar. It has no default key; the top bar has no digit. |
| Modal | `nav.up`, `nav.down`, `nav.activate`, `overlay.close` | Navigate and run More menu options, or close the menu. |

Precedence: `useHotkeys` in `src/app/hooks/useHotkeys.ts` resolves the same global action IDs for every region. When another region is focused, `remote.pull`, `remote.push`, `remote.fetch`, `remote.fetchPrune`, and `remote.more` remain global unless that region defines a context key on the same key. Tags is the concrete case: `tag.push` shadows `remote.push` while Tags is focused, so the footer shows Push selected tag, not Push branch. `useTopBar` registers each `remote.*` handler once with the `global` scope and the `top-bar` owner, and registers `nav.left`, `nav.right`, and `nav.activate` in the `top-bar` scope, through one batched registration; it never inspects key events. The force and no-verify variants have no default key, so they are reached through the More menu, the palette, and help. Features never register a `remote.*` action, so a sidebar panel that unmounts in the collapsed layout cannot remove a global remote handler. While any overlay is open, including the More menu and a force push confirmation, `remote.*` is unreachable; only `overlay.close`, `app.quit`, and the same overlay's toggle may resolve.

Focus: the `top-bar` frame is a focusable region frame with `focusedBorderColor`. Entering it with Tab, a click, or the palette's Focus Top Bar command gives native focus to the frame or the clicked control; `FocusProvider` derives `top-bar` from the focused renderable's ancestor and the border follows natively. The `1`-`9` direct region jumps deliberately skip the top bar. The focused control kind remains local to `useTopBar`; it is not a second native focus. Its index is derived from the current control list, so the idle info stop disappearing does not move focus to Push, and `nav.activate` does nothing while the focused kind is hidden. Mouse activation sets the focused kind. The status strip is not focusable and is skipped by `nav.left` and `nav.right`.

## 9. Loading, empty, error, and disabled states

- Loading: before the first repository read completes, the status strip shows "loading repository" and the buttons render disabled with the reason "loading repository". If that first read fails and there is no snapshot yet, the strip shows the error marker plus the redacted `lastRefreshError` message instead, so a failed read never looks stuck; no error overlay opens, because the overlay remains M6. Remote progress shows the phase and a `Spinner`, plus the `ProgressBar` and percentage when git reports one; a new phase with no percentage clears the previous percentage. The footer keeps its hints. After the read settles, a terminal state such as not-a-repository, bare, missing-git, or permission-error renders only the state label, with no fake loading branch and no sync badge.
- Empty: an empty repository shows the unborn branch name and no ahead/behind counts; Push is disabled with the reason "no commits yet". The upstream block is omitted when there is no upstream. The status strip returns to branch info when there is no message.
- Error: a failed remote operation sets an error status with the redacted git output and writes a console entry; the status strip shows the failure summary. The persistent `ErrorOverlay` lands in M6. The repository state refreshes after the failure. The top bar never claims success on failure.
- Cancelled or timed out: the status strip shows a warning with "cancelled" or "timed out after 120 seconds", the console records one cancelled or timed-out entry, and the repository refreshes. No ref is reported as pushed, pruned, or up to date.
- Failed or unknown remote check: a Fetch --prune group whose `ls-remote` failed, timed out, was cancelled, or was truncated is reported as "unknown" in the partial-success status. Its refs keep their previous classification and are never shown as deleted or pruned.
- Disabled: each control renders with the `dim` token plus its reason text and stays visible. Reasons include "detached HEAD", "no remote", "no upstream; use Push to create it first.", "no local branches with upstreams", "no commits yet", and "operation in progress".
- Detached HEAD: the branch name is replaced by the short hash plus the "detached" label; Pull, Push, and force variants are disabled with the reason "detached HEAD".
- No remote: Pull, Push, Fetch, Fetch --prune, and every More menu item are disabled with the reason "no remote"; the More button itself stays available so the menu can explain them.
- No origin but other remotes exist: Push without an upstream is available in the UI but the command fails with a clear error listing the configured remotes; the app does not guess another remote.
- Upstream gone: the sync badge reads "upstream gone" with a `[?]` marker; Pull is disabled with the reason "upstream gone; push to recreate it"; Push recreates the configured upstream branch.
- Text markers: `[?]` for a missing upstream, plus `[v]`, `!`, `x`, and `i` markers for success, warning, error, and information status. Color is never the only signal.

## 10. Performance and bounds

- The top bar is a fixed two-row block; it never scrolls and never wraps. Row one is the app identity and row two holds the status strip and the actions. The status strip shares row two and never changes the top bar height. At 80 and 100 columns the budget reserves the actual reason text plus the focus marker and keeps a 20-cell status minimum, so a short reason never hides the branch and the action strip never overflows.
- Branch, upstream, phase, status, and ahead/behind strings truncate through `@/lib/text.ts` with a budget from `useTerminalDimensions`. Truncation never hides the current branch when idle, the sync state, or the Push button. Pure budget tests cover 80 and 100 columns with zero, one, and two disabled actions.
- Progress updates do not trigger a repository read. `ProgressBar` redraws only when the rounded filled-cell count, width, a terminal resize, or the theme color changes, then calls `requestRender()`, and a height-only resize redraws even when the width is unchanged because the buffer was cleared. The 100 ms timer in `ProgressBar` is the deliberate throttling mechanism; `useTimeline` is used only by `Spinner`, and this deviation from the architecture's earlier `useTimeline` assignment is recorded in `00-project-architecture.md` section 6. A status timeout re-render only swaps text.
- The progress bar is bounded to 24 cells and hidden below 8 available cells; the percentage text remains. No allocation grows with terminal width.
- The More menu has a fixed five rows and does not need virtualization.
- Availability is computed per render from the latest provider store through `useRepositoryAvailability`; it is intentionally not cached, because it also reads the command latch and orchestration slot at call time. The matrix is O(number of controls) and cheap, and a stale cache would be worse than the small recompute.
- `commands.remote.ts` is above the file-size review threshold and keeps the prune orchestration on purpose. The recorded extraction target is `commands.prune.ts` for the prune orchestration and, if useful, `commands.remote.push.ts` for the push and upstream readers; extract when a fourth composite remote command lands or before the v1 freeze.

## 11. Safety and confirmations

- Force push variants require an existing upstream and always open a confirmation that names the branch, upstream, command, and target it authorises. The confirmation revalidates those values on confirm; a branch or upstream change closes it with a warning and runs nothing. The safe variant runs `--force-with-lease` and explains that it refuses to overwrite commits this clone has not fetched. The overwrite variant runs literal `--force`, uses a stronger warning that remote commits not present locally can be lost, and is never the default focused action.
- Push never force-pushes. When `origin/<branch>` already exists and the push is not a fast-forward, the push fails and leaves the local branch unchanged. Only the explicit `remote.pushForceSafe` and `remote.pushForceOverwrite` commands force, and each requires a fresh confirmation.
- Fetch --prune confirms remote absence before deleting any tracking ref. A non-zero, timed-out, cancelled, truncated, or unparsable `git ls-remote` result is `unknown`, and the affected refs are retained. The command never treats a failed remote check as a deleted branch and never deletes an out-of-scope ref.
- Upstream routing is unambiguous. Push, scoped Fetch, and Fetch --prune read `%(upstream:remotename)` and `%(upstream:remoteref)`, keep the exact remote name including any `/`, and never split a display ref; `%(upstream:short)` is display-only. This prevents a legal slash-named remote from being addressed as its prefix remote.
- No credentials are requested. Credential prompts are disabled, so an auth failure fails visibly instead of hanging, and the command is recorded in the console with secrets redacted by `@/domain/git/git.redact.ts`.
- Writes are serialized by `commands.runner.ts`; a second remote write while one is running, or while the first command still applies its post-result refresh and status effects, returns a blocked result with "operation in progress" and leaves the first operation visible.
- A failed operation never clears the user's commit message or staged files.

## 12. Acceptance mapping

| Product spec acceptance bullet | Implementing module or component |
| --- | --- |
| "Pull, Push, Fetch, Fetch --prune, safe force push, overwrite force push, and push --no-verify all run the expected git operation and are visible in the console." (F-02 acceptance) | `src/features/top-bar/useTopBar.ts`, `MoreMenuLive.tsx`, `@/domain/commands/commands.registry.ts`, `@/domain/commands/commands.runner.ts`, `@/domain/commands/commands.remote.ts`, `@/domain/commands/commands.fetch.ts`, `@/app/hooks/useCommandRunner.ts`, `ConsoleProvider`. |
| "Push with no upstream creates origin/<local-branch-name> and sets the upstream without an extra modal." (F-02) | `src/domain/git/git.remotes.ts` planning `git push --progress --set-upstream origin refs/heads/<branch>:refs/heads/<branch>` and `src/domain/commands/commands.remote.ts` executing it. |
| "The top bar updates branch, upstream, and ahead/behind state after every successful operation." (F-02) | `RepositoryProvider` refresh plus `SyncStateBadge.tsx` and `@/domain/repository/repository.selectors.ts`. |
| "The top bar middle section shows the operation phase and a FrameBuffer progress bar with a percentage (when git reports one) during Pull, Push, Fetch, and Fetch --prune, and shows transient status messages when no operation is running." (F-02 acceptance) | `TopBarStatus.tsx`, `src/ui/ProgressBar.tsx`, `StatusProvider`, and `git.progress.ts`. |
| "A failed operation never clears the user's commit message or staged files." (F-02) | `useCommandRunner.ts` result handling and `commands.runner.ts`; the runner returns the result without mutating drafts. |
| "Pull and Push are explicit text buttons with icons, not icon-only controls. Their order is Pull then Push." (F-02) | `src/features/top-bar/TopBarActions.tsx` composed from `ui/Button.tsx` and `ui/ButtonRow.tsx`. |
| "The menu shows why an item is unavailable, for example no remote or detached HEAD." (F-02) | `src/features/top-bar/MoreMenuLive.tsx` and `MoreMenu.tsx` option `description` from `getAvailability(commandId, context).reason`, rebuilt on each render. |
| "Fetch updates only the upstream refs of local branches and does not fetch unrelated remote branches." (v1 acceptance) | Scoped fetch in `src/domain/commands/commands.fetch.ts` via `commands.registry.ts`. |
| "Fetch --prune ... first confirms remote absence with git ls-remote --heads <remote> ... then removes only the confirmed stale remote-tracking refs." (F-02) | The two-phase orchestration in `@/domain/commands/commands.remote.ts` with planning and parsing in `@/domain/git/git.remotes.ts`; deletion is `git update-ref -d` only after a successful, untruncated confirmation. |
| "A failed or timed-out remote check is unknown, not missing or deleted." (F-02) | `commands.remote.ts` result classification and `repository.upstream.ts`; no `deleted` state is written for an unknown or truncated group. |
| "Fetch --prune marks local branches with missing upstream refs as [?] remote branch deleted." (v1 acceptance) | `useRemoteCommands` folds the pruned and unknown refs into repository evidence and refreshes once; `repository.upstream.ts` re-evaluates the confirmed delete phase. |
| "Push with no upstream creates origin/<local-branch-name>, sets the upstream, and updates the top bar without an extra modal." (v1 acceptance) | `commands.remote.ts` push branch and `RepositoryProvider` refresh. |

## 13. Tests to add

- `src/features/top-bar/SyncStateBadge.test.tsx`: renders each of the six sync states with the correct text and marker, including `[?]` for upstream gone.
- `src/features/top-bar/TopBarStatus.test.tsx`: selects branch info when idle, progress when running, and status when a message is active; checks the precedence order; checks that the initial operation renders the label once, that a running operation without a percentage renders the spinner, that a percentage renders the bar and text, that a terminal repository state renders neither a fake loading branch nor a sync badge, and that a failed first read renders the error marker and message instead of "loading repository".
- `src/ui/ProgressBar.test.tsx`: clamps progress to `0` to `100`, rounds the filled cells, draws the track and fill with the expected theme colors through the FrameBuffer, calls `requestRender()` on a percent change and after a width change, and redraws after a height-only resize.
- `src/features/top-bar/topBar.budgets.test.ts`: 80 and 100 columns with zero, one, and two disabled actions keep the status minimum and never overflow the row, including two maximum-length reasons.
- `src/features/top-bar/TopBarActions.test.tsx`: Pull and Push render as text buttons in that order; disabled controls show the exact reason and remain visible; the focus marker follows the focused control kind as `nav.left` and `nav.right` move it.
- `src/features/top-bar/MoreMenu.test.tsx`: the five options render; each disabled option exposes its reason; selecting an enabled option reports its explicit command ID; the live container updates reasons after a read settles while open; no option dispatches a raw key.
- `src/features/top-bar/useTopBar.test.tsx`: detached HEAD, no upstream, upstream gone, no remote, no-origin, empty repository, and operation-in-progress cases select the expected labels and availability reasons; focus survives the idle info stop disappearing; each `remote.*` handler is registered exactly once with `scope: "global"`; the `p`, `P`, and `F` keybindings reach their commands; and a rendered 80- and 100-column frame keeps the branch and two maximum reasons readable. Duplicate registration is covered by `useRemoteCommands.test.tsx` and the `useAction` tests.
- `src/app/AppShellHost.test.tsx`: the More menu opens a force confirmation through `MoreMenuLive`, no command runs before confirmation, and cancelling restores the top-bar focus.
- `src/domain/commands/commands.availability.test.ts`: availability matrix covering detached HEAD, no upstream, upstream gone, no remote, no-origin-but-other-remotes, empty repository, operation in progress, missing target, and stale target, asserting the exact reason strings the top bar renders; repository-wide gates come from `gateRepository`.
- `src/domain/commands/commands.remote.test.ts`: push argv for every variant, auto-create argv, truncation handling, prune ordering, check failure, fetch failure, cancellation, multiple remotes, total failure, and the prune check phase.
- `src/domain/commands/commands.remote.integration.test.ts`: a real bare remote with `push.default=matching` proves a force push updates only the current branch, a differently named configured upstream is updated by name, moving `HEAD` to another branch while the target stays fixed fails without moving the configured upstream, an auto-create push creates the remote branch and sets the local upstream, and remotes named `a` plus `a/b` prove Push and scoped Fetch address `a/b` and leave `a` untouched.
- `src/domain/git/git.remotes.test.ts`: Fetch scope grouping reads the tab-separated remotename/remoteref atoms, skips branches without upstreams, and deduplicates refspecs by remote, including a slash-named remote `a/b`; prune planning returns the exact descriptors for fetch and delete. Fetch and Fetch --prune argument construction includes `--progress` and `--`; pull uses `--progress --no-edit`; push variants include the captured local branch and configured upstream refspec, `--force-with-lease`, `--force`, and `--no-verify` flags; unsafe remote and ref names are rejected; a truncated `git remote -v` result is a failed read. The prune ordering, no-delete-on-failure, and truncation behavior are covered in `src/domain/commands/commands.remote.test.ts`.
- `src/app/hooks/useCommandRunner.test.tsx`: a cancelled or timed-out remote result refreshes once, appends one console entry, sets a warning status with the reported duration, never sets success, and opens no success surface; a second command is blocked while the first refresh is in flight; a stale orchestration slot is reset for test isolation. Prune partial-success and total-failure outcomes are covered in `commands.remote.test.ts`, and the batched evidence refresh for pruned, unknown-only, and both lists is covered in `useRemoteCommands.test.tsx`.

## 14. Open questions

- The product spec says Pull and Push are "explicit text buttons with icons". The implemented composition uses ASCII `^` and `v` markers in front of the labels, because F-18 forbids non-ASCII glyphs; the mockup's directional arrows are therefore rendered as text markers next to words, not as icon-only controls. No separate glyph column is needed.
- The exact truncation budget for branch, upstream, phase, and status names between 80 and 99 columns is unspecified; `topBar.budgets.ts` derives it from `useTerminalDimensions` and preserves the branch, the sync badge, the action labels, and the percentage while truncating disabled reasons first.
- The product spec says success and informational messages clear after a "short timeout"; this document uses five seconds. Confirm whether the timeout should be configurable.
- Whether Fetch should show per-remote progress groups or a single aggregate phase is unspecified; this document shows a single phase with the aggregate counts in the final status, while failures remain per remote in the result.
- The exact status text for a timed-out Fetch --prune group is unspecified; this document reports "unknown" and keeps the prior upstream classification.
