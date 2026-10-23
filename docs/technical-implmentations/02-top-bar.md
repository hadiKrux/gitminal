# 02 - Top bar

## 1. Header

Spec reference: `docs/product-spec.md` section 3 "Application shell" (lines 67-162), section 5 F-02 (lines 207-319), section 6 "Keyboard map" Top bar (lines 1539-1704), section 6.1 "Action IDs" (lines 1705-1742), section 9 "Resolved product decisions" D4, D14, and D15 (lines 1865-1889), and section 10 "Assumed defaults" (lines 1890-1908).
Dependencies: F-01 `01-app-shell-and-focus.md` (the `top-bar` region and `nav.left` / `nav.right`), F-04 `04-remotes-panel.md` (fetch scope and remote list), F-05 `05-tags-panel.md` (`tag.push` shadowing `remote.push`), F-13 `13-console.md` (command log), F-15 `15-overlays-and-confirmations.md` (force push confirmations and error overlay), F-16 `16-repository-states.md` (detached, no upstream, upstream gone, no remote, no origin), F-17 `17-freshness-and-performance.md` (refresh after operations), F-18 `18-safety-and-platform-behavior.md` (redaction, no prompts), F-20 `20-theme-and-colors.md` (progress bar colors).
Owned paths: `src/features/top-bar/TopBar.tsx`, `src/features/top-bar/TopBarStatus.tsx`, `src/features/top-bar/SyncStateBadge.tsx`, `src/features/top-bar/TopBarActions.tsx`, `src/features/top-bar/MoreMenu.tsx`, `src/features/top-bar/useTopBar.ts`.
Referenced shared modules (not owned here): `src/domain/commands/commands.registry.ts`, `src/domain/commands/commands.runner.ts`, `src/domain/commands/commands.availability.ts`, `src/app/hooks/useCommandRunner.ts`, `src/domain/repository/repository.upstream.ts`, `src/domain/repository/repository.selectors.ts`, `src/domain/git/git.remotes.ts`, `src/domain/git/git.progress.ts`, `src/domain/git/git.client.ts`, `src/ui/ProgressBar.tsx`, `src/ui/Spinner.tsx`.

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

Hooks used: `useTerminalDimensions` for truncation and status-strip width budgets, `useTimeline` for spinner and throttled progress redraws, `useAction` to register the `remote.*` global action IDs from the top bar as their single designated owner, `useFocusRegion` for the `top-bar` focus state, `useStatus` for transient status and operation progress, and `useRepository` for the snapshot. `useKeyboard` is never called here; all keys arrive through `useHotkeys` in `src/app/hooks/useHotkeys.ts`. `useTopBar` calls `useAction(actionId, { scope: "global", targetKind }, handler)` once per remote action; features never register `remote.pull`, `remote.push`, `remote.fetch`, `remote.fetchPrune`, `remote.more`, or the force and no-verify variants.

### 3.1 Pull and Push button composition

Pull and Push are explicit text buttons, never icon-only, and their order is Pull then Push. They are composed from `box` plus `text` through the `ui/Button.tsx` and `ui/ButtonRow.tsx` primitives, because the strip mixes static content (branch info and the sync badge) with focusable controls, and because the focused control index is app state that `ButtonRow` already models with `nav.left` and `nav.right`. `<tab-select>` is not used for these buttons: it cannot render the sync badge alongside the labels, and it would force a uniform-row model onto a mixed strip. `<tab-select>` remains the right component only where a horizontal selector with native Left/Right is the whole control, as in the collapsed sidebar switcher in F-01.

### 3.2 Status strip and progress bar

The top bar middle section is `TopBarStatus`. It renders exactly one of three modes: branch info when idle, operation progress while a command runs, or a transient status message after a command finishes. It is a fixed one-row `<box>` between the identity block and `TopBarActions`, with a width budget from `useTerminalDimensions`.

The progress bar is `ProgressBar` from `src/ui/ProgressBar.tsx`. OpenTUI 0.6.6 has no React intrinsic for `FrameBufferRenderable`, so `ProgressBar` registers OpenTUI's own renderable once with `extend({ "frame-buffer": FrameBufferRenderable })` and augments `OpenTUIComponents` for JSX typing. The registered `<frame-buffer>` is one row high and as wide as the strip budget allows, between 8 and 24 cells.

`ProgressBar` draws the track with the `surface` token and the filled portion with the `accent` token through `fillRect`. This follows the one-row cell-buffer approach of the [OpenTUI FrameBuffer progress-bar example](https://opentui.com/docs/components/frame-buffer/#example-progress-bar), but draws colored cells instead of block glyphs so the output stays ASCII-safe. It clamps progress to `0` to `100`, rounds the filled cell count, calls `requestRender()` after a change, and redraws after a resize because a resize clears the buffer. The bar contains no text. The phase, operation label, and percentage are ordinary `<text>` and `<span>` siblings, so the display still carries meaning with `NO_COLOR`.

The status strip is not focusable. `nav.left` and `nav.right` skip it and move between the branch info when shown, Pull, Push, and More. It has no mouse handlers and no keybindings.

All icons and markers used by this feature come from `src/theme/icons.ts`; see architecture section 6.1. No glyph literal is written in feature code.

## 4. Component tree

```text
TopBar                          (src/features/top-bar/TopBar.tsx)
-> box (row)
   -> box (identity)            "Gitminal"
      -> text
   -> TopBarStatus              (src/features/top-bar/TopBarStatus.tsx)
      -> box (status strip)
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
   -> TopBarActions             (src/features/top-bar/TopBarActions.tsx)
      -> ButtonRow
         -> Button (Pull)
         -> Button (Push)
         -> Button (More)
   -> MoreMenu (modal, conditionally)   (src/features/top-bar/MoreMenu.tsx)
      -> ModalFrame
         -> select
```

`useTopBar.ts` supplies branch text, upstream text, ahead and behind counts, sync state, availability, and the focused control index. The More menu open state lives in `OverlayProvider`, not in a local flag. `useTopBar` combines repository data with status and progress from `useStatus` to select the `TopBarStatus` mode. It reads repository data from `@/domain/repository` and never recomputes ahead/behind or upstream state itself.

`MoreMenu` dispatches an explicit command ID and target for every item, never a raw key or an ambient cursor: `remote.fetch` with `{ kind: "none" }`, `remote.fetchPrune` with `{ kind: "none" }`, `remote.pushForceSafe` with `{ kind: "branch", name: currentBranch }`, `remote.pushForceOverwrite` with `{ kind: "branch", name: currentBranch }`, and `remote.pushNoVerify` with `{ kind: "branch", name: currentBranch }`. The force commands open their confirmation through `OverlayProvider` before the command runner is invoked.

## 5. Enforced files and folders

| File | Responsibility |
| --- | --- |
| `src/features/top-bar/TopBar.tsx` | Top-bar frame, app identity, and composition of `TopBarStatus`, `TopBarActions`, and `MoreMenu`. |
| `src/features/top-bar/TopBarStatus.tsx` | Renders the middle status strip from the mode selected by `useTopBar`: branch info, progress, or transient status; renders the phase, percentage, `Spinner`, and `ProgressBar`. |
| `src/features/top-bar/SyncStateBadge.tsx` | Renders "up to date", "ahead", "behind", "diverged", "no upstream", or "upstream gone" as a `span` plus a text marker. |
| `src/features/top-bar/TopBarActions.tsx` | Renders the Pull, Push, and More text buttons, their disabled reasons, and the focused control index. |
| `src/features/top-bar/MoreMenu.tsx` | The modal `<select>` with Fetch, Fetch --prune, Push force (safe), Push force (overwrite), and Push --no-verify. Each option carries its availability reason and dispatches an explicit command ID and `CommandTarget`, never a raw key. |
| `src/features/top-bar/useTopBar.ts` | Selects display data from `@/domain/repository`, calls `getAvailability(commandId, context)` for each control with the current snapshot, signals, target, region, and operation state, reads status and progress from `useStatus`, holds the focused control index, derives the status-strip mode, and registers the single global `remote.*` handler for each action. |

## 6. State model

Provider state: the repository snapshot, the selected commit, and the right-pane selection live in `RepositoryProvider`. Transient status and operation progress live in `StatusProvider`. The modal stack, including the More menu and the force push confirmation, lives in `OverlayProvider`. The resolved keymap lives in `KeymapProvider`.

View state (local, in `useTopBar.ts`): only the focused control index for `nav.left` and `nav.right`. The More menu open state is overlay state, not a second local flag. No component keeps a copy of ahead/behind, upstream state, sync state, or availability; all of those are derived in `@/domain/repository/repository.selectors.ts` and `@/domain/commands/commands.availability.ts`.

Availability is target-aware. `useTopBar` calls `getAvailability(commandId, { state, signals, target, region, operation })` for each control, where `push`, force push, and pull use `{ kind: "branch", name: currentBranch }` and fetch uses `{ kind: "none" }` because its scope spans the upstreams of all local branches. Repository-wide gates such as detached HEAD, empty repository, no remote, and operation in progress come from `gateRepository(actionId, state, signals)` inside that call. The buttons, More menu options, footer, help, and palette all render the same result and reason.

Derived display: `useTopBar` calls selectors for the branch label (branch name or detached short hash plus "detached"), the upstream ref name, the ahead and behind counts, and the sync state. It never computes these from raw refs.

Status mode: `TopBarStatus` renders the first matching mode in this order:

1. Running operation: phase, `Spinner` or `ProgressBar`, and percentage when known.
2. Error or warning summary: text marker plus the short message; an error stays while its `ErrorOverlay` is open.
3. Success or informational status: text marker plus the short message, for a bounded timeout of about five seconds.
4. Idle: branch name or detached label, upstream, ahead and behind counts, and `SyncStateBadge`.

The timeout is owned by `StatusProvider`, not by `TopBarStatus`. `TopBarStatus` is a pure projection of `StatusProvider` plus the repository snapshot, so a re-render never resets a message's lifetime.

## 7. Data flow

Pull: action ID `remote.pull` -> the single global `useAction` handler in `useTopBar` -> `useCommandRunner.runCommand({ commandId: "remote.pull", target: { kind: "branch", name: currentBranch } })` -> `commands.runner.ts` checks availability and serialization -> `@/domain/git/git.client.ts` runs `git pull --progress --no-edit` for the current branch and upstream -> output parsed into a `CommandResult` -> the orchestrator refreshes `RepositoryProvider`, appends a console entry, and sets status -> `TopBar` re-renders.

Push: action ID `remote.push` -> the single global handler -> `useCommandRunner.runCommand({ commandId: "remote.push", target: { kind: "branch", name: currentBranch } })` -> `git push --progress`. When there is no upstream, the command runs `git push --progress --set-upstream origin <local-branch-name>`, which creates `origin/<local-branch-name>` and sets the upstream without an extra modal. The status shows "Creating origin/feature/AB-1231 and setting upstream" before and after, and the command is logged. If no `origin` remote exists, the command fails with an error listing the configured remotes and never guesses another remote. If the configured upstream exists but its remote branch is gone, Push recreates the configured upstream branch, not `origin/<branch>` under a different name.

Push --no-verify: action ID `remote.pushNoVerify`, dispatched by the More menu with an explicit command ID and `{ kind: "branch", name: currentBranch }` target -> `git push --progress --no-verify` with the same auto-create behavior when no upstream exists. It has no default key and is also palette-invocable.

Force push (safe): action ID `remote.pushForceSafe` -> `git push --progress --force-with-lease` -> requires an existing upstream.
Force push (overwrite): action ID `remote.pushForceOverwrite` -> `git push --progress --force` -> requires an existing upstream.
Both are disabled when there is no upstream with the reason "no upstream; use Push to create it first." Both open a confirmation that names the branch and remote; the safe option is visually primary and the overwrite option is never the default focused action. Neither has a default key; the More menu and the palette are their entry points.

Fetch: action ID `remote.fetch` -> the single global handler -> `useCommandRunner.runCommand({ commandId: "remote.fetch", target: { kind: "none" } })` -> scoped fetch. The scope is the upstream refs of all local branches, grouped by remote and deduplicated. For each remote group the command runs `git fetch --progress <remote> <refspec>` with the deduplicated refspecs. Local branches without an upstream are skipped. Remote branches that are not the upstream of a local branch are not updated. If no local branch has an upstream, Fetch is unavailable with the reason "no local branches with upstreams". A failure for one remote does not stop the other groups, and a missing upstream ref is non-fatal and marks the branch `[?] upstream not found`. The result reports partial success, for example "Fetched 4 upstreams; 1 upstream missing; 1 remote failed."

Fetch --prune: action ID `remote.fetchPrune` -> `useCommandRunner.runCommand({ commandId: "remote.fetchPrune", target: { kind: "none" } })`. It uses the same scope and runs in two phases so a failed remote check can never be mistaken for a deleted branch:

1. Confirm absence. For each affected remote, run `git ls-remote --heads <remote>` and build the set of advertised heads. A non-zero exit, timeout, cancellation, or unparsable output makes that remote's result `unknown`; no ref from that remote is pruned.
2. Update and delete confirmed refs. For each advertised in-scope ref, run `git fetch --progress <remote> <ref>` without `--prune`; a ref that was not advertised is never fetched by name. Then delete each in-scope remote-tracking ref that is still present locally and absent from the confirmed head set with `git update-ref -d refs/remotes/<remote>/<branch>`. Only confirmed stale tracking refs are deleted, and unrelated out-of-scope refs are never touched. If the fetch for a group fails, times out, or is cancelled, that group is `unknown` and the delete phase does not run for it.

A confirmed missing upstream is classified `[?] remote branch deleted`. A failed or timed-out remote check keeps the prior classification as `[?] upstream not found` or `unknown`, never `deleted`. Local branches whose upstream ref disappeared are re-evaluated after the delete phase, and a branch whose upstream ref was found again clears the indicator. Remote branches without a local upstream keep their last known state.

More menu: action ID `remote.more` -> the single global handler opens `MoreMenu` through `OverlayProvider`. Each `<select>` option has a `description` equal to `getAvailability(commandId, context).reason`, and selecting it dispatches its explicit command ID and target as listed in section 4. The menu never replays a raw key and never reads a hidden panel cursor.

Progress: remote operations pass `--progress` and stream stderr through `@/domain/git/git.progress.ts`, which publishes percentage and phase. `commands.runner.ts` forwards each event to its progress callback; `useCommandRunner` calls `StatusProvider.beginOperation` before execution and `StatusProvider.updateOperation` for each event. `TopBarStatus` renders the phase text, a `Spinner` when no percentage is known, and a `ProgressBar` plus percentage when git reports one. Completion replaces the running state with a success or warning status, or a persistent error status plus `ErrorOverlay`.

Network operations use the 120 second network timeout from `git.client.ts` and the `AbortSignal` owned by `useCommandRunner`. A timeout sends the same `SIGTERM`, then `SIGKILL` path as a cancel and returns a result with `timedOut: true`; a quit or explicit cancel returns `cancelled: true`. Both are warning results: they refresh the repository so partial local effects are visible, append one console entry, set a warning status such as "cancelled" or "timed out after 120 seconds", and never open a success status or claim a pruned or pushed ref. A failed Fetch --prune confirmation leaves the affected remote group `unknown` and reports it in the partial-success status.

Availability agreement: `TopBarActions`, `MoreMenu`, the footer, and the palette all read `getAvailability(commandId, context)` from `@/domain/commands/commands.availability.ts`, which combines repository-wide gates from `gateRepository(actionId, state, signals)` (detached HEAD, no remote, empty repository, operation in progress) with target validation. The footer hints from `@/domain/keymap/keymap.describe.ts` and the palette options filter by the same result, so the surfaces never disagree.

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

Precedence: `useHotkeys` in `src/app/hooks/useHotkeys.ts` resolves the same global action IDs for every region. When another region is focused, `remote.pull`, `remote.push`, `remote.fetch`, `remote.fetchPrune`, and `remote.more` remain global unless that region defines a context key on the same key. Tags is the concrete case: `tag.push` shadows `remote.push` while Tags is focused, so the footer shows Push selected tag, not Push branch. `useTopBar` registers each `remote.*` handler once with `useAction(actionId, { scope: "global", targetKind }, handler)` and never inspects key events. The force and no-verify variants have no default key, so they are reached through the More menu, the palette, and help. Features never register a `remote.*` action, so a sidebar panel that unmounts in the collapsed layout cannot remove a global remote handler. While any overlay is open, including the More menu and a force push confirmation, `remote.*` is unreachable; only `overlay.close`, `app.quit`, and the same overlay's toggle may resolve.

Focus: the `top-bar` frame is a focusable region frame with `focusedBorderColor`. Entering it with Tab, a click, or the palette's Focus Top Bar command gives native focus to the frame or the clicked control; `FocusProvider` derives `top-bar` from the focused renderable's ancestor and the border follows natively. The `1`-`9` direct region jumps deliberately skip the top bar. The focused control index remains local to `useTopBar`; it is not a second native focus. The status strip is not focusable and is skipped by `nav.left` and `nav.right`.

## 9. Loading, empty, error, and disabled states

- Loading: before the first repository read completes, the status strip shows "loading repository" and the buttons render disabled with the reason "loading repository". Remote progress shows the phase and a `Spinner`, plus the `ProgressBar` and percentage when git reports one. The footer keeps its hints.
- Empty: an empty repository shows the unborn branch name and no ahead/behind counts; Push is disabled with the reason "no commits yet". The upstream block is omitted when there is no upstream. The status strip returns to branch info when there is no message.
- Error: a failed remote operation opens a persistent `ErrorOverlay` with the redacted git output and writes a console entry; the status strip shows a failure summary while the overlay is open. The repository state refreshes after the failure. The top bar never claims success on failure.
- Cancelled or timed out: the status strip shows a warning with "cancelled" or "timed out after 120 seconds", the console records one cancelled or timed-out entry, and the repository refreshes. No ref is reported as pushed, pruned, or up to date.
- Failed or unknown remote check: a Fetch --prune group whose `ls-remote` failed, timed out, or was cancelled is reported as "unknown" in the partial-success status. Its refs keep their previous classification and are never shown as deleted or pruned.
- Disabled: each control renders with the `dim` token plus its reason text and stays visible. Reasons include "detached HEAD", "no remote", "no upstream; use Push to create it first", "no local branches with upstreams", "no commits yet", and "operation in progress".
- Detached HEAD: the branch name is replaced by the short hash plus the "detached" label; Pull, Push, and force variants are disabled with the reason "detached HEAD".
- No remote: Pull, Push, Fetch, Fetch --prune, and all More items are disabled with the reason "no remote".
- No origin but other remotes exist: Push without an upstream is available in the UI but the command fails with a clear error listing the configured remotes; the app does not guess another remote.
- Upstream gone: the sync badge reads "upstream gone" with a `[?]` marker; Pull is disabled with the reason "upstream gone; push to recreate it"; Push recreates the configured upstream branch.
- Text markers: `[?]` for a missing upstream, plus `[v]`, `!`, `x`, and `i` markers for success, warning, error, and information status. Color is never the only signal.

## 10. Performance and bounds

- The top bar is a fixed-height row; it never scrolls and never wraps. The status strip shares the row and never changes its height.
- Branch, upstream, phase, status, and ahead/behind strings truncate through `@/lib/text.ts` with a budget from `useTerminalDimensions`. Truncation never hides the current branch when idle, the sync state, or the Push button.
- Progress updates are throttled to the renderer frame rate through `useTimeline`. A progress tick does not trigger a repository read. `ProgressBar` redraws only when the rounded filled-cell count, width, or theme color changes, then calls `requestRender()`. A status timeout re-render only swaps text.
- The progress bar is bounded to 24 cells and hidden below 8 available cells; the percentage text remains. No allocation grows with terminal width.
- The More menu has a fixed five rows and does not need virtualization.
- Availability is computed once per snapshot in `commands.availability.ts` and cached by snapshot version, so re-renders do not recompute the matrix.

## 11. Safety and confirmations

- Force push variants require an existing upstream and always open a confirmation that names the branch and remote. The safe variant runs `--force-with-lease` and explains that it refuses to overwrite commits this clone has not fetched. The overwrite variant runs literal `--force`, uses a stronger warning that remote commits not present locally can be lost, and is never the default focused action.
- Push never force-pushes. When `origin/<branch>` already exists and the push is not a fast-forward, the push fails and leaves the local branch unchanged. Only the explicit `remote.pushForceSafe` and `remote.pushForceOverwrite` commands force, and each requires a fresh confirmation.
- Fetch --prune confirms remote absence before deleting any tracking ref. A non-zero, timed-out, cancelled, or unparsable `git ls-remote` result is `unknown`, and the affected refs are retained. The command never treats a failed remote check as a deleted branch and never deletes an out-of-scope ref.
- No credentials are requested. Credential prompts are disabled, so an auth failure fails visibly instead of hanging, and the command is recorded in the console with secrets redacted by `@/domain/git/git.redact.ts`.
- Writes are serialized by `commands.runner.ts`; a second remote write while one is running returns a blocked result with a visible reason.
- A failed operation never clears the user's commit message or staged files.

## 12. Acceptance mapping

| Product spec acceptance bullet | Implementing module or component |
| --- | --- |
| "Pull, Push, Fetch, Fetch --prune, safe force push, overwrite force push, and push --no-verify all run the expected git operation and are visible in the console." (F-02 acceptance) | `src/features/top-bar/useTopBar.ts`, `MoreMenu.tsx`, `@/domain/commands/commands.registry.ts`, `@/domain/commands/commands.runner.ts`, `@/app/hooks/useCommandRunner.ts`, `ConsoleProvider`. |
| "Push with no upstream creates origin/<local-branch-name> and sets the upstream without an extra modal." (F-02) | `src/features/top-bar/useTopBar.ts` push branch running `git push --progress --set-upstream origin <branch>`. |
| "The top bar updates branch, upstream, and ahead/behind state after every successful operation." (F-02) | `RepositoryProvider` refresh plus `SyncStateBadge.tsx` and `@/domain/repository/repository.selectors.ts`. |
| "The top bar middle section shows the operation phase and a FrameBuffer progress bar with a percentage (when git reports one) during Pull, Push, Fetch, and Fetch --prune, and shows transient status messages when no operation is running." (F-02 acceptance) | `TopBarStatus.tsx`, `src/ui/ProgressBar.tsx`, `StatusProvider`, and `git.progress.ts`. |
| "A failed operation never clears the user's commit message or staged files." (F-02) | `useCommandRunner.ts` result handling and the error path in `useTopBar.ts`; the runner returns the result without mutating drafts. |
| "Pull and Push are explicit text buttons with icons, not icon-only controls. Their order is Pull then Push." (F-02) | `src/features/top-bar/TopBarActions.tsx` composed from `ui/Button.tsx` and `ui/ButtonRow.tsx`. |
| "The menu shows why an item is unavailable, for example no remote or detached HEAD." (F-02) | `src/features/top-bar/MoreMenu.tsx` option `description` from `getAvailability(commandId, context).reason`. |
| "Fetch updates only the upstream refs of local branches and does not fetch unrelated remote branches." (v1 acceptance) | Scoped fetch in `useTopBar.ts` via `commands.registry.ts`. |
| "Fetch --prune ... first confirms remote absence with git ls-remote --heads <remote> ... then removes only the confirmed stale remote-tracking refs." (F-02) | The two-phase command in `@/domain/git/git.remotes.ts` and `commands.runner.ts`; deletion is `git update-ref -d` only after a successful confirmation. |
| "A failed or timed-out remote check is unknown, not missing or deleted." (F-02) | `git.remotes.ts` result classification and `@/domain/repository/repository.upstream.ts`; no `deleted` state is written for an unknown group. |
| "Fetch --prune marks local branches with missing upstream refs as [?] remote branch deleted." (v1 acceptance) | `@/domain/repository/repository.upstream.ts` re-evaluation after the confirmed delete phase. |
| "Push with no upstream creates origin/<local-branch-name>, sets the upstream, and updates the top bar without an extra modal." (v1 acceptance) | `useTopBar.ts` push branch and `RepositoryProvider` refresh. |

## 13. Tests to add

- `src/features/top-bar/SyncStateBadge.test.tsx`: renders each of the six sync states with the correct text and marker, including `[?]` for upstream gone.
- `src/features/top-bar/TopBarStatus.test.tsx`: selects branch info when idle, progress when running, and status when a message is active; checks the precedence order; checks that a running operation without a percentage renders the spinner, and with a percentage renders the bar and percentage text.
- `src/ui/ProgressBar.test.tsx`: clamps progress to `0` to `100`, rounds the filled cells, draws the track and fill with the expected theme colors through the FrameBuffer, calls `requestRender()` only when the rendered cells change, and redraws after a width change.
- `src/features/top-bar/TopBarActions.test.tsx`: Pull and Push render as text buttons in that order; disabled controls show the exact reason and remain visible; the focused control index moves with `nav.left` and `nav.right`.
- `src/features/top-bar/MoreMenu.test.tsx`: the five options render; each disabled option exposes its reason; selecting an enabled option dispatches its explicit command ID and target (`remote.pushForceSafe`, `remote.pushForceOverwrite`, and `remote.pushNoVerify` each with the current branch target); no option dispatches a raw key.
- `src/features/top-bar/useTopBar.test.ts`: detached HEAD, no upstream, upstream gone, no remote, no-origin, empty repository, and operation-in-progress cases select the expected labels and availability reasons; each `remote.*` handler is registered exactly once with `scope: "global"`; a second registration is rejected.
- `src/domain/commands/commands.availability.test.ts`: availability matrix covering detached HEAD, no upstream, upstream gone, no remote, no-origin-but-other-remotes, empty repository, operation in progress, missing target, and stale target, asserting the exact reason strings the top bar renders; repository-wide gates come from `gateRepository`.
- `src/domain/repository/repository.upstream.test.ts`: fetch scope selection skips branches without upstreams and deduplicates refspecs by remote.
- `src/domain/git/git.remotes.test.ts`: Fetch and Fetch --prune argument construction includes `--progress`; pull uses `--progress --no-edit`; push variants include the correct `--force-with-lease`, `--force`, and `--no-verify` flags. Fetch --prune runs `ls-remote --heads` before any `update-ref -d`, deletes only confirmed stale in-scope refs, and performs no delete for a non-zero, timed-out, cancelled, or unparsable `ls-remote`.
- `src/app/hooks/useCommandRunner.test.tsx`: a cancelled or timed-out remote result refreshes once, appends one console entry, sets a warning status, never sets success, and opens no success surface; a failed prune group stays `unknown` and is reported in the partial-success status.

## 14. Open questions

- The product spec says Pull and Push are "explicit text buttons with icons". This document composes them from `box` plus `text` and does not add a separate icon glyph source. Confirm whether a text glyph such as `[Pull]` counts as the icon or whether a distinct glyph column is expected.
- The exact truncation budget for branch, upstream, phase, and status names between 80 and 99 columns is unspecified; this document derives it from `useTerminalDimensions` and preserves the branch when idle, the sync badge, the percentage, and Push.
- The product spec says success and informational messages clear after a "short timeout"; this document uses five seconds. Confirm whether the timeout should be configurable.
- Whether Fetch should show per-remote progress groups or a single aggregate phase is unspecified; this document shows a single phase with the aggregate counts in the final status, while failures remain per remote in the result.
- The exact status text for a timed-out Fetch --prune group is unspecified; this document reports "unknown" and keeps the prior upstream classification.
