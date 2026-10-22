# 13 Console

## 1. Header

Status: Draft for review
Spec reference: `docs/product-spec.md` F-13 Console (lines 937-971); action IDs section 6.1 (lines 1583-1611); console keymap (lines 1562-1571); key precedence section 3 (lines 109-119)
Dependencies: F-01 app shell and focus, F-15 overlays and confirmations (clear confirmation), F-18 safety and platform behavior (redaction), F-17 freshness and performance (routine refresh grouping), F-19 configuration and keybindings
Owned paths:
- `src/features/console/ConsoleDrawer.tsx`
- `src/features/console/ConsoleEntryRow.tsx`
- `src/features/console/ConsoleOutput.tsx`
- `src/features/console/useConsole.ts`
- `src/domain/console/console.types.ts`
- `src/domain/console/console.buffer.ts`
- `src/domain/console/console.format.ts`

Consumed paths (not owned):
- `src/app/providers/ConsoleProvider.tsx`
- `src/app/providers/StatusProvider.tsx`
- `src/app/providers/OverlayProvider.tsx`
- `src/app/hooks/useConsoleLog.ts`
- `src/app/hooks/useAction.ts`
- `src/domain/git/git.redact.ts`
- `src/domain/git/git.progress.ts`
- `src/domain/commands/commands.runner.ts`
- `src/features/shell/regions.ts` (the `console` region id)
- `src/ui/ModalFrame.tsx`, `src/ui/Overlay.tsx`, `src/ui/Spinner.tsx`, `src/ui/ProgressBar.tsx`, `src/ui/KeyHint.tsx`

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

Non-goals:
- The console does not execute commands; it observes entries produced by the command runner.
- No persistence across sessions.
- No editing, search, or filtering of entries in v1.
- No use of the renderer's built-in console for app logs (see section 3).

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
- `useFocus` / `useBlur`: optionally pause follow mode while the terminal is blurred.
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
- `src/features/console/useConsole.ts` - local view state (expanded entries, follow mode, selected entry) and the toggle handler for `app.console`.
- `src/domain/console/console.types.ts` - `ConsoleEntry`, `ConsoleStatus`, and phase types.
- `src/domain/console/console.buffer.ts` - bounded buffer, trimming, first/last preservation, omitted count, new-entries count.
- `src/domain/console/console.format.ts` - entry and output formatting, including the omitted-lines marker and the decisive stderr line.
- Colocated tests: `console.buffer.test.ts`, `console.format.test.ts`, `ConsoleOutput.test.tsx`, `useConsole.test.ts`, `ConsoleDrawer.test.tsx`.

## 6. State model

Local view state (owned by `useConsole.ts` and the components):
- `expandedEntryIds: Set<string>` - which entries show stdout or stderr.
- `selectedEntryId: string | null` - the entry under the cursor.
- `scrollOffset: number` - current position in the log viewport.
- `followMode: boolean` - derived from the scroll position (true at the bottom).

Provider state (single source of truth):
- `ConsoleProvider`: the bounded entry buffer, follow mode, and the new-entries count. Backed by `src/domain/console/console.buffer.ts`.
- `StatusProvider`: transient status, kept separate from the console history.
- `OverlayProvider`: hosts the clear confirmation.
- `RepositoryProvider`: not read by the console; entries are produced by the command runner.

Rule: entries are created by the runner and appended through `src/app/hooks/useConsoleLog.ts`. The console feature only reads and renders them; it never constructs git output itself.

## 7. Data flow

```text
command -> commands.runner.ts -> domain command -> git client -> result
  -> console.format.ts builds a ConsoleEntry
       (timestamp, operation label, argv, cwd, exit status, duration, phase, stdout, stderr)
  -> git.redact.ts redacts credentials in URLs, headers, and environment values
  -> ConsoleProvider.append -> console.buffer.ts trims to the bound
  -> ConsoleDrawer re-renders; follow mode scrolls to bottom, otherwise the new-entries count increments
```

Named modules:
- `src/domain/console/console.types.ts` - entry and status types.
- `src/domain/console/console.buffer.ts` - bounded ring with at least 200 entries, first/last output preservation, omitted-line counts, and the new-entries counter.
- `src/domain/console/console.format.ts` - builds entries and output blocks, the omitted-lines marker, and the decisive stderr line for failures.
- `src/domain/git/git.redact.ts` - redaction applied before any entry is stored.
- `src/domain/git/git.progress.ts` - progress phase for remote operations.
- `src/domain/commands/commands.runner.ts` - the append point for every command result.
- `src/app/hooks/useConsoleLog.ts` - the app hook the runner uses to append entries.

## 8. Keyboard and focus

Action IDs only; never raw key strings:
- `app.console` (default `Ctrl/Cmd+``) - toggles the drawer.
- `overlay.close` (default `Esc`) - closes the drawer.
- `nav.up`, `nav.down` - scroll (defaults also bind `j`/`k`).
- `nav.pageUp`, `nav.pageDown` - move by a screen.
- `nav.first` (default `g`) - jump to the oldest entry.
- `nav.last` (default `G`) - jump to the newest entry.
- `console.clear` (default `c`) - clears the console after confirmation.
- `focus.next`, `focus.previous` (`Tab`/`Shift+Tab`) - move focus to and from the console region.

Focus:
- The console is the `console` region defined in `src/features/shell/regions.ts`.
- It is non-modal: it can stay open while focus moves to another region with `Tab` or a click, and the region cursor persists when focus leaves and returns.
- Because no overlay owns keys while the drawer is open, `useHotkeys` resolves the console region context keys through precedence rule 3.
- When the drawer is closed, its keys are inert and repository navigation is unaffected.
- When an entry's output pane has focus, arrow keys scroll within that pane.

## 9. Loading, empty, error, and disabled states

- Empty: a single text row with the marker `[ ]` and the message "No commands yet"; `console.clear` is dimmed with the reason "console empty".
- Loading: an in-progress entry shows a `Spinner` and the current phase, and the footer shows progress through `StatusProvider`; there is no separate loading screen.
- Error entry: the exit status renders as the marker `x` plus "exit N", and the stderr pane is expanded by default for failures.
- Disabled: `console.clear` is dimmed with its reason when there are no entries; the clear action never fires while disabled.
- Success entry: the exit status renders as the marker `v` plus "exit 0" and a short summary, and stdout stays collapsed unless expanded.

## 10. Performance and bounds

- `console.buffer.ts` keeps a bounded history of at least 200 entries and drops the oldest beyond the bound while preserving the first and last output of the retained window.
- Each entry's stdout and stderr are capped: the first and last portion are kept and an omitted-lines marker such as "... N lines omitted ..." is inserted in the middle.
- The log viewport uses a `<scrollbox>` with `viewportCulling`, so only visible entries render.
- Routine refreshes are grouped into a single "Refresh" entry with a count rather than one entry per poll.
- Follow mode scrolls to the bottom on append only when following; otherwise it increments the new-entries count without moving the viewport.
- Truncation of command lines and cwd uses `src/lib/text.ts` budgets from `useTerminalDimensions()`; the operation label, exit status, and duration are never truncated away.

## 11. Safety and confirmations

- `console.clear` asks for confirmation through `ConfirmModal` (via `OverlayProvider`) with the label "Clear console" and states that the session history will be lost.
- `src/domain/git/git.redact.ts` removes credentials from URLs, authorization headers, and environment values before an entry is stored, so expanded output cannot leak them.
- Clearing is session-only and has no git side effect.
- Entries never clear on failure; the history is append-only within the session until the user clears it.

## 12. Acceptance mapping

- "Every app-triggered git command is visible, with outcome" -> `src/domain/commands/commands.runner.ts` appends through `useConsoleLog.ts`; `ConsoleEntryRow.tsx` renders each entry.
- "A failed remote operation shows the decisive stderr line" -> `console.format.ts` selects the decisive stderr line and `ConsoleOutput.tsx` expands stderr by default for failures.
- "Console scrolling does not interfere with repository navigation" -> `nav.*` resolves only when the `console` region is focused; the drawer is non-modal.
- "No credentials appear in the console" -> `src/domain/git/git.redact.ts` before display.
- "Each entry shows timestamp, operation label, command and arguments, working directory only when different from the root, exit status, duration, and progress phase" -> `ConsoleEntryRow.tsx` plus `console.format.ts`.
- "Expandable stdout and stderr capped with first and last preserved and an omitted-lines marker" -> `ConsoleOutput.tsx` plus `console.buffer.ts`.
- "Read operations are logged when user-visible or failing, and may be grouped to avoid noise" -> grouping in `console.format.ts`.
- "The console follows new entries while scrolled to the bottom; scrolling up pauses follow and shows a new-entries indicator" -> `useConsole.ts` plus `ConsoleDrawer.tsx`.
- "The console keeps a bounded session history, at least 200 entries" -> `console.buffer.ts`.
- "Errors in the app link to the corresponding console entry" -> an "Open console entry" action that opens the drawer and selects the entry id from the error overlay.
- "The console can remain open while the user works in other regions" -> non-modal region handling in `ConsoleDrawer.tsx`.

## 13. Tests to add

Colocated per architecture section 5:
- `console.buffer.test.ts`: bound trimming at the 200-entry minimum, first/last output preservation, omitted count, and the new-entries counter.
- `console.format.test.ts`: entry formatting; cwd shown only when it differs from the repository root; omitted-lines marker; decisive stderr line selection.
- `ConsoleOutput.test.tsx`: expansion and collapse; marker placement; redaction already applied before render.
- `useConsole.test.ts`: follow mode pauses when scrolling up; the new-entries indicator appears; clear requests confirmation.
- `ConsoleDrawer.test.tsx`: `overlay.close` closes the drawer; `app.console` toggles it; focus can leave with `focus.next` while the drawer stays open.

## 14. Open questions

- Where the console session buffer lives relative to `OverlayProvider` and `ConsoleProvider`; both are planned, but ownership of the new-entries counter needs to be pinned to one.
- Whether grouped routine refreshes render as a single entry with a count badge or as one entry with a collapsed count.
- The exact heuristic for the decisive stderr line in `console.format.ts` when git prints multiple lines.
- Whether stdout for successful reads should stay collapsed by default or respect a "last expanded" preference.
- Whether the new-entries indicator should also appear when the drawer is closed but new entries arrive.
