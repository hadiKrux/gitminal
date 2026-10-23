# 13 Console

## 1. Header

Status: Ready for dev
Spec reference: `docs/product-spec.md` F-13 Console (lines 980-1015); action IDs section 6.1 (lines 1705-1742); keyboard map (lines 1539-1704); key precedence section 3 (lines 109-119)
Dependencies: F-01 app shell and focus, F-15 overlays and confirmations (clear confirmation), F-18 safety and platform behavior (redaction), F-17 freshness and performance (routine refresh grouping), F-19 configuration and keybindings
Owned paths:
- `src/features/console/ConsoleDrawer.tsx`
- `src/features/console/ConsoleEntryRow.tsx`
- `src/features/console/ConsoleOutput.tsx`
- `src/features/console/useConsole.ts`
- `src/domain/console/console.types.ts`
- `src/domain/console/console.buffer.ts`
- `src/domain/console/console.format.ts`
- `src/app/providers/ConsoleProvider.tsx` (the single owner of console history state)

Consumed paths (not owned):
- `src/app/providers/StatusProvider.tsx`
- `src/app/providers/OverlayProvider.tsx`
- `src/app/hooks/useConsoleLog.ts`
- `src/app/hooks/useCommandRunner.ts`
- `src/app/hooks/useAction.ts`
- `src/domain/git/git.redact.ts`
- `src/domain/git/git.progress.ts`
- `src/domain/commands/commands.runner.ts`
- `src/features/shell/regions.ts` (the `console` region id)
- `src/ui/ModalFrame.tsx`, `src/ui/Overlay.tsx`, `src/ui/Spinner.tsx`, `src/ui/KeyHint.tsx`

## 2. Scope and non-goals

In scope:
- A non-modal bottom drawer that opens above the footer and shows a log of git commands executed by the app.
- Per-entry fields: local timestamp, operation label, command and arguments, working directory only when it differs from the repository root, exit status, duration, and a progress phase or a short success or failure summary.
- Expandable stdout and stderr for failures, capped with the first and last portion preserved and an omitted-lines marker.
- Logging every mutating operation, logging user-visible or failing reads, and grouping routine refreshes to avoid noise.
- Follow mode with a new-entries indicator when the user scrolls up.
- Scrolling keys, clear with confirmation, and Esc close.
- A bounded session history of at least 200 entries.
- Redaction through `src/domain/git/git.redact.ts` before display.
- Error entries linked from the app.
- The drawer staying open while focus moves elsewhere.
- Cancelled and timed-out results rendered as their own outcome, never as success.

Non-goals:
- The console does not execute commands; it observes entries produced by `useCommandRunner` from the runner result.
- No persistence across sessions.
- No editing, search, or filtering of entries in v1.
- No use of the renderer's built-in console for app logs (see section 3).
- The console is not an overlay and does not participate in modal precedence; its `app.console` toggle stays global while the drawer is open.

## 3. OpenTUI components used

The app console drawer is app-owned UI built from `<box>` plus `<scrollbox>`, so it can show command, status, duration, and expandable output in the app style. The renderer's built-in console from `useRenderer()` is reserved for development logging only and never renders user-visible app history.

| Component | Where used | Why it is the right component |
| --- | --- | --- |
| `<box>` | Drawer frame docked above the footer, header row, each entry row, output panes | Layout, borders, and the docked drawer structure; section 6 rule 7 defines the drawer as boxes plus a scrollbox. |
| `<text>` | Timestamp, operation label, command text, cwd, exit status, duration, phase, omitted-lines marker | Every string in an entry and the header. |
| `<span>` | Status markers, dim omitted-lines marker, dim phase text | Inline styled runs inside `<text>`. |
| `<scrollbox>` | The log viewport, and each expanded output pane | Scrolling, wheel scroll, scrollbars, and `viewportCulling` for the entry list; section 6 assigns `<scrollbox>` to the console. |
| `<code>` | The command line when a filetype is known, and expanded output previews | Read-only syntax-highlighted content; section 6 assigns `<code>` to console command text when a filetype is known. |
| `<select>` | Not used | Entries need custom multi-field rows and expansion, so they are scrollbox boxes, not uniform options. |
| `<markdown>` | Not used in this feature | - |

Hooks:
- `useKeyboard`: never called directly; `src/app/hooks/useHotkeys.ts` owns dispatch, and the console registers handlers by action ID through `useAction`.
- `useTerminalDimensions()`: computes the drawer height, visible entry count, and truncation budgets.
- `useSelectionHandler()`: console log text selection and copy.
- `useFocus` / `useBlur`: report terminal blur so `ConsoleProvider` can pause follow mode. This is not region focus.
- `useRenderer()`: used only for focus plumbing; the renderer built-in console stays a development tool.

All icons and markers used by this feature come from `src/theme/icons.ts`; see architecture section 6.1. No glyph literal is written in feature code.

## 4. Component tree

```text
AppShell (src/features/shell/AppShell.tsx)
  MainArea (src/features/shell/MainArea.tsx)
  ConsoleDrawer (src/features/console/ConsoleDrawer.tsx)   // non-modal, docked above the footer
    box                                                     // drawer header
      text "Console"
      text                                                  // follow indicator or new-entries marker
    scrollbox                                               // log viewport, viewportCulling
      ConsoleEntryRow (src/features/console/ConsoleEntryRow.tsx)
        box
          text                                              // timestamp + operation label
          text                                              // command and arguments
          text                                              // cwd, only when different from root
          text                                              // exit status + duration + phase
          ConsoleOutput (src/features/console/ConsoleOutput.tsx)   // expanded stdout/stderr
            scrollbox
              text / code                                   // first portion, omitted-lines marker, last portion
    box                                                     // footer hints
      KeyHint (src/ui/KeyHint.tsx)                          // c Clear, Esc Close, Up/Down Scroll
  Footer (src/features/shell/Footer.tsx)                    // drawer sits directly above this
```

## 5. Enforced files and folders

- `src/features/console/ConsoleDrawer.tsx` - the drawer component: header, log viewport, footer hints, and the docked layout above the footer.
- `src/features/console/ConsoleEntryRow.tsx` - one entry row: all logged fields and the expansion toggle.
- `src/features/console/ConsoleOutput.tsx` - expandable stdout and stderr rendering with first/last preservation and the omitted-lines marker.
- `src/features/console/useConsole.ts` - scroll and selection view state plus the `console.clear` request; it does not own drawer visibility, follow mode, or expansion.
- `src/domain/console/console.types.ts` - `ConsoleEntry`, `ConsoleStatus`, and phase types.
- `src/domain/console/console.buffer.ts` - bounded buffer, trimming, first/last preservation, omitted count, new-entries count.
- `src/domain/console/console.format.ts` - entry and output formatting, including the omitted-lines marker, the decisive stderr line, and the cancelled or timed-out outcome text.
- `src/app/providers/ConsoleProvider.tsx` - the single owner of the bounded buffer, follow mode, new-entry count, and expanded entry ids.
- Colocated tests: `console.buffer.test.ts`, `console.format.test.ts`, `ConsoleOutput.test.tsx`, `useConsole.test.ts`, `ConsoleDrawer.test.tsx`, plus `src/app/providers/ConsoleProvider.test.tsx`.

## 6. State model

Local view state (owned by `useConsole.ts` and the components):
- `selectedEntryId: string | null` - the entry under the cursor.
- `scrollOffset: number` - current position in the log viewport, plus the per-output-pane scroll position.
- No `followMode` or `expandedEntryIds` is stored here; both are provider state.

Provider state (single source of truth):
- `ConsoleProvider`: drawer visibility (`isOpen`), the bounded entry buffer, `followMode`, `newEntryCount`, and `expandedEntryIds`. Backed by `src/domain/console/console.buffer.ts`. The global `app.console`, `overlay.close`, and `focus.region.console` handlers call `ConsoleProvider.toggle()`, `close()`, and `open()`; no feature component keeps a second visibility flag.
- `StatusProvider`: transient status, kept separate from the console history.
- `OverlayProvider`: hosts the clear confirmation.
- `RepositoryProvider`: not read by the console; the orchestrator refreshes it after the command result, and entries are produced from that result.

Rule: entries are created by the app-layer `useCommandRunner` orchestrator from the runner's `CommandResult` and appended through `src/app/hooks/useConsoleLog.ts`. `commands.runner.ts` never touches a provider or a hook. The console feature only reads and renders entries; it never constructs git output itself. `useConsole` reports scroll position changes to `ConsoleProvider.setFollowing(boolean)` and expansion toggles to `ConsoleProvider.toggleExpanded(entryId)`; it never keeps a second copy of those values.

## 7. Data flow

```text
command -> useCommandRunner.runCommand -> commands.runner.ts -> domain command -> git client -> CommandResult
  -> useCommandRunner applies redaction and formatting
  -> git.redact.ts redacts credentials in URLs, headers, and environment values
  -> console.format.ts builds a ConsoleEntry
       (timestamp, operation label, argv, cwd, exit status, duration, phase, stdout, stderr,
        cancelled or timed-out outcome)
       - success: status "success", exitCode 0, summary
       - failure: status "failure", exitCode N, decisive stderr line
       - cancelled: status "cancelled", exitCode null, marker "cancelled", never success
       - timed out: status "timed-out", exitCode null, marker "timed out after N seconds", never success
  -> useConsoleLog -> ConsoleProvider.append -> console.buffer.ts trims to the bound
  -> ConsoleDrawer re-renders; follow mode scrolls to bottom, otherwise the new-entry count increments
```

A cancelled or timed-out result is still exactly one entry. It never renders the success marker or "exit 0", even when the child exited with code 0 after a cancellation race. The orchestrator sets a warning status instead of an error overlay, and the entry keeps the cancelled or timed-out reason.

Named modules:
- `src/domain/console/console.types.ts` - entry and status types, including `cancelled` and `timedOut` on the entry.
- `src/domain/console/console.buffer.ts` - bounded ring with at least 200 entries, first/last output preservation, omitted-line counts, and the new-entries counter.
- `src/domain/console/console.format.ts` - builds entries and output blocks from a `CommandResult`, the omitted-lines marker, the decisive stderr line for failures, and the cancelled or timed-out outcome.
- `src/app/providers/ConsoleProvider.tsx` - the single owner of buffer, follow mode, new-entry count, and expanded entry ids.
- `src/domain/git/git.redact.ts` - redaction applied before any entry is stored.
- `src/domain/git/git.progress.ts` - progress phase for remote operations.
- `src/domain/commands/commands.runner.ts` - the pure executor: availability, serialization, execution, and a `CommandResult`; no provider access and no append point.
- `src/app/hooks/useCommandRunner.ts` - the app-layer orchestrator and append point for every command result; it redacts, formats, and appends through `useConsoleLog.ts`.
- `src/app/hooks/useConsoleLog.ts` - the app hook the orchestrator uses to append entries.

## 8. Keyboard and focus

Action IDs only; never raw key strings:
- `app.console` (default `Ctrl/Cmd+``) - toggles the drawer. It is a global action owned by the always-mounted app or shell layer, not registered by the console feature. Because the console is not an overlay, this toggle stays global and resolves while the drawer is open.
- `overlay.close` (default `Esc`) - closes the drawer while it is open, even when focus is in another region. The action has one global registration owned by the app or shell layer; the console feature does not register it. Focus then returns to the region that was focused before the console opened.
- `nav.up`, `nav.down` - scroll (defaults also bind `j`/`k`).
- `nav.pageUp`, `nav.pageDown` - move by a screen.
- `nav.first` (default `g`) - jump to the oldest entry.
- `nav.last` (default `G`) - jump to the newest entry.
- `console.clear` (default `c`) - clears the console after confirmation. The console feature registers it with `scope: "console"` through `useAction`; it is not a global action.
- `focus.next`, `focus.previous` (`Tab`/`Shift+Tab`) - move focus to and from the console region.
- `focus.region.console` (default `9`) - opens the drawer if it is closed and then focuses the console region. It is a key-only global action owned by `useFocusModel.ts`, not by the console feature. It does not toggle; `app.console` remains the close path.

Registration:
- The console registers only `console.clear` and its region-scoped `nav.*` handlers with `scope: "console"`. It never registers `app.*`, `focus.*`, or `overlay.close`; those stay single global registrations in the app or shell layer.
- `nav.activate` is not used by the console; entries expand through their own action or the row toggle.

Focus:
- The console is the `console` region defined in `src/features/shell/regions.ts`. Its frame is focusable and uses native `focusedBorderColor`; its `<scrollbox>` is non-focusable so the region frame owns focus and `nav.*` actions drive the entry cursor.
- It is non-modal: it can stay open while focus moves to another region with `Tab`, a digit jump, or a click, and the region cursor persists when focus leaves and returns.
- Because no overlay owns keys while the drawer is open, `useHotkeys` resolves the console region context keys through the normal region precedence when the console region is focused. Modal precedence does not apply, and the console does not gate global actions.
- When the drawer is closed, its region keys are inert and repository navigation is unaffected.
- When an entry's output pane has focus, arrow keys scroll within that pane.

## 9. Loading, empty, error, and disabled states

- Empty: a single text row with the marker `[ ]` and the message "No commands yet"; `console.clear` is dimmed with the reason "console empty".
- Loading: an in-progress entry shows a `Spinner` and the current phase, and the top bar status strip shows progress through `StatusProvider`; there is no separate loading screen.
- Error entry: the exit status renders as the marker `x` plus "exit N", and the stderr pane is expanded by default for failures.
- Cancelled entry: the exit status renders as the marker `!` plus "cancelled" and the cancellation reason; it is never shown as success and the stderr pane stays collapsed unless the user expands it.
- Timed-out entry: the exit status renders as the marker `!` plus "timed out after N seconds"; it is never shown as success.
- Disabled: `console.clear` is dimmed with its reason when there are no entries; the clear action never fires while disabled.
- Success entry: the exit status renders as the marker `v` plus "exit 0" and a short summary, and stdout stays collapsed unless expanded.

## 10. Performance and bounds

- `console.buffer.ts` keeps a bounded history of at least 200 entries and drops the oldest beyond the bound while preserving the first and last output of the retained window.
- Each entry's stdout and stderr are capped: the first and last portion are kept and an omitted-lines marker such as "... N lines omitted ..." is inserted in the middle.
- The log viewport uses a `<scrollbox>` with `viewportCulling`, so only visible entries render.
- Routine refreshes are grouped into a single "Refresh" entry with a count rather than one entry per poll.
- Follow mode scrolls to the bottom on append only when `ConsoleProvider.followMode` is true; otherwise it increments `newEntryCount` without moving the viewport. `append` is the single place that updates both values, so the count and the viewport can never disagree.
- Expanding an entry toggles `ConsoleProvider.expandedEntryIds`; the set is bounded by the buffer bound because ids of trimmed entries are dropped with their entries.
- Truncation of command lines and cwd uses `src/lib/text.ts` budgets from `useTerminalDimensions()`; the operation label, exit status, and duration are never truncated away.

## 11. Safety and confirmations

- `console.clear` asks for confirmation through `ConfirmModal` (via `OverlayProvider`) with the label "Clear console" and states that the session history will be lost.
- `src/domain/git/git.redact.ts` removes credentials from URLs, authorization headers, and environment values before an entry is stored, so expanded output cannot leak them.
- Clearing is session-only and has no git side effect.
- Entries never clear on failure; the history is append-only within the session until the user clears it.

## 12. Acceptance mapping

- "Every app-triggered git command is visible, with outcome" -> `src/app/hooks/useCommandRunner.ts` appends the redacted formatted result through `useConsoleLog.ts`; `commands.runner.ts` returns the raw result; `ConsoleEntryRow.tsx` renders each entry, including cancelled and timed-out outcomes.
- "A failed remote operation shows the decisive stderr line" -> `console.format.ts` selects the decisive stderr line and `ConsoleOutput.tsx` expands stderr by default for failures.
- "Console scrolling does not interfere with repository navigation" -> `nav.*` resolves only when the `console` region is focused; the drawer is non-modal and registers no global action.
- "No credentials appear in the console" -> `src/domain/git/git.redact.ts` before display.
- "Each entry shows timestamp, operation label, command and arguments, working directory only when different from the root, exit status, duration, and progress phase" -> `ConsoleEntryRow.tsx` plus `console.format.ts`; cancelled and timed-out results show a cancelled marker instead of a success summary.
- "Expandable stdout and stderr capped with first and last preserved and an omitted-lines marker" -> `ConsoleOutput.tsx` plus `console.buffer.ts`, with expansion state in `ConsoleProvider`.
- "Read operations are logged when user-visible or failing, and may be grouped to avoid noise" -> grouping in `console.format.ts`.
- "The console follows new entries while scrolled to the bottom; scrolling up pauses follow and shows a new-entries indicator" -> `ConsoleProvider.followMode` and `newEntryCount`, fed by `useConsole.ts` scroll reporting and rendered by `ConsoleDrawer.tsx`.
- "The console keeps a bounded session history, at least 200 entries" -> `console.buffer.ts` behind `ConsoleProvider`.
- "Errors in the app link to the corresponding console entry" -> an "Open console entry" action that opens the drawer and selects the entry id from the error overlay.
- "The console can remain open while the user works in other regions" -> non-modal region handling in `ConsoleDrawer.tsx`; `app.console` stays global while open.
- "`9` opens and focuses the console from any region without toggling a drawer that is already open" -> `focus.region.console` handler in `useFocusModel.ts` plus `ConsoleProvider.open()`. No digit fires while a text input or overlay owns keys.
- "`Ctrl/Cmd+`` toggles the console" -> the global `app.console` handler, not a console-registered action.

## 13. Tests to add

Colocated per architecture section 5:
- `console.buffer.test.ts`: bound trimming at the 200-entry minimum, first/last output preservation, omitted count, and the new-entries counter.
- `console.format.test.ts`: entry formatting; cwd shown only when it differs from the repository root; omitted-lines marker; decisive stderr line selection; a cancelled result and a timed-out result each format as their own outcome with a marker and never as success.
- `src/app/providers/ConsoleProvider.test.tsx`: append updates the buffer, increments `newEntryCount` when not following, and does not increment while following; scroll reporting calls `setFollowing`; expansion toggles `expandedEntryIds`; trimmed entries drop their expanded ids; the provider is the only writer of these values.
- `ConsoleOutput.test.tsx`: expansion and collapse; marker placement; redaction already applied before render.
- `useConsole.test.ts`: scrolling up reports `setFollowing(false)` and shows the new-entries indicator; scrolling to the bottom reports `setFollowing(true)`; clear requests confirmation; `useConsole` holds no follow or expansion copy.
- `src/app/hooks/useCommandRunner.test.tsx`: every result produces exactly one console entry, redaction runs before the append, a blocked result produces none, and a cancelled or timed-out result produces exactly one non-success entry.
- `ConsoleDrawer.test.tsx`: `overlay.close` closes the open drawer from any focused region; `app.console` toggles it from any region and stays global while open; focus can leave with `focus.next` while the drawer stays open; `focus.region.console` opens a closed drawer, focuses it, and leaves an already focused console unchanged.
- Handler registration test: the console registers `console.clear` and its `nav.*` handlers with `scope: "console"` and registers no `app.*` or `focus.*` action.

## 14. Open questions

- Whether grouped routine refreshes render as a single entry with a count badge or as one entry with a collapsed count.
- The exact heuristic for the decisive stderr line in `console.format.ts` when git prints multiple lines.
- Whether stdout for successful reads should stay collapsed by default or respect a "last expanded" preference.
- Whether the new-entries indicator should also appear when the drawer is closed but new entries arrive.
- Whether a cancelled or timed-out entry should auto-expand its output, since cancellation often leaves partial stderr worth seeing. The current plan keeps it collapsed and relies on the marker plus the warning status.
