# 16 - Repository states

## 1. Header

Spec reference: `docs/product-spec.md` F-16 (lines 1067-1095), plus F-17 (lines 1096-1125), F-18 (lines 1126-1153), F-19 (lines 1154-1323) and F-20 (lines 1324-1487) for the configuration and theme rows, F-02 fetch and upstream rules (lines 207-319), F-11 conflicts (lines 838-953), and the action IDs in section 6.1 (lines 1705-1742).
Dependencies: F-01 `01-app-shell-and-focus.md` (the shell that renders the state screens and banners), F-02 `02-top-bar.md` (detached, no upstream, upstream gone, no remote, no origin), F-08 `08-commit-graph.md` (empty repository and pagination), F-09 `09-commit-composer.md` (missing git identity and hook failure), F-11 `11-diffs-and-file-actions.md` (conflicted files, binary and oversized files, conflict-marker diff), F-12 `12-command-palette.md` and F-14 `14-help.md` (invalid configuration details), F-13 `13-console.md` (config and theme warnings), F-15 `15-overlays-and-confirmations.md` (error overlay), F-17 `17-freshness-and-performance.md` (external changes, huge repository), F-19 `19-configuration-and-keybindings.md` (invalid configuration), F-20 `20-theme-and-colors.md` (invalid theme).
Owned paths: `src/domain/repository/repository.states.ts` (state detection and repository-wide gating).
Referenced shared modules (not owned here): `src/domain/repository/repository.types.ts` (the `RepositoryState` union), `src/domain/repository/repository.selectors.ts` (state and display selectors), `src/domain/repository/repository.upstream.ts` (upstream classification), `src/app/hooks/useRepository.ts` (the presentation hook AppShell reads), `src/domain/git/git.repo.ts`, `src/domain/git/git.status.ts`, `src/domain/git/git.errors.ts`.

This document follows the 14-section contract in `00-project-architecture.md` section 14. `repository.states.ts` is pure domain code: it imports only `src/domain/**` and `src/lib/**`, never React, never `@opentui/*`, and never spawns a process. Where this document and the architecture contract disagree, the architecture contract wins.

## 2. Scope and non-goals

In scope: detecting every repository state in the F-16 table, exposing each as a `RepositoryState` value, splitting repository-wide gating (`gateRepository`) from target-aware command availability (`getAvailability`) with a machine-readable reason, and driving the shell presentation (screens, banners, and disabled reasons) that AppShell and the features render.
Non-goals: the detailed UI of the panels, graph, composer, diff, palette, help, console, and overlays (owned by their feature docs); running git (owned by `git.client.ts`); the refresh cycle and pagination (F-17 `17-freshness-and-performance.md`); keymap and config file parsing (F-19 `19-configuration-and-keybindings.md`); theme token resolution (F-20 `20-theme-and-colors.md`).

## 3. OpenTUI components used

`repository.states.ts` is pure domain code and uses no OpenTUI components. The presentation it drives uses the following.

| Component | Where used | Why it is the right component |
| --- | --- | --- |
| `<box>` | State screens, the repository-state banner container, and the splash containers. | Layout, borders, and hit areas. |
| `<text>` | State titles, the current directory, the missing git identity value, and every reason string. | Every string. |
| `<span>` | The banner markers (`[?]`, `U`, `!`) inside banner text. | Inline runs inside `<text>`. |
| `<ascii-font>` | The not-a-git-repository, bare-repository, and terminal-too-small splashes only. | The single sanctioned splash use in architecture section 6. |
| `<scrollbox>` | Long error detail and the Help > Configuration detail list. | Scrollable bounded region. |
| `<select>` | Not used here; the palette and More menu own their lists. | N/A here. |
| `<input>`, `<diff>`, `<code>`, `<line-number>`, `<markdown>`, `<textarea>` | Not owned here. | N/A here. |

Hooks used: `useRepository` (the presentation hook AppShell reads to get the state and gating), `useStatus`, and `useOverlay`. `useKeyboard` is never called here; keys arrive through `useHotkeys` in `src/app/hooks/useHotkeys.ts`.

All icons and markers used by this feature come from `src/theme/icons.ts`; see architecture section 6.1. No glyph literal is written in feature code.

## 4. Component tree

```text
AppShell                          (src/features/shell/AppShell.tsx)
-> RepositoryStateGate            (rendered inside AppShell from useRepository state)
   -> NonRepoScreen               "Not a git repository"      (box + text + ascii-font)
   -> BareRepoScreen              "Bare repositories are not supported"
   -> RepositoryStateBanner       merge/rebase/cherry-pick, conflicts, detached, operation, external changes
-> TopBar                         reads detached, no upstream, upstream gone, no remote
-> Sidebar                        branch rows read upstream classification
-> MainArea
   -> CommitGraph                 empty repository, pagination
   -> CommitComposer              missing identity, hook failure
   -> DiffPanel                   conflicted files, binary/oversized notice
-> ConsoleDrawer                  config and theme warnings
-> ErrorOverlay                   permission, missing git, auth/network, hook output
```

The state gate is a render decision in AppShell, not a new renderable. Screens and banners are composed from the `ui/` primitives `EmptyState`, `ErrorState`, `StatusBadge`, and `TextMarker`.

## 5. Enforced files and folders

| File | Responsibility |
| --- | --- |
| `src/domain/repository/repository.states.ts` | The state machine: `detectRepositoryState(signals)` returns the `RepositoryState`, and `gateRepository(actionId, state, signals)` returns `{ available, reason }` for repository-wide gates only. Pure, table-driven, no git spawning. |

Referenced files that hold adjacent responsibilities:

| File | Responsibility |
| --- | --- |
| `src/domain/repository/repository.types.ts` | The `RepositoryState` union and the `RepositorySignals` input type. |
| `src/domain/repository/repository.selectors.ts` | State and display selectors consumed by features. |
| `src/domain/repository/repository.upstream.ts` | Upstream classification: none, healthy, gone, deleted-after-prune, deleted-after-remote-branch-deletion, or unknown when a remote check fails or times out. |
| `src/app/hooks/useRepository.ts` | The presentation hook AppShell and features read for the snapshot, state, and gating. |
| `src/app/hooks/useCommandRunner.ts` | The app-layer orchestrator that applies the runner result: repository refresh, console append, status and progress, and error routing. |
| `src/domain/commands/commands.availability.ts` | `getAvailability(commandId, context)` combines the `gateRepository` result from `repository.states.ts` with target validation against the explicit `CommandTarget`, so footer, palette, buttons, and row-level reasons agree. |

## 6. State model

Provider state: `RepositoryProvider` owns the snapshot and the derived `RepositoryState`. `commands.runner.ts` owns the write latch; `StatusProvider` holds the projected running-operation flag and progress. `ConfigProvider` owns config warnings; `ThemeProvider` owns theme warnings. `OverlayProvider` owns the error overlay stack.

`RepositoryState` is a discriminated union whose members cover the F-16 rows: `loading`, `normal`, `subdirectory`, `not-a-repository`, `bare`, `empty`, `detached`, `no-upstream`, `upstream-gone`, `no-remote`, `no-origin`, `merge-in-progress`, `rebase-in-progress`, `cherry-pick-in-progress`, `conflicted`, `checkout-dirty`, `operation-in-progress`, `external-changes`, `huge-repository`, `binary-or-oversized`, `permission-error`, `missing-git`, `missing-identity`, `hook-failure`, `auth-network-failure`, `invalid-config`, and `invalid-theme`.

Some members are exclusive (not-a-repository, bare, missing-git) and gate the whole app. Others are orthogonal overlays on a normal repository (detached, no-upstream, upstream-gone, conflicted, operation-in-progress) and are reported as a set of active flags so a repository can be, for example, `normal` plus `detached` plus `conflicted`. `detectRepositoryState` returns the exclusive state plus an ordered list of active flags; `gateRepository` reads both for repository-wide gates, and `getAvailability` adds target validation on top.

View state: none in this feature. Every screen and banner is a pure function of provider state.

## 7. Data flow

`RepositoryProvider` builds a `RepositorySignals` object from git reads, then calls `detectRepositoryState`. The signals and their commands:

| Signal | Git command | Domain module |
| --- | --- | --- |
| Is inside a work tree | `git rev-parse --is-inside-work-tree` | `@/domain/git/git.repo.ts` |
| Repository root | `git rev-parse --show-toplevel` | `@/domain/git/git.repo.ts` |
| Is bare | `git rev-parse --is-bare-repository` | `@/domain/git/git.repo.ts` |
| Git directory path | `git rev-parse --git-dir` | `@/domain/git/git.repo.ts` |
| HEAD exists | `git rev-parse --verify HEAD` | `@/domain/git/git.repo.ts` |
| Unborn branch | `git symbolic-ref --short HEAD` | `@/domain/git/git.repo.ts` |
| Detached HEAD | `git symbolic-ref -q --short HEAD` failing, then `git rev-parse --short HEAD` | `@/domain/git/git.repo.ts` |
| Upstream ref | `git rev-parse --abbrev-ref --symbolic-full-name @{u}` | `@/domain/repository/repository.upstream.ts` |
| Upstream existence | `git rev-parse --verify <upstream>` | `@/domain/repository/repository.upstream.ts` |
| Remote upstream absence | `git ls-remote --heads -- <remote>` during prune confirmation, plus the `git push <remote> --delete <branch>` result | `@/domain/repository/repository.upstream.ts` |
| Remotes | `git remote` | `@/domain/git/git.remotes.ts` |
| Status, conflicts, and operation markers | `git status --porcelain=v2 --branch -z --untracked-files=all` | `@/domain/git/git.status.ts` plus `parsers/parse.status.ts` |
| Merge, rebase, cherry-pick markers | `git rev-parse --verify --quiet MERGE_HEAD`, `git rebase --show-current-patch`, `git rev-parse --verify --quiet REBASE_HEAD`, `git rev-parse --verify --quiet CHERRY_PICK_HEAD` | `@/domain/git/git.repo.ts` |
| Identity | `git config user.name`, `git config user.email` | `@/domain/git/git.repo.ts` |

`detectRepositoryState(signals)` maps these to the union. `gateRepository(actionId, state, signals)` maps the repository-wide state plus the action ID to `{ available, reason }`; it owns gates that do not depend on a row, such as detached HEAD, empty repository, and missing remote. `@/domain/commands/commands.availability.ts` exposes `getAvailability(commandId, context)`, where `CommandContext` carries `state`, `signals`, the explicit `CommandTarget`, `region`, and `operation`. It calls `gateRepository` first, then validates the target, so a branch action can explain "cannot delete the current branch" and a diff action can explain "read-only" from the same call. The canonical status read is `git status --porcelain=v2 --branch -z --untracked-files=all` everywhere; no module uses a shorter status form. `repository.upstream.ts` classifies an absent upstream as deleted only from a successful prune confirmation or a successful `git push --delete`, and reports `unknown` when the remote check fails or times out. Features read availability through `useRepository` and `commands.availability.ts` and never recompute it. Errors from git flow through `@/domain/git/git.errors.ts`, which classifies exit codes and stderr into the error members (permission, missing-git, auth/network, hook-failure) before `detectRepositoryState` sees them.

Rebase marker deviation: the ticket's original directory checks (`git rev-parse --git-path rebase-merge` and `rebase-apply` plus existence checks) cannot be implemented inside `git.repo.ts` because the domain builtin allowlist does not include `node:fs`. The probe therefore uses `git rebase --show-current-patch`, which reports a paused rebase for both backends, and falls back to `REBASE_HEAD` for a paused state that has not written a current patch. This keeps detection inside the allowlist and still covers the states the app gates.

### 7.1 State table

Each row lists the detection signal, the git command that reveals it, the domain module, the UI surface, and the disabled actions with their reason.

| State | Detection signal | Git command | Domain module | UI surface | Disabled actions and reason |
| --- | --- | --- | --- | --- | --- |
| Normal repository | inside work tree, not bare, HEAD exists, no blockers | `git rev-parse --is-inside-work-tree`, `git rev-parse --is-bare-repository` | `git.repo.ts` | full shell | none |
| Subdirectory launch | `--show-toplevel` differs from process cwd | `git rev-parse --show-toplevel` | `git.repo.ts`, `@/lib/paths.ts` | all paths root-relative; commands run with `cwd` at the root | none |
| Not a git repository | `--is-inside-work-tree` exits 128 | `git rev-parse --is-inside-work-tree` | `git.repo.ts` | `NonRepoScreen` with the current directory and instructions, `ascii-font` splash | every git action, reason "not a git repository" |
| Bare repository | `--is-bare-repository` is true | `git rev-parse --is-bare-repository` | `git.repo.ts` | `BareRepoScreen` "Bare repositories are not supported" | every repository action, reason "bare repository not supported" |
| Empty repository | `--verify HEAD` fails; unborn branch from `symbolic-ref` | `git rev-parse --verify HEAD`, `git symbolic-ref --short HEAD` | `git.repo.ts` | unborn branch shown, no commits, Pending Changes row, composer after staging | `branch.create`, `branch.delete`, `tag.create`, `tag.push`, `tag.delete`, `stash.create`, `remote.push`, `remote.pushForceSafe`, `remote.pushForceOverwrite`, and `remote.pushNoVerify`, reason "no commits yet" |
| Detached HEAD | `symbolic-ref -q` fails; short hash from `rev-parse --short HEAD` | `git symbolic-ref -q --short HEAD`, `git rev-parse --short HEAD` | `git.repo.ts` | top bar shows short hash plus "detached"; composer shows a detached warning | `remote.pull` and `branch.delete`, reason "detached HEAD"; `branch.create` stays available because creating a branch at the detached commit is the recovery path; `commit.submit` allowed |
| No upstream | `@{u}` fails; `for-each-ref` upstream empty | `git rev-parse --abbrev-ref --symbolic-full-name @{u}` | `repository.upstream.ts` | top bar "no upstream"; branch row has no upstream badge | `remote.pull`, reason "no upstream; use Push to create it first."; `remote.push` available when `origin` exists |
| Upstream gone | upstream configured but absent from the fetched remote-tracking refs after a successful remote check; classified as deleted only after a successful Fetch --prune that confirms absence, or after a successful remote branch deletion from the app | `git rev-parse --verify <upstream>`, `git ls-remote --heads -- <remote>` during prune confirmation, and the `git push <remote> --delete <branch>` result | `repository.upstream.ts` | top bar "upstream gone" with `[?]`; branch row `[?]` | `remote.pull`, reason "upstream gone; push to recreate it"; `remote.push` pushes with an explicit `<upstream.remote> refs/heads/<branch>:refs/heads/<upstream.branch>` refspec and recreates the configured upstream; a failed, truncated, or timed-out remote check is `unknown`, never deleted or unpushed |
| No remote | `git remote` is empty | `git remote` | `git.remotes.ts` | top bar and tags show "local only" | `remote.pull`, `remote.push`, `remote.fetch`, `remote.fetchPrune`, reason "no remote"; `remote.more` stays available so the menu can explain every unavailable item |
| No origin but other remotes | `git remote` non-empty and does not contain `origin` | `git remote` | `git.remotes.ts` | top bar Push available without upstream | push without an upstream fails with an error listing the configured remotes; the app does not guess another remote. An existing configured upstream is pushed by explicit remote and refspec, so `push.default=matching` cannot update unrelated branches |
| Merge, rebase, or cherry-pick in progress | `MERGE_HEAD` or `CHERRY_PICK_HEAD` resolves; a paused rebase is reported by `git rebase --show-current-patch` with `REBASE_HEAD` as a fallback | `git rev-parse --verify --quiet MERGE_HEAD`, `git rebase --show-current-patch`, `git rev-parse --verify --quiet REBASE_HEAD`, `git rev-parse --verify --quiet CHERRY_PICK_HEAD` | `git.repo.ts` | persistent `RepositoryStateBanner` naming the operation; conflicted files visible | unsupported operations blocked with reason "merge in progress", "rebase in progress", or "cherry-pick in progress"; `diff.stageAll` and `diff.unstageAll` blocked with reason "merge state" |
| Conflicted files | unmerged entries in status v2 (`u` records) | `git status --porcelain=v2 --branch -z --untracked-files=all` | `git.status.ts`, `parsers/parse.status.ts` | `U` rows in Working Directory plus a conflict banner and a conflict-marker preview rendered from a synthetic unified patch, never combined `--cc` output | `diff.discard` and `diff.discardAll` on a conflicted path, reason "resolve conflicts first"; `diff.stageAll` and `diff.unstageAll` during merge, rebase, or cherry-pick, reason "merge state"; `diff.unstage` on a conflicted file during that operation, reason "merge state"; per-file `diff.stage` allowed after external resolution; ours/theirs deferred |
| Dirty working tree during checkout | checkout returns non-zero with an overwrite message | `git checkout <branch>` | `git.branches.ts`, `git.errors.ts` | inline error naming the blocking paths | the checkout itself; no auto-stash, current state kept |
| Operation in progress | a write latch is held in the runner | none (runner state) | `commands.runner.ts` enforces; `useCommandRunner.ts` projects through `StatusProvider` | top bar status strip with spinner or progress bar plus phase | conflicting mutations blocked, reason "operation in progress"; console available |
| External git changes | watcher event on the git directory | none (watcher) | `@/domain/git/git.watcher.ts` | silent refresh; the F-17 watcher-limitation hint is deferred to the footer/sidebar surface | none; `app.refresh` always available |
| Huge repository | commit count and file count over the configured threshold | `git rev-list --count HEAD`, `git status --porcelain=v2 --branch -z --untracked-files=all` count | `@/domain/graph/graph.paginate.ts`, `@/domain/diff/diff.limits.ts` | paginated graph, virtualized lists, truncated diffs with a notice | none; behavior is bounded rendering |
| Binary or oversized file | diff output "Binary files differ" or size over the limit | `git diff --numstat`, file size check | `@/domain/diff/diff.limits.ts`, `git.diff.ts` | notice instead of a diff | none; file actions remain available |
| Permission or filesystem error | exit code with `EACCES` or `EPERM` in stderr | the failing git command | `git.errors.ts` | `ErrorOverlay` with the exact error | none beyond the failing action; selection is kept and success is never claimed |
| Missing git binary | spawn `ENOENT` for `git.path` | none (spawn failure) | `git.client.ts`, `git.errors.ts` | install message screen | every git action, reason "git not found" |
| Missing git identity | `user.name` or `user.email` empty | `git config user.name`, `git config user.email` | `git.repo.ts` | composer shows the missing value and instructions | `commit.submit`, reason "missing git identity" |
| Hook failure | commit or push exits non-zero with hook output | `git commit`, `git push` | `git.commit.ts`, `git.errors.ts` | `ErrorOverlay` with hook output; console entry | the failed action; message and staged files kept; `--no-verify` mentioned when relevant |
| Authentication failure or network error | exit code with auth or network stderr | the failing remote command | `git.errors.ts`, `git.redact.ts` | `ErrorOverlay` with the decisive error; console entry | none beyond the failing action; local state kept; no interactive prompt |
| Invalid or unreadable configuration | loader warning | none (config loader) | `@/domain/config/config.validate.ts` | non-blocking warning banner; details in Help > Configuration and the console | none; defaults or the previous valid settings are used |
| Invalid theme file | theme resolver warning | none (theme resolver) | `@/domain/theme/theme.resolve.ts` | non-blocking warning; base theme kept | none; the app keeps running |

## 8. Keyboard and focus

This feature adds no keybindings. It only produces the availability that other features' action IDs resolve against, so the footer hints from `@/domain/keymap/keymap.describe.ts`, the palette, and the buttons agree. The relevant global action IDs are `app.refresh` (always available, including while loading, in a whole-shell state, and during an operation), `app.console` (available during an operation), `app.help`, and `app.palette`. When a full-app state is active (not-a-repository, bare, missing-git), `gateRepository` returns unavailable for every repository-wide action and `getAvailability` returns unavailable for every command, and `useHotkeys` still dispatches `app.quit`, `app.help`, `app.palette`, `app.console`, and `app.reloadConfig` because those are not repository actions. No raw key strings appear here.

## 9. Loading, empty, error, and disabled states

- Loading: `detectRepositoryState` returns a `loading` marker until the first signal set arrives; the shell shows `LoadingRow` and disables repository actions with the reason "loading repository".
- Empty: the empty-repository row above; the graph shows the Pending Changes row and the composer becomes editable after staging.
- Error: classified by `git.errors.ts` into permission, missing-git, auth/network, or hook-failure, then rendered through `ErrorOverlay` with the exact or redacted message. The state refreshes after the failure, and success is never claimed.
- Disabled: every gated action renders with the `dim` token plus its reason string and stays visible, so the user can read why it is unavailable.
- Text markers: `[?]` for missing or deleted upstreams, `U` for conflicted files, `!` for a blocking banner. `NO_COLOR` keeps all markers, per F-18 and F-20.

## 10. Performance and bounds

- `detectRepositoryState`, `gateRepository`, and `getAvailability` are pure and O(1) over the signal set; they run once per snapshot, not per render.
- The git-dir watcher is debounced and coalesced; it triggers one refresh per quiet period, not one per filesystem event.
- The huge-repository classification is computed from counts already gathered for the graph and status reads, so it adds no extra process spawn.
- Error detail rendering is bounded by the console and error buffer caps; the overlay shows a bounded head plus a pointer to the full console entry.
- Conflict detection reuses the status parse already performed for the panels, so it adds no extra git call.

## 11. Safety and confirmations

- Detecting a state never mutates the repository. There is no auto-stash, auto-reset, auto-checkout, auto-clean, or auto-prune.
- A missing upstream is classified as a deleted remote branch only after a successful Fetch --prune that confirms the ref is absent, or after a successful remote branch deletion initiated from the Delete Branch flow. A normal fetch with a missing ref stays `upstream not found`; a failed or timed-out remote check is `unknown`, never "deleted" or "unpushed". The configured upstream is read from branch configuration with `git for-each-ref --format=%(upstream:remotename)%09%(upstream:remoteref)`, and local existence is checked against `refs/remotes/<remote>/<branch>`. `%(upstream:short)` is display-only because a remote name may legally contain a slash. This is enforced in `repository.upstream.ts` and consumed here.
- Credential prompts are disabled, so auth and network failures surface as errors rather than hangs.
- Redaction through `git.redact.ts` applies before any error text reaches the overlay or console.
- The dirty-checkout state never discards changes; it reports git's error and keeps the working tree.
- The binary or oversized notice never removes file actions; it only replaces the diff body.

## 12. Acceptance mapping

| Product spec row or bullet | Implementing module or component |
| --- | --- |
| F-16 "Normal repository" (line 1063) | `repository.states.ts` `detectRepositoryState` normal branch. |
| F-16 "Subdirectory launch" (line 1064) | `git.repo.ts` root resolution plus `@/lib/paths.ts`. |
| F-16 "Not a git repository" (line 1065) | `repository.states.ts` not-a-repository gate plus the `NonRepoScreen` in `AppShell.tsx`. |
| F-16 "Bare repository" (line 1066) | `repository.states.ts` bare gate plus the `BareRepoScreen`. |
| F-16 "Empty repository" (line 1067) | `repository.states.ts` empty gate covering `branch.create`, `branch.delete`, `tag.create`, `tag.push`, `tag.delete`, `stash.create`, and push variants with "no commits yet", plus F-08 `08-commit-graph.md` and F-09 `09-commit-composer.md`. |
| F-16 "Detached HEAD" (line 1068) | `repository.states.ts` detached flag plus F-02 `02-top-bar.md` and F-09. |
| F-16 "No upstream" and "Upstream gone" (lines 1069-1070) | `repository.upstream.ts` plus F-02 `02-top-bar.md` and F-03 `03-branches-panel.md`. |
| F-16 "No remote" and "No origin remote but other remotes exist" (lines 1071-1072) | `git.remotes.ts`, `repository.states.ts` gates, and F-02 push error path. |
| F-16 "Merge or rebase in progress" (line 1073) | `git.repo.ts` marker detection for merge, rebase, and cherry-pick, the bulk stage/unstage gates in `commands.availability.ts`, and the `RepositoryStateBanner` in `AppShell.tsx`. |
| F-16 "Conflicted files" (line 1074) | `parsers/parse.status.ts` unmerged records, the synthetic conflict patch in `git.diff.ts`, the bulk and conflicted unstage gates in `commands.availability.ts`, and F-11 `11-diffs-and-file-actions.md`. |
| F-16 "Dirty working tree during checkout" (line 1075) | `git.branches.ts` error path and `git.errors.ts`. |
| F-16 "Operation in progress" (line 1076) | `commands.runner.ts` write latch, projected by `useCommandRunner.ts` through `StatusProvider`. |
| F-16 "External git changes" (line 1077) | `git.watcher.ts` plus F-17 `17-freshness-and-performance.md`. |
| F-16 "Huge repository" (line 1078) | `@/domain/graph/graph.paginate.ts` plus F-17. |
| F-16 "Binary or oversized file" (line 1079) | `@/domain/diff/diff.limits.ts` plus F-11. |
| F-16 "Permission or filesystem error" (line 1080) | `git.errors.ts` plus `ErrorOverlay`. |
| F-16 "Missing git binary" (line 1081) | `git.client.ts` spawn `ENOENT` plus `git.errors.ts`. |
| F-16 "Missing git identity" (line 1082) | `git.repo.ts` identity read plus F-09. |
| F-16 "Hook failure" (line 1083) | `git.commit.ts` plus `git.errors.ts` and `ErrorOverlay`. |
| F-16 "Authentication failure or network error" (line 1084) | `git.errors.ts` plus `git.redact.ts`. |
| F-16 "Invalid or unreadable configuration" (line 1085) | `@/domain/config/config.validate.ts` plus F-14 and F-13. |
| F-16 "Invalid theme file" (line 1086) | `@/domain/theme/theme.resolve.ts` plus F-20. |
| F-02 upstream deletion and failed-check rules (lines 268-272) | `repository.upstream.ts`: prune confirmation, successful remote branch deletion, and `unknown` on a failed check. |
| "Launching outside a repository shows a clear non-repository state and no destructive actions." (v1 acceptance, line 1817) | `repository.states.ts` not-a-repository gate. |
| "The app does not hang on git prompts; missing credentials and network failures are reported." (v1 acceptance, line 1854) | `git.errors.ts` classification plus credential prompt disabling. |
| "The app works with an empty repository, detached HEAD, no upstream, no remote, and conflicted files as described above." (v1 acceptance, line 1855) | the corresponding `repository.states.ts` members. |

## 13. Tests to add

- `src/domain/repository/repository.states.test.ts`: table-driven detection over recorded signal fixtures for every F-16 row, asserting the exclusive state and the active flag set, including separate merge, rebase, and cherry-pick flags.
- `src/domain/repository/repository.states.gating.test.ts`: `gateRepository` returns the exact reason for detached HEAD, no upstream, upstream gone, no remote, no-origin, missing identity, missing git, not-a-repository, bare, and operation in progress, and returns "no commits yet" for `branch.create`, `branch.delete`, `tag.create`, `tag.push`, `tag.delete`, `stash.create`, `remote.push`, and the three force-push variants in an empty repository.
- `src/domain/repository/repository.upstream.test.ts`: `upstream not found` versus `deleted after prune` versus `deleted after an app-initiated remote branch deletion`, and that a non-prune fetch never claims deletion and a failed or timed-out remote check stays `unknown`.
- `src/domain/commands/commands.availability.test.ts`: `getAvailability(commandId, context)` with the full target matrix, asserting that a selected branch, a selected diff file, and a selected stash each produce their own reason, that footer, palette, and button reasons come from the same source, and that `diff.stageAll`, `diff.unstageAll`, and conflicted `diff.unstage` are blocked during merge, rebase, or cherry-pick.
- `src/domain/git/parsers/parse.status.test.ts`: unmerged records produce `U` conflicted entries from `git status --porcelain=v2 --branch -z --untracked-files=all` output, including `-z` paths with spaces and newlines; merge, rebase, and cherry-pick markers are read from the recorded `git rev-parse --git-path` fixtures.
- `src/domain/git/git.diff.test.ts` (shared with F-11): the conflicted-file preview is built as a synthetic unified patch and never invokes `--cc`.
- `src/domain/git/git.errors.test.ts`: exit codes and stderr map to permission, missing-git, auth/network, and hook-failure, with redaction applied.
- `src/features/shell/AppShell.test.tsx`: renders `NonRepoScreen` and `BareRepoScreen` for the corresponding states and asserts that repository action hints are absent.

## 14. Open questions

- `repository.types.ts` is shared with the repository snapshot; confirm this document owns the `RepositoryState` union there or whether it moves into `repository.states.ts` and leaves only the snapshot type in `repository.types.ts`.
- The F-16 table lists "merge or rebase in progress" as one row; this document splits it into three flags (merge, rebase, cherry-pick) so the banner can name the operation and the conflict gates can match F-11. Confirm the split is acceptable.
- The F-11 conflict block is enforced through `getAvailability` with target validation, while the empty-repository and missing-upstream blocks live in `gateRepository`. Confirm that no repository-wide gate needs the target, so the split stays one-directional.
- The exact thresholds for "huge repository" and "oversized file" are unspecified; this document derives them from `@/domain/diff/diff.limits.ts` and a config value, and lists the concrete numbers as an F-17 decision.
- Whether "subdirectory" is a distinct `RepositoryState` member or just a field on the snapshot is unspecified; this document keeps it as a member so the banner and Help can explain root-relative paths.
- Whether the not-a-repository and bare screens should still allow `app.help` and `app.palette` is unspecified; this document keeps both available.
