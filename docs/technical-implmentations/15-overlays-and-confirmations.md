# 15 Overlays and Confirmations

## 1. Header

Status: Draft for review
Spec reference: `docs/product-spec.md` F-15 Overlays and confirmations (lines 1041-1066); keyboard map (lines 1539-1704); action IDs section 6.1 (lines 1705-1742); key precedence section 3 (lines 109-119)
Dependencies: F-01 app shell and focus, F-19 configuration and keybindings, F-13 console (error linking), F-18 safety and platform behavior (redaction)
Owned paths:
- `src/features/overlays/ConfirmModal.tsx`
- `src/features/overlays/ErrorOverlay.tsx`
- `src/features/overlays/OverlayHost.tsx`
- `src/app/providers/OverlayProvider.tsx` (the overlay stack)

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
- The exact confirm button labels: "Discard changes", "Delete local branch", "Delete local and remote branch", "Drop stash", "Delete tag", "Delete worktree", "Force push safely", "Overwrite remote".
- No generic "OK" or "Yes" for destructive actions.
- Inline validation that keeps the modal open on error.
- `Enter` submitting single-line forms through the input's native `onSubmit`/`onEnter` callback and `form.submit` (`Ctrl/Cmd+Enter`) submitting multiline forms.
- Background regions visibly inactive and unable to receive actions while a modal is open, with only three exceptions: `overlay.close`, `app.quit`, and the same overlay's toggle.
- The footer showing the modal's keys.
- Only one modal open at a time.
- A failure closing the modal and opening a persistent error overlay with preserved input when retry is meaningful.
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
  OverlayProvider (src/app/providers/OverlayProvider.tsx)     // the modal stack and the current error detail
    (top of stack, rendered once)
    OverlayHost (src/features/overlays/OverlayHost.tsx)       // stack-aware host
      Overlay (src/ui/Overlay.tsx)                             // full-size dim layer, background deactivation
      ui/ModalFrame (src/ui/ModalFrame.tsx)                    // presentational structure and focus trap
        box                                                    // title + description
          text
        box                                                    // optional fields or list
          FormField (src/ui/FormField.tsx)                     // input/textarea/select with inline error
        ModalActions (src/ui/ModalActions.tsx)                 // footer actions with keys
          ButtonRow (src/ui/ButtonRow.tsx)
            Button (src/ui/Button.tsx)
      ConfirmModal (src/features/overlays/ConfirmModal.tsx)    // destructive and non-destructive confirmations
    ErrorOverlay (src/features/overlays/ErrorOverlay.tsx)      // persistent, replaces the previous error, never stacks
      box
        text / code / scrollbox                                // redacted error details
        ModalActions                                           // Dismiss, Open console entry, Retry when meaningful
```

Note on the two frame modules: `src/ui/ModalFrame.tsx` is the reusable presentational primitive from architecture section 7 (box overlay plus Panel plus title plus `ModalActions`, with the focus trap). `src/features/overlays/OverlayHost.tsx` is the overlay-stack-aware wrapper that reads the top of the `OverlayProvider` stack and feeds the primitive the right title, description, fields, and actions. The wrapper is named `OverlayHost` so it cannot be confused with the presentational `ModalFrame`. There is no `NoticeOverlay`: success and informational messages are not overlays and render only in the top bar status strip and the console.

## 5. Enforced files and folders

- `src/features/overlays/ConfirmModal.tsx` - destructive and non-destructive confirmation content, exact labels, scope text, and Cancel-first focus.
- `src/features/overlays/ErrorOverlay.tsx` - the persistent error overlay with redacted details, Dismiss, Open console entry, and optional Retry.
- `src/features/overlays/OverlayHost.tsx` - the overlay-stack-aware host that renders the top modal and error through `src/ui/ModalFrame.tsx`.
- `src/app/providers/OverlayProvider.tsx` - the overlay stack, destructive flag, current error detail, and preserved input on failure.
- Colocated tests: `OverlayHost.test.tsx`, `ConfirmModal.test.tsx`, `ErrorOverlay.test.tsx`, plus `src/app/providers/OverlayProvider.test.tsx`.

## 6. State model

Provider state (owned by `OverlayProvider.tsx`, the single source of truth):
- `stack: OverlayEntry[]` - the overlay stack. It holds at most one modal at a time; opening a second modal closes or replaces the first.
- `destructive: boolean` and `destructiveLabel: string` - drive default focus and the confirm button label.
- `errorDetail: ErrorDetail | null` - the current error shown by `ErrorOverlay`; a new failure replaces it rather than stacking.
- `preservedInput: unknown` - draft values kept from the failed modal when retry is meaningful.

Local view state (owned by the feature that opens the modal, passed in through the overlay entry):
- Form draft values and per-field validation errors.
- The focused field or footer action within the modal.

Provider state read by overlays:
- `StatusProvider`: transient success and informational messages. They render only in the top bar status strip and the console; no overlay reads or renders them.
- `ConsoleProvider`: the entry id that `ErrorOverlay`'s "Open console entry" action selects.
- `RepositoryProvider`: not read directly; availability comes through `commands.availability.ts`.

Rule: while an overlay is open it owns all keys, except `overlay.close`, `app.quit`, and the same overlay's toggle. No background feature keeps a parallel "modal is open" flag; the stack in `OverlayProvider` is the only authority.

## 7. Data flow

```text
action ID -> useAction -> OverlayProvider.open({ kind, title, description, fields, actions, destructive })
  -> features/overlays/OverlayHost.tsx renders src/ui/ModalFrame.tsx + src/ui/ModalActions.tsx
  -> submit -> form.submit for a multiline form, or the single-line input's native Enter
       -> useCommandRunner.runCommand(request)
       -> commands.runner.ts executes and returns a CommandResult
       success -> useCommandRunner: OverlayProvider.close(); StatusProvider.success(); console append; RepositoryProvider.refresh()
       failure -> useCommandRunner: OverlayProvider.close(); console append; RepositoryProvider.refresh()
                  OverlayProvider.showError({ details, preserveInput })
                  -> ErrorOverlay (persistent until dismissed; replaces any prior error)
                     -> git.redact.ts applied to details before render
       success and informational messages -> top bar status strip plus console only, never an overlay
```

Named modules:
- `src/app/providers/OverlayProvider.tsx` - the stack, open, close, showError, and preserved input.
- `src/app/hooks/useOverlay.ts` - the hook features use to open and close overlays.
- `src/domain/commands/commands.runner.ts` - the pure executor: availability, serialization, execution, and a `CommandResult`. It never closes an overlay, sets a status, or refreshes the repository.
- `src/app/hooks/useCommandRunner.ts` - the app-layer orchestrator that applies the result: closes the overlay on success, refreshes the repository, appends the console entry, sets status, and routes failures to `showError`.
- `src/domain/commands/commands.availability.ts` - disables a confirm action when its preconditions are unmet, with the same reason string the palette, footer, and help use.
- `src/domain/git/git.redact.ts` - redacts credentials in URLs, headers, and environment values in error details before display.
- `src/app/providers/StatusProvider.tsx` - transient success and informational messages, projected to the top bar status strip and the console. It owns the message timer and never opens an overlay.

## 8. Keyboard and focus

Action IDs only; never raw key strings:
- `overlay.close` (default `Esc`) - cancels the top overlay.
- `app.quit` (default `q`, plus the hardcoded `Ctrl+C`) - the quit escape hatch. It resolves while an overlay is open and follows the unsaved-work and running-operation confirmation rules.
- The same overlay's own toggle - `app.palette` when the palette is open, `app.help` when help is open. No other overlay has a toggle unless it declares one; the theme picker and confirmations do not.
- `nav.activate` (default `Enter`) - activates the focused footer action or button. For a single-line field, `Enter` stays with the input and its native `onSubmit`/`onEnter` callback dispatches the form's submit action; `nav.activate` does not intercept it.
- `form.submit` (default `Ctrl/Cmd+Enter`) - the submit action for every multiline form. It fires from a focused `<textarea>` and is the documented multiline submit path; it never applies to a single-line field, which keeps native `Enter`.
- `nav.up`, `nav.down` - move within an option list or field list.
- `nav.left`, `nav.right` - move within the footer `ButtonRow` (defaults also bind `h`/`l`).
- `focus.next`, `focus.previous` (`Tab`/`Shift+Tab`) - cycle fields and footer actions when focus is not in a multiline textarea. A multiline textarea owns Tab for indentation and Shift+Tab for outdent per F-01; the focus trap keeps focus inside the modal in all cases.

How `OverlayProvider` plus `useHotkeys` gives overlays full key ownership:
- `useHotkeys` reads the top of the `OverlayProvider` stack on every key event. If the stack is non-empty, it resolves only overlay-scope actions from the keymap and returns. Background region handlers and global handlers are never reached, so a background action cannot fire while a modal is open. Keys the overlay context does not handle are delegated to the focused modal text input or native list widget.
- Exactly three global actions resolve while an overlay is open: `overlay.close`, `app.quit`, and the same overlay's toggle. The overlay's own scoped actions (`nav.*`, `form.submit`, and its feature commands) continue to resolve inside the modal. No other global action does. `app.console` is global in the shell, but it does not resolve while an overlay owns keys because the console drawer is not the open overlay; the same applies to `remote.*`, `app.themePicker`, `app.refresh`, and `app.reloadConfig`.
- The background is deactivated visually and functionally by rendering `src/ui/Overlay.tsx`, a full-size dim `<box>`, beneath the modal. On open, `OverlayProvider` captures the currently focused renderable, blurs it, and focuses the modal's first focusable field or action after mount. Because native focus moves into the modal, region borders lose the focus ring and no background renderable receives keys. On close, `OverlayProvider` restores the captured renderable if it is still mounted, otherwise it focuses its region frame.

Focus behavior:
- Destructive confirmations default focus to Cancel.
- Non-destructive confirmations default focus to the primary action.
- On close, focus returns to the exact renderable that was focused before the overlay opened, if it is still mounted; otherwise it focuses that renderable's region frame and restores the region cursor.
- The footer shows the modal's keys while the modal is open.

## 9. Loading, empty, error, and disabled states

- Inline validation error: a text row under the field with the marker `[!]`, the modal stays open, and the submit action is disabled with the reason.
- Submitting: the footer action shows a spinner through `useTimeline()`, and the background stays inactive.
- Disabled confirm: when availability fails, the primary action is dim with the reason from `commands.availability.ts` and cannot be activated.
- Error overlay: persistent, shows redacted details, and offers Dismiss plus "Open console entry"; a Retry action appears only when retry is meaningful and the preserved input can be reused.
- Success and informational messages: non-blocking, rendered only in the top bar status strip and the console, and auto-dismissed by `StatusProvider`. They never render as a modal, overlay, toast, or focus owner.
- Empty list in a modal: a text row with the marker `[ ]` and a short reason, for example when an option list has no entries.
- Multiline form: the footer shows the `form.submit` hint (`Ctrl/Cmd+Enter`); an empty required field keeps the modal open with an inline reason, and successful submit closes the modal.

## 10. Performance and bounds

- Only one overlay is rendered at a time; the stack never renders more than one modal, so there is no stacking cost.
- Error details are capped with the first and last portion preserved and an omitted-lines marker, mirroring the console cap.
- The error detail container is a `<scrollbox>`, so large git output does not force a full render.
- Redaction runs once before an error detail is stored, not on each render.
- Status messages use a single timer in `StatusProvider`; because they are not overlays, they allocate no stack entry and no focus state.

## 11. Safety and confirmations

- Destructive confirmations default focus to Cancel and state the exact scope and consequence.
- Exact confirm labels: "Discard changes", "Delete local branch", "Delete local and remote branch", "Drop stash", "Delete tag", "Delete worktree", "Force push safely", "Overwrite remote".
- Generic "OK" and "Yes" labels are never used for destructive actions.
- Configuration cannot disable destructive confirmations, force-push warnings, credential prompt protection, or hook execution defaults.
- On failure, the user's input is preserved when retry is meaningful, and drafts or staged files are never cleared.
- The app never stacks error overlays: a new failure replaces the visible error details but remains in the console.
- Success and informational messages never mask the UI, never take focus, and never require dismissal; they live in the top bar status strip and the console only.

## 12. Acceptance mapping

- "All modals use the same structure: title, short description, optional fields or list, footer with actions and their keys, focus trap, `Esc` cancels" -> `src/ui/ModalFrame.tsx` plus `src/ui/ModalActions.tsx`, wrapped by `src/features/overlays/OverlayHost.tsx`.
- "Destructive confirmations default focus to Cancel" -> `ConfirmModal.tsx` plus the `destructive` flag in `OverlayProvider.tsx`.
- "Confirm buttons use specific labels" -> the label table in `ConfirmModal.tsx`; the eight labels above.
- "Simple OK and Yes labels are not used for destructive actions" -> enforced in `ConfirmModal.tsx`.
- "Destructive confirmations state the exact scope and consequence" -> the description built by the calling feature and rendered by `ConfirmModal.tsx`.
- "Text input modals validate inline and keep the modal open on error" -> `src/ui/FormField.tsx` plus validation state owned by the calling feature.
- "`Enter` submits single-line forms through the input's native submit callback; multiline fields use `form.submit` (`Ctrl/Cmd+Enter`)" -> `onSubmit`/`onEnter` wiring in `OverlayHost.tsx` plus `src/ui/FormField.tsx`, and the `form.submit` action from the keymap for a focused textarea.
- "While a modal is open, background regions are visibly inactive and cannot receive actions" -> `src/ui/Overlay.tsx` plus the `useHotkeys` overlay branch. Only `overlay.close`, `app.quit`, and the same overlay's toggle resolve.
- "The footer shows the modal's keys" -> `OverlayProvider` sets the footer hint mode and `HintBar` renders the modal keys, including `form.submit` for multiline forms.
- "Only one modal is open at a time; a successful action closes the modal and shows status" -> single-entry modal handling in `OverlayProvider.tsx` plus `StatusProvider`.
- "If an operation started from a modal fails, the modal closes and a persistent error overlay opens with the details; input is preserved when retry is meaningful" -> `OverlayProvider.showError` with `preservedInput`.
- "Success and informational messages are non-blocking, appear only in the top bar status strip and the console, and auto-dismiss; failures stay until dismissed" -> `StatusProvider` projection to the top bar and console versus `ErrorOverlay.tsx`; no notice overlay exists.
- "The app does not stack error overlays; a new failure replaces the visible error details but remains in the console" -> `errorDetail` replacement in `OverlayProvider.tsx`.

## 13. Tests to add

Colocated per architecture section 5:
- `src/app/providers/OverlayProvider.test.tsx`: only one modal at a time; a second error replaces the first instead of stacking; close on success; input preserved on failure when retry is meaningful; opening captures and blurs the focused renderable, and closing restores that renderable if it is still mounted, otherwise its region frame; success and informational results add no stack entry.
- `OverlayHost.test.tsx`: `overlay.close` cancels; the focus trap keeps `focus.next` inside the modal; destructive default focus is Cancel; the footer shows the modal keys; `form.submit` fires from a multiline field; `Enter` still activates a focused footer button.
- Keyboard ownership test: while an overlay is open, `app.quit` and that overlay's own toggle resolve, and every other global action, including `app.console`, `app.palette` in a non-palette modal, `remote.pull`, `app.themePicker`, and `app.reloadConfig`, does not resolve.
- `ConfirmModal.test.tsx`: each of the eight labels renders for its action; no "OK" or "Yes" appears for destructive actions; scope text is present.
- `ErrorOverlay.test.tsx`: persistence until dismissed; details are redacted; "Open console entry" selects the entry; a new error replaces the visible details.
- Status message tests: success and informational results render in the top bar status strip and append to the console; they never mount an overlay, take focus, or block keys.
- Form submit tests: `Enter` reaches a single-line input and its `onSubmit`/`onEnter` callback runs the form submit action; `nav.activate` still activates footer buttons; `form.submit` fires on the mapped `Ctrl/Cmd+Enter` binding for a textarea; inline validation keeps the modal open.

## 14. Open questions

- Whether the error overlay is a modal stack entry or a separate `errorDetail` field on `OverlayProvider`; the current plan uses a separate field so a new error cannot stack.
- Where "Open console entry" navigation lives: `OverlayProvider` coordinating with `ConsoleProvider`, or a command dispatched by `ErrorOverlay`.
- Whether Retry reopens the original modal with preserved input or re-runs the command directly; the plan reopens the modal when input exists.
- Which overlays other than the palette and help declare their own toggle. Proposal: none in v1, so only `overlay.close` and `app.quit` are universal.
- Whether `app.quit` from inside a confirmation should close the confirmation first or quit directly. Proposal: quit directly after its own confirmation, so the overlay stack is cleared once.
