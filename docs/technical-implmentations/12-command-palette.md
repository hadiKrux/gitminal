# 12 Command Palette

## 1. Header

Status: Draft for review
Spec reference: `docs/product-spec.md` F-12 Command palette (lines 954-979); keyboard map (lines 1539-1704); action IDs section 6.1 (lines 1705-1742); key precedence section 3 (lines 109-119)
Dependencies: F-01 app shell and focus, F-15 overlays and confirmations, F-19 configuration and keybindings, F-16 repository states, F-13 console (dispatch logging)
Owned paths:
- `src/features/palette/CommandPalette.tsx`
- `src/features/palette/CommandRow.tsx`
- `src/features/palette/useCommandPalette.ts`

Consumed paths (not owned):
- `src/domain/commands/commands.registry.ts`
- `src/domain/commands/commands.types.ts`
- `src/domain/commands/commands.availability.ts`
- `src/domain/commands/commands.runner.ts`
- `src/app/hooks/useCommandRunner.ts`
- `src/domain/keymap/keymap.resolve.ts`
- `src/app/hooks/useAction.ts`
- `src/app/providers/OverlayProvider.tsx`
- `src/ui/ModalFrame.tsx`, `src/ui/Overlay.tsx`, `src/ui/KeyHint.tsx`

## 2. Scope and non-goals

In scope:
- Opening the palette with `Ctrl/Cmd+P` from anywhere outside a modal.
- A centered modal with a search field and a scrollable result list.
- Filtering commands by label, description, keywords, and effective shortcut, case-insensitively.
- An empty query showing recent session commands first (max five), then all commands grouped by category.
- Up and Down, or `j` and `k`, moving the selection; `Enter` running the selected command; `Esc` closing without running anything; re-pressing the palette shortcut closing it.
- Disabled commands remaining visible and dimmed with a reason from `src/domain/commands/commands.availability.ts`.
- Selecting a disabled command doing nothing except keeping the palette open.
- Commands that need input closing the palette and opening the relevant modal.
- The palette containing every palette-invocable command: commit search, theme picker, remote operations, commit variants, staging actions, branch creation, tag creation, stash creation, console, help, refresh, Reload configuration, and quit.
- Palette entries carrying an explicit `{ commandId, target }`, captured at open time from provider and selector projections, so dispatch never reads a hidden panel's ambient cursor.

Non-goals:
- The palette does not implement command behavior; it dispatches `{ commandId, target }` through the owning scope handler. Mutating commands reach `useCommandRunner`; read commands such as `app.refresh` refresh through their handler.
- `nav.*` actions are never palette entries. They are key-only intents that move a cursor, and the palette lists commands, not keystrokes. `focus.region.*` actions are palette-invocable navigation commands, because they are the discovery surface for direct region access; they are not footer hints.
- Recent commands are session-only and capped at five; they are not persisted to disk.
- The palette does not define keys; it reads effective keys from the keymap.
- No fuzzy ranking beyond the substring and keyword rules in F-12 (advanced ranking is deferred).
- No palette-level theming or layout configuration.

## 3. OpenTUI components used

| Component | Where used | Why it is the right component |
| --- | --- | --- |
| `<box>` | Modal container, search row, category header rows, footer hint strip | Layout, borders, and focus rings; the palette is a centered overlay built from boxes. |
| `<text>` | Category headers, labels, footer hint text, empty state text | Every string in the palette. |
| `<span>` | Match emphasis inside a label, dim marker for disabled commands | Inline styled runs inside `<text>`. |
| `<input>` | The search field at the top of the palette | Section 6 assigns `<input>` to the palette search; single-line filter field. |
| `<select>` | The result list | Section 6 rule 8 mandates `<select>` for palette results; each option carries `name`, `description`, and a value identifying the `PaletteOption`, and the `description` carries the disabled reason. The select provides built-in up/down navigation, Enter activation, and internal scrolling. |
| `<scrollbox>` | Not used for the result list | `<select>` already scrolls its own viewport; a wrapping scrollbox would double-scroll. |
| `<markdown>` | Not used in this feature | - |

Hooks:
- `useKeyboard`: never called directly; `src/app/hooks/useHotkeys.ts` owns the single dispatcher, and the palette registers handlers by action ID through `src/app/hooks/useAction.ts`.
- `useTerminalDimensions()`: computes the visible option count and truncation budgets.
- `useFocus` / `useBlur`: refresh command availability when the terminal window regains focus. This is not region focus.
- `useRenderer()`: not used by the palette directly; overlay registration goes through `OverlayProvider`.

All icons and markers used by this feature come from `src/theme/icons.ts`; see architecture section 6.1. No glyph literal is written in feature code.

## 4. Component tree

```text
OverlayProvider (src/app/providers/OverlayProvider.tsx)
  CommandPalette (src/features/palette/CommandPalette.tsx)
    ModalFrame (src/ui/ModalFrame.tsx)
      Overlay (src/ui/Overlay.tsx)                 // full-size dim layer, background deactivation
      box                                          // title row
        text "Command palette"
      box                                          // search row
        input                                      // search field
      box                                          // results
        text                                       // category header row (one per group)
        select                                     // result list, options built by CommandRow
      box                                          // footer
        KeyHint (src/ui/KeyHint.tsx)               // Enter Run, Esc Close, Tab Next field
```

`useCommandPalette.ts` owns the query, filtering, recents, the captured option list, availability join, and dispatch. `CommandRow.tsx` owns the projection from a command descriptor plus the captured target and availability into a `<select>` option (`name`, `description`, `value`). Because section 6 mandates `<select>`, the visual rows are the select's own rendering; `CommandRow` is a pure projection helper rather than a visual row component.

## 5. Enforced files and folders

- `src/features/palette/CommandPalette.tsx` - the palette modal component, composing `ModalFrame`, the search `input`, and the result `select`.
- `src/features/palette/CommandRow.tsx` - projection from command descriptor, captured target, and availability to a `SelectOption`, including category prefix and disabled reason.
- `src/features/palette/useCommandPalette.ts` - query state, filtering, recent list, option capture at open, availability join, Enter revalidation, and dispatch by `{ commandId, target }`.
- `src/features/palette/CommandRow.test.tsx` - colocated tests for the projection.
- `src/features/palette/useCommandPalette.test.ts` - colocated tests for filtering and recents.
- `src/features/palette/CommandPalette.test.tsx` - colocated component tests.

## 6. State model

Local view state (owned by `useCommandPalette.ts` and `CommandPalette.tsx`):
- `query: string` - current search text.
- `highlightedIndex: number` - selected option index in the select.
- `isOpen: boolean` - palette open state, mirrored into the overlay stack.
- `options: PaletteOption[]` - the captured list, where `PaletteOption` is `{ commandId: string; target: CommandTarget; availability: CommandAvailability }`. The list is captured once when the palette opens from the registry descriptors plus the owning provider selectors, and it is not re-derived from a hidden surface while the palette is open.
- `recentCommandIds: string[]` - session-only recents, capped at five, deduplicated by command ID.

Provider state (single source of truth):
- `OverlayProvider`: the palette is a stack entry; open and close go through `src/app/hooks/useOverlay.ts`.
- `RepositoryProvider`: repository snapshot, the right-pane selection union, and the row data that target selectors read when the palette opens; the palette never copies it.
- `FocusProvider`: per-region cursor projection used to derive row targets at open time.
- `KeymapProvider`: effective keys, read through `keymap.resolve.ts` for the shortcut column and for shortcut matching.
- `ConfigProvider`: indirect, through availability and command metadata.
- `StatusProvider`: shows the transient status after a command runs.
- `ConsoleProvider`: the app-layer orchestrator appends a console entry after dispatch.

Rule: the palette holds no repository, availability, or keybinding copies. It re-reads the registry and keymap on each open, captures each option's target once, and revalidates availability with fresh state only when Enter is pressed.

## 7. Data flow

```text
Ctrl/Cmd+P -> action ID app.palette -> the single global useAction handler in AppShellHost
  -> OverlayProvider.open("palette"), or close when the palette is already open
  -> CommandPalette captures options once from commands.registry.ts
       for each descriptor with paletteInvocable: true
       -> target selector for targetKind (RepositoryProvider selection or FocusProvider cursor)
       -> commands.availability.ts joined with keymap.resolve.ts for the reason and shortcut
  -> option value is { commandId, target }; the option description is the disabled reason
Enter on an option -> useCommandPalette revalidates with fresh context
  -> unavailable, or target missing or stale -> close, reveal and focus the owning region,
       show the availability reason; never dispatch to a hidden surface
  -> available and target still valid -> dispatch { commandId, target } to the owning scope handler
       -> mutating command: useCommandRunner.runCommand(request)
            -> commands.runner.ts (availability + serialization) -> domain command -> git client
            -> CommandResult -> useCommandRunner applies RepositoryProvider refresh, console entry, status, and error routing
       -> read or navigation command: the owning handler runs it directly
  -> needsInput: close the palette and open the owning modal with the resolved target
  -> palette closes; the owning surface re-renders
```

The registry descriptor is the palette's only command source:

```ts
type CommandDescriptor = {
  id: string
  actionId?: string
  kind: "mutation" | "read" | "navigation"
  scope: "global" | RegionId | "overlay"
  targetKind: CommandTarget["kind"]
  label: string
  description: string
  keywords: readonly string[]
  category: string
  paletteInvocable: boolean
  needsInput: boolean
}
```

`paletteInvocable` is false for every `nav.*` action and for internal selection commands that are not user-facing. `focus.region.*` descriptors are `paletteInvocable: true` and appear under the Focus category. Entries whose `targetKind` is not `none` resolve their target through a provider selector at open time; a missing or stale target disables the entry with a reason rather than silently falling back to an ambient cursor.

Named modules:
- `src/domain/commands/commands.registry.ts` - the full command catalogue of `CommandDescriptor` entries, including label, description, keywords, category, `kind`, `scope`, `targetKind`, `paletteInvocable`, and `needsInput`.
- `src/domain/commands/commands.types.ts` - command descriptor, target, request, progress, and result types.
- `src/domain/commands/commands.availability.ts` - machine-readable availability and reason per command, with target-aware validation.
- `src/domain/commands/commands.runner.ts` - the pure executor: availability check, serialization, and execution; returns a `CommandResult`. It never touches a provider.
- `src/app/hooks/useCommandRunner.ts` - the app-layer orchestrator: the only caller of the runner; applies refresh, console, status, and error effects.
- `src/domain/keymap/keymap.resolve.ts` - effective key list per action for the shortcut column and matching.
- `src/app/hooks/useAction.ts` - registers handlers by action ID, scope, and target kind.
- `src/app/providers/OverlayProvider.tsx` - opens and closes the palette and any follow-on modal.
- `src/domain/repository/repository.selectors.ts` - target projections for commit, pending, diff file, and right-pane selection targets.

## 8. Keyboard and focus

Action IDs only; never raw key strings:
- `app.palette` - opens the palette when no overlay is open; when the palette is already open, pressing it again closes it. Its defaults are `Ctrl/Cmd+P` and the alternate `F2`, both for the same action ID. It is the palette's own toggle and the only global toggle that resolves while the palette owns keys.
- `overlay.close` (default `Esc`) - closes the palette without running anything.
- `nav.up`, `nav.down` - move the selection (defaults also bind `j`/`k`). These are key-only navigation actions; they are not palette entries.
- `nav.pageUp`, `nav.pageDown` - page the option list.
- `nav.activate` (default `Enter`) - runs the highlighted command after revalidation.
- `focus.next`, `focus.previous` (default `Tab`/`Shift+Tab`) - move between the search field and the result list.
- `app.help`, `app.console`, `remote.*`, `app.themePicker`, and `app.reloadConfig` - do not resolve while the palette owns keys. Only `app.palette`, `overlay.close`, and the hardcoded quit escape hatch are reachable.

Focus:
- On open, focus goes to the search `<input>`. `OverlayProvider` captures the renderable that had focus before the palette opened.
- While the palette is open, `OverlayProvider` gives the palette full key ownership per key precedence rule 1; background regions are inactive through `ui/Overlay.tsx`, and native focus is inside the palette.
- The footer shows the palette keys while it is open.
- The search field owns text-input mode: printable keys edit the query, OpenTUI editing keys pass through, and `Esc` closes the palette. The palette uses a `search` input mode so `nav.up`, `nav.down`, `nav.pageUp`, `nav.pageDown`, and `nav.activate` route to the result list while the search input keeps focus. `app.palette` is in the text-input-safe allowlist, so pressing it again toggles the palette closed.
- The palette is a modal and is not a focus region; it never appears in the Tab order of the shell. On close, focus returns to the captured renderable if it is still mounted, otherwise to its region frame.

## 9. Loading, empty, error, and disabled states

- Empty query: shows the recent block (max five) then all palette-invocable commands grouped by category, with a category header `<text>` row before each group and the category encoded as a prefix in the option name. `nav.*` never appears as an entry; `focus.region.*` appears under the Focus category with its effective digit or "Unbound".
- No matches: an empty state row with the marker `[?] No matching commands` and the query echoed.
- Disabled command: rendered dim with the reason as the option `description`, using the exact reason strings from `commands.availability.ts`, for example "nothing to commit", "message required", "no changes to stage", "no other branches", "no remote", and "detached HEAD". Selecting it does nothing and keeps the palette open.
- Stale or missing target: the option is disabled at capture time with the reason such as "selection changed" or "no longer available". If the target disappears after the palette opens, Enter closes the palette, reveals and focuses the owning region, and shows the same reason instead of dispatching.
- Hidden owning surface: when the owning region is hidden by the collapsed layout, Enter closes the palette, reveals or focuses that region, and shows the availability reason; the command is never dispatched to an unmounted panel.
- Operation in progress: commands whose availability reports a running mutation show the reason "operation in progress" and are dimmed; the runner also serializes the write.
- Loading: the registry is in memory, so there is no palette-level loading state. If availability for a command is still resolving, its reason reads "checking" and the command is treated as disabled.
- Error: the palette has no error surface of its own; a failing command closes the palette and reports through `StatusProvider` and the error overlay.

## 10. Performance and bounds

- The result list is bounded: only the visible window of options is passed to `<select>`, and the select renders its own viewport.
- Filtering runs over the in-memory command registry, which is a small fixed set, on each keystroke; no git call is made while typing.
- Availability is captured once per open and revalidated with fresh context only on Enter, never per keystroke.
- The recent list is capped at five entries and deduplicated by command ID.
- Label and description truncation uses `src/lib/text.ts` budgets derived from `useTerminalDimensions()`.
- Shortcut matching reuses the effective key list from `keymap.resolve.ts` rather than parsing keys in the feature.

## 11. Safety and confirmations

- The palette never performs a destructive action directly. Destructive commands (for example `diff.discard`, `branch.delete`, `stash.delete`, `tag.delete`, `worktree.delete`) dispatch their own confirmation, which opens `ConfirmModal` through `OverlayProvider` after the palette closes.
- Commands that need input close the palette first, then open the relevant modal, so only one overlay is open at a time.
- A disabled command cannot be run, so a destructive command whose preconditions are unmet is blocked before any confirmation appears.
- Dispatch is target-explicit. The captured `{ commandId, target }` is revalidated on Enter; if the target is missing or stale, or the owning surface is hidden, the palette closes, reveals and focuses the owning region, and shows the reason. It never resolves a handler against a hidden panel's stale cursor.
- `app.quit` opened from the palette follows the same quit confirmation rules as the shell (operation running, unsent message, or open confirmation).

## 12. Acceptance mapping

- "The palette opens with `Ctrl/Cmd+P` and can be fully operated without a mouse" -> the single global `app.palette` handler in `AppShellHost.tsx`; keyboard-only operation through `nav.*` keys, `nav.activate`, and `overlay.close`; rendered by `CommandPalette.tsx`.
- "Filtering is case-insensitive and matches command keywords" -> filter in `useCommandPalette.ts` over the `commands.registry.ts` fields label, description, keywords, and shortcut.
- "Unavailable commands explain why" -> `commands.availability.ts` reason rendered as the option `description` by `CommandRow.tsx`, including missing or stale targets and hidden owning surfaces.
- "The palette and the footer agree on the active shortcut" -> both derive keys from the same resolved keymap (`keymap.resolve.ts`), and the footer is filtered by `keymap.describe.ts`.
- "The palette is a centered modal with a search field and a scrollable result list" -> `src/ui/ModalFrame.tsx` plus `<input>` plus `<select>`.
- "An empty query shows recently used commands first, then all commands grouped by category" -> recent block in `useCommandPalette.ts`; grouping by `category` from `commands.registry.ts`.
- "Disabled commands remain visible and dimmed with a reason" -> dim token plus `description`; disabled entries are never filtered out.
- "Selecting a disabled command does nothing except keep the palette open" -> Enter revalidation in `useCommandPalette.ts`.
- "Commands that need input close the palette and open the relevant modal" -> `needsInput` flag in `commands.registry.ts`, handled in `useCommandPalette.ts` through `OverlayProvider`.
- "The palette contains every user-facing action, including navigation, commit search, theme picker, remote operations, commit variants, staging actions, branch creation, tag creation, stash creation, console, help, refresh, Reload configuration, and quit" -> the registry enumerates every palette-invocable command, including all ten `focus.region.*` commands, and the availability matrix keeps each entry visible even when disabled. Key-only `nav.*` intents are documented in help, not listed as palette commands.
- "Recent commands are session-only and capped at five" -> `recentCommandIds` in `useCommandPalette.ts`.

## 13. Tests to add

Colocated per architecture section 5:
- `useCommandPalette.test.ts`: filtering is case-insensitive; matches label, description, keywords, and shortcut; the recent list is capped at five and deduplicated by command ID; disabled commands are retained in results; `nav.*` descriptors are never options but `focus.region.*` descriptors are; opening captures `{ commandId, target }` per option from provider selectors.
- `CommandRow.test.tsx`: the projection sets `name`, `description` (the reason when disabled), and a `value` carrying `{ commandId, target }`; a dim marker is set for disabled rows.
- `CommandPalette.test.tsx`: an empty query shows recents then category groups; selecting a disabled command keeps the palette open and dispatches nothing; a stale target closes the palette and focuses the owning region with the reason; a hidden owning surface is revealed rather than dispatched to; `overlay.close` closes without dispatch; `nav.activate` dispatches `{ commandId, target }`; a second `app.palette` toggles the palette closed; no other global action resolves while the palette owns keys.
- Availability agreement test: the option `description` for every disabled command equals the reason returned by `commands.availability.ts`. A table-driven case asserts each `targetKind` resolves its target from the documented selector and not from component state.

## 14. Open questions

- Section 6 mandates `<select>` for palette results, but section 4 also lists `CommandRow.tsx`. Resolution taken here: the result list is the select's own rendering, and `CommandRow.tsx` is the projection module that builds `SelectOption` objects. If a later OpenTUI version supports custom select rows, revisit.
- Category grouping headers: encoded as an option name prefix plus a preceding header `<text>` row. Confirm whether `<select>` can render non-selectable header rows; otherwise keep the prefix-only form.
- Where the session recent list lives: `OverlayProvider` versus a dedicated session store. Pending the ConsoleProvider pattern being finalized in F-13. The current plan keeps it in `useCommandPalette.ts` as session-only view state.
- The palette's `app.palette` binding toggles the palette closed while the search field is focused because `app.palette` is in the text-input-safe allowlist. Other configured bindings outside that allowlist do not fire while the search field owns text input.
- Whether a stale target should be re-resolved before closing, for example a diff file that moved to another section. Proposal: keep the captured target, revalidate identity, and close with the reason on mismatch rather than guessing a new target.
