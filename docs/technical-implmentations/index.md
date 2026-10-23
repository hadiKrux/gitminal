# Implementation order

Status: Active
Last updated: 2026-10-22
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

- 23 `src/**` paths are claimed as owned by more than one ticket. The main groups are `useHotkeys.ts` and `KeymapProvider.tsx` (01 and 19), `git.client.ts`, `commands.runner.ts`, and `git.errors.ts` (17 and 18), `console.buffer.ts`, `diff.limits.ts`, `graph.paginate.ts`, and `graph.search.ts` (17 and the feature owners), the `domain/git` read modules (`git.branches.ts`, `git.diff.ts`, `git.log.ts`, `git.stashes.ts`, `git.status.ts`, `git.tags.ts`, `parsers/parse.log.ts`), `repository.selectors.ts` and `repository.upstream.ts`, `useFileDiff.ts`, and the overlay components (15 and 18).
- Structural open questions still unresolved: `RepositoryState` ownership between `repository.types.ts` and `repository.states.ts`, the error overlay as a stack entry versus a provider field, session ownership of the palette recent list, and provider ownership for config, keymap, and theme.

## M1 - Bootstrap and splash

Status: Done

Tickets: [`21-startup-splash.md`](21-startup-splash.md)

Scope: the real `src/index.tsx` bootstrap with `exitOnCtrlC: false`, the splash gate components (`src/app/App.tsx`, `src/app/SplashGate.tsx`, `src/app/WorkspacePlaceholder.tsx`, `src/app/quit.key.ts`), `src/app/app.constants.ts`, the splash UI (`src/features/splash/SplashScreen.tsx`, `SplashScreen.constants.ts`, `SplashUpdateNotice.tsx`), the any-key dismissal, the `Ctrl+C` quit path, and the one-shot update check.

Observable outcome: `bun run dev` renders the splash with the wordmark and running version; any key opens the workspace placeholder; `Ctrl+C` quits and restores the terminal. A failed or slow update check is silent and never blocks dismissal.

Deferred: the shell providers, repository reads, configuration, and theming.

Why first: it has no runtime dependencies, it establishes the entry point and test harness, and it proves OpenTUI rendering plus keyboard handling in the smallest possible flow.

## M2 - Keymap, configuration, and theme core

Status: Ready for dev

Tickets: [`19-configuration-and-keybindings.md`](19-configuration-and-keybindings.md) (core), [`20-theme-and-colors.md`](20-theme-and-colors.md) (core)

Scope for 19: `domain/config` defaults and types, `domain/keymap` types, defaults, parse, and resolve, plus `ConfigProvider` and `KeymapProvider` with built-in defaults.

Scope for 20: theme token types, the Catppuccin tokens, the icons module, and a fixed default theme.

Observable outcome: the app boots with a resolved default keymap and theme tokens. No config file is required.

Deferred for 19: file loading and precedence, validation and warnings, reload, conflict reporting, help and palette integration, and alternate binding forms.

Deferred for 20: theme file loading, the theme picker, capability detection, and `NO_COLOR` behavior.

Why now: the shell's `useHotkeys`, `KeymapProvider`, focus borders, and footer hints need the keymap and token contracts before they can be built without rework. Shipping these two tickets in full first would delay the first real screen, so build only the core.

## M3 - App shell and focus

Status: Ready for dev

Tickets: [`01-app-shell-and-focus.md`](01-app-shell-and-focus.md)

Scope: `AppShellHost`, the four-region frame, `TopBar` slot, `Sidebar`, `MainArea`, `Footer`, `ResponsiveGate`, the region constants, `FocusProvider`, `StatusProvider`, `useHotkeys`, `useAction`, `useFocusRegion`, `useFocusModel`, Tab traversal, direct region jumps, cursor persistence, and the terminal-too-small notice.

Observable outcome: the shell renders with the four regions, focus moves by Tab and the digit jumps, region borders follow focus, the footer shows hints, and the too-small notice appears at the documented breakpoints. Panels, graph, diff, composer, and console are placeholders.

Deferred: every panel's content, the real top bar actions, repository state, overlays, and command execution.

Why now: every later feature plugs into this frame. Building it against placeholders avoids blocking on repository or git work while proving the focus model, which is the hardest part of the UI architecture.

## M4 - Repository and git foundation

Status: Ready for dev

Tickets: [`18-safety-and-platform-behavior.md`](18-safety-and-platform-behavior.md), [`16-repository-states.md`](16-repository-states.md), [`17-freshness-and-performance.md`](17-freshness-and-performance.md)

Build in this order because they share files:

1. 18: `git.client.ts` execution contract, prompt suppression, timeouts, `git.errors.ts`, `git.redact.ts`, and `commands.runner.ts` result shape.
2. 16: `repository.states.ts`, state detection, and gating.
3. 17: `RepositoryProvider`, the first repository read, refresh, serialization, watcher opt-in, pagination and diff limits, and `useCommandRunner`.

Observable outcome: the app reads the current repository on launch, shows branch, upstream, ahead and behind, and repository state, and a read-only command runs through the orchestrator with a console entry and status.

Deferred: the full command registry and availability rules for every feature, progress rendering, and the performance edge cases that need real data.

Why now: the top bar and every panel read the repository snapshot. The git client and command runner are the shared contract that all mutations use, so they belong before the first actionable feature.

## M5 - Top bar

Status: Ready for dev

Tickets: [`02-top-bar.md`](02-top-bar.md)

Scope: identity, branch and upstream display, ahead and behind, sync state badge, Pull and Push buttons, the More menu, fetch and fetch --prune, force push variants, no-upstream push, progress, and transient status.

Observable outcome: the top bar shows the real repository state and runs fetch, pull, and push with progress, confirmation, console output, and a refreshed repository.

Deferred: remote-specific edge cases that need the remotes panel, and tag push from the tags panel.

Why now: it is the first feature that turns the repository foundation into an observable user workflow.

## M6 - Overlays and console

Status: Ready for dev

Tickets: [`15-overlays-and-confirmations.md`](15-overlays-and-confirmations.md), [`13-console.md`](13-console.md)

Scope: the overlay stack, confirm and error modals, focus trapping, destructive confirmation wording, the console drawer, bounded entries, selection, copy, and clear confirmation.

Observable outcome: destructive and failed commands open the correct overlay, and every command appears in the console with redacted output.

Deferred: feature-specific confirmation copy can land with each feature, and console filtering beyond the documented scope can wait.

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
