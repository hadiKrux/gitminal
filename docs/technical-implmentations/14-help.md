# 14 Help

## 1. Header

Spec reference: `docs/product-spec.md` F-14 Help (lines 1016-1040); F-19 help and discovery (lines 1300-1323); keyboard map (lines 1539-1704); action IDs section 6.1 (lines 1705-1742); key precedence section 3 (lines 109-119)
Dependencies: F-19 configuration and keybindings, F-20 theme and colors, F-01 app shell and focus, F-15 overlays and confirmations (modal frame and focus trap)
Owned paths:
- `src/features/help/HelpModal.tsx`
- `src/features/help/HelpSection.tsx`
- `src/features/help/HelpRow.tsx`
- `src/features/help/HelpConfiguration.tsx`
- `src/features/help/useHelp.ts`
- `src/app/hooks/useHelpAction.tsx`

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
- `src/app/hooks/useDebouncedValue.ts`, `src/app/hooks/useAction.ts`, `src/app/hooks/useCommandTargets.ts` (the shared command target derivation also used by the palette)
- `src/ui/ModalFrame.tsx`, `src/ui/Overlay.tsx`, `src/ui/SearchField.tsx`, `src/ui/KeyHint.tsx`

## 2. Scope and non-goals

In scope:
- The help modal opened with the configured help key (action `app.help`, default `?` or `F1`) from anywhere outside a text input or a modal.
- A search field activated by its configured key (action `help.search`, default `/`).
- Sections for Focus, Global, Top bar, Sidebar panels, Commit graph, Commit composer, Commit details, Diffs, Console, Modals, and Configuration.
- Each row showing the action, its effective keys after configuration overrides, a one-line description, and, when the action is currently unavailable, its availability reason.
- Every implemented action listed, including actions that are currently unavailable, unbound, or reported as disabled by availability.
- The section for the current focus shown first.
- Case-insensitive search across actions, keys, descriptions, and action IDs.
- Up and Down, or `j` and `k`, navigating results.
- `Esc` clearing the search, then closing help on a second press.
- The help key closing help, including the configured alternative key such as `F1`.
- Help being scrollable and never trapping the user.
- The Configuration section showing the resolved config path, the keybindings path or "not present", the theme path or "not present", load status, configuration and theme resolution warnings, the active theme name, and the note that Reload configuration is available from the command palette.
- Documenting the three input modes (`field`, `search`, and `form`), including that single-line forms submit with `Enter`, multiline forms submit with `form.submit` (`Ctrl/Cmd+Enter`), and `Tab` indents in a multiline field.
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
              text                                 // availability reason when currently unavailable
        HelpConfiguration (src/features/help/HelpConfiguration.tsx)   // the Configuration section
          box
            markdown                               // notes
            text                                   // resolved paths, status, theme, warnings
      box                                          // footer
        KeyHint (src/ui/KeyHint.tsx)               // / Search, Esc Clear/Close, Up/Down Navigate
```

`useHelp.ts` owns the query, cursor, collapse, search, and handler registration. It composes two pure sibling modules: `help.sections.ts` owns the section catalogue order, filtering, collapse set, and visible-row flattening, while `help.availability.ts` owns the availability join against `commands.availability.ts`. It consumes the unfiltered help rows from `keymap.describe.ts`; it never filters unavailable actions out.

## 5. Enforced files and folders

- `src/features/help/HelpModal.tsx` - the modal: title, search field, scrollable body, footer hints, and key handling.
- `src/features/help/HelpSection.tsx` - a titled section containing `HelpRow` children, including the Configuration section wrapper.
- `src/features/help/HelpRow.tsx` - one row: action name, effective keys or "Unbound", one-line description, and the availability reason when the action cannot run now.
- `src/features/help/HelpConfiguration.tsx` - the Configuration section: resolved paths, load status, warnings, active theme, the reload note, and the input-mode notes.
- `src/features/help/help.sections.ts` - the section catalogue order, focus-first rule, query filtering, collapse set, filtered match count, and visible-row flattening.
- `src/features/help/help.availability.ts` - the join from every catalogue action to the shared availability reason.
- `src/features/help/useHelp.ts` - query state, cursor, collapse, search, and overlay-scoped handler registration; it composes the two pure modules above.
- `src/features/help/*.constants.ts` and `*.types.ts` - the overlay and renderable ids, section catalogue, budgets, and the hook and row contracts.
- `src/app/hooks/useHelpAction.tsx` - the single global `app.help` owner that opens and toggles the overlay entry.
- Colocated tests: `useHelp.test.tsx`, `help.sections.test.ts`, `help.availability.test.ts`, `HelpRow.test.tsx`, `HelpConfiguration.test.tsx`, `HelpModal.test.tsx`, and `src/app/hooks/useHelpAction.test.tsx`.

## 6. State model

Local view state (owned by `useHelp.ts` and `HelpModal.tsx`):
- `query: string` - current search text.
- `isSearchActive: boolean` - whether the search field has focus.
- `selectedRowIndex: number` - the row under the cursor.
- `expandedSections: Set<string>` - collapsed section ids (all expanded by default).
- `scrollOffset: number` - modal body scroll position.
- `matchCount` - the number of rows that survived filtering, independent of collapse state, so collapsing every section still renders every header.

Provider state (single source of truth):
- `ConfigProvider`: resolved config path, keybindings path, theme path, load status, and warnings.
- `ThemeProvider`: the active theme name and its resolution warnings, which the Configuration section renders behind the `Theme:` prefix.
- `KeymapProvider`: effective bindings after overrides, read through `keymap.describe.ts`.
- `RepositoryProvider`: repository state and signals, read only through `commands.availability.ts` for the current reason; help never copies repository data.
- `FocusProvider`: the derived current region id, used to order the current focus section first.
- `OverlayProvider`: the help modal is a stack entry.

Rule: help never copies configuration or keybindings. It reads them through the providers and the domain describe, path, and availability modules on each open. Availability reasons are recomputed on open and whenever the repository state changes while help is visible, so a reason is never a stale snapshot from mount time.

## 7. Data flow

```text
app.help (? or F1) -> the single global useAction handler in AppShellHost -> OverlayProvider.open("help"), or close when help is already open -> HelpModal
HelpModal -> useHelp
  -> keymap.describe.ts          // describeHelpRows: unfiltered rows with action, context, effective keys, description
  -> commands.availability.ts    // current reason per action, joined into the row
  -> keymap.resolve.ts           // effective bindings after config and keybindings overrides
  -> config.paths.ts             // resolved config, keybindings, theme paths
  -> config.loader.ts            // load status
  -> config.validate.ts          // warnings
  -> theme.resolve.ts            // active theme name
  -> FocusProvider.activeRegion  // current focus section first
help.search -> focus the search input -> useHelp filters rows case-insensitively
```

Two describe outputs, one resolver: `keymap.describe.ts` exposes `describeFooterHints(keymap, context, options)` and `describeHelpRows()`. Footer hints drop actions that cannot run now; help rows keep every implemented action and attach the availability reason as data. The palette reads command metadata from the registry and effective keys from the same keymap resolver, not from either describe output. This keeps the footer, help, and palette agreeing on effective keys while differing only in filtering. Help evaluates availability with no form values, so a bulk diff action is shown from its section-independent availability and can read as available while the section it would act on is empty or unknown; the action is disabled at execution with the section reason. That is a discovery-surface caveat, not a second availability rule.

Help also documents the three input modes from architecture section 8: `field` (printable keys, editing keys, native Enter submit for single-line, newline for multiline), `search` (editing keys plus arrows, paging, and Enter routed to the result list), and `form` (Tab between fields and footer actions, `Ctrl/Cmd+Enter` mapped to `form.submit`, and Tab indent inside a multiline field). The help content states that `form.submit` is the multiline submit action and that single-line forms keep native `Enter`.

Named modules:
- `src/domain/keymap/keymap.describe.ts` - the two row projections: availability-filtered footer hints and unfiltered help rows with action, context, effective keys, and one-line description.
- `src/domain/keymap/keymap.resolve.ts` - the effective binding map after configuration overrides and context overrides.
- `src/domain/keymap/keymap.types.ts` - key and action types.
- `src/domain/commands/commands.availability.ts` - the current availability and reason per action, joined into help rows.
- `src/domain/config/config.paths.ts` - resolved config, keybindings, and theme paths, and whether each is present.
- `src/domain/config/config.loader.ts` - load status per file.
- `src/domain/config/config.validate.ts` - warnings surfaced in the Configuration section.
- `src/domain/config/config.warnings.ts` - `combineConfigurationWarnings`, which prefixes theme warnings and bounds the combined list the same way the top bar and console reporter does.
- `src/domain/config/config.types.ts` - config and warning types.
- `src/domain/theme/theme.resolve.ts` and `src/domain/theme/theme.types.ts` - the active theme name.
- `src/app/hooks/useDebouncedValue.ts` - debounce before filtering.
- `src/app/providers/OverlayProvider.tsx` - open and close the help modal.

## 8. Keyboard and focus

Action IDs only; never raw key strings:
- `app.help` (defaults `?` and `F1`) - opens help. When help is already open, the same action closes it; both default keys are alternative bindings for the one action.
- `overlay.close` (default `Esc`) - clears the search if it is non-empty; on a second press, closes help.
- `help.search` (default `/`) - focuses the search field.
- `nav.up`, `nav.down` - move the row cursor (defaults also bind `j`/`k`).
- `nav.pageUp`, `nav.pageDown` - page the row list.
- `nav.first`, `nav.last` - jump to the first and last row; in the `search` input mode Home and End route to these actions while the search field keeps focus.
- `focus.next`, `focus.previous` (`Tab`/`Shift+Tab`) - move between the search field and the row list.

Ownership:
- `app.help` is the help overlay's own toggle, registered once as a global action by `src/app/hooks/useHelpAction.tsx` in `AppShellHost`. It is the only global action besides `overlay.close` and `app.quit` that resolves while help owns keys.
- `app.console`, `app.palette`, `app.themePicker`, `app.reloadConfig`, `remote.*`, and every region action are unreachable while help is open.
- While the search has text, help registers a first-Esc clear for the search field and the modal frame through `useInputEscapeClear`, so the real Esc path clears and the next Esc closes.

Focus:
- On open, focus goes to the row list; `help.search` moves focus to the search field.
- While help is open, `OverlayProvider` gives help full key ownership per key precedence rule 1; background regions are inactive through `ui/Overlay.tsx`.
- The help search field uses the `search` input mode, so arrows, paging, and Enter still drive the row list while the query keeps focus.
- The footer shows the help keys while it is open.
- Help is a modal and is not a focus region; it never enters the shell Tab order.
- `Esc` always works, so help never traps the user.

## 9. Loading, empty, error, and disabled states

- Loading: none. The composition root loads `config.json`, `keybindings.json`, and `theme.json` before the first render, so the Configuration section always has resolved paths, load status, and the active theme on its first paint; there is no "Loading configuration" row and no `[ ]` marker, and the key list renders from the already-resolved keymap.
- Empty: when the search matches nothing, a single row shows the marker `[?]` and "No actions match" with the query echoed. The empty state is driven by the filtered match count, not the visible row count, so collapsing every section still renders every section header.
- Error: configuration warnings render in the Configuration section with the marker `[!]` and never block the rest of help; theme resolution warnings render in the same bounded list behind a `Theme:` prefix, and the combined count is the one the top bar and console report. A missing keybindings or theme file is shown as "not present" without a warning, since missing files are normal and silent.
- Disabled or unbound: an action with an empty binding list renders the keys cell as "Unbound" and is still listed and searchable.
- Unavailable action: the row stays visible with its effective keys, description, and the availability reason from `commands.availability.ts`, for example "detached HEAD", "no upstream", or "nothing to commit". It is never filtered out and never rendered as if it could run.
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

- "Every implemented keyboard action appears in help with its effective binding" -> `describeHelpRows()` in `src/domain/keymap/keymap.describe.ts` enumerates every implemented action ID from section 6.1 and their effective keys, without availability filtering.
- "Every implemented keyboard action appears in help whether or not it is currently available, and an unavailable action stays listed with its reason" -> every help row is joined with `commands.availability.ts`; `HelpRow.tsx` renders the reason. Only footer hints from `describeFooterHints()` drop unavailable actions.
- "The help reflects context overrides and configuration overrides, for example the configured Stashes key shows Pop stash" -> `src/domain/keymap/keymap.resolve.ts` applies context and configuration overrides, and `HelpRow.tsx` renders the resolved keys.
- "A user can find any action by searching part of its name, key, or action ID" -> the filter in `useHelp.ts` matches action name, effective keys, availability reason, description, and action ID.
- "The Configuration section lists the resolved file paths and any warning without blocking the rest of help" -> `HelpConfiguration.tsx` with `config.paths.ts`, `config.loader.ts`, `config.validate.ts`, and the combined configuration and theme warning list from `config.warnings.ts`.
- "Sections for Focus, Global, Top bar, Sidebar panels, Commit graph, Commit composer, Commit details, Diffs, Console, Modals, and Configuration" -> the ordered section list in `useHelp.ts`; `HelpSection.tsx` renders each. The Focus section lists `focus.next`, `focus.previous`, and every `focus.region.*` action with its effective key or "Unbound".
- "The section for the current focus is shown first" -> `FocusProvider.activeRegion` (derived from native focus) reorders the section list in `useHelp.ts`.
- "Each row shows the action, its effective keys after configuration overrides, and a one-line description" -> `HelpRow.tsx`; the Modals section also lists `form.submit`, and `HelpConfiguration.tsx` carries the input-mode notes.
- "`Esc` clears the search, then closes help on a second press" -> `overlay.close` handling in `useHelp.ts`.
- "`?` closes help" and "Help is scrollable and never traps the user" -> `app.help` toggle, including the `F1` alternative binding, plus the scrollbox body.
- "Unbound actions are labeled Unbound" -> `HelpRow.tsx`.
- "The Configuration section shows resolved config, keybindings, and theme paths, load status, active theme, and warnings" -> `HelpConfiguration.tsx`.
- "A note that Reload configuration is available from the command palette" -> a `<markdown>` note in `HelpConfiguration.tsx` naming `app.reloadConfig`.

## 13. Tests to add

Colocated per architecture section 5:
- `useHelp.test.tsx`: search is case-insensitive and matches action name, effective keys, availability reason, description, and action ID; the current focus section is first; the Focus section lists all ten `focus.region.*` rows with their effective keys and shows `focus.region.topBar` as "Unbound"; unavailable actions are present with their reason and are not filtered out; `overlay.close` clears the search then closes on a second call; `app.help` closes help while open and the `F1` alternative does the same.
- `HelpRow.test.tsx`: the effective keys cell reflects a configuration override; an unbound action renders "Unbound"; an unavailable action renders its exact availability reason and keeps its keys.
- `HelpConfiguration.test.tsx`: resolved config, keybindings, and theme paths; "not present" for a missing keybindings or theme file; configuration warnings render with the `[!]` marker; theme resolution warnings render with the `Theme:` prefix and count toward the bounded warning count; the active theme name; the reload note; the input-mode notes including `form.submit` for multiline forms.
- `HelpModal.test.tsx`: `help.search` focuses the search field; `app.help` closes help; no other global action resolves while help is open; the body scrolls; focus stays trapped inside the modal while it is open.
- `keymap.describe.test.ts`: `describeHelpRows()` returns every implemented action regardless of availability, while `describeFooterHints()` drops unavailable actions and still agrees with help on effective keys.
- `src/app/hooks/useHelpAction.test.tsx`: `app.help` opens the toggleable overlay entry, `?` and `F1` both resolve to the same toggle, and the palette and help agree on one action's effective keys and availability reason.

## 14. Open questions

- Section ordering when the current focus region has no dedicated section, for example the `right-pane` region which maps to both Commit composer and Commit details. Proposed: order by the focused pane's sub-mode.
- Whether the Modals section is generated from the overlay keymap or hand-listed from the modal keymap table in the spec.
- How `<markdown>` blocks and the row list coexist inside one scrollbox without layout jumps; may require the Configuration section to render markdown in a separate scrollbox.
- Whether a flat "all actions" `<select>` view is worth adding alongside the sectioned scrollbox.
- Whether the availability reason should refresh live while help is open or only on open. Proposal: refresh on open and on repository state change, so a stale reason never contradicts the palette.
- Whether input-mode documentation belongs in the Modals section or a dedicated Input section. The current plan puts a short note in the Configuration section and a row for `form.submit` in Modals.
