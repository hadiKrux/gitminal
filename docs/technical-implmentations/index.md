# Implementation order

Status: Active
Last updated: 2026-10-23
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

Status: Ready for dev

Tickets: [`03-branches-panel.md`](03-branches-panel.md), [`04-remotes-panel.md`](04-remotes-panel.md), [`05-tags-panel.md`](05-tags-panel.md), [`06-stashes-panel.md`](06-stashes-panel.md), [`07-worktrees-panel.md`](07-worktrees-panel.md)

Recommended order: branches, remotes, tags, stashes, worktrees.

Observable outcome: each panel lists real repository data, supports navigation and its documented actions, and updates after a refresh.

Deferred: any action that needs the graph, details, or diff surfaces; wire those when M8 lands.

Why here: the panels are independent of the graph and diff work and can be built in parallel once the shell and repository foundation exist.

## M8 - Main workflows

Status: Ready for dev

Tickets: [`08-commit-graph.md`](08-commit-graph.md), [`11-diffs-and-file-actions.md`](11-diffs-and-file-actions.md), [`09-commit-composer.md`](09-commit-composer.md), [`10-commit-details.md`](10-commit-details.md)

Recommended order:

1. 08: graph, Pending Changes row, selection, paging, search.
2. 11: working tree and staged diffs, file actions, staging.
3. 09: composer, identity, commit.
4. 10: commit details, parents, refs, and the commit diff.

Observable outcome: the user can inspect history, select the Pending Changes row, review and stage files, write and submit a commit, then inspect the resulting commit.

Deferred: broader commit actions that the product spec defers beyond v1.

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
