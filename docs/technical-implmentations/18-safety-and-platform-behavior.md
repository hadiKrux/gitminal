# 18 - Safety and Platform Behavior

## 1. Header

- Status: Draft for review
- Spec reference: `docs/product-spec.md` F-18 (lines 1081-1106), decisions D4, D13, D14, D15; safety bullets in F-15 and F-16.
- Dependencies: `03-branches-panel.md`, `05-tags-panel.md`, `06-stashes-panel.md`, `07-worktrees-panel.md`, `11-diffs-and-file-actions.md`, `15-overlays-and-confirmations.md`, `16-repository-states.md`, `17-freshness-and-performance.md` (serialization), `19-configuration-and-keybindings.md` (non-configurability), `20-theme-and-colors.md` (NO_COLOR markers).
- Owned paths (cross-cutting):
  - `src/domain/git/git.client.ts`
  - `src/domain/git/git.errors.ts`
  - `src/domain/git/git.redact.ts`
  - `src/domain/commands/commands.runner.ts`
  - `src/domain/commands/commands.availability.ts`
  - `src/features/overlays/ConfirmModal.tsx`
  - `src/features/overlays/ErrorOverlay.tsx`
  - `src/features/overlays/NoticeOverlay.tsx`
  - `src/features/overlays/ModalFrame.tsx`
  - `src/ui/ModalActions.tsx`
  - `src/ui/TextMarker.tsx`

Consumed paths (not owned):
- `src/app/hooks/useCommandRunner.ts` (app-layer orchestrator, owned by F-17). F-18 defines the contract it must satisfy: it is the only caller of the runner and is responsible for refresh, console, status, and error routing.

F-18 is cross-cutting. The confirmations themselves are specified in each feature doc; this doc owns the invariants and the platform fallbacks.

## 2. Scope and non-goals

In scope: destructive confirmation invariants; force push variants; no automatic stash, reset, checkout, clean, or prune; no credential storage or prompts; argument-array execution; redaction; drafts surviving failures; one mutation at a time; reachable-commit safety; remote-delete scope; push with no upstream; missing-upstream after prune; non-configurable safety; `git.path` without a shell; platform support for macOS, Linux, and Windows; `Ctrl`/`Cmd` meaning; terminal-reserved fallbacks; ASCII markers with text equivalents; NO_COLOR and low-color fallbacks.

Non-goals: sandboxing git; enforcing repository policy; an allowlist of git subcommands; managing credentials or SSH keys.

## 3. OpenTUI components used

| Component | Where used | Why it is the right component |
| --- | --- | --- |
| `<box>` | Confirm modal frame, error overlay, notice overlay, dim overlay | Layout, focus ring, and the dim layer behind modals. |
| `<text>` | Confirmation scope text, error details, marker glyphs | The safety signal is text, not color. |
| `<span>` | Inline target names and force-push warnings | Inline emphasis inside confirmation text. |
| `<scrollbox>` | Error overlay body for long stderr | Scroll long failure output. |
| `<diff>` | Not used here | Diff colors are mapped from tokens in `20-theme-and-colors.md`. |
| `useKeyboard` | Not used directly | Centralized in `useHotkeys`; destructive actions use action IDs through `useAction`. |

Confirmations and overlays are composed from the `src/ui/ModalFrame.tsx`, `ModalActions.tsx`, `Button`, and `Overlay` primitives. `ModalActions` enforces Cancel-first focus for destructive actions.

All icons and markers used by this feature come from `src/theme/icons.ts`; see architecture section 6.1. No glyph literal is written in feature code.

## 4. Component tree

```text
OverlayProvider
  ConfirmModal            (ModalFrame + Overlay + ModalActions)
  ErrorOverlay            (ModalFrame + scrollbox stderr + redacted command)
  NoticeOverlay           (ModalFrame, non-blocking success)
AppShell
  TopBar                  (operation progress and transient status)
  Footer                  (keyboard hints and blocked-mutation reason)
```

Destructive flows call `ConfirmModal` with a named target and an action-specific confirm label. Failures open `ErrorOverlay`; the console keeps the full redacted record.

## 5. Enforced files and folders

- `src/domain/git/git.client.ts`
- `src/domain/git/git.errors.ts`
- `src/domain/git/git.redact.ts`
- `src/domain/commands/commands.runner.ts`
- `src/domain/commands/commands.availability.ts`
- `src/features/overlays/ConfirmModal.tsx`
- `src/features/overlays/ErrorOverlay.tsx`
- `src/features/overlays/NoticeOverlay.tsx`
- `src/features/overlays/ModalFrame.tsx`
- `src/ui/ModalActions.tsx`
- `src/ui/TextMarker.tsx`

## 6. State model

- `OverlayProvider` (provider state): the modal stack, the pending confirmation request (action ID, target label, scope options, primary index), and the current error record.
- `RepositoryProvider` (provider state): the current snapshot, which is only replaced on a successful read after a mutation. The mutation latch lives in `commands.runner.ts`; `StatusProvider` holds its UI projection.
- `commands.runner.ts` (domain state): the module-level write latch that enforces one mutation at a time. `StatusProvider` reflects it as the running-operation flag; the runner is the authority and the provider is the UI projection.
- `ConsoleProvider` (provider state): the redacted command log.
- `StatusProvider` (provider state): the blocked-mutation reason string from `commands.availability.ts`.
- Feature view state: drafts (commit message, modal field values) live in the feature that owns them and are never cleared by a failed command.
- `src/theme/useTokens.ts`: provides the `error`, `warning`, and `dim` tokens for destructive styling; markers come from `TextMarker`, not color.

## 7. Data flow

```text
action ID -> useAction -> ConfirmModal (named target) -> confirm
   -> useCommandRunner.runCommand(request)                         (app layer)
   -> commands.runner: availability check (commands.availability) + serialization
   -> git.client (argument array, git.path, cwd=root, no shell, prompts disabled)
   -> git.errors classification -> git.redact on all captured output
   -> CommandResult
   -> useCommandRunner applies effects:
        RepositoryProvider.refresh() on success and failure
        ConsoleProvider entry + StatusProvider status or ErrorOverlay
```

Redaction runs in `git.redact.ts` before any console or overlay rendering, covering credential-bearing URLs, authorization headers, and environment values. `useCommandRunner` applies it to the `CommandResult` before storing or rendering output. Availability reasons are machine-readable strings produced by `commands.availability.ts` and read by the palette, footer, and buttons.

## 8. Keyboard and focus

Action IDs only:

- `app.quit`: quit path, with confirmation when work is unsaved or an operation is running.
- `overlay.close`: `Esc` cancels a confirmation; the destructive option is never the default focus.
- `nav.activate`: confirms the focused modal button; `focus.next` and `focus.previous` move between `ModalActions`.
- Destructive context actions use their feature action IDs (`diff.discard`, `branch.delete`, `tag.delete`, `stash.pop`, `stash.delete`, `worktree.delete`), never raw keys.
- `Ctrl+C` is a hardcoded quit and cancel path owned by `useHotkeys`; it cannot be unbound (detail in `19-configuration-and-keybindings.md`).

Focus: while a confirmation is open, the overlay owns all keys except the quit escape hatch. Destructive confirmations default focus to Cancel, and `ModalActions` sets the initial focus index to Cancel for destructive actions.

## 9. Loading, empty, error, and disabled states

- Loading: a running mutation shows a phase status in the top bar status strip and disables conflicting actions.
- Empty: not applicable; confirmations always name a concrete target.
- Error: `git.errors.ts` classifies failures (missing git, permission, auth or network, hook failure, non-fast-forward). `ErrorOverlay` shows the decisive redacted line and the command; drafts and staged files remain.
- Disabled: a second mutation renders blocked with the reason "another operation is running" from `commands.availability.ts`. Remote deletion shows disabled with the reason when the remote is unreachable.

## 10. Performance and bounds

- Only one mutation runs at a time; the runner rejects a second request in constant time.
- Confirmation rendering is bounded; the error overlay caps displayed stderr with head and tail preservation and links to the console entry (detail in `13-console.md`).
- Redaction is linear in output size and runs once per captured stream.

## 11. Safety and confirmations

Invariants, each with the enforcing module and a required test:

| Invariant | Enforcing module | Test |
| --- | --- | --- |
| Every destructive action confirms and names its target | `ConfirmModal.tsx`, per-feature handlers | `ConfirmModal.test.tsx` asserts target text and Cancel-first focus |
| Both force push variants offered; safe primary; literal never default | `MoreMenu.tsx` and `ConfirmModal.tsx` | `MoreMenu.test.tsx` asserts order, labels, and default focus |
| No automatic stash, reset, checkout, clean, or prune | `commands.registry.ts`, `commands.availability.ts` (no such commands) | `commands.availability.test.ts` asserts absence |
| No credential storage or prompts | `git.client.ts` (prompt-disabling environment) | `git.client.test.ts` asserts environment flags and no TTY prompt |
| Argument-array execution | `git.client.ts` | `git.client.test.ts` asserts argv array and no shell |
| Redaction in console and overlays | `git.redact.ts` | `git.redact.test.ts` table of URL, header, and environment cases |
| Drafts and staged files survive failures | feature view state plus `useCommandRunner` (the runner returns a result and never mutates UI state) | `useComposer.test.ts` asserts draft preserved on failure; `useCommandRunner.test.tsx` asserts no draft or provider state is cleared |
| One mutation at a time | `commands.runner.ts` write latch; `useCommandRunner` surfaces the blocked result | `commands.runner.test.ts` asserts blocked second write with reason; `useCommandRunner.test.tsx` asserts no refresh, console append, or error overlay for a blocked result |
| Deletes never remove reachable commits | per-feature delete handlers (branch, tag, stash, worktree) | `branch.delete.test.ts` asserts only the named ref is deleted |
| Remote branch delete requires explicit scope | `DeleteBranchModal.tsx` scope options | `DeleteBranchModal.test.tsx` asserts local-only is the default |
| Push with no upstream never force pushes | push handler no-upstream branch | `remote.push.test.ts` asserts the create-upstream path and no force flag |
| Missing-upstream indicators only after prune confirmation | `repository.upstream.ts` | `repository.upstream.test.ts` asserts `[?]` gating on prune |
| Safety not configurable | `config.validate.ts` (no such fields) | `config.validate.test.ts` asserts unknown safety fields ignored |
| `git.path` executed without a shell | `git.client.ts` | `git.client.test.ts` asserts direct exec |

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
- Platform bullets -> the platform table in section 11.

## 13. Tests to add

Colocated per architecture section 5: `git.client.test.ts` (argv, no shell, prompt environment, `git.path`), `git.redact.test.ts`, `git.errors.test.ts` (classification), `commands.runner.test.ts` (serialization, blocked reason, pure execution), `src/app/hooks/useCommandRunner.test.tsx` (refresh on success and failure, one console entry, error routing, no refresh/console/error effects for a blocked result), `commands.availability.test.ts` (detached HEAD, no upstream, no remote, empty repository, operation in progress), `ConfirmModal.test.tsx` (named target, Cancel-first), `ModalActions.test.tsx`, `DeleteBranchModal.test.tsx` (scope default), `TextMarker.test.tsx` (glyph plus text), plus `keymap.parse.test.ts` and `theme.capability.test.ts` for the platform fallbacks.

## 14. Open questions

- Whether the literal `--force` confirmation needs a typed target name or a distinct extra step beyond a second confirm.
- Whether "another operation is running" should be a blocking modal or a transient status; the spec implies transient.
- The exact alternate bindings used when a terminal reserves `Ctrl/Cmd+P` or `?`.
