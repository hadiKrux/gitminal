# 15 Overlays and Confirmations

## 1. Header

Spec reference: `docs/product-spec.md` F-15 Overlays and confirmations (lines 1041-1066); keyboard map (lines 1539-1704); action IDs section 6.1 (lines 1705-1742); key precedence section 3 (lines 109-119)
Dependencies: F-01 app shell and focus, F-19 configuration and keybindings, F-13 console (error linking), F-18 safety and platform behavior (redaction)
Owned paths:
- `src/features/overlays/ConfirmModal.tsx`
- `src/features/overlays/ConfirmModal.constants.ts`
- `src/features/overlays/ErrorOverlay.tsx`
- `src/features/overlays/OverlayHost.tsx`
- `src/features/overlays/OverlayFocus.tsx` (per-surface initial focus)
- `src/features/overlays/OverlayEntrySurface.tsx`
- `src/features/overlays/OverlayEntrySurface.types.ts`
- `src/features/overlays/useOverlayHostActions.ts`
- `src/features/overlays/useOverlayHostActions.types.ts`
- `src/app/providers/OverlayProvider.tsx` (the single-entry overlay provider)
- `src/app/providers/OverlayProvider.state.ts` (pure surface transitions)
- `src/app/providers/OverlayProvider.types.ts`
- `src/app/hooks/useOverlaySurfaceState.ts` (focus capture, blur, restore, and surface operations)
- `src/domain/commands/confirm.labels.ts` (the shared F-15 label table)

Consumed paths (not owned):
- `src/app/hooks/useOverlay.ts`
- `src/app/hooks/useAction.ts`
- `src/app/hooks/useHotkeys.ts`
- `src/app/providers/StatusProvider.tsx`
- `src/app/providers/ConsoleProvider.tsx`
- `src/domain/commands/commands.runner.ts`
- `src/app/hooks/useCommandRunner.ts`
- `src/domain/commands/commands.availability.ts`
- `src/domain/git/git.redact.ts`
- `src/ui/Overlay.tsx`, `src/ui/ModalFrame.tsx`, `src/ui/ModalActions.tsx`, `src/ui/Button.tsx`, `src/ui/ButtonRow.tsx`, `src/ui/FormField.tsx`, `src/ui/KeyHint.tsx`

## 2. Scope and non-goals

In scope:
- The standard modal structure: title, short description, optional fields or list, footer actions with their keys, a focus trap while open, and `Esc` cancel.
- Destructive confirmations defaulting focus to Cancel.
- The exact confirm button labels: "Discard changes", "Delete untracked file", "Delete local branch", "Delete local and remote branch", "Drop stash", "Delete tag", "Delete worktree", "Force push safely", "Overwrite remote", plus the count-naming bulk untracked delete label `Delete <N> untracked files`.
- No generic "OK" or "Yes" confirms a destructive action. A destructive entry whose label is outside the exact table keeps the visible warning and disables its primary action, so the generic action cannot run.
- Inline validation that keeps the modal open on error.
- `Enter` submitting single-line forms through the input's native `onSubmit`/`onEnter` callback and `form.submit` (`Ctrl/Cmd+Enter`) submitting multiline forms.
- Background regions visibly inactive and unable to receive actions while a modal is open. Outside a modal text field the only exceptions are `overlay.close`, `app.quit`, and the same overlay's toggle; inside a modal text field `overlay.close` on `Esc`, the hardcoded `Ctrl+C` quit path, and modifier-gated text-input-safe actions may also fire.
- The footer showing the modal's keys.
- Only one modal open at a time.
- A failure closing the originating modal and opening a persistent error overlay with a retry closure when retry is meaningful.
- Success and informational messages that are non-blocking and appear only in the top bar status strip and the console.
- No stacking of error overlays.

Non-goals:
- No feature-specific form logic; fields and submit handlers come from the calling feature.
- Configuration cannot disable destructive confirmations, force-push warnings, or credential protection.
- No toast library and no third-party notification system.
- No multi-modal workflows; a modal never opens another modal on top of itself.
- No notice or toast overlay. Success and informational messages never open a modal or overlay.

## 3. OpenTUI components used

| Component | Where used | Why it is the right component |
| --- | --- | --- |
| `<box>` | Modal frame, the dim overlay layer, footer action row, field rows, error detail container | Layout, borders, and the overlay structure; section 6 assigns modals and overlays to boxes. |
| `<text>` | Title, description, field labels, inline validation text, error details | Every string in a modal or overlay. |
| `<span>` | Key hints inside footer actions, warning markers, dim scope text | Inline styled runs inside `<text>`. |
| `<input>` | Single-line modal fields such as branch name, tag name, worktree path, and typed confirmations | Section 6 assigns `<input>` to single-line modal fields. |
| `<textarea>` | Multiline fields such as a stash message or a multiline note | Section 6 assigns `<textarea>` to multiline form fields. |
| `<select>` | Option lists inside a modal, such as commit options or an option field | Section 6 assigns `<select>` to modal option lists. |
| `<scrollbox>` | Long error details and git output in the error overlay | Scrolling for potentially large output. |
| `<code>` | Hook output or command output in the error overlay when a filetype is known | Read-only syntax-highlighted content. |
| `<markdown>` | Not used | - |

Hooks:
- `useKeyboard`: never called directly; `src/app/hooks/useHotkeys.ts` owns dispatch, and overlays register handlers by action ID through `useAction`.
- `useRenderer()`: only through `OverlayProvider` for overlay registration and focus restoration.
- `useFocus` / `useBlur`: no special handling required; these are terminal-window events only, and the modal focus trap is native-renderable based.
- `useTimeline()`: spinner animation for a submitting action.

All icons and markers used by this feature come from `src/theme/icons.ts`; see architecture section 6.1. No glyph literal is written in feature code.

## 4. Component tree

```text
App (src/app/App.tsx)
  OverlayProvider (src/app/providers/OverlayProvider.tsx)     // the single open entry and captured focus
    (the open entry, rendered once)
    OverlayHost (src/features/overlays/OverlayHost.tsx)       // entry-aware host
      OverlayFocus (src/features/overlays/OverlayFocus.tsx)   // initial focus, keyed by visible surface
      Overlay (src/ui/Overlay.tsx)                             // dim layer over the shell except the footer row, background deactivation
      OverlayEntrySurface (src/features/overlays/OverlayEntrySurface.tsx) // confirm or feature modal
        ConfirmModal (src/features/overlays/ConfirmModal.tsx)  // destructive and non-destructive confirmations
          ui/ModalFrame (src/ui/ModalFrame.tsx)                 // presentational structure and focus trap
          box                                                  // title + description
            text
          box                                                  // optional fields or list
            FormField (src/ui/FormField.tsx)                   // input/textarea/select with inline error
          ModalActions (src/ui/ModalActions.tsx)               // footer actions with keys
            ButtonRow (src/ui/ButtonRow.tsx)
              Button (src/ui/Button.tsx)
        (feature modal content)                                // supplied by the opening feature
          ui/ModalFrame
    ErrorOverlay (src/features/overlays/ErrorOverlay.tsx)      // persistent, replaces the previous error, never stacks
      box
        text / code / scrollbox                                // redacted error details
        ModalActions                                           // Dismiss, Open console entry, Retry when meaningful
```

Note on the frame modules: `src/ui/ModalFrame.tsx` is the reusable presentational primitive from architecture section 7 (box overlay plus Panel plus title plus `ModalActions`, with the focus trap). `src/features/overlays/OverlayEntrySurface.tsx` renders a confirm entry through `ConfirmModal` or a feature-supplied modal through its renderer, and `src/features/overlays/OverlayHost.tsx` is the overlay-entry-aware wrapper that reads the current `OverlayProvider` entry and the persistent error detail. The wrapper is named `OverlayHost` so it cannot be confused with the presentational `ModalFrame`. There is no `NoticeOverlay`: success and informational messages are not overlays and render only in the top bar status strip and the console.

## 5. Enforced files and folders

- `src/features/overlays/ConfirmModal.tsx` - destructive and non-destructive confirmation content, exact labels, scope text, Cancel-first focus, and the visible warning plus disabled primary action for an unrecognized destructive label.
- `src/features/overlays/ConfirmModal.constants.ts` - renderable ids, frame width, and the Cancel label.
- `src/domain/commands/confirm.labels.ts` - the exact F-15 label table and its single validator, shared by `ConfirmModal`, the overlay provider, and the top bar.
- `src/features/overlays/ErrorOverlay.tsx` - the persistent error overlay with redacted, sanitized details, Dismiss, Open console entry, and optional Retry.
- `src/features/overlays/ErrorOverlay.constants.ts`, `ErrorOverlay.types.ts` - stable ids, labels, dimensions, and props for the error surface.
- `src/features/overlays/OverlayHost.tsx` - the overlay-entry-aware host that renders the open entry through `src/ui/ModalFrame.tsx` and the persistent error detail through `ErrorOverlay`.
- `src/features/overlays/OverlayFocus.tsx` - keyed initial-focus effect that runs only when the visible surface identity changes, so a queued error cannot steal focus inside an open modal.
- `src/features/overlays/OverlayEntrySurface.tsx` - renders a confirm entry through `ConfirmModal` and a modal entry through its owning feature's renderer.
- `src/features/overlays/useOverlayHostActions.ts` - the console-entry and retry actions that need the overlay, console, and focus providers.
- `src/app/providers/OverlayProvider.tsx` - the provider shell that publishes the surface context.
- `src/app/providers/OverlayProvider.state.ts` - pure reducer for entry, error, captured focus, and released focus.
- `src/app/hooks/useOverlaySurfaceState.ts` - captures and blurs the background focus, dispatches surface transitions, and restores focus once on close.
- Colocated tests: `OverlayHost.test.tsx`, `ConfirmModal.test.tsx`, `ErrorOverlay.test.tsx`, plus `src/app/providers/OverlayProvider.test.tsx`.

## 6. State model

Provider state (owned by `OverlayProvider.state.ts` and published by `OverlayProvider.tsx`, the single source of truth):
- `entry: OverlayEntry | null` - the single open overlay entry. Opening a second entry replaces the first, so only one modal is open at a time and there is nothing to stack. The provider implements two entry kinds: a `modal` entry whose owning feature supplies the content renderer and optional toggle and initial-focus ids, and a `confirm` entry for destructive and non-destructive confirmations with an exact confirm label. A confirm entry also carries `labelWarning` when its destructive label is outside the F-15 table, so the defect is visible and `ConfirmModal` disables the primary action instead of throwing during render.
- `destructive: boolean` and `confirmLabel: string` - drive default focus and the confirm button label.
- `errorDetail: ErrorDetail | null` - the current error shown by `ErrorOverlay`; a new failure replaces it rather than stacking.
- `capturedFocusId` and `releasedFocusId` - the renderable to restore when the last surface closes. Opening a surface blurs the current renderable and captures its id; replacing a surface keeps the original capture. `closeEntry(entryId)` closes only the entry that the caller opened, so an unrelated confirmation or a visible error stays untouched.

Local view state (owned by the feature that opens the modal, passed in through the overlay entry):
- Form draft values and per-field validation errors.
- The focused field or footer action within the modal.

Provider state read by overlays:
- `StatusProvider`: transient success and informational messages. They render only in the top bar status strip and the console; no overlay reads or renders them.
- `ConsoleProvider`: the entry id that `ErrorOverlay`'s "Open console entry" action selects.
- `RepositoryProvider`: not read directly; availability comes through `commands.availability.ts`.

Rule: while an overlay is open it owns all keys, except `overlay.close`, `app.quit`, the same overlay's toggle, and modifier-gated text-input-safe actions while a modal field is focused. No background feature keeps a parallel "modal is open" flag; the single entry in `OverlayProvider` is the only authority.

## 7. Data flow

```text
action ID -> useAction -> OverlayProvider.open({ kind, title, description, fields, actions, destructive })
  -> features/overlays/OverlayHost.tsx renders src/ui/ModalFrame.tsx + src/ui/ModalActions.tsx
  -> submit -> form.submit for a multiline form, or the single-line input's native Enter
       -> useCommandRunner.runCommand(request)
       -> commands.runner.ts executes and returns a CommandResult
       success -> useCommandRunner: closeEntry(originatingEntryId); StatusProvider.success(); console append; RepositoryProvider.refresh()
       failure -> useCommandRunner: closeEntry(originatingEntryId); console append; RepositoryProvider.refresh()
                  OverlayProvider.showError({ message, details, consoleEntryId, retry })
                  -> ErrorOverlay (persistent until dismissed; replaces any prior error)
                     -> git.redact.ts and console.sanitize.ts applied to details before store and render
       success and informational messages -> top bar status strip plus console only, never an overlay
```

Named modules:
- `src/app/providers/OverlayProvider.state.ts` - the single entry, the error detail, the captured focus, and the released focus.
- `src/app/hooks/useOverlaySurfaceState.ts` - open, close, closeEntry, confirm, showError, dismissError, background blur, and focus restore.
- `src/app/hooks/useOverlay.ts` - the hook features use to open and close overlays.
- `src/domain/commands/confirm.labels.ts` - the exact F-15 labels and the visible label warning used at entry creation.
- `src/domain/commands/commands.runner.ts` - the pure executor: availability, serialization, execution, and a `CommandResult`. It never closes an overlay, sets a status, or refreshes the repository.
- `src/app/hooks/useCommandRunner.ts` - the app-layer orchestrator that applies the result: closes only the originating entry on success, refreshes the repository, appends the console entry, sets status, and routes failures to `showError` with a retry closure over the original request.
- `src/domain/commands/commands.availability.ts` - disables a confirm action when its preconditions are unmet, with the same reason string the palette, footer, and help use.
- `src/domain/git/git.redact.ts` and `src/domain/console/console.sanitize.ts` - remove credentials and ESC sequences, C0/DEL/C1 controls, bidi embeddings and isolates, and the documented invisible marks from error details before storage, while preserving ZWNJ and ZWJ; argv, cwd, and warnings are flattened to one row. The stored detail block, including a thrown-error detail, is capped with the shared console head-and-tail rule.
- `src/app/providers/StatusProvider.tsx` - transient success and informational messages, projected to the top bar status strip and the console. It owns the message timer and never opens an overlay.

## 8. Keyboard and focus

Action IDs only; never raw key strings:
- `overlay.close` (default `Esc`) - cancels the top overlay.
- `app.quit` (default `q`, plus the hardcoded `Ctrl+C`) - the quit escape hatch. It resolves while an overlay is open and always aborts the in-flight command, waits for it to settle, and quits. Draft-based quit confirmation is deferred beyond M6, so it does not yet ask about `DraftProvider.hasUnsavedDraft`.
- The same overlay's own toggle - `app.palette` when the palette is open, `app.help` when help is open. No other overlay has a toggle unless it declares one; the theme picker and confirmations do not.
- `nav.activate` (default `Enter`) - activates the focused footer action or button. For a single-line field, `Enter` stays with the input and its native `onSubmit`/`onEnter` callback dispatches the form's submit action; `nav.activate` does not intercept it.
- `form.submit` (default `Ctrl/Cmd+Enter`) - the submit action for every multiline form. It fires from a focused `<textarea>` and is the documented multiline submit path; it never applies to a single-line field, which keeps native `Enter`.
- `nav.up`, `nav.down` - move within an option list or field list when the modal declares one. No M6 confirm or error surface registers them.
- `nav.left`, `nav.right` - move within the footer `ButtonRow` (defaults also bind `h`/`l`).
- `focus.next`, `focus.previous` (`Tab`/`Shift+Tab`) - deferred with the modal forms that need them. The keymap binds them globally, but overlay precedence blocks them while a modal is open, and every M6 surface has a single focusable control. When forms land, Tab and Shift+Tab will cycle fields and footer actions; a multiline textarea keeps Tab for indentation and Shift+Tab for outdent. The focus trap already keeps the current control from moving to the background in all cases. The footer's modal hint set does not advertise `focus.next`, because overlay precedence blocks it while a modal is open; for the M6 confirm and error surfaces it advertises `nav.left`, `nav.right`, `nav.activate`, and `overlay.close`.

How `OverlayProvider` plus `useHotkeys` gives overlays full key ownership:
- `useHotkeys` reads the current `OverlayProvider` entry on every key event. If an entry is open, it resolves overlay-scope actions plus only the documented global exceptions and returns. Other background region and global handlers are never reached, so a background action cannot fire while a modal is open. Keys the overlay context does not handle are delegated to the focused modal text input or native list widget.
- `OverlayHost` sets the footer hint mode to `modal` while an entry exists and back to `context` after it closes. `OverlayFocus` moves native focus to the entry's initial renderable, the frame the entry renders, or the error frame, and retries once on the next tick because a select or field can mount after the effect. It is keyed by the visible surface identity (entry id or error key), so a queued error that arrives while a modal is open does not re-run focus. A confirm entry's `ConfirmModal` owns the focused footer action and registers `nav.left`, `nav.right`, and `nav.activate` in the overlay scope; a modal entry's content registers its own overlay actions, so switching entries cannot create a duplicate `(actionId, scope)` registration.
- Outside a modal text field, exactly three global actions resolve while an overlay is open: `overlay.close`, `app.quit`, and the same overlay's toggle. Inside a modal text field, the hardcoded `Ctrl+C` quit path, `overlay.close` on `Esc`, and modifier-gated text-input-safe actions (`app.palette`, `app.console`, `commit.submit`, `commit.options`, and `form.submit`) may also fire when their effective binding uses `Ctrl`, `Cmd`, or `Alt`; an unmodified global action never does. The overlay's own scoped actions (`nav.*`, `form.submit`, and its feature commands) continue to resolve inside the modal. `app.console` does not resolve while an overlay owns keys unless a modal field is focused and its binding is modified, because the console drawer is not the open overlay; the same applies to `remote.*`, `app.themePicker`, `app.refresh`, and `app.reloadConfig`.
- The background is deactivated visually and functionally by rendering `src/ui/Overlay.tsx`, a full-width layer that paints the app background and leaves the footer row visible, beneath the modal. On open, `OverlayProvider` captures the currently focused renderable, blurs it, and then native focus moves to the modal's first focusable field or action after mount. Because the background renderable is blurred, it cannot keep receiving typing even when an entry exposes no focus target; region borders lose the focus ring and no background renderable receives keys. On close, `OverlayProvider` restores the captured renderable if it is still mounted, otherwise it focuses its region frame.

Focus behavior:
- Destructive confirmations default focus to Cancel.
- Non-destructive confirmations default focus to the primary action.
- On close, focus returns to the exact renderable that was focused before the overlay opened, if it is still mounted; otherwise it focuses that renderable's region frame and restores the region cursor.
- The footer shows the modal's keys while the modal is open.

## 9. Loading, empty, error, and disabled states

- Inline validation error: a text row under the field with the marker `[!]`, the modal stays open, and the submit action is disabled with the reason.
- Submitting: the footer action shows a spinner through `useTimeline()`, and the background stays inactive.
- Disabled confirm: an M6 caller closes the modal instead of opening it with an unavailable primary action, so availability-driven disabling is deferred with the forms. When the form work lands, availability failure will dim the primary action with the reason from `commands.availability.ts` and prevent activation. The one disabled case that exists now is a destructive confirmation whose label is outside the exact F-15 table: `ConfirmModal` keeps the visible warning and disables the primary action with `CONFIRM_LABEL_DISABLED_REASON`.
- Error overlay: persistent, shows redacted and sanitized details, and offers Dismiss plus "Open console entry"; a Retry action appears only when retry is meaningful and the original request is still safe to repeat.
- Success and informational messages: non-blocking, rendered only in the top bar status strip and the console, and auto-dismissed by `StatusProvider`. They never render as a modal, overlay, toast, or focus owner.
- Empty list in a modal: a text row with the marker `[ ]` and a short reason, for example when an option list has no entries.
- Multiline form: the footer shows the `form.submit` hint (`Ctrl/Cmd+Enter`); an empty required field keeps the modal open with an inline reason, and successful submit closes the modal.

## 10. Performance and bounds

- Only one overlay is rendered at a time; the provider holds one entry and never renders more than one modal, so there is no stacking cost.
- Error details are capped with the first and last portion preserved and an omitted-lines marker, mirroring the console cap.
- The error detail container is a `<scrollbox>`, so large git output does not force a full render.
- Redaction runs once before an error detail is stored, not on each render.
- Status messages use a single timer in `StatusProvider`; because they are not overlays, they allocate no overlay entry and no focus state.

## 11. Safety and confirmations

- Destructive confirmations default focus to Cancel and state the exact scope and consequence.
- Exact confirm labels: "Discard changes", "Delete untracked file", "Delete local branch", "Delete local and remote branch", "Drop stash", "Delete tag", "Delete worktree", "Force push safely", "Overwrite remote". The bulk untracked delete label names its count: `Delete <N> untracked files` (`Delete <N> untracked file` for one).
- Generic "OK" and "Yes" labels never confirm a destructive action. A destructive entry that receives any other label renders the supplied label with the warning and disables its primary action with a reason, so `nav.activate` and a click do nothing.
- Configuration cannot disable destructive confirmations, force-push warnings, credential prompt protection, or hook execution defaults.
- On failure, the user's input is preserved when retry is meaningful: the retry closure captures the original request, so drafts or staged files are never cleared and no duplicate input state is stored.
- The app never stacks error overlays: a new failure replaces the visible error details but remains in the console.
- Success and informational messages never mask the UI, never take focus, and never require dismissal; they live in the top bar status strip and the console only.

## 12. Acceptance mapping

- "All modals use the same structure: title, short description, optional fields or list, footer with actions and their keys, focus trap, `Esc` cancels" -> `src/ui/ModalFrame.tsx` plus `src/ui/ModalActions.tsx`, wrapped by `src/features/overlays/OverlayHost.tsx`.
- "Destructive confirmations default focus to Cancel" -> `ConfirmModal.tsx` plus the `destructive` flag in `OverlayProvider.tsx`.
- "Confirm buttons use specific labels" -> the shared table in `domain/commands/confirm.labels.ts`; the nine fixed labels above plus the count-naming bulk untracked delete label from `formatDeleteAllUntrackedLabel`.
- "Simple OK and Yes labels are not used for destructive actions" -> the exact-label validation at entry creation in `OverlayProvider` plus `ConfirmModal`, which renders a visible warning and disables the primary action so the generic action cannot run.
- "Destructive confirmations state the exact scope and consequence" -> the description built by the calling feature and rendered by `ConfirmModal.tsx`.
- "Text input modals validate inline and keep the modal open on error" -> `src/ui/FormField.tsx` plus validation state owned by the calling feature.
- "`Enter` submits single-line forms through the input's native submit callback; multiline fields use `form.submit` (`Ctrl/Cmd+Enter`)" -> `onSubmit`/`onEnter` wiring in `OverlayHost.tsx` plus `src/ui/FormField.tsx`, and the `form.submit` action from the keymap for a focused textarea.
- "While a modal is open, background regions are visibly inactive and cannot receive actions" -> `src/ui/Overlay.tsx` plus the `useHotkeys` overlay branch. Only `overlay.close`, `app.quit`, the same overlay's toggle, and modifier-gated text-input-safe actions inside a focused modal field resolve.
- "The footer shows the modal's keys" -> `OverlayProvider` sets the footer hint mode and `HintBar` renders the modal keys, including `form.submit` for multiline forms.
- "Only one modal is open at a time; a successful action closes the modal and shows status" -> single-entry modal handling in `OverlayProvider.tsx` plus `StatusProvider`.
- "If an operation started from a modal fails, the modal closes and a persistent error overlay opens with the details; input is preserved when retry is meaningful" -> `OverlayProvider.closeEntry(originatingEntryId)` plus `showError`; Retry re-runs the closure's original request, and a retry rejection is consumed after the error detail is stored so the overlay stays visible. The overlay links to the appended entry on every failure path, including an unexpected throw or a post-result rejection. A post-result refresh failure updates the already-appended entry to a matching failure and reports the distinct operation `Refresh after <command>`, so the overlay title, entry status, and entry summary agree. The thrown detail is capped with the same rule as a settled failure.
- "Success and informational messages are non-blocking, appear only in the top bar status strip and the console, and auto-dismiss; failures stay until dismissed" -> `StatusProvider` projection to the top bar and console versus `ErrorOverlay.tsx`; no notice overlay exists.
- "The app does not stack error overlays; a new failure replaces the visible error details but remains in the console" -> `errorDetail` replacement in `OverlayProvider.tsx`.

## 13. Tests to add

Colocated per architecture section 5:
- `src/app/providers/OverlayProvider.test.tsx`: only one modal at a time; a second error replaces the first instead of stacking; close on success closes only the originating entry; an unrelated entry stays open; opening captures and blurs the focused renderable, and closing restores that renderable if it is still mounted, otherwise its region frame; a stale `showError` captured before a modal opened cannot blur the modal's focused field; an invalid destructive label produces a visible warning and a disabled primary action instead of a crash; success and informational results add no overlay entry.
- `OverlayHost.test.tsx`: `overlay.close` cancels; the focus trap keeps `focus.next` inside the modal even when another field is focusable; destructive default focus is Cancel; an exact destructive label leaves the primary enabled and Enter runs `onConfirm`; a non-exact destructive label cannot be confirmed with Enter; a queued error does not pull focus back to the modal's initial field; Open console entry moves focus into the console region; the footer shows the modal keys; `form.submit` fires from a multiline field; `Enter` still activates a focused footer button. `src/app/hooks/useCommandRunner.test.tsx` covers an unrelated confirmation staying open while a command settles, and `src/app/AppShellHost.test.tsx` covers a confirmation that keeps native focus when an in-flight failure arrives.
- Keyboard ownership test: while an overlay is open outside a modal text field, `app.quit` and that overlay's own toggle resolve, and every other global action, including `app.console`, `app.palette` in a non-palette modal, `remote.pull`, `app.themePicker`, and `app.reloadConfig`, does not resolve.
- `ConfirmModal.test.tsx`: each of the exact labels renders for its action; the explicit label-to-destructiveness table drives label rendering and the Cancel-first check for every label; no "OK" or "Yes" appears for destructive actions; scope text is present; a non-exact destructive label renders the warning and the disabled reason. `src/domain/commands/confirm.labels.test.ts` pins the literal label set and the count-naming bulk label.
- `ErrorOverlay.test.tsx`: persistence until dismissed; details are redacted; "Open console entry" selects the entry; a new error replaces the visible details.
- Status message tests: success and informational results render in the top bar status strip and append to the console; they never mount an overlay, take focus, or block keys.
- Form submit tests: `Enter` reaches a single-line input and its `onSubmit`/`onEnter` callback runs the form submit action; `nav.activate` still activates footer buttons; `form.submit` fires on the mapped `Ctrl/Cmd+Enter` binding for a textarea; inline validation keeps the modal open.

## 14. Open questions

- Resolved: the error overlay is a separate `errorDetail` field on `OverlayProvider` so a new error cannot replace an open modal.
- Resolved: "Open console entry" asks `ConsoleProvider` to open the drawer and carries a pending selection request that `useConsole` consumes into its local cursor.
- Resolved: Retry re-runs the command through `useCommandRunner` with the closure's original request; it appears only for retryable remote commands, so no separate preserved-input state is needed. A rejected retry is consumed after the error detail is stored, so a post-result refresh failure cannot terminate the TUI.
- Which overlays other than the palette and help declare their own toggle. Proposal: none in v1, so only `overlay.close` and `app.quit` are universal.
- Resolved: `app.quit` inside a confirmation aborts the in-flight command and quits directly, clearing the overlay state as the renderer is destroyed. The draft-based confirmation is deferred beyond M6.
