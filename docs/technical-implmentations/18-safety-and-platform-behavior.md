# 18 - Safety and Platform Behavior

## 1. Header

- Spec reference: `docs/product-spec.md` F-18 (lines 1126-1153), F-15 overlay and message rules (lines 1041-1066), F-16 repository-state gates (lines 1067-1095), F-21 startup splash and its `Ctrl+C` path (lines 1488-1538), decisions D4 (line 1872), D13 (line 1881), D14 (line 1882), D15 (line 1883), the keyboard map quit paths (lines 1543-1567), and the action IDs in section 6.1 (lines 1705-1742).
- Dependencies: `01-app-shell-and-focus.md` (quit handler, `Ctrl+C`, renderer teardown), `03-branches-panel.md`, `05-tags-panel.md`, `06-stashes-panel.md`, `07-worktrees-panel.md`, `11-diffs-and-file-actions.md`, `15-overlays-and-confirmations.md`, `16-repository-states.md`, `17-freshness-and-performance.md` (serialization and refresh), `19-configuration-and-keybindings.md` (non-configurability), `20-theme-and-colors.md` (NO_COLOR markers), `21-startup-splash.md` (startup `Ctrl+C`).
- Owned paths (cross-cutting):
  - `src/domain/git/git.client.ts`
  - `src/domain/git/git.errors.ts`
  - `src/domain/git/git.redact.ts`
  - `src/domain/console/console.sanitize.ts`
  - `src/domain/commands/commands.runner.ts`
  - `src/domain/commands/commands.availability.ts`
  - `src/features/overlays/ConfirmModal.tsx`
  - `src/features/overlays/ErrorOverlay.tsx`
  - `src/features/overlays/OverlayHost.tsx`
  - `src/ui/ModalActions.tsx`
  - `src/ui/TextMarker.tsx`
  - `src/test/git.fixture.ts`

Consumed paths (not owned):
- `src/index.tsx` (renderer creation with `exitOnCtrlC: false`, owned by F-01 bootstrap).
- `src/app/hooks/useCommandRunner.ts` (app-layer orchestrator, owned by F-17), `src/app/hooks/commandRunner.blocked.ts` (availability and blocked-result reporting), and `src/app/hooks/commandRunner.report.ts` (settled-outcome reporting, unexpected-failure reporting, and retry policy). F-18 defines the contract they must satisfy: `useCommandRunner` is the only caller of the runner and is responsible for refresh, console, status, and error routing.
- `src/app/AppShellHost.tsx` (the single `app.quit` handler, owned by F-01). F-18 defines the abort-before-teardown sequence it must perform.
- `src/ui/ModalFrame.tsx` (the presentational modal primitive, owned by the shared UI catalog in `00-project-architecture.md` section 7).

F-18 is cross-cutting. The confirmations themselves are specified in each feature doc; this doc owns the invariants and the platform fallbacks.

## 2. Scope and non-goals

In scope: destructive confirmation invariants; force push variants; no automatic stash, reset, checkout, clean, or prune; no credential storage or prompts; argument-array execution; the exact prompt, editor, and pager environment matrix; ignored stdin; per-invocation timeouts and `AbortSignal` cancellation with `SIGTERM` then `SIGKILL`; quit aborting the child before renderer teardown; `exitOnCtrlC: false` and the `Ctrl+C` to `app.quit` path; `--progress` on network operations and `--no-edit` on pull; redaction; drafts surviving failures; one mutation at a time; reachable-commit safety; remote-delete scope; push with no upstream; missing-upstream classification from prune or an app-initiated remote deletion; failed remote checks as `unknown`; non-configurable safety; `git.path` without a shell; platform support for macOS, Linux, and Windows; `Ctrl`/`Cmd` meaning; terminal-reserved fallbacks; ASCII markers with text equivalents; NO_COLOR and low-color fallbacks; and the integration test harness (`src/test/git.fixture.ts`, `*.integration.test.ts`, `bun test:integration`).

Non-goals: sandboxing git; enforcing repository policy; an allowlist of git subcommands; managing credentials or SSH keys; downloading or bundling a git binary.

## 3. OpenTUI components used

| Component | Where used | Why it is the right component |
| --- | --- | --- |
| `<box>` | Confirm modal frame, error overlay, dim overlay | Layout, focus ring, and the dim layer behind modals. |
| `<text>` | Confirmation scope text, error details, marker glyphs | The safety signal is text, not color. |
| `<span>` | Inline target names and force-push warnings | Inline emphasis inside confirmation text. |
| `<scrollbox>` | Error overlay body for long stderr | Scroll long failure output. |
| `<diff>` | Not used here | Diff colors are mapped from tokens in `20-theme-and-colors.md`. |
| `useKeyboard` | Not used directly | Centralized in `useHotkeys`; destructive actions use action IDs through `useAction`. |

Confirmations and errors are composed from the `src/ui/ModalFrame.tsx` presentational primitive, `ModalActions.tsx`, `Button`, and `Overlay`, and rendered through the single-entry-aware wrapper `src/features/overlays/OverlayHost.tsx`. The wrapper reads the current `OverlayProvider` entry; the primitive never reads provider state. `ModalActions` enforces Cancel-first focus for destructive actions. Success and informational messages never open a modal or overlay: they render only in the top bar status strip through `StatusProvider` and in the console.

All icons and markers used by this feature come from `src/theme/icons.ts`; see architecture section 6.1. No glyph literal is written in feature code.

## 4. Component tree

```text
OverlayProvider
  OverlayHost               (src/features/overlays/OverlayHost.tsx, single-entry-aware wrapper)
    ConfirmModal            (src/features/overlays/ConfirmModal.tsx -> src/ui/ModalFrame.tsx + Overlay + ModalActions)
    ErrorOverlay            (src/features/overlays/ErrorOverlay.tsx -> src/ui/ModalFrame.tsx + scrollbox stderr + redacted command)
AppShell
  TopBar
    TopBarStatus            (the only surface for success, warning, and informational messages, plus progress)
  Footer                    (keyboard hints and blocked-mutation reason)
```

Destructive flows call `ConfirmModal` with a named target and an action-specific confirm label. Failures open `ErrorOverlay`; the console keeps the full redacted record. Success and informational messages never open an overlay: they go to the top bar status strip through `StatusProvider` and to the console.

## 5. Enforced files and folders

- `src/domain/git/git.client.ts`
- `src/domain/git/git.errors.ts`
- `src/domain/git/git.redact.ts`
- `src/domain/commands/commands.runner.ts`
- `src/domain/commands/commands.availability.ts`
- `src/features/overlays/ConfirmModal.tsx`
- `src/features/overlays/ErrorOverlay.tsx`
- `src/features/overlays/OverlayHost.tsx`
- `src/ui/ModalActions.tsx`
- `src/ui/TextMarker.tsx`
- `src/test/git.fixture.ts`

## 6. State model

- `OverlayProvider` (provider state): the single open overlay entry (a feature modal or a confirmation with its exact label and destructiveness) and the focus captured when it opened. Opening another entry replaces the first instead of stacking. It never stores success or informational messages; those are `StatusProvider` state. The persistent error detail landed in M6.
- `RepositoryProvider` (provider state): the current snapshot, which is only replaced on a successful read after a mutation. The mutation latch lives in `commands.runner.ts`; `StatusProvider` holds its UI projection.
- `commands.runner.ts` (domain state): the module-level write latch that enforces one mutation at a time. `StatusProvider` reflects it as the running-operation flag; the runner is the authority and the provider is the UI projection.
- `git.client.ts` (per-invocation state): the child process handle, its timeout timer, and the `AbortSignal` subscription for one invocation. It holds no repository or UI state and exposes no persistent global.
- `ConsoleProvider` (provider state): the redacted command log.
- `DraftProvider` (provider state): the composer draft and `hasUnsavedDraft`, read by the composer and the quit handler. Modal field values remain feature view state.
- `StatusProvider` (provider state): the blocked-mutation reason string from `commands.availability.ts`, operation progress, and the only surface for success, warning, and informational messages. It owns their dismiss timers.
- Feature view state: modal form drafts, row expansion, focused control index, and filter text live in the feature that owns them and are never cleared by a failed command.
- `src/theme/useTokens.ts`: provides the `error`, `warning`, and `dim` tokens for destructive styling; markers come from `TextMarker`, not color.

## 7. Data flow

```text
action ID or command ID + explicit CommandTarget
   -> useAction handler for the focused scope, or the single global handler
   -> ConfirmModal for destructive intents (named target, Cancel-first focus)
   -> useCommandRunner.runCommand(request)                         (app layer)
   -> commands.runner: getAvailability (commands.availability) + serialization
   -> git.client: argv array, git.path, cwd=root, no shell, stdin ignored,
      prompt/editor/pager environment, timeout, AbortSignal
   -> git.errors classification -> CommandResult with raw captured output
      (cancelled or timedOut when applicable)
   -> useCommandRunner applies effects:
        git.redact on every step's stdout, stderr, and argv before storing or rendering
        console.sanitize removes ESC sequences, C0/DEL/C1, bidi embeddings/isolates, and U+00AD, U+061C, U+200B, U+200E, U+200F, U+2060, U+FEFF in the same pass, preserving ZWNJ and ZWJ
        RepositoryProvider.refresh() on success, failure, cancellation, and timeout
        ConsoleProvider entry + StatusProvider status or ErrorOverlay
```

Redaction runs in `git.redact.ts` before any console or overlay rendering, covering credential-bearing URLs, authorization headers, and environment values. `useCommandRunner` applies it to the `CommandResult` before storing or rendering output, and applies it to a caught exception message before that message becomes the error detail. `console.sanitize.ts` then removes ESC sequences, C0 and C1 controls, DEL, bidi embeddings and isolates (U+202A-U+202E, U+2066-U+2069), and the invisible marks U+00AD, U+061C, U+200B, U+200E, U+200F, U+2060, and U+FEFF before capping or storing, because captured git and hook output is rendered directly into terminal cells. ZWNJ (U+200C) and ZWJ (U+200D) are preserved because they are legitimate in Persian, Arabic, Indic, and emoji text. argv, cwd, and warnings are also flattened to one row, while stdout, stderr, and error messages keep newlines and tabs. Availability reasons are machine-readable strings produced by `getAvailability` in `commands.availability.ts` and read by the palette, footer, buttons, and confirmations. Every request carries an explicit `CommandTarget`; no handler reads another feature's cursor. Reads (`app.refresh`, watcher, and focus refresh) call `RepositoryProvider.refresh()` directly and never enter this flow.

### 7.1 Git execution contract

`git.client.ts` is the only production module that spawns a process. It executes `git.path` directly with an argument array, `cwd` at the repository root, no shell, and stdin ignored. File names therefore cannot be interpreted as shell syntax.

The child environment contains every row below, merged over the user's environment, except `GIT_SSH_COMMAND`, which is conditional:

| Variable | Value | Purpose |
| --- | --- | --- |
| `GIT_TERMINAL_PROMPT` | `0` | Git never prompts on the terminal for credentials. |
| `GCM_INTERACTIVE` | `never` | Git Credential Manager never opens an interactive prompt. |
| `GIT_ASKPASS` | `""` | No GUI askpass helper is launched. |
| `SSH_ASKPASS` | `""` | No SSH askpass helper is launched. |
| `SSH_ASKPASS_REQUIRE` | `never` | SSH never requires or uses askpass. |
| `GIT_EDITOR` | `true` | Any command that would open an editor exits successfully instead of waiting. |
| `GIT_SEQUENCE_EDITOR` | `true` | Interactive rebase sequence editing cannot block. |
| `GIT_PAGER` | `cat` | Git never launches a pager. |
| `PAGER` | `cat` | The pager fallback is inert. |
| `GIT_MERGE_AUTOEDIT` | `no` | A merge does not open an editor for its message. |
| `LC_ALL` | `C` | Git output is stable and parseable regardless of the user's locale. |
| `GIT_SSH_COMMAND` | `"ssh -o BatchMode=yes"` | Only set when the user has not configured `GIT_SSH_COMMAND` or `core.sshCommand`; a user-configured command always wins. |

The child is spawned with `stdio: ["ignore", "pipe", "pipe"]`. Stdin is therefore ignored for every invocation, and stdout and stderr are captured. A hook or credential helper that tries to read stdin sees EOF and fails visibly; the app never forwards terminal input into a child and never hands the terminal to git.

Every invocation in every class has both a timeout and an `AbortSignal`; neither is optional. Timeout defaults are fixed by operation class:

| Operation class | Default | Examples |
| --- | --- | --- |
| Local read | 10 seconds | `status`, `log`, `diff`, `for-each-ref`, `rev-parse`, config reads |
| Local write | 30 seconds | `add`, `restore`, `commit`, `branch`, `tag`, `stash`, `worktree`, `checkout` |
| Network | 120 seconds | `fetch`, `ls-remote` prune confirmation, `pull`, `push`, tag push, remote branch delete |

On abort the client sends `SIGTERM`, waits two seconds, then sends `SIGKILL`, waits for the child to exit, and returns a result with `cancelled: true`. A timeout uses the same path and returns `timedOut: true` with the message "timed out after N seconds". A cancelled or timed-out result is a warning, never a success, and the orchestrator still refreshes so partial local changes are visible.

Network operations pass `--progress`: `git fetch --progress`, `git pull --progress --no-edit`, `git push --progress`, plus tag push and remote branch delete. `--no-edit` prevents pull from opening an editor for a merge message. Stderr is streamed through `git.progress.ts` and forwarded to `StatusProvider`; commands without a meaningful percentage emit phase-only events.

Quit is part of this contract and never relies on the renderer default. The renderer is created with `exitOnCtrlC: false`, so `Ctrl+C` arrives as a key and dispatches `app.quit` instead of the renderer's default exit. The quit handler, not the renderer, decides whether confirmation is required. The target contract opens the confirmation when `DraftProvider.hasUnsavedDraft` is true, an operation is running, or a confirmation is already open. M4 implements the operation half: the handler aborts the in-flight command through the `AbortSignal` owned by `useCommandRunner`, waits for it to settle, and only then calls `renderer.destroy()`. Draft-based confirmation remains deferred beyond M6 and is recorded as a contract deviation in `00-project-architecture.md`. The client performs the `SIGTERM`-then-`SIGKILL` sequence, and the renderer is destroyed only after the child has exited or been killed, so the terminal is restored after git has stopped writing to it.

### 7.2 Integration test harness

Process-spawning tests are isolated from the unit suite:

- `src/test/git.fixture.ts` creates a temporary repository with `git init`, configures a local identity, seeds commits, and removes the directory in a `finally` block. It also builds the fixtures that exist today: prompting hooks (a `pre-commit` that reads stdin), merge and rebase conflicts, an index-lock helper, and empty and bare repositories. SSH and credential failure fixtures and rename-with-pathspec fixtures are not implemented yet.
- Integration tests are colocated `*.integration.test.ts` files and run with `bun test:integration`. They may spawn the system git only through the fixture, and the fixture runs commands through `git.client.ts` so the production execution contract is what gets tested.
- `src/test/git.fixture.ts` is the only test module allowed to spawn git directly for setup and teardown; the boundary check in architecture section 12 exempts it by path alongside `git.client.ts`. Production code never imports it.
- Unit tests never spawn a process. They use recorded stdout and stderr fixtures and call parsers, builders, and availability functions directly.
- `bun test` runs the unit suite and `bun test:integration` runs the spawning suite; CI runs both. Integration tests are skipped when `git --version` is below the supported minimum, Git >= 2.30.0 (also the fixture floor), and skip is reported as a skip, not a pass. The fixture isolates ambient configuration on every supported version: it sets `GIT_CONFIG_GLOBAL` and `GIT_CONFIG_SYSTEM` to the null device for git 2.32 and later, and additionally sets `GIT_CONFIG_NOSYSTEM=1` with per-fixture `HOME` and `XDG_CONFIG_HOME` directories for 2.30 and 2.31.

## 8. Keyboard and focus

Action IDs and command IDs are distinct (architecture section 8.1). An action ID is a key-bindable intent from product spec section 6.1; a command ID is a palette-invocable operation declared in `commands.registry.ts`. Most commands reuse their action ID. `nav.*` is key-only and is never a palette command; `focus.region.*` is palette- and help-invocable navigation. Every request carries an explicit `CommandTarget`. The palette dispatches `{ commandId, target }` captured when it opened, revalidates availability before invoking the handler, and for a stale, missing, or hidden target focuses or reveals the owning region and shows the reason. Exactly one handler may exist per `(actionId, scope)`; a duplicate registration is a development error and the later registration is rejected.

Bindings use action IDs only:

- `app.quit`: quit path, with confirmation when `DraftProvider.hasUnsavedDraft` is true, an operation is running, or a confirmation is open. The handler aborts and settles the running child before destroying the renderer; draft confirmation remains deferred.
- `overlay.close`: `Esc` cancels a confirmation; the destructive option is never the default focus.
- `nav.activate`: confirms the focused modal button; `focus.next` and `focus.previous` move between `ModalActions`.
- `form.submit`: `Ctrl/Cmd+Enter` submits a multiline form; single-line forms keep native `Enter`.
- Destructive context actions use their feature action IDs (`diff.discard`, `diff.discardAll`, `diff.deleteUntracked`, `diff.deleteAllUntracked`, `branch.delete`, `tag.delete`, `stash.pop`, `stash.delete`, `worktree.delete`, `remote.pushForceSafe`, `remote.pushForceOverwrite`), never raw keys.
- `Ctrl+C` is the hardcoded quit escape hatch and dispatches `app.quit`; it cannot be unbound (detail in `19-configuration-and-keybindings.md`). The renderer is created with `exitOnCtrlC: false`, so `Ctrl+C` is not the renderer's default exit and does not bypass the confirmation or abort sequence.

Focus: while a confirmation is open, the overlay owns all keys except the quit escape hatch. Destructive confirmations default focus to Cancel, and `ModalActions` sets the initial focus index to Cancel for destructive actions.

## 9. Loading, empty, error, and disabled states

- Loading: a running mutation shows a phase status in the top bar status strip and disables conflicting actions.
- Empty: not applicable; confirmations always name a concrete target.
- Error: `git.errors.ts` classifies failures (missing git, permission, auth or network, hook failure, non-fast-forward, cancelled, timed out). `ErrorOverlay` shows the decisive redacted line and the command; drafts and staged files remain. A cancelled or timed-out command is a warning, not an error overlay.
- Disabled: a second mutation renders blocked with the reason "another operation is running" from `getAvailability` in `commands.availability.ts`. A remote deletion whose remote check has not succeeded shows `unknown` and never claims the remote branch is deleted.
- Success: `StatusProvider` writes the top bar status strip and the console appends one entry; no overlay or modal opens and nothing takes focus.

## 10. Performance and bounds

- Only one mutation runs at a time; the runner rejects a second request in constant time.
- Every git invocation is bounded by its timeout, and cancellation escalates `SIGTERM` to `SIGKILL` after a fixed two-second grace, so no child can block quit or the UI indefinitely.
- Stdin is ignored and stdout and stderr are captured into bounded buffers, so a hook that writes without reading cannot grow an input pipe.
- Confirmation rendering is bounded; the error overlay caps displayed stderr with head and tail preservation and links to the console entry (detail in `13-console.md`).
- Redaction is linear in output size and runs once per captured stream.
- Progress parsing is incremental over stderr chunks; it never buffers the whole stream before publishing a phase.

## 11. Safety and confirmations

Invariants, each with the enforcing module and a required test:

| Invariant | Enforcing module | Test |
| --- | --- | --- |
| Every destructive action confirms and names its target | `ConfirmModal.tsx`, per-feature handlers | `useTopBarCommands.test.tsx` asserts the target/description, Cancel-first focus, and that a branch or upstream change while a force confirmation is open runs nothing; `OverlayHost.test.tsx` asserts the destructive Cancel-first default |
| Both force push variants offered; safe primary; literal never default | `MoreMenu.tsx` and `ConfirmModal.tsx` | `MoreMenu.test.tsx` asserts order and labels; `OverlayHost.test.tsx` asserts destructive Cancel-first focus and non-destructive primary focus |
| No automatic stash, reset, checkout, clean, or prune | `commands.registry.ts`, `commands.availability.ts` (no such commands) | `commands.availability.test.ts` asserts absence |
| No credential storage or prompts | `git.client.ts` (prompt-disabling environment) | `git.client.test.ts` asserts environment flags and no TTY prompt |
| Argument-array execution | `git.client.ts` | `git.client.test.ts` asserts argv array and no shell |
| Redaction in console and overlays | `git.redact.ts` plus `console.sanitize.ts` | `git.redact.test.ts` table of URL, header, and environment cases; `console.sanitize.test.ts` covers ESC, C0, DEL, C1, bidi embeddings/isolates, the invisible-mark set, ZWNJ/ZWJ preservation, single-line argv/cwd/warnings, and idempotence; `useCommandRunner.test.tsx` covers a credential-bearing thrown error and the settled error details |
| Drafts and staged files survive failures | feature view state plus `useCommandRunner` (the runner returns a result and never mutates UI state) | `useComposer.test.ts` asserts draft preserved on failure; `useCommandRunner.test.tsx` asserts no draft or provider state is cleared |
| One mutation at a time | `commands.runner.ts` write latch; `useCommandRunner` surfaces the blocked result | `commands.runner.test.ts` asserts blocked second write with reason; `useCommandRunner.test.tsx` asserts no refresh, console append, or error overlay for a blocked result |
| Deletes never remove reachable commits | per-feature delete handlers (branch, tag, stash, worktree) | `branch.delete.test.ts` asserts only the named ref is deleted |
| Remote branch delete requires explicit scope | `DeleteBranchModal.tsx` scope options | `DeleteBranchModal.test.tsx` asserts local-only is the default |
| Push with no upstream never force pushes | push handler no-upstream branch | `commands.remote.test.ts` asserts the create-upstream argv and no force flag; `commands.remote.integration.test.ts` proves an explicit refspec scope with `push.default=matching` |
| Missing-upstream indicators only after prune confirmation | `repository.upstream.ts` | `repository.upstream.test.ts` asserts `[?]` gating on prune |
| Safety not configurable | `config.validate.ts` (no such fields) | `config.validate.test.ts` asserts unknown safety fields ignored |
| `git.path` executed without a shell | `git.client.ts` | `git.client.test.ts` asserts direct exec |
| Every invocation has a timeout and an `AbortSignal`; abort sends `SIGTERM`, waits two seconds, then sends `SIGKILL` | `git.client.ts` | `git.client.test.ts` asserts class defaults, signal abort, and escalation |
| Quit aborts the running child before renderer teardown | `AppShellHost.tsx` quit handler plus the `useCommandRunner` signal | `AppShellHost.quit.test.tsx` asserts abort-then-destroy order |
| Network commands pass `--progress`; pull passes `--no-edit` | command builders called by `git.client.ts` | `git.client.test.ts` asserts argv for fetch, pull, push, tag push, and remote delete |
| Unit tests never spawn; process tests spawn only through the fixture | `src/test/git.fixture.ts`, boundary check in architecture section 12 | `bun test` has no spawn call; `bun test:integration` runs `*.integration.test.ts` through the fixture |
| Success and informational messages never open an overlay | `useCommandRunner`, `StatusProvider` | `useCommandRunner.test.tsx` asserts a status write and no overlay for success |
| Destructive intents are action IDs mapped to mutation commands with explicit targets; one handler per `(actionId, scope)` | `commands.registry.ts`, `useAction.ts` | `commands.registry.test.ts`, `useAction.test.tsx` |

Platform invariants:

| Concern | Enforcing module | Test |
| --- | --- | --- |
| macOS, Linux, Windows support | `src/lib/paths.ts`, `config.paths.ts` | `config.paths.test.ts` per-OS resolution |
| `Ctrl`/`Cmd` meaning (Control on Windows and Linux, Command on macOS, both accepted) | `keymap.parse.ts`, `keymap.defaults.ts` | `keymap.parse.test.ts` mod expansion per platform |
| Terminal-reserved fallbacks for palette and help | `keymap.defaults.ts` (alternate bindings) | `keymap.defaults.test.ts` asserts alternates present |
| ASCII-safe markers with text equivalents | `TextMarker.tsx` | `TextMarker.test.tsx` asserts glyph and text label |
| NO_COLOR and low-color fallback | `theme.capability.ts`, `useTokens.ts` | `theme.capability.test.ts` asserts the monochrome path keeps markers |

## 12. Acceptance mapping

- "Never discard, delete, drop, or force push without a confirmation that names the target." -> `ConfirmModal.tsx` and per-feature handlers.
- "Force push offers both variants; safe primary; literal never default; stronger confirmation." -> `MoreMenu.tsx`, `ConfirmModal.tsx`.
- "No automatic stash, reset, checkout, clean, or prune." -> `commands.registry.ts` has no such commands.
- "No credentials stored or requested; prompts disabled." -> `git.client.ts`.
- "Argument arrays, not a shell string." -> `git.client.ts`.
- "Sensitive values redacted." -> `git.redact.ts`.
- "Messages and staged files survive failures." -> feature drafts plus the orchestrator, which applies the result without clearing UI state.
- "One mutation at a time." -> `commands.runner.ts` write latch, with the blocked reason surfaced by `useCommandRunner`.
- "Deletes never delete reachable commits." -> per-feature delete handlers.
- "Remote branch deletion requires explicit scope." -> `DeleteBranchModal.tsx`.
- "Push with no upstream never force pushes." -> the push handler.
- "Missing upstream indicators only after prune." -> `repository.upstream.ts`.
- "Safety not configurable." -> `config.validate.ts`.
- "`git.path` executed directly without a shell." -> `git.client.ts`.
- "Every git invocation has a timeout and can be cancelled; `Ctrl+C` and quit abort the running child, terminate it, and restore the terminal." -> `git.client.ts` abort escalation plus the `AppShellHost.tsx` quit handler, which aborts before `useRenderer().destroy()`.
- "Success and informational messages are non-blocking and never open a modal or overlay." -> `useCommandRunner`, `StatusProvider`, and the top bar status strip.
- Platform bullets -> the platform table in section 11.

## 13. Tests to add

Colocated per architecture section 5: `git.client.test.ts` (argv, no shell, prompt environment, `git.path`, `stdio: ["ignore", "pipe", "pipe"]`, 10-second/30-second/120-second timeout selection, `AbortSignal` cancellation, `SIGTERM` then `SIGKILL` after two seconds, `--progress` on network commands, `--no-edit` on pull, truncation flags), `git.redact.test.ts`, `git.errors.test.ts` (classification), `commands.runner.test.ts` (serialization, blocked reason, pure execution), `src/app/hooks/useCommandRunner.test.tsx` (refresh on success and failure, one console entry, error routing, no refresh/console/error effects for a blocked result, no overlay for success, a second command blocked during the post-result refresh, timeout duration text), `src/app/hooks/commandRunner.report.test.ts` (thrown summary flattening, capped thrown details, and post-result replacement with the `Refresh after <label>` operation), `commands.availability.test.ts` (detached HEAD, no upstream, no remote, empty repository, operation in progress), `commands.registry.test.ts` (remote commands use the global handler scope; destructive intents map to mutation commands with action IDs and explicit targets; `nav.*` is not a palette command and `focus.region.*` is), `useAction.test.tsx` (duplicate `(actionId, scope)` registration rejected; one global owner for `app.quit` and `remote.*`), `OverlayHost.test.tsx` (named target, Cancel-first, keyed confirmation focus), `ModalActions.test.tsx`, `DeleteBranchModal.test.tsx` (scope default), `TextMarker.test.tsx` (glyph plus text), plus `keymap.parse.test.ts` and `theme.capability.test.ts` for the platform fallbacks.

Integration tests are `*.integration.test.ts` files run with `bun test:integration`. They spawn the system git only through `src/test/git.fixture.ts`, which creates and removes the temporary repository, and they exercise the production `git.client.ts` contract, including the two-second abort escalation. `bun test` is the unit suite and never spawns a process.

## 14. Open questions

- Whether the literal `--force` confirmation needs a typed target name or a distinct extra step beyond a second confirm.
- Whether "another operation is running" should be a blocking modal or a transient status; the spec implies transient.
- The exact alternate bindings used when a terminal reserves `Ctrl/Cmd+P` or `?`.
