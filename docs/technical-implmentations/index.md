# Implementation order

Status: Active
Last updated: 2026-10-25
Source: the architecture contract in [`00-project-architecture.md`](00-project-architecture.md) and the `Dependencies` line in each ticket.
Ticket index: [`index.md`](index.md)

## Ordering principles

1. Keep the application runnable after every milestone.
2. Build vertical slices with a visible or executable result, not horizontal layers.
3. Start from the ticket with no runtime dependencies, then add the smallest foundation needed by the next slice.
4. Treat ticket dependencies as integration dependencies. A ticket may list another feature because it renders or consumes it, not because every line must exist first.
5. Defer file-based configuration, full theming, and edge-case hardening until the primary flow works.
6. Add tests when each slice's behavior and boundaries are stable.

## M0 - Architecture contract

Ticket: [`00-project-architecture.md`](00-project-architecture.md)

Read and follow the contract. This is not an implementation step. It fixes the layer model, folder structure, OpenTUI component rules, state ownership, git execution rules, and the feature document format.

Done when:

- [x] The contract is reviewed, marked `Ready for dev`, and referenced from `AGENTS.md`, `index.md`, and this document.
- [x] All 21 feature tickets follow the 14-section contract and appear in `index.md`.
- [x] The fixed stack in section 1 matches `package.json`, `tsconfig.json`, `biome.json`, Husky, and fallow.
- [ ] Every implemented `src/**` path has exactly one owning ticket. Cross-cutting modules name one owner and list their consumers in the ticket header.
- [ ] Structural open questions that change file ownership or provider layout are resolved or explicitly deferred with a named decision point. Behavior-only open questions may stay open in their feature ticket.
- [x] Section 12 slice 1 enforcement work is assigned with concrete script names for the boundary, glyph, and structure checks, and the checks now exist.

Current gaps:

- 22 `src/**` paths are claimed as owned by more than one ticket. The main groups are `useHotkeys.ts` (01 and 19), `git.client.ts`, `commands.runner.ts`, and `git.errors.ts` (17 and 18), `console.buffer.ts`, `diff.limits.ts`, `graph.paginate.ts`, and `graph.search.ts` (17 and the feature owners), the `domain/git` read modules (`git.branches.ts`, `git.diff.ts`, `git.log.ts`, `git.stashes.ts`, `git.status.ts`, `git.tags.ts`, `parsers/parse.log.ts`), `repository.selectors.ts` and `repository.upstream.ts`, `useFileDiff.ts`, and the overlay components (15 and 18).
- Structural open questions still unresolved: `RepositoryState` ownership between `repository.types.ts` and `repository.states.ts`, the error overlay as a stack entry versus a provider field, and session ownership of the palette recent list.

## M1 - Bootstrap and splash

Status: Done

Tickets: [`21-startup-splash.md`](21-startup-splash.md)

Scope: the real `src/index.tsx` bootstrap with `exitOnCtrlC: false`, the splash gate components (`src/app/App.tsx`, `src/app/SplashGate.tsx`, `src/app/quit.key.ts`), `src/app/app.constants.ts`, the splash UI (`src/features/splash/SplashScreen.tsx`, `SplashScreen.constants.ts`, `SplashUpdateNotice.tsx`), the any-key dismissal, the `Ctrl+C` quit path, and the one-shot update check.

Observable outcome: `bun run dev` renders the splash with the wordmark and running version; any key opens the shell; `Ctrl+C` quits and restores the terminal. A failed or slow update check is silent and never blocks dismissal.

Deferred: the shell providers, repository reads, configuration, and theming.

Why first: it has no runtime dependencies, it establishes the entry point and test harness, and it proves OpenTUI rendering plus keyboard handling in the smallest possible flow.

## M2 - Keymap, configuration, and theme core

Status: Done

Tickets: [`19-configuration-and-keybindings.md`](19-configuration-and-keybindings.md) (core), [`20-theme-and-colors.md`](20-theme-and-colors.md) (core)

Scope for 19: `domain/config` defaults and types, `domain/keymap` types, defaults, parse, and resolve, plus `ConfigProvider` and `KeymapProvider` with built-in defaults.

Scope for 20: theme token types, the Catppuccin tokens, the icons module, and a fixed default theme.

Observable outcome: the app boots with a resolved default keymap and theme tokens. No config file is required.

Deferred for 19: file loading and precedence, validation and warnings, reload, conflict-reporting surfaces in help and the palette, `useHotkeys` dispatch, and the help and palette integration. Conflict settlement already rejects conflicting overrides and warns, and the string, array, `null` reset, and `[]` unbind override forms are implemented.

Deferred for 20: theme file loading, the theme picker, capability detection, and `NO_COLOR` behavior.

Why now: the shell's `useHotkeys`, `KeymapProvider`, focus borders, and footer hints need the keymap and token contracts before they can be built without rework. Shipping these two tickets in full first would delay the first real screen, so build only the core.

## M3 - App shell and focus

Status: Done (shell and focus frame; every row in Deferred below is still open)

Tickets: [`01-app-shell-and-focus.md`](01-app-shell-and-focus.md)

Scope: `AppShellHost`, the four-region frame, `TopBar` slot, `Sidebar`, `MainArea`, `Footer`, `ResponsiveGate`, the region constants, `FocusProvider`, `StatusProvider`, `useHotkeys`, `useAction`, `useFocusRegion`, `useFocusModel`, Tab traversal, direct region jumps, cursor persistence, and the terminal-too-small notice.

Observable outcome: the shell renders with the four regions, focus starts on the top bar, moves by Tab, Shift+Tab, and the digit jumps, region borders and markers follow focus, the footer shows global hints, and the too-small notice appears at the documented breakpoints with the current, enforced, and target sizes. Panels, graph, diff, composer, and console are placeholders.

Deferred: every panel's content, the real top bar actions, repository state, overlays, command execution, quit confirmation and operation abort, loading rows, overlay footer keys, the right-pane selection derivation, `search` and `form` input modes, and console provider ownership. M3 ships global-only footer hints until the first real panel registers region-scoped actions in M5/M7.

Why now: every later feature plugs into this frame. Building it against placeholders avoids blocking on repository or git work while proving the focus model, which is the hardest part of the UI architecture.

## M4 - Repository and git foundation

Status: Done (phase 1 execution contract and phase 2 freshness layer; `remote.fetch` is the one wired mutation command, and the full command registry, progress rendering, and the real top-bar and console surfaces stay deferred)

Tickets: [`18-safety-and-platform-behavior.md`](18-safety-and-platform-behavior.md), [`16-repository-states.md`](16-repository-states.md), [`17-freshness-and-performance.md`](17-freshness-and-performance.md)

Build in this order because they share files:

1. 18: `git.client.ts` execution contract, prompt suppression, timeouts, `git.errors.ts`, `git.redact.ts`, and `commands.runner.ts` result shape.
2. 16: `repository.states.ts`, state detection, and gating.
3. 17: `RepositoryProvider`, the first repository read, refresh, serialization, watcher opt-in, pagination and diff limits, and `useCommandRunner`.

Done in phase 1: the git client execution contract, prompt/editor/pager environment, timeouts and cancellation, error classification, redaction, the canonical status read, repository probes, remotes and identity reads, the command runner with its write latch, repository state detection and gating, and command availability.

Done in phase 2: incremental `--progress` parsing, the debounced git-directory watcher with opt-in worktree mode, upstream classification and per-remote fetch evidence recording, repository selectors, the graph paging and search engines, diff caps, the bounded console buffer and formatter, `RepositoryProvider` with coalesced refresh and watcher and terminal-focus refresh, `useRepository` with the single global `app.refresh` handler, `ConsoleProvider` and `useConsoleLog`, and `useCommandRunner` with the exact eight-step effect order.

The one mutation command reachable end to end is `remote.fetch`: `AppShellHost` registers the real upstream-scoped fetch handler and dispatches it through `useCommandRunner` from the temporary global `remote.fetch` action bound to `f`. The M5 top bar replaces that trigger and keeps the same orchestrator path.

Observable outcome: the app reads the current repository on launch, shows branch, upstream, ahead and behind, staged, unstaged and untracked counts, and repository state in the temporary top-bar placeholder, and pressing `f` runs a real fetch through `useCommandRunner` that produces exactly one console entry, one status, and one refresh. A fetch that reaches a remote also advances that remote's last successful fetch timestamp; a failed remote leaves it untouched. The real top bar is M5 and the console drawer is M6.

Deferred: the full command registry and availability rules for every feature, progress rendering in the top bar, the graph and diff surfaces that consume the paging engines, draft-based quit confirmation (quit aborts the child and waits for it to settle, but does not yet ask about an unsaved draft), and the performance edge cases that need real data. The overlay-based error surface and the real console drawer were completed in M6.

Why now: the top bar and every panel read the repository snapshot. The git client and command runner are the shared contract that all mutations use, so they belong before the first actionable feature.

## M5 - Top bar

Status: Done

Tickets: [`02-top-bar.md`](02-top-bar.md)

Scope: repository path title, branch and upstream display, ahead and behind, sync state badge, Pull and Push buttons, the More menu, fetch and fetch --prune, force push variants, no-upstream push, progress, and transient status.

Observable outcome: the top bar shows the real repository state and runs fetch, pull, and push with progress, confirmation, console output, and a refreshed repository.

Deferred: remote-specific edge cases that need the remotes panel, and tag push from the tags panel.

Why now: it is the first feature that turns the repository foundation into an observable user workflow.

## M6 - Overlays and console

Status: Done

Tickets: [`15-overlays-and-confirmations.md`](15-overlays-and-confirmations.md), [`13-console.md`](13-console.md)

Scope: the overlay stack, confirm and error modals, focus trapping, destructive confirmation wording, the console drawer, bounded entries, selection, copy, and clear confirmation.

Done: the single-entry `OverlayProvider` now owns the open entry, the persistent redacted error detail, and the focus captured when either surface opens. Opening a surface blurs the background renderable, and a settled command closes only the entry that was open when it started. `ConfirmModal` keeps Cancel as the destructive default, validates the exact shared F-15 label table at entry creation with a visible warning instead of a render crash, and exposes the exact F-15 label table. `ErrorOverlay` renders redacted, sanitized, capped details with Dismiss, Open console entry, and Retry only for retryable remote failures; a new failure replaces the visible one without stacking. While an overlay is open the `Overlay` layer blocks the background; outside a modal text field only `overlay.close`, `app.quit`, and the same modal's toggle resolve, while inside a modal text field the `Esc` close, the hardcoded `Ctrl+C` quit path, and modifier-gated text-input-safe actions may also fire. `useCommandRunner` now routes settled failures to the error overlay with the console entry link and a retry closure over the original request, updates an already-appended entry to a matching failure when the post-result refresh fails, and no longer writes a temporary error status. The real `ConsoleDrawer` replaces the M4 placeholder: singular/plural header count, follow and new-entry indicators, bounded viewport, per-entry timestamp, operation, argv, conditional cwd, exit status, duration, phase and summary, expandable stdout/stderr with the omitted-lines marker, failure rows expanded by default, keyboard selection, scrolling, and expansion through `nav.activate`, OSC 52 copy on selection, empty, running, failure, cancelled, and timed-out states, and clear confirmation through the overlay. The console joins the Tab order only while open, and captured output is sanitized for terminal control bytes before storage. The console registers only `console.clear`, `nav.*`, and `nav.activate` in the `console` scope; `app.console`, `overlay.close`, and `focus.region.console` stay in the app and shell layers.

Deferred: feature-specific destructive confirmation copy lands with each panel ticket; text-field modal forms and their `form.submit` flow land with the features that own those forms; console search and filtering remain outside the documented scope; draft-based quit confirmation and the per-feature confirmations beyond the force-push pair remain open.

Observable outcome: destructive and failed commands open the correct overlay, and every command appears in the console with redacted output.

Why now: every later destructive action depends on the overlay stack, and every command result depends on the console surface.

## M7 - Sidebar panels

Status: Done

Tickets: [`03-branches-panel.md`](03-branches-panel.md), [`04-remotes-panel.md`](04-remotes-panel.md), [`05-tags-panel.md`](05-tags-panel.md), [`06-stashes-panel.md`](06-stashes-panel.md), [`07-worktrees-panel.md`](07-worktrees-panel.md)

Recommended order: branches, remotes, tags, stashes, worktrees.

Scope: the five real sidebar panels, their row rendering and navigation, the panel-scoped action registrations, their modals and destructive confirmations, the panel command executors, the repository snapshot extensions that carry branches, remote branches, tags, stashes, and worktrees, the shared selectors, remote tag knowledge, bounded worktree dirty reads, and the right-pane `StashDetails` and `WorktreeDetails` summaries.

Done: `RepositorySnapshot` now carries local branches with worktree and upstream classification, remote branches, local tags, stashes, worktrees, the current worktree path, and the HEAD subject. Branch merge state is not part of the snapshot: `readBranchRisk()` reads the capped at-risk list lazily when the Delete Branch modal opens, against the configured upstream while its remote-tracking ref exists and otherwise against HEAD, which matches `git branch -d`. `repository.selectors.ts` owns branch ordering, remote grouping, tag scope merge and version ordering, stash ordering, and the worktree branch map. Repository reads treat each optional ref list as its own result: a failed branch, remote-branch, tag, stash, or worktree read keeps that list's previous snapshot and records a per-list failure while status, branch, remotes, and the successful lists still apply, and each panel reports only its own list failure above the previous rows. A retained worktree or branch list re-derives the branch worktree paths from the worktrees the snapshot stores, so the branch `+` marker, the selected-row worktree detail, and the `checked-out-in-worktree` delete guard stay consistent with the Worktrees panel after either list fails, including the mirror case where the branch read fails while the worktree read succeeds; a store test covers that direction. `RepositoryProvider` gained remote tag knowledge with a coalesced `refreshRemoteTags()` that queues one follow-up check when a caller joins an in-flight read, the capped `readBranchRisk()` commit read, and selection repair that moves a vanished stash or worktree selection to the nearest surviving row or `{ kind: "pending" }`. The registry gained `branch.checkout`, `remote.createLocal`, `graph.selectCommit`, `stash.select`, and `worktree.select`; the new executors cover atomic branch create and checkout, local-first branch delete with partial-failure reporting, remote-scope resolution that disables the remote half when the upstream or remote is gone, local-branch creation from a remote ref, lightweight and annotated tag create plus tag push and scoped delete, stash create/apply/pop/drop with action-time object-name resolution, and worktree add/remove with the exact zero, one, or two force flags. The Delete Branch modal names the capped at-risk commit list, scrolls it with PageUp/PageDown while it is taller than its viewport so every listed commit is reachable from the keyboard, and requires the acknowledgement before an unmerged branch can be force-deleted. `usePanelCommands` registers every panel executor once at the composition root. Each panel owns exactly its documented region-scoped actions plus `list.filter` where it has a filter; `useListCursor` owns `nav.up`, `nav.down`, `nav.activate`, and `nav.first`/`nav.last` only for the regions that bind them, and passes the clicked index to double click. Panel actions publish their selected-target availability so the footer hides an unavailable `branch.delete`, `tag.push`, or `worktree.delete`, and `useScrollSelectedRow` keeps the active row inside the shell's single scrollbox. The Remotes filter clears on the first `Esc` through the input clear registry and the panel caps rendered rows at 5000 with a truncation notice. Remote rows budget the name from the panel's real inner content width through `PanelScrollContext`, reserving the panel border, the `ListRow` marker, and the freshness marker, so the ellipsis is never clipped in the sidebar. `StashDetails` and `WorktreeDetails` render from the right-pane selection, and `AppShellHost` composes all five panels and the two summaries. M7 also ships `git.branches.integration.test.ts` and `git.remotes.integration.test.ts` against the shared git fixture, and a provider test drives a command-triggered refresh that joins an in-flight read and asserts exactly one follow-up read, plus an unmount case that starts no follow-up and a case that aborts an already-started follow-up. Review cleanup moved the remote-branch read, parse, group, and create-local planners out of `git.remotes.ts` into `git.remote-branches.ts`, and put every M7 named type in a sibling `*.types.ts` and every component constant in a sibling `*.constants.ts`.

Deferred: the New Worktree form does not probe the parent directory's writability and cannot detect an arbitrary directory that exists on disk but is absent from the snapshot; git rejects such a path at execution. `search` and `form` input modes and overlay `Tab` traversal for a focused text field remain deferred, so a modal text field owns its keys and a select is reached through the modal's explicit control cycle. The Branches `list.filter` behavior stays unregistered because F-03 does not define branch filtering and the ticket keeps it as an open question. Any action that needs the graph, diff, or details surfaces stays deferred to M8, including the stash diff and the tag-to-commit graph highlight beyond setting the commit selection. Help and the palette do not exist yet, so only the footer consumes the availability each panel publishes. Repository-owned text is rendered raw: stash and tag subjects, the HEAD subject used by the stash prefill, and the at-risk commit subjects reach `<text>` and the form input without the control-character sanitizer used for command output. This is the pre-existing display posture rather than an M7 regression, and it stays open until the product decides whether repository text needs sanitizing. The at-risk commit list is read once when the Delete Branch modal opens and is never re-read while the modal stays open, so a commit added from another terminal after that read is an accepted TOCTOU window and is not named before `-D`. The collapsed sidebar switcher uses the plain section name in its tabs (`shortLabel`) while the bordered panel title keeps the row count, so the count appears once per layout. Size debt is recorded rather than split further. `useNewWorktreeForm.ts` (~442 lines) stays one form state machine for path derivation, branch mode, and name validation; split it when another worktree mode lands (for example a detached-HEAD start point) or a second form consumer needs the same flow. `useBranchActions.ts` (~402 lines) stays one action hook for create, checkout, and delete dispatch; split it when M8 graph or diff integration adds commit-context branch actions that do not share the create and delete target model, or when a fourth branch action lands. `useWorktrees.ts` (~383 lines) stays the composing hook for rows, cursor, filter, selection repair, and action wiring; split it when another worktree mode or an M8 graph or diff surface needs view state the sidebar does not. `useTags.ts` (~323 lines) stays one hook for tag rows, scope merge, remote tag knowledge, and tag action wiring; split it when a tag details, signature, or push-progress surface adds state the sidebar does not need. `useRepositoryRefresh.ts` (~345 lines) stays one refresh cycle for status, graph, and combined coalescing plus the single-slot follow-up queue; split it when two follow-up kinds can queue at once or a read path needs its own retry policy. `RepositoryProvider.store.ts` (~344 lines) stays one pure store module for read application, worktree re-derivation, remote evidence, and selection identity; split selection repair or tag knowledge into its own module when either grows a state machine the store no longer just merges. `commands.availability.ts` stays one pure availability table over the registry's target kinds; split it when a command family needs availability state that is not a plain `(state, signals, target)` predicate. `git.tags.ts` stays one cohesive tag module (reads, scope merge, ordering, planners); split it when a tag feature change adds a distinct concern such as signed tags or a tag details surface. The M5 remote-command debt also stands: `commands.remote.ts` is split into the prune and push planners when a fourth composite remote command lands, or before the v1 freeze. The four speculative M7 UI primitives (`Badge`, `Divider`, `ListView`, `PanelHeader`) were removed from M7 because no production surface consumed them; they are deferred to M8, are not available M7 primitives, and an M8 ticket that sketches a `PanelHeader` reintroduces it only when that surface is built.

Observable outcome: each panel lists real repository data, supports navigation and its documented actions, and updates after a refresh.

Why here: the panels are independent of the graph and diff work and can be built in parallel once the shell and repository foundation exist.


## M8 - Main workflows

Status: Done

Tickets: [`08-commit-graph.md`](08-commit-graph.md), [`11-diffs-and-file-actions.md`](11-diffs-and-file-actions.md), [`09-commit-composer.md`](09-commit-composer.md), [`10-commit-details.md`](10-commit-details.md)

Recommended order:

1. 08: graph, Pending Changes row, selection, paging, search.
2. 11: working tree and staged diffs, file actions, staging.
3. 09: composer, identity, commit.
4. 10: commit details, parents, refs, and the commit diff.

Done: `CommitGraph` renders the paged history with lanes, ref badges, the Pending Changes row, loading, empty, error, bounded-miss, and end-of-history states, and the commit search input in `search` input mode; it owns the commit navigator and the graph-window refresher. `DiffPanel` renders the three pending sections with lazy per-file `<diff>` reads, hunk collapse, the conflict banner, per-file and bulk stage, unstage, discard, and delete with their confirmations, and a read-only file list for a commit or stash selection. `CommitComposer` owns the composer surface through `DraftProvider`, the identity line, the auto-growing multiline message, the four commit variants menu, amend message loading, and the shared enablement rule. `CommitDetails` renders the hashes, author and committer, ref badges, parent selection through the graph's bounded `ensureLoaded`, the capped stats row, and the collapsible message. `App.tsx` mounts `DraftProvider` inside `RepositoryProvider` and around `FocusProvider`; `AppShellHost` derives the right pane from `selection.kind`, keeps the graph mounted across mode changes, mounts the diff and commit executors once through `useMainCommands`, and registers `commit.focus` as the app-owned global action; `MainArea` is layout-only and every surface owns its own `Panel`, region frame, and scroll container. The last `PlaceholderSurface` use is gone and the component is deleted.

Deferred: command palette and help integration, because both surfaces are M9 and still absent, so the new commands and effective bindings are not discoverable from a palette or help. Parent subjects in commit details: parent rows show the short hash because the loaded graph window belongs to the graph feature, and reading a subject per parent would add a read to a pane that must stay responsive. Commit stats cap behavior: the stats read stops at `COMMIT_STATS_FILE_CAP` and reports "stats truncated" instead of reading an unbounded commit. `form` input mode (modal forms and footer action traversal) and every `search` mode beyond commit search, so a modal text field still owns its keys and a select is reached through the modal control cycle. Draft-based quit confirmation: `app.quit` still aborts the in-flight command and destroys the renderer without asking about `DraftProvider.hasUnsavedDraft`. Remaining caveats: the right column reserves 11 rows for the composer at the enforced 80x24 minimum and the target 100x30 (clamped only when the console drawer leaves less room, and the composer fills the clamped slot down to a one-row message field), so at those sizes the message field is capped at about four rows and the diff takes the remaining rows down to its three-row minimum; the composer never draws over the diff and keeps its one-cell gutter in both console states, and its More and Commit controls stay visible, and the message field grows toward eight rows as the one-fifth right-pane share exceeds the reservation, and the right-pane summaries still render repository text without the command-output sanitizer recorded in M7.

Observable outcome: the user can inspect history, select the Pending Changes row, review and stage files, write and submit a commit, then inspect the resulting commit.

Why this order: staging is the input to committing, and commit details need the graph selection plus the diff surface.

## M9 - Completion and hardening

Status: Ready for dev

Tickets: [`12-command-palette.md`](12-command-palette.md), [`14-help.md`](14-help.md), and the remaining scope of [`20-theme-and-colors.md`](20-theme-and-colors.md), [`17-freshness-and-performance.md`](17-freshness-and-performance.md), and [`18-safety-and-platform-behavior.md`](18-safety-and-platform-behavior.md)

Scope: the palette, help discovery of effective bindings, the help Configuration section, theme file loading and the picker, capability detection, `NO_COLOR`, watch mode, performance bounds, redaction review, and platform behavior.

Observable outcome: every action is discoverable from the palette and help, the theme is configurable and degrades safely, and the documented bounds hold.

Why last: these surfaces read effective bindings, commands, and tokens that only exist after the earlier milestones. Hardening is revisited at the end of every milestone, not deferred entirely to this one.

## Parallel work

- M7 panels can run in parallel with each other and with M8 once M3 and M4 are stable.
- M6 can start as soon as M3 lands; it does not need M4.
- 12 and 14 can start once their consumers exist; they do not need to wait for all of M8.
- 17 and 18 must be revisited during M5 to M8 because progress, timeouts, redaction, and refresh affect every command.
