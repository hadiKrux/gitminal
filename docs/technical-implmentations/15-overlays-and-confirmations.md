# 15 Overlays and Confirmations

## 1. Header

Status: Draft for review
Spec reference: `docs/product-spec.md` F-15 Overlays and confirmations (lines 997-1021); modal and palette keymap (lines 1573-1581); action IDs section 6.1 (lines 1583-1611); key precedence section 3 (lines 109-119)
Dependencies: F-01 app shell and focus, F-19 configuration and keybindings, F-13 console (error linking), F-18 safety and platform behavior (redaction)
Owned paths:
- `src/features/overlays/ConfirmModal.tsx`
- `src/features/overlays/ErrorOverlay.tsx`
- `src/features/overlays/NoticeOverlay.tsx`
- `src/features/overlays/ModalFrame.tsx`
- `src/app/providers/OverlayProvider.tsx` (the overlay stack)

Consumed paths (not owned):
- `src/app/hooks/useOverlay.ts`
- `src/app/hooks/useAction.ts`
- `src/app/hooks/useHotkeys.ts`
- `src/app/providers/StatusProvider.tsx`
- `src/app/providers/ConsoleProvider.tsx`
- `src/domain/commands/commands.runner.ts`
- `src/domain/commands/commands.availability.ts`
- `src/domain/git/git.redact.ts`
- `src/ui/Overlay.tsx`, `src/ui/ModalActions.tsx`, `src/ui/Button.tsx`, `src/ui/ButtonRow.tsx`, `src/ui/FormField.tsx`, `src/ui/KeyHint.tsx`

## 2. Scope and non-goals

In scope:
- The standard modal structure: title, short description, optional fields or list, footer actions with their keys, a focus trap while open, and `Esc` cancel.
- Destructive confirmations defaulting focus to Cancel.
- The exact confirm button labels: "Discard changes", "Delete local branch", "Delete local and remote branch", "Drop stash", "Delete tag", "Delete worktree", "Force push safely", "Overwrite remote".
- No generic "OK" or "Yes" for destructive actions.
- Inline validation that keeps the modal open on error.
- `Enter` submitting single-line forms and `Ctrl/Cmd+Enter` submitting multiline forms.
- Background regions visibly inactive and unable to receive actions while a modal is open.
- The footer showing the modal's keys.
- Only one modal open at a time.
- A failure closing the modal and opening a persistent error overlay with preserved input when retry is meaningful.
- Success messages that are non-blocking and auto-dismiss.
- No stacking of error overlays.

Non-goals:
- No feature-specific form logic; fields and submit handlers come from the calling feature.
- Configuration cannot disable destructive confirmations, force-push warnings, or credential protection.
- No toast library and no third-party notification system.
- No multi-modal workflows; a modal never opens another modal on top of itself.

## 3. OpenTUI components used

| Component | Where used | Why it is the right component |
| --- | --- | --- |
| `<box>` | Modal frame, the dim overlay layer, footer action row, field rows, error detail container | Layout, borders, and the overlay structure; section 6 assigns modals and overlays to boxes. |
| `<text>` | Title, description, field labels, inline validation text, error details, notice text | Every string in a modal or overlay. |
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
- `useFocus` / `useBlur`: no special handling required; the focus trap is provider-driven.
- `useTimeline()`: spinner animation for a submitting action.

All icons and markers used by this feature come from `src/theme/icons.ts`; see architecture section 6.1. No glyph literal is written in feature code.

## 4. Component tree

```text
App (src/app/App.tsx)
  OverlayProvider (src/app/providers/OverlayProvider.tsx)     // the modal stack and the current error detail
    (top of stack, rendered once)
    ModalFrame (src/features/overlays/ModalFrame.tsx)          // stack-aware frame
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
      NoticeOverlay (src/features/overlays/NoticeOverlay.tsx)  // auto-dismissing success and info notices
    ErrorOverlay (src/features/overlays/ErrorOverlay.tsx)      // persistent, replaces the previous error, never stacks
      box
        text / code / scrollbox                                // redacted error details
        ModalActions                                           // Dismiss, Open console entry, Retry when meaningful
```

Note on the two frame modules: `src/ui/ModalFrame.tsx` is the reusable presentational primitive from architecture section 7 (box overlay plus Panel plus title plus `ModalActions`, with the focus trap). `src/features/overlays/ModalFrame.tsx` is the overlay-stack-aware wrapper that reads the top of the `OverlayProvider` stack and feeds the primitive the right title, description, fields, and actions. Both names are required by architecture section 4; the split keeps presentation in `src/ui` and stack wiring in the feature.

## 5. Enforced files and folders

- `src/features/overlays/ConfirmModal.tsx` - destructive and non-destructive confirmation content, exact labels, scope text, and Cancel-first focus.
- `src/features/overlays/ErrorOverlay.tsx` - the persistent error overlay with redacted details, Dismiss, Open console entry, and optional Retry.
- `src/features/overlays/NoticeOverlay.tsx` - non-blocking, auto-dismissing success and info notices.
- `src/features/overlays/ModalFrame.tsx` - the overlay-stack-aware frame that renders the top modal through `src/ui/ModalFrame.tsx`.
- `src/app/providers/OverlayProvider.tsx` - the overlay stack, destructive flag, current error detail, and preserved input on failure.
- Colocated tests: `ModalFrame.test.tsx`, `ConfirmModal.test.tsx`, `ErrorOverlay.test.tsx`, `NoticeOverlay.test.tsx`, plus `src/app/providers/OverlayProvider.test.tsx`.

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
- `StatusProvider`: transient success and info messages that `NoticeOverlay` renders and auto-dismisses.
- `ConsoleProvider`: the entry id that `ErrorOverlay`'s "Open console entry" action selects.
- `RepositoryProvider`: not read directly; availability comes through `commands.availability.ts`.

Rule: while an overlay is open it owns all keys. No background feature keeps a parallel "modal is open" flag; the stack in `OverlayProvider` is the only authority.

## 7. Data flow

```text
action ID -> useAction -> OverlayProvider.open({ kind, title, description, fields, actions, destructive })
  -> features/overlays/ModalFrame.tsx renders src/ui/ModalFrame.tsx + src/ui/ModalActions.tsx
  -> submit -> commands.runner.ts
       success -> OverlayProvider.close(); StatusProvider.success() -> NoticeOverlay auto-dismisses
       failure -> OverlayProvider.close()
                  OverlayProvider.showError({ details, preserveInput })
                  -> ErrorOverlay (persistent until dismissed; replaces any prior error)
                     -> git.redact.ts applied to details before render
```

Named modules:
- `src/app/providers/OverlayProvider.tsx` - the stack, open, close, showError, and preserved input.
- `src/app/hooks/useOverlay.ts` - the hook features use to open and close overlays.
- `src/domain/commands/commands.runner.ts` - executes the submit and returns success or a failure result.
- `src/domain/commands/commands.availability.ts` - disables a confirm action when its preconditions are unmet, with the same reason string the palette and footer use.
- `src/domain/git/git.redact.ts` - redacts credentials in URLs, headers, and environment values in error details before display.
- `src/app/providers/StatusProvider.tsx` - success and info notices that auto-dismiss.

## 8. Keyboard and focus

Action IDs only; never raw key strings:
- `overlay.close` (default `Esc`) - cancels the top overlay.
- `nav.activate` (default `Enter`) - activates the focused action; for single-line forms, `Enter` submits.
- `nav.up`, `nav.down` - move within an option list or field list.
- `nav.left`, `nav.right` - move within the footer `ButtonRow` (defaults also bind `h`/`l`).
- `focus.next`, `focus.previous` (`Tab`/`Shift+Tab`) - cycle fields and footer actions; the focus trap keeps focus inside the modal.
- Multiline submit: `Ctrl/Cmd+Enter` maps to the modal's submit action through the keymap, never as a raw key check.

How `OverlayProvider` plus `useHotkeys` gives overlays full key ownership:
- `useHotkeys` reads the top of the `OverlayProvider` stack on every key event. If the stack is non-empty, it resolves only overlay-scope actions from the keymap and returns. Background region handlers and global handlers are never reached, so a background action cannot fire while a modal is open.
- The single exception is the hardcoded quit escape hatch, which still works per key precedence rule 1.
- The background is deactivated visually and functionally by rendering `src/ui/Overlay.tsx`, a full-size dim `<box>`, beneath the modal. `FocusProvider` is suspended while an overlay is open, so region borders lose the focus ring and no region receives `focus.next` traversal.

Focus behavior:
- Destructive confirmations default focus to Cancel.
- Non-destructive confirmations and notices default focus to the primary action.
- On close, focus returns to the region that was active before the overlay opened, restoring that region's cursor.
- The footer shows the modal's keys while the modal is open.

## 9. Loading, empty, error, and disabled states

- Inline validation error: a text row under the field with the marker `[!]`, the modal stays open, and the submit action is disabled with the reason.
- Submitting: the footer action shows a spinner through `useTimeline()`, and the background stays inactive.
- Disabled confirm: when availability fails, the primary action is dim with the reason from `commands.availability.ts` and cannot be activated.
- Error overlay: persistent, shows redacted details, and offers Dismiss plus "Open console entry"; a Retry action appears only when retry is meaningful and the preserved input can be reused.
- Notice: success and info messages render in `NoticeOverlay`, are non-blocking, and auto-dismiss after a short delay.
- Empty list in a modal: a text row with the marker `[ ]` and a short reason, for example when an option list has no entries.

## 10. Performance and bounds

- Only one overlay is rendered at a time; the stack never renders more than one modal, so there is no stacking cost.
- Error details are capped with the first and last portion preserved and an omitted-lines marker, mirroring the console cap.
- The error detail container is a `<scrollbox>`, so large git output does not force a full render.
- Redaction runs once before an error detail is stored, not on each render.
- Auto-dismiss uses a single timer per notice; a new notice replaces the previous timer.

## 11. Safety and confirmations

- Destructive confirmations default focus to Cancel and state the exact scope and consequence.
- Exact confirm labels: "Discard changes", "Delete local branch", "Delete local and remote branch", "Drop stash", "Delete tag", "Delete worktree", "Force push safely", "Overwrite remote".
- Generic "OK" and "Yes" labels are never used for destructive actions.
- Configuration cannot disable destructive confirmations, force-push warnings, credential prompt protection, or hook execution defaults.
- On failure, the user's input is preserved when retry is meaningful, and drafts or staged files are never cleared.
- The app never stacks error overlays: a new failure replaces the visible error details but remains in the console.

## 12. Acceptance mapping

- "All modals use the same structure: title, short description, optional fields or list, footer with actions and their keys, focus trap, `Esc` cancels" -> `src/ui/ModalFrame.tsx` plus `src/ui/ModalActions.tsx`, wrapped by `src/features/overlays/ModalFrame.tsx`.
- "Destructive confirmations default focus to Cancel" -> `ConfirmModal.tsx` plus the `destructive` flag in `OverlayProvider.tsx`.
- "Confirm buttons use specific labels" -> the label table in `ConfirmModal.tsx`; the eight labels above.
- "Simple OK and Yes labels are not used for destructive actions" -> enforced in `ConfirmModal.tsx`.
- "Destructive confirmations state the exact scope and consequence" -> the description built by the calling feature and rendered by `ConfirmModal.tsx`.
- "Text input modals validate inline and keep the modal open on error" -> `src/ui/FormField.tsx` plus validation state owned by the calling feature.
- "`Enter` submits single-line forms; multiline fields use `Ctrl/Cmd+Enter`" -> keymap mapping to the submit action in `ModalFrame.tsx`.
- "While a modal is open, background regions are visibly inactive and cannot receive actions" -> `src/ui/Overlay.tsx` plus the `useHotkeys` overlay branch.
- "The footer shows the modal's keys" -> `OverlayProvider` sets the footer mode and `HintBar` renders the modal keys.
- "Only one modal is open at a time; a successful action closes the modal and shows status" -> single-entry modal handling in `OverlayProvider.tsx` plus `StatusProvider`.
- "If an operation started from a modal fails, the modal closes and a persistent error overlay opens with the details; input is preserved when retry is meaningful" -> `OverlayProvider.showError` with `preservedInput`.
- "Success messages are non-blocking and auto-dismiss; failures stay until dismissed" -> `NoticeOverlay.tsx` versus `ErrorOverlay.tsx`.
- "The app does not stack error overlays; a new failure replaces the visible error details but remains in the console" -> `errorDetail` replacement in `OverlayProvider.tsx`.

## 13. Tests to add

Colocated per architecture section 5:
- `src/app/providers/OverlayProvider.test.tsx`: only one modal at a time; a second error replaces the first instead of stacking; close on success; input preserved on failure when retry is meaningful.
- `ModalFrame.test.tsx`: `overlay.close` cancels; the focus trap keeps `focus.next` inside the modal; destructive default focus is Cancel; the footer shows the modal keys.
- `ConfirmModal.test.tsx`: each of the eight labels renders for its action; no "OK" or "Yes" appears for destructive actions; scope text is present.
- `ErrorOverlay.test.tsx`: persistence until dismissed; details are redacted; "Open console entry" selects the entry; a new error replaces the visible details.
- `NoticeOverlay.test.tsx`: auto-dismiss after the delay; a new notice replaces the timer.
- Form submit tests: `nav.activate` submits a single-line form; the multiline submit action fires on the mapped `Ctrl/Cmd+Enter` binding; inline validation keeps the modal open.

## 14. Open questions

- `src/features/overlays/ModalFrame.tsx` and `src/ui/ModalFrame.tsx` share a name. Resolution taken here: `src/ui` owns presentation and the focus trap, `src/features/overlays` owns the stack-aware wrapper. Confirm this split is intended by architecture section 4, which lists both.
- Whether the error overlay is a modal stack entry or a separate `errorDetail` field on `OverlayProvider`; the current plan uses a separate field so a new error cannot stack.
- The auto-dismiss delay for notices. Proposed: four seconds, with no configuration in v1.
- Where "Open console entry" navigation lives: `OverlayProvider` coordinating with `ConsoleProvider`, or a command dispatched by `ErrorOverlay`.
- Whether Retry reopens the original modal with preserved input or re-runs the command directly; the plan reopens the modal when input exists.
