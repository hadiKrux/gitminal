# 14 Help

## 1. Header

Status: Draft for review
Spec reference: `docs/product-spec.md` F-14 Help (lines 973-995); F-19 help and discovery (lines 1254-1265); action IDs section 6.1 (lines 1583-1611); key precedence section 3 (lines 109-119)
Dependencies: F-19 configuration and keybindings, F-20 theme and colors, F-01 app shell and focus, F-15 overlays and confirmations (modal frame and focus trap)
Owned paths:
- `src/features/help/HelpModal.tsx`
- `src/features/help/HelpSection.tsx`
- `src/features/help/HelpRow.tsx`
- `src/features/help/HelpConfiguration.tsx`
- `src/features/help/useHelp.ts`

Consumed paths (not owned):
- `src/domain/keymap/keymap.describe.ts`
- `src/domain/keymap/keymap.resolve.ts`
- `src/domain/keymap/keymap.types.ts`
- `src/domain/config/config.paths.ts`
- `src/domain/config/config.loader.ts`
- `src/domain/config/config.validate.ts`
- `src/domain/config/config.types.ts`
- `src/domain/theme/theme.resolve.ts`
- `src/domain/theme/theme.types.ts`
- `src/app/providers/ConfigProvider.tsx`, `ThemeProvider.tsx`, `KeymapProvider.tsx`, `FocusProvider.tsx`, `OverlayProvider.tsx`
- `src/app/hooks/useDebouncedValue.ts`, `src/app/hooks/useAction.ts`
- `src/ui/ModalFrame.tsx`, `src/ui/Overlay.tsx`, `src/ui/SearchField.tsx`, `src/ui/KeyHint.tsx`

## 2. Scope and non-goals

In scope:
- The help modal opened with the configured help key (action `app.help`, default `?`) from anywhere outside a text input or a modal.
- A search field activated by its configured key (action `help.search`, default `/`).
- Sections for Global, Top bar, Sidebar panels, Commit graph, Commit composer, Commit details, Diffs, Console, Modals, and Configuration.
- Each row showing the action, its effective keys after configuration overrides, and a one-line description.
- The section for the current focus shown first.
- Case-insensitive search across actions, keys, and descriptions (and action IDs).
- Up and Down, or `j` and `k`, navigating results.
- `Esc` clearing the search, then closing help on a second press.
- The help key closing help.
- Help being scrollable and never trapping the user.
- The Configuration section showing the resolved config path, the keybindings path or "not present", the theme path or "not present", load status, warnings, the active theme name, and the note that Reload configuration is available from the command palette.
- Unbound actions labeled "Unbound".

Non-goals:
- Help does not edit configuration, keybindings, or theme.
- Help does not watch configuration files for changes.
- Help does not document unimplemented actions.
- Help is not mouse-only; every action has a keyboard path.

## 3. OpenTUI components used

| Component | Where used | Why it is the right component |
| --- | --- | --- |
| `<box>` | Modal frame, section headers, row layout, configuration rows | Layout and borders for the modal and its grouped rows. |
| `<text>` | Section titles, action names, effective keys, one-line descriptions, configuration values | Every string in help. |
| `<span>` | Key hints inside a row, the Unbound marker, warning markers, the active theme marker | Inline styled runs inside `<text>`. |
| `<input>` | The help search field | Section 6 assigns `<input>` to the help search; single-line filter field. |
| `<scrollbox>` | The whole modal body, holding all sections and the row list | Help is scrollable; a scrollbox of `<box>` rows is the section 6 rule 3 choice when rows need custom content (key hints as spans) and section grouping. |
| `<markdown>` | Long documentation blocks and configuration notes | Section 6 assigns `<markdown>` to help documentation blocks and configuration notes. |
| `<select>` | Not used for the key list | Rows carry inline key hints and must group under section headers, so custom `<box>` rows in a scrollbox are used instead. A select may still back a flat "all actions" view if added later. |
| `<tab-select>` | Not used | Sections are vertical, not a horizontal selector. |

Hooks:
- `useKeyboard`: never called directly; `src/app/hooks/useHotkeys.ts` owns dispatch, and help registers handlers by action ID through `useAction`.
- `useDebouncedValue()`: debounces the search query before filtering.
- `useTerminalDimensions()`: visible row count and truncation budgets.
- `useRenderer()`: not used by help directly; overlay registration goes through `OverlayProvider`.

All icons and markers used by this feature come from `src/theme/icons.ts`; see architecture section 6.1. No glyph literal is written in feature code.

## 4. Component tree

```text
OverlayProvider (src/app/providers/OverlayProvider.tsx)
  HelpModal (src/features/help/HelpModal.tsx)
    ModalFrame (src/ui/ModalFrame.tsx)
      Overlay (src/ui/Overlay.tsx)                 // background deactivation
      box                                          // title row
        text "Help"
      box                                          // search row
        input                                      // search field (SearchField)
      scrollbox                                    // modal body, viewportCulling
        HelpSection (src/features/help/HelpSection.tsx)        // one per section, in order
          box
            text                                   // section title
          HelpRow (src/features/help/HelpRow.tsx)              // one per action
            box
              text                                 // action name
              span                                 // effective keys, or "Unbound"
              text                                 // one-line description
        HelpConfiguration (src/features/help/HelpConfiguration.tsx)   // the Configuration section
          box
            markdown                               // notes
            text                                   // resolved paths, status, theme, warnings
      box                                          // footer
        KeyHint (src/ui/KeyHint.tsx)               // / Search, Esc Clear/Close, Up/Down Navigate
```

`useHelp.ts` owns the query, the ordered section list, the current-focus-first rule, and the filtered row list.

## 5. Enforced files and folders

- `src/features/help/HelpModal.tsx` - the modal: title, search field, scrollable body, footer hints, and key handling.
- `src/features/help/HelpSection.tsx` - a titled section containing `HelpRow` children, including the Configuration section wrapper.
- `src/features/help/HelpRow.tsx` - one row: action name, effective keys or "Unbound", and a one-line description.
- `src/features/help/HelpConfiguration.tsx` - the Configuration section: resolved paths, load status, warnings, active theme, and the reload note.
- `src/features/help/useHelp.ts` - query state, section ordering, current-focus-first, filtering, and Esc search-then-close handling.
- Colocated tests: `useHelp.test.ts`, `HelpRow.test.tsx`, `HelpConfiguration.test.tsx`, `HelpModal.test.tsx`.

## 6. State model

Local view state (owned by `useHelp.ts` and `HelpModal.tsx`):
- `query: string` - current search text.
- `isSearchActive: boolean` - whether the search field has focus.
- `selectedRowIndex: number` - the row under the cursor.
- `expandedSections: Set<string>` - collapsed section ids (all expanded by default).
- `scrollOffset: number` - modal body scroll position.

Provider state (single source of truth):
- `ConfigProvider`: resolved config path, keybindings path, theme path, load status, and warnings.
- `ThemeProvider`: the active theme name.
- `KeymapProvider`: effective bindings after overrides, read through `keymap.describe.ts`.
- `FocusProvider`: the current region id, used to order the current focus section first.
- `OverlayProvider`: the help modal is a stack entry.

Rule: help never copies configuration or keybindings. It reads them through the providers and the domain describe and path modules on each open.

## 7. Data flow

```text
app.help -> useAction -> OverlayProvider.open("help") -> HelpModal
HelpModal -> useHelp
  -> keymap.describe.ts          // rows: action, context, effective keys, description
  -> keymap.resolve.ts           // effective bindings after config and keybindings overrides
  -> config.paths.ts             // resolved config, keybindings, theme paths
  -> config.loader.ts            // load status
  -> config.validate.ts          // warnings
  -> theme.resolve.ts            // active theme name
  -> FocusProvider.activeRegion  // current focus section first
help.search -> focus the search input -> useHelp filters rows case-insensitively
```

Named modules:
- `src/domain/keymap/keymap.describe.ts` - the action, context, effective keys, and one-line description per row.
- `src/domain/keymap/keymap.resolve.ts` - the effective binding map after configuration overrides and context overrides.
- `src/domain/keymap/keymap.types.ts` - key and action types.
- `src/domain/config/config.paths.ts` - resolved config, keybindings, and theme paths, and whether each is present.
- `src/domain/config/config.loader.ts` - load status per file.
- `src/domain/config/config.validate.ts` - warnings surfaced in the Configuration section.
- `src/domain/config/config.types.ts` - config and warning types.
- `src/domain/theme/theme.resolve.ts` and `src/domain/theme/theme.types.ts` - the active theme name.
- `src/app/hooks/useDebouncedValue.ts` - debounce before filtering.
- `src/app/providers/OverlayProvider.tsx` - open and close the help modal.

## 8. Keyboard and focus

Action IDs only; never raw key strings:
- `app.help` (default `?`) - opens help; when help is open, closes it.
- `overlay.close` (default `Esc`) - clears the search if it is non-empty; on a second press, closes help.
- `help.search` (default `/`) - focuses the search field.
- `nav.up`, `nav.down` - move the row cursor (defaults also bind `j`/`k`).
- `nav.pageUp`, `nav.pageDown` - page the row list.
- `nav.first`, `nav.last` - jump to the first and last row.
- `focus.next`, `focus.previous` (`Tab`/`Shift+Tab`) - move between the search field and the row list.

Focus:
- On open, focus goes to the row list; `help.search` moves focus to the search field.
- While help is open, `OverlayProvider` gives help full key ownership per key precedence rule 1; background regions are inactive through `ui/Overlay.tsx`.
- The footer shows the help keys while it is open.
- Help is a modal and is not a focus region; it never enters the shell Tab order.
- `Esc` always works, so help never traps the user.

## 9. Loading, empty, error, and disabled states

- Loading: if configuration or keymap is not yet resolved, the Configuration section shows a "Loading configuration" row with the marker `[ ]`; the key list still renders from defaults.
- Empty: when the search matches nothing, a single row shows the marker `[?]` and "No actions match" with the query echoed.
- Error: configuration warnings render in the Configuration section with the marker `[!]` and never block the rest of help; a missing keybindings or theme file is shown as "not present" without a warning, since missing files are normal and silent.
- Disabled or unbound: an action with an empty binding list renders the keys cell as "Unbound" and is still listed and searchable.
- No blocking modal on error: help is read-only, so no confirmation or retry state exists.

## 10. Performance and bounds

- Help virtualization: the modal body is a `<scrollbox>` with `viewportCulling`, so only visible sections and rows render.
- Search filtering is debounced through `useDebouncedValue()` and runs over the in-memory keymap, which is a small fixed set.
- Rows are keyed by action ID so filtering preserves the cursor where possible.
- Long documentation blocks use `<markdown>` and appear only in the Configuration section, not per row, to keep row rendering cheap.
- Truncation of action names and descriptions uses `src/lib/text.ts` budgets from `useTerminalDimensions()`; the effective keys cell is never truncated away.

## 11. Safety and confirmations

- Help is read-only and has no destructive action, so no confirmation is required.
- `Esc` always clears the search first and then closes, so the user can always leave.
- The Configuration section lists paths and warnings but never writes to any file; editing stays in F-19 and F-20.
- The active theme name and any config warning are shown as text, not color alone.

## 12. Acceptance mapping

- "Every implemented keyboard action appears in help with its effective binding" -> `src/domain/keymap/keymap.describe.ts` enumerates all action IDs from section 6.1 and their effective keys.
- "The help reflects context overrides and configuration overrides, for example the configured Stashes key shows Pop stash" -> `src/domain/keymap/keymap.resolve.ts` applies context and configuration overrides, and `HelpRow.tsx` renders the resolved keys.
- "A user can find any action by searching part of its name, key, or action ID" -> the filter in `useHelp.ts` matches action name, effective keys, description, and action ID.
- "The Configuration section lists the resolved file paths and any warning without blocking the rest of help" -> `HelpConfiguration.tsx` with `config.paths.ts`, `config.loader.ts`, and `config.validate.ts`.
- "Sections for Global, Top bar, Sidebar panels, Commit graph, Commit composer, Commit details, Diffs, Console, Modals, and Configuration" -> the ordered section list in `useHelp.ts`; `HelpSection.tsx` renders each.
- "The section for the current focus is shown first" -> `FocusProvider.activeRegion` reorders the section list in `useHelp.ts`.
- "Each row shows the action, its effective keys after configuration overrides, and a one-line description" -> `HelpRow.tsx`.
- "`Esc` clears the search, then closes help on a second press" -> `overlay.close` handling in `useHelp.ts`.
- "`?` closes help" and "Help is scrollable and never traps the user" -> `app.help` toggle and the scrollbox body.
- "Unbound actions are labeled Unbound" -> `HelpRow.tsx`.
- "The Configuration section shows resolved config, keybindings, and theme paths, load status, active theme, and warnings" -> `HelpConfiguration.tsx`.
- "A note that Reload configuration is available from the command palette" -> a `<markdown>` note in `HelpConfiguration.tsx` naming `app.reloadConfig`.

## 13. Tests to add

Colocated per architecture section 5:
- `useHelp.test.ts`: search is case-insensitive and matches action name, effective keys, description, and action ID; the current focus section is first; `overlay.close` clears the search then closes on a second call.
- `HelpRow.test.tsx`: the effective keys cell reflects a configuration override; an unbound action renders "Unbound".
- `HelpConfiguration.test.tsx`: resolved config, keybindings, and theme paths; "not present" for a missing keybindings or theme file; warnings render with the `[!]` marker; the active theme name; the reload note.
- `HelpModal.test.tsx`: `help.search` focuses the search field; `app.help` closes help; the body scrolls; focus stays trapped inside the modal while it is open.

## 14. Open questions

- Section ordering when the current focus region has no dedicated section, for example the `right-pane` region which maps to both Commit composer and Commit details. Proposed: order by the focused pane's sub-mode.
- Whether the Modals section is generated from the overlay keymap or hand-listed from the modal keymap table in the spec.
- How `<markdown>` blocks and the row list coexist inside one scrollbox without layout jumps; may require the Configuration section to render markdown in a separate scrollbox.
- Whether a flat "all actions" `<select>` view is worth adding alongside the sectioned scrollbox.
