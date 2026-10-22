# 02 - Top bar

## 1. Header

Status: Draft for review.
Spec reference: `docs/product-spec.md` section 3 layout (lines 66-96), section 5 F-02 (lines 197-292), section 6 "Keyboard map" Top bar (lines 1465-1473), and section 6.1 "Action IDs" (lines 1583-1611).
Dependencies: F-01 `01-app-shell-and-focus.md` (the `top-bar` region and `nav.left` / `nav.right`), F-04 `04-remotes-panel.md` (fetch scope and remote list), F-05 `05-tags-panel.md` (`tag.push` shadowing `remote.push`), F-13 `13-console.md` (command log), F-15 `15-overlays-and-confirmations.md` (force push confirmations and error overlay), F-16 `16-repository-states.md` (detached, no upstream, upstream gone, no remote, no origin), F-17 `17-freshness-and-performance.md` (refresh after operations), F-18 `18-safety-and-platform-behavior.md` (redaction, no prompts).
Owned paths: `src/features/top-bar/TopBar.tsx`, `src/features/top-bar/SyncStateBadge.tsx`, `src/features/top-bar/TopBarActions.tsx`, `src/features/top-bar/MoreMenu.tsx`, `src/features/top-bar/useTopBar.ts`.
Referenced shared modules (not owned here): `src/domain/commands/commands.registry.ts`, `src/domain/commands/commands.runner.ts`, `src/domain/commands/commands.availability.ts`, `src/domain/repository/repository.upstream.ts`, `src/domain/repository/repository.selectors.ts`, `src/domain/git/git.remotes.ts`, `src/domain/git/git.progress.ts`, `src/domain/git/git.client.ts`.

This document follows the 14-section contract in `00-project-architecture.md` section 14. Where it and the architecture contract disagree, the architecture contract wins.

## 2. Scope and non-goals

In scope: rendering the app identity, current branch or detached short hash, upstream name, ahead and behind counts, and the sync state badge; the Pull and Push buttons; the More menu with Fetch, Fetch --prune, Push force (safe), Push force (overwrite), and Push --no-verify; scoped fetch behavior; push with no upstream auto-create; force push variants and their confirmations; detached HEAD, no-remote, and no-origin states; and operation progress in the top bar.
Non-goals: the keymap format (F-19 `19-configuration-and-keybindings.md`); the remote branch list and filter (F-04 `04-remotes-panel.md`); tag push (F-05 `05-tags-panel.md`); the confirmation modal structure itself (F-15 `15-overlays-and-confirmations.md`); repository state detection primitives (F-16 `16-repository-states.md`); console rendering (F-13 `13-console.md`).

## 3. OpenTUI components used

| Component | Where used | Why it is the right component |
| --- | --- | --- |
| `<box>` | `TopBar` frame, the branch-info block, `TopBarActions`, each `Button`, and the `MoreMenu` frame. | The only layout, border, and hit-test primitive. |
| `<text>` | App identity "Gitminal", branch name, detached short hash plus "detached" label, upstream name, ahead and behind text, and disabled reasons. | Every string. |
| `<span>` | The sync state badge inside `SyncStateBadge`, the ahead/behind counts, and the button label runs. | Inline runs inside `<text>`. |
| `<select>` | The `MoreMenu` modal option list. | Vertical option list with built-in up/down and Enter, and `description` carrying the disabled reason. |
| `<tab-select>` | Not used for the buttons; documented in section 3.1. | N/A here. |
| `<scrollbox>` | Not needed; the More menu has five fixed rows. | N/A here. |
| `<ascii-font>`, `<input>`, `<diff>`, `<code>`, `<line-number>`, `<markdown>`, `<textarea>` | Not used here. | N/A here. |

Hooks used: `useTerminalDimensions` for truncation budgets, `useTimeline` for the spinner and progress animation, `useAction` to register the top-bar action IDs, `useFocusRegion` for the `top-bar` focus state, `useStatus` for transient status and operation progress, and `useRepository` for the snapshot. `useKeyboard` is never called here; all keys arrive through `useHotkeys` in `src/app/hooks/useHotkeys.ts`.

### 3.1 Pull and Push button composition

Pull and Push are explicit text buttons, never icon-only, and their order is Pull then Push. They are composed from `box` plus `text` through the `ui/Button.tsx` and `ui/ButtonRow.tsx` primitives, because the strip mixes static content (branch info and the sync badge) with focusable controls, and because the focused control index is app state that `ButtonRow` already models with `nav.left` and `nav.right`. `<tab-select>` is not used for these buttons: it cannot render the sync badge alongside the labels, and it would force a uniform-row model onto a mixed strip. `<tab-select>` remains the right component only where a horizontal selector with native Left/Right is the whole control, as in the collapsed sidebar switcher in F-01.

All icons and markers used by this feature come from `src/theme/icons.ts`; see architecture section 6.1. No glyph literal is written in feature code.

## 4. Component tree

```text
TopBar                          (src/features/top-bar/TopBar.tsx)
-> box (row)
   -> box (identity)            "Gitminal"
      -> text
   -> box (branch info)
      -> text (branch name)      or short hash + "detached"
      -> span (upstream name)    when an upstream exists
      -> span ("ahead N")        when an upstream exists
      -> span ("behind N")       when an upstream exists
      -> SyncStateBadge          (src/features/top-bar/SyncStateBadge.tsx)
   -> TopBarActions             (src/features/top-bar/TopBarActions.tsx)
      -> ButtonRow
         -> Button (Pull)
         -> Button (Push)
         -> Button (More)
   -> MoreMenu (modal, conditionally)   (src/features/top-bar/MoreMenu.tsx)
      -> ModalFrame
         -> select
```

`useTopBar.ts` supplies branch text, upstream text, ahead and behind counts, sync state, availability, the focused control index, and the More menu open state. It reads repository data from `@/domain/repository` and never recomputes ahead/behind or upstream state itself.

## 5. Enforced files and folders

| File | Responsibility |
| --- | --- |
| `src/features/top-bar/TopBar.tsx` | Top-bar frame, app identity, branch-info block, and composition of `TopBarActions` and `MoreMenu`. |
| `src/features/top-bar/SyncStateBadge.tsx` | Renders "up to date", "ahead", "behind", "diverged", "no upstream", or "upstream gone" as a `span` plus a text marker. |
| `src/features/top-bar/TopBarActions.tsx` | Renders the Pull, Push, and More text buttons, their disabled reasons, the focused control index, and the operation spinner or progress. |
| `src/features/top-bar/MoreMenu.tsx` | The modal `<select>` with Fetch, Fetch --prune, Push force (safe), Push force (overwrite), and Push --no-verify, each option carrying its availability reason. |
| `src/features/top-bar/useTopBar.ts` | Selects display data from `@/domain/repository`, reads availability from `@/domain/commands/commands.availability.ts`, holds the focused control index and More menu open state, and dispatches actions. |

## 6. State model

Provider state: the repository snapshot, the selected commit, and selection state live in `RepositoryProvider`. Transient status and operation progress live in `StatusProvider`. The modal stack (including the More menu and the force push confirmation) lives in `OverlayProvider`. The resolved keymap lives in `KeymapProvider`.

View state (local, in `useTopBar.ts`): the focused control index for `nav.left` and `nav.right`, and the More menu open flag. No component keeps a copy of ahead/behind, upstream state, sync state, or availability; all of those are derived in `@/domain/repository/repository.selectors.ts` and `@/domain/commands/commands.availability.ts`.

Derived display: `useTopBar` calls selectors for the branch label (branch name or detached short hash plus "detached"), the upstream ref name, the ahead and behind counts, and the sync state. It never computes these from raw refs.

## 7. Data flow

Pull: action ID `remote.pull` -> `useTopBar` handler -> command `remote.pull` from `@/domain/commands/commands.registry.ts` -> `commands.runner.ts` checks availability and serialization -> `@/domain/git/git.client.ts` runs `git pull` for the current branch and upstream -> output parsed -> `RepositoryProvider` refresh -> `TopBar` re-renders -> console entry and status.

Push: action ID `remote.push` -> command `remote.push` -> `git push`. When there is no upstream, the command runs `git push --set-upstream origin <local-branch-name>`, which creates `origin/<local-branch-name>` and sets the upstream without an extra modal. The status shows "Creating origin/feature/AB-1231 and setting upstream" before and after, and the command is logged. If no `origin` remote exists, the command fails with an error listing the configured remotes and never guesses another remote. If the configured upstream exists but its remote branch is gone, Push recreates the configured upstream branch, not `origin/<branch>` under a different name.

Push --no-verify: action from the More menu -> `git push --no-verify` with the same auto-create behavior when no upstream exists.

Force push (safe): `git push --force-with-lease` -> requires an existing upstream.
Force push (overwrite): `git push --force` -> requires an existing upstream.
Both are disabled when there is no upstream with the reason "no upstream; use Push to create it first." Both open a confirmation that names the branch and remote; the safe option is visually primary and the overwrite option is never the default focused action.

Fetch: action ID `remote.fetch` -> command `remote.fetch` -> scoped fetch. The scope is the upstream refs of all local branches, grouped by remote and deduplicated. For each remote group the command runs `git fetch <remote> <refspec>` with the deduplicated refspecs. Local branches without an upstream are skipped. Remote branches that are not the upstream of a local branch are not updated. If no local branch has an upstream, Fetch is unavailable with the reason "no local branches with upstreams". A failure for one remote does not stop the other groups, and a missing upstream ref is non-fatal and marks the branch `[?] upstream not found`. The result reports partial success, for example "Fetched 4 upstreams; 1 upstream missing; 1 remote failed."

Fetch --prune: action ID `remote.fetchPrune` -> command `remote.fetchPrune` -> `git fetch --prune <remote> <refspec>` with the same scope. It removes stale refs only within the fetched upstream scope. A pruned upstream is marked `[?] remote branch deleted` and local branch upstreams are re-evaluated. Remote branches without a local upstream keep their last known state.

More menu: action ID `remote.more` -> `useTopBar` opens `MoreMenu` through `OverlayProvider`. Each `<select>` option has a `description` equal to the availability reason, so the menu, footer, and palette agree.

Progress: remote operations stream through `@/domain/git/git.progress.ts`, which publishes percentage and phase; `TopBarActions` renders a `Spinner` or a `ProgressBar` when git reports a percentage.

Availability agreement: `TopBarActions` reads every button's availability and reason from `@/domain/commands/commands.availability.ts`, which combines repository-level gating from `@/domain/repository/repository.states.ts` (detached HEAD, no remote, empty repository, operation in progress) with command-specific reasons. The footer hints from `@/domain/keymap/keymap.describe.ts` and the palette options filter by the same availability, so the three surfaces never disagree.

## 8. Keyboard and focus

Action IDs only (product spec section 6.1). No raw key strings.

| Context | Action IDs | Behavior |
| --- | --- | --- |
| Top bar | `nav.left`, `nav.right` | Move between branch info, Pull, Push, and More. |
| Top bar | `nav.activate` | Activate the focused control. |
| Global | `remote.pull` | Pull. |
| Global | `remote.push` | Push. |
| Global | `remote.fetch` | Fetch. |
| Global | `remote.fetchPrune` | Fetch --prune. |
| Global | `remote.more` | Open the More menu. |
| Modal | `nav.up`, `nav.down`, `nav.activate`, `overlay.close` | Navigate and run More menu options, or close the menu. |

Precedence: `useHotkeys` in `src/app/hooks/useHotkeys.ts` resolves the same global action IDs for every region. When another region is focused, `remote.pull`, `remote.push`, `remote.fetch`, `remote.fetchPrune`, and `remote.more` remain global unless that region defines a context key on the same key. Tags is the concrete case: `tag.push` shadows `remote.push` while Tags is focused, so the footer shows Push selected tag, not Push branch. `useTopBar` registers its handlers with `useAction` and never inspects key events.

## 9. Loading, empty, error, and disabled states

- Loading: before the first repository read completes, the branch block shows "loading" and the buttons render disabled with the reason "loading repository". Remote progress shows a `Spinner` and a phase, and a percentage through `ProgressBar` when git reports one.
- Empty: an empty repository shows the unborn branch name and no ahead/behind counts; Push is disabled with the reason "no commits yet". The upstream block is omitted when there is no upstream.
- Error: a failed remote operation opens a persistent `ErrorOverlay` with the redacted git output and writes a console entry; the repository state refreshes after the failure. The top bar never claims success on failure.
- Disabled: each control renders with the `dim` token plus its reason text and stays visible. Reasons include "detached HEAD", "no remote", "no upstream; use Push to create it first", "no local branches with upstreams", and "operation in progress".
- Detached HEAD: the branch name is replaced by the short hash plus the "detached" label; Pull, Push, and force variants are disabled with the reason "detached HEAD".
- No remote: Pull, Push, Fetch, Fetch --prune, and all More items are disabled with the reason "no remote".
- No origin but other remotes exist: Push without an upstream is available in the UI but the command fails with a clear error listing the configured remotes; the app does not guess another remote.
- Upstream gone: the sync badge reads "upstream gone" with a `[?]` marker; Pull is disabled with the reason "upstream gone; push to recreate it"; Push recreates the configured upstream branch.
- Text markers: `[?]` for a missing upstream, plus the badge text. Color is never the only signal.

## 10. Performance and bounds

- The top bar is a fixed-height row; it never scrolls and never wraps.
- Branch, upstream, and ahead/behind strings truncate through `@/lib/text.ts` with a budget from `useTerminalDimensions`. Truncation never hides the current branch, the sync state, or the Push button.
- Progress updates are throttled to the renderer frame rate through `useTimeline`; a progress tick does not trigger a repository read.
- The More menu has a fixed five rows and does not need virtualization.
- Availability is computed once per snapshot in `commands.availability.ts` and cached by snapshot version, so re-renders do not recompute the matrix.

## 11. Safety and confirmations

- Force push variants require an existing upstream and always open a confirmation that names the branch and remote. The safe variant runs `--force-with-lease` and explains that it refuses to overwrite commits this clone has not fetched. The overwrite variant runs literal `--force`, uses a stronger warning that remote commits not present locally can be lost, and is never the default focused action.
- Push never force-pushes. When `origin/<branch>` already exists and the push is not a fast-forward, the push fails and leaves the local branch unchanged.
- No credentials are requested. Credential prompts are disabled, so an auth failure fails visibly instead of hanging, and the command is recorded in the console with secrets redacted by `@/domain/git/git.redact.ts`.
- Writes are serialized by `commands.runner.ts`; a second remote write while one is running returns a blocked result with a visible reason.
- A failed operation never clears the user's commit message or staged files.

## 12. Acceptance mapping

| Product spec acceptance bullet | Implementing module or component |
| --- | --- |
| "Pull, Push, Fetch, Fetch --prune, safe force push, overwrite force push, and push --no-verify all run the expected git operation and are visible in the console." (F-02, line 289) | `src/features/top-bar/useTopBar.ts`, `MoreMenu.tsx`, `@/domain/commands/commands.registry.ts`, `@/domain/commands/commands.runner.ts`, `ConsoleProvider`. |
| "Push with no upstream creates origin/<local-branch-name> and sets the upstream without an extra modal." (F-02, line 290) | `src/features/top-bar/useTopBar.ts` push branch running `git push --set-upstream origin <branch>`. |
| "The top bar updates branch, upstream, and ahead/behind state after every successful operation." (F-02, line 291) | `RepositoryProvider` refresh plus `SyncStateBadge.tsx` and `@/domain/repository/repository.selectors.ts`. |
| "A failed operation never clears the user's commit message or staged files." (F-02, line 292) | `@/domain/commands/commands.runner.ts` result handling and the error path in `useTopBar.ts`. |
| "Pull and Push are explicit text buttons with icons, not icon-only controls. Their order is Pull then Push." (F-02, line 210) | `src/features/top-bar/TopBarActions.tsx` composed from `ui/Button.tsx` and `ui/ButtonRow.tsx`. |
| "The menu shows why an item is unavailable, for example no remote or detached HEAD." (F-02, line 243) | `src/features/top-bar/MoreMenu.tsx` option `description` from `commands.availability.ts`. |
| "Fetch updates only the upstream refs of local branches and does not fetch unrelated remote branches." (v1 acceptance, line 1698) | Scoped fetch in `useTopBar.ts` via `commands.registry.ts`. |
| "Fetch --prune marks local branches with missing upstream refs as [?] remote branch deleted." (v1 acceptance, line 1700) | `@/domain/repository/repository.upstream.ts` re-evaluation after the prune command. |
| "Push with no upstream creates origin/<local-branch-name>, sets the upstream, and updates the top bar without an extra modal." (v1 acceptance, line 1695) | `useTopBar.ts` push branch and `RepositoryProvider` refresh. |

## 13. Tests to add

- `src/features/top-bar/SyncStateBadge.test.tsx`: renders each of the six sync states with the correct text and marker, including `[?]` for upstream gone.
- `src/features/top-bar/TopBarActions.test.tsx`: Pull and Push render as text buttons in that order; disabled controls show the exact reason and remain visible; the focused control index moves with `nav.left` and `nav.right`.
- `src/features/top-bar/MoreMenu.test.tsx`: the five options render; each disabled option exposes its reason; `nav.activate` on an enabled option dispatches the matching action ID.
- `src/features/top-bar/useTopBar.test.ts`: detached HEAD, no upstream, upstream gone, no remote, and no-origin cases select the expected labels and availability reasons.
- `src/domain/commands/commands.availability.test.ts`: availability matrix covering detached HEAD, no upstream, upstream gone, no remote, no-origin-but-other-remotes, empty repository, and operation in progress, asserting the exact reason strings the top bar renders.
- `src/domain/repository/repository.upstream.test.ts`: fetch scope selection skips branches without upstreams and deduplicates refspecs by remote.

## 14. Open questions

- Product spec line 210 says Pull and Push are "explicit text buttons with icons". This document composes them from `box` plus `text` and does not add a separate icon glyph source. Confirm whether a text glyph such as `[Pull]` counts as the icon or whether a distinct glyph column is expected.
- Product spec section 3 line 72 shows `[.]` as the More control. Confirm the label text for the More button is "." plus a text label, or the word "More".
- The exact truncation budget for branch and upstream names between 80 and 99 columns is unspecified; this document derives it from `useTerminalDimensions` and preserves the branch, badge, and Push.
- Whether Fetch should show per-remote progress groups or a single aggregate phase is unspecified; this document shows a single phase with the aggregate counts in the final status.
- Whether "no commits yet" or "empty repository" is the canonical Push disabled reason for an empty repository is unspecified; this document uses "no commits yet".
