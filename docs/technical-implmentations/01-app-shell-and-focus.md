# 01 - App shell and focus

## 1. Header

Status: Draft for review.
Spec reference: `docs/product-spec.md` section 3 "Application shell" (lines 66-152), section 5 F-01 (lines 181-195), section 6 "Keyboard map" (lines 1442-1611), and section 6.1 "Action IDs" (lines 1583-1611).
Dependencies: F-02 `02-top-bar.md`, F-03 `03-branches-panel.md`, F-04 `04-remotes-panel.md`, F-05 `05-tags-panel.md`, F-06 `06-stashes-panel.md`, F-07 `07-worktrees-panel.md`, F-08 `08-commit-graph.md`, F-09 `09-commit-composer.md`, F-10 `10-commit-details.md`, F-11 `11-diffs-and-file-actions.md`, F-13 `13-console.md`, F-15 `15-overlays-and-confirmations.md`, F-16 `16-repository-states.md`, F-19 `19-configuration-and-keybindings.md`, F-20 `20-theme-and-colors.md`.
Owned paths: `src/features/shell/AppShell.tsx`, `src/features/shell/Sidebar.tsx`, `src/features/shell/MainArea.tsx`, `src/features/shell/Footer.tsx`, `src/features/shell/ResponsiveGate.tsx`, `src/features/shell/regions.ts`, `src/features/shell/focus.types.ts`, `src/features/shell/useFocusModel.ts`, `src/app/providers/FocusProvider.tsx`, `src/app/providers/KeymapProvider.tsx`, `src/app/providers/StatusProvider.tsx`, `src/app/hooks/useHotkeys.ts`, `src/app/hooks/useFocusRegion.ts`, `src/app/hooks/useAction.ts`, `src/app/hooks/useStatus.ts`.

This document follows the 14-section contract in `00-project-architecture.md` section 14 and conforms to the enforced structure in section 4, the component catalog in section 6, the focus model in section 8, and the state rules in section 9. Where this document and the architecture contract disagree, the architecture contract wins.

## 2. Scope and non-goals

In scope: the four-region shell frame; the region focus state machine; Tab and Shift+Tab traversal order; the focus border plus text marker; per-region cursor persistence; the responsive fallbacks at 100 columns, 90 columns, 80 columns, and 24 rows; the terminal-too-small notice using `ascii-font`; the contextual footer hint bar with priority-based dropping; mouse focus, mouse selection, wheel scrolling, and double click dispatch; quit confirmation gating; and the single centralized keyboard dispatcher in `useHotkeys`.
Non-goals: rendering the content of any panel, graph, composer, diff, or console (owned by F-03 through F-13); the overlay and modal stack plus destructive confirmations (F-15 `15-overlays-and-confirmations.md`); the keymap file format, defaults, and conflict detection (F-19 `19-configuration-and-keybindings.md`); theme token values and color capability (F-20 `20-theme-and-colors.md`); repository state detection and gating (F-16 `16-repository-states.md`); any git command execution.

## 3. OpenTUI components used

| Component | Where used | Why it is the right component |
| --- | --- | --- |
| `<box>` | AppShell root frame, Sidebar, MainArea, Footer, each region frame, the too-small notice container, and every mouse hit area. | The only layout, border, focus-ring, and hit-test primitive. Text is never rendered directly on a box. |
| `<text>` | Region titles, panel labels, footer hints, the transient status line, selection markers, and the too-small notice body. | Every string of UI text goes through `<text>`. |
| `<span>` | Inline runs inside `<text>`: the key part of a `KeyHint`, the sync badge text, and marker emphasis. | Inline styling without a layout block. |
| `<scrollbox>` | The body of every sidebar panel and the main-area scroll regions; wheel scroll, scrollbars, and `viewportCulling`. | Handles wheel scrolling, visible-on-overflow scrollbars, and viewport culling for long lists. |
| `<tab-select>` | The collapsed single-panel switcher in `Sidebar` when the sidebar falls back below 90 columns. | Native horizontal selector semantics for switching the single visible sidebar panel. |
| `<ascii-font>` | The terminal-too-small splash only. | Splash text is the one sanctioned use in architecture section 6. |
| `<select>` | Not owned here. The More menu lives in F-02. | N/A for this feature. |
| `<input>` | Not owned here. Filter fields live in the panels. | N/A for this feature. |
| `<diff>`, `<code>`, `<line-number>`, `<markdown>`, `<textarea>` | Not owned here. | N/A for this feature. |

OpenTUI hooks used:

| Hook | Where used | Note |
| --- | --- | --- |
| `useKeyboard` | Called exactly once, inside `src/app/hooks/useHotkeys.ts`. | Features never call `useKeyboard` directly. This is enforced by architecture section 6 and the boundary check in section 12. |
| `useOnResize` | `ResponsiveGate` and `AppShell` recompute the layout mode on terminal resize. | Resize is the trigger for fallback transitions. |
| `useTerminalDimensions` | Minimum-size checks, sidebar width budget, and hint fitting budgets. | Single source for columns and rows. |
| `useRenderer` | Bootstrap focus acquisition and terminal restore on quit. | Owned by `App.tsx` and the quit handler, not by feature components. |
| `useFocus` / `useBlur` | Refresh on terminal focus and pause timeline animation on blur. | Prevents background work while the terminal is unfocused. |
| `useTimeline` | `Spinner` and `ProgressBar` animation inside the `Footer` status area. | Animation only. |
| `usePaste`, `useSelectionHandler` | Not owned here. | `usePaste` belongs to F-09; `useSelectionHandler` belongs to F-13. |

All icons and markers used by this feature come from `src/theme/icons.ts`; see architecture section 6.1. No glyph literal is written in feature code.

## 4. Component tree

```text
src/index.tsx (bootstrap: createCliRenderer + createRoot)
-> src/app/App.tsx
   -> ConfigProvider
      -> ThemeProvider
         -> KeymapProvider
            -> RepositoryProvider
               -> FocusProvider
                  -> OverlayProvider
                     -> StatusProvider
                        -> ConsoleProvider
                           -> ResponsiveGate
                              -> AppShell                      (src/features/shell/AppShell.tsx)
                                 -> TopBar                     (src/features/top-bar/TopBar.tsx)
                                 -> Sidebar                    (src/features/shell/Sidebar.tsx)
                                    -> tab-select              (collapsed switcher, conditionally)
                                    -> BranchesPanel           (src/features/branches/BranchesPanel.tsx)
                                    -> RemotesPanel            (src/features/remotes/RemotesPanel.tsx)
                                    -> TagsPanel               (src/features/tags/TagsPanel.tsx)
                                    -> StashesPanel            (src/features/stashes/StashesPanel.tsx)
                                    -> WorktreesPanel          (src/features/worktrees/WorktreesPanel.tsx)
                                 -> MainArea                   (src/features/shell/MainArea.tsx)
                                    -> CommitGraph             (src/features/graph/CommitGraph.tsx)
                                    -> CommitComposer          (src/features/composer/CommitComposer.tsx)
                                    -> CommitDetails           (src/features/commit-details/CommitDetails.tsx)
                                    -> DiffPanel               (src/features/diff/DiffPanel.tsx)
                                 -> ConsoleDrawer              (src/features/console/ConsoleDrawer.tsx)
                                 -> Footer                     (src/features/shell/Footer.tsx)
                                 -> overlay hosts              (src/features/overlays/ConfirmModal.tsx, ErrorOverlay.tsx, NoticeOverlay.tsx)
```

`ResponsiveGate` renders either `AppShell` or the terminal-too-small notice. Providers always mount so quit, help, and console remain reachable.

## 5. Enforced files and folders

| File | Responsibility |
| --- | --- |
| `src/features/shell/AppShell.tsx` | Root frame: arranges TopBar, Sidebar, MainArea, ConsoleDrawer, Footer; owns the region frames and the mouse focus wiring; applies the layout mode from `ResponsiveGate`. |
| `src/features/shell/Sidebar.tsx` | Stacks the five sidebar panels; renders the `<tab-select>` switcher when the sidebar is collapsed; provides each panel's `<scrollbox>` container. |
| `src/features/shell/MainArea.tsx` | Places the commit graph, the right pane (composer or details), and the diff panel; defines the `graph`, `right-pane`, and `diff` region frames. |
| `src/features/shell/Footer.tsx` | Renders the hint bar, transient status, and progress; implements priority-based hint dropping; shows modal keys when an overlay is open. |
| `src/features/shell/ResponsiveGate.tsx` | Computes the layout mode from `useTerminalDimensions` and `useOnResize`; renders the too-small notice with `ascii-font`. |
| `src/features/shell/regions.ts` | The stable region ID constants: `top-bar`, `branches`, `remotes`, `tags`, `stashes`, `worktrees`, `graph`, `right-pane`, `diff`, `console`; plus the Tab order array. |
| `src/features/shell/focus.types.ts` | `RegionId`, `FocusState`, `LayoutMode`, `RegionCursor` types and the cursor key helper. |
| `src/features/shell/useFocusModel.ts` | Computes the effective Tab order (skipping hidden regions), exposes `focusNext` and `focusPrevious`, and applies the collapsed-sidebar panel switching. |
| `src/app/providers/FocusProvider.tsx` | Holds `activeRegion`, `previousRegion`, the per-region cursor map, and the focused text-input flag; exposes `setActiveRegion`, `clearFocus`, and cursor get/set. |
| `src/app/providers/KeymapProvider.tsx` | Holds the resolved action-to-keys map from `@/domain/keymap`; exposes lookups for `useHotkeys`, the footer, help, and the palette. |
| `src/app/providers/StatusProvider.tsx` | Holds transient status, footer mode, and operation progress; exposes `setStatus`, `clearStatus`, `beginOperation`, `endOperation`. |
| `src/app/hooks/useHotkeys.ts` | The only `useKeyboard` caller; resolves precedence and dispatches action IDs to registered handlers. |
| `src/app/hooks/useFocusRegion.ts` | Reads and writes focus for one region; returns `{ focused, focus(), cursors }`. |
| `src/app/hooks/useAction.ts` | Registers an action-ID handler for the lifetime of the component and reports availability. |
| `src/app/hooks/useStatus.ts` | Reads transient status and operation progress from `StatusProvider`. |

## 6. State model

Provider state (architecture section 9): `FocusProvider` owns `activeRegion`, `previousRegion`, and the per-region cursor map keyed by `RegionId`. `KeymapProvider` owns the resolved keymap. `StatusProvider` owns transient status, footer mode, and operation progress. `OverlayProvider` owns the modal stack that `useHotkeys` and `Footer` read for precedence and modal hints. `RepositoryProvider` owns the snapshot the panels render.

View state (local to shell components): the current `LayoutMode` (derived in `ResponsiveGate`, held in `AppShell`), the active sidebar panel index when the sidebar is collapsed, and the focused control index inside the top bar (held by F-02, not here). No shell component keeps a copy of repository state, keybindings, or theme tokens.

Cursor persistence: the cursor map lives in `FocusProvider`, not in each panel. A panel reads and writes its cursor through `useFocusRegion(regionId)`. When focus leaves and returns, the cursor is unchanged, satisfying "each list keeps its own cursor when focus moves away and back". Cursors are keyed by a stable item key (branch name, commit hash, file path) so a refresh that preserves the item also preserves the cursor.

## 7. Data flow

Focus change: key or click -> action ID `focus.next` -> handler registered with `useAction` in `useFocusModel` -> `FocusProvider.setActiveRegion` -> `AppShell` re-renders the border and `Footer` recomputes hints in the same render.

Key dispatch: physical key -> `useHotkeys` (the only `useKeyboard` caller) -> `@/domain/keymap/keymap.resolve.ts` resolves the action ID for the current context -> the registered `useAction` handler runs.

Refresh: action ID `app.refresh` -> command `app.refresh` from `@/domain/commands/commands.registry.ts` -> `commands.runner.ts` -> `@/domain/git/git.repo.ts` and `git.status.ts` -> `git.client.ts` runs `git rev-parse --show-toplevel`, `git status --porcelain=v2`, and `git for-each-ref` -> parsers -> `RepositoryProvider` refresh.

Quit: action ID `app.quit` -> handler reads `StatusProvider` for a running operation, the composer draft via the composer feature, and `OverlayProvider` for an open confirmation -> if any is present, `OverlayProvider` opens `ConfirmModal`; otherwise `useRenderer().destroy()` restores the terminal.

No shell component calls git directly. Shell actions are limited to focus, refresh, quit, console toggle, help, palette, and theme picker; all mutation flows belong to their feature docs.

## 8. Keyboard and focus

Action IDs only (product spec section 6.1). Raw key strings never appear outside `@/domain/keymap/**` and `src/app/hooks/useHotkeys.ts`.

| Context | Action IDs | Behavior |
| --- | --- | --- |
| Global | `focus.next`, `focus.previous` | Tab and Shift+Tab move between regions in the spec order, skipping regions hidden by a fallback. |
| Global | `app.quit` | Quits, with confirmation when an operation is running, a commit message is unsent, or a confirmation is open. |
| Global | `app.help`, `app.palette`, `app.console`, `app.refresh`, `app.themePicker`, `app.reloadConfig` | Cross-region actions registered by their owning features. |
| Global | `overlay.close` | Closes an overlay; with no overlay, clears transient state, then returns focus to `previousRegion`. |
| Region | `nav.up`, `nav.down`, `nav.pageUp`, `nav.pageDown`, `nav.first`, `nav.last` | Move within the focused region. |
| Region | `nav.activate` | Primary action for the focused item; mouse double click dispatches the same ID. |
| Sidebar (collapsed) | `nav.left`, `nav.right` | Switch the visible sidebar panel through the `<tab-select>`. |
| Top bar | `nav.left`, `nav.right` | Move between top-bar controls (owned by F-02). |

Precedence implementation in `useHotkeys`: it calls `useKeyboard` once and, on each key event, resolves in this order, matching product spec section 3 and architecture section 8. First, if an overlay is open, the overlay context owns the key except the quit escape hatch. Second, if focus is inside a text input, printable keys, Backspace, Delete, arrow keys, and Enter pass to the input, while modified shortcuts still resolve through the keymap. Third, the focused region context is consulted. Fourth, global actions. Unhandled keys are ignored. `KeymapProvider` supplies the resolved map, `OverlayProvider` supplies the overlay stack, `FocusProvider` supplies the active region and the text-input flag, and `useAction` supplies the handler registry.

Collapsed sidebar switcher: when `LayoutMode` is `sidebar-collapsed`, `Sidebar` renders one `<tab-select>` whose options are the five panel labels and one panel body below it. Focusing the sidebar region and pressing `nav.left` or `nav.right` changes the `<tab-select>` selection and swaps the visible panel. The `Tab` key still moves between regions through `focus.next`; the panel switcher does not consume `focus.next`. See section 14 for the ambiguity this resolves.

Mouse: `onMouseDown` on each region frame calls `focus()` from `useFocusRegion` and selects the clicked row; a second click on the same row inside the double-click threshold dispatches `nav.activate`. `onMouseScroll` on each `<scrollbox>` scrolls the hovered list. Mouse never exposes an action without a keybinding.

Focus visibility: the focused region is drawn with `focusedBorderColor` from `useTokens()` and a leading `>` text marker in its header via `TextMarker`. Color is never the only signal.

## 9. Loading, empty, error, and disabled states

- Loading: the shell renders immediately with region frames and a `LoadingRow` inside each not-yet-loaded region. The footer shows the transient status line while `RepositoryProvider` performs its first read.
- Empty: handled per region by its owning feature (`EmptyState`). The shell always renders the frame so the layout does not shift.
- Error: a repository-level failure renders through `ErrorOverlay` (F-15) and leaves the shell frame intact. Region-level failures render an inline `ErrorState` with Retry. Shell-level failures never blank the whole app.
- Disabled: when an overlay is open, background regions are visibly inactive (dim tokens) and `useHotkeys` routes every key to the overlay. When an operation is running, the footer replaces hints with the status line and progress, then restores hints on completion.
- Text markers: focus marker `>`, detached and missing-upstream markers `[?]`, status markers from `TextMarker`. No state is conveyed by color alone.
- Too small: below 80 columns or 24 rows, `ResponsiveGate` renders the `ascii-font` notice showing the current size and the minimum `100x30`, and does not attempt the layout.

## 10. Performance and bounds

- Focus changes must not remount region subtrees. Region frames are stable; only the border color and header marker change.
- The footer hint bar never wraps. `Footer` computes a hint budget from `useTerminalDimensions` and drops the least important hints first, always keeping Help available.
- The cursor map is a plain object keyed by region, so cursor reads are O(1) and do not trigger repository reads.
- `useOnResize` recomputes `LayoutMode` at most once per resize event and only when a breakpoint is crossed.
- Region rendering stays bounded because each region's own virtualization is owned by its feature; the shell adds no unbounded list.

## 11. Safety and confirmations

- Quit confirmation is the only confirmation owned here. It opens when `StatusProvider` reports a running operation, the composer reports an unsent draft, or `OverlayProvider` has an open confirmation. The confirm modal defaults focus to Cancel and uses a specific label, not "OK".
- `Esc` with no overlay clears transient state, then returns focus to `previousRegion`; it never discards staged files or a draft.
- The shell never performs a destructive git action itself, so it cannot bypass a feature's confirmation.
- Terminal restore is guaranteed on quit through `useRenderer().destroy()`.
- Modal open state deactivates background regions so a stray key cannot reach a background action.

## 12. Acceptance mapping

| Product spec acceptance bullet | Implementing module or component |
| --- | --- |
| "Changing focus updates the highlighted region and the footer hints in the same render." (F-01, line 193) | `src/app/providers/FocusProvider.tsx`, `src/features/shell/useFocusModel.ts`, `src/features/shell/Footer.tsx`. |
| "Clicking a row selects it and focuses its region." (F-01, line 194) | `onMouseDown` wiring in `src/features/shell/AppShell.tsx` with `src/app/hooks/useFocusRegion.ts`. |
| "Keyboard navigation never requires a mouse." (F-01, line 195) | `src/app/hooks/useHotkeys.ts` plus `src/app/hooks/useAction.ts`. |
| "The shell is persistent. Panels do not open as separate screens." (F-01, line 183) | `src/features/shell/AppShell.tsx`. |
| "Focus moves with Tab and Shift+Tab in this order unless an overlay is open..." (F-01, line 184) | `src/features/shell/regions.ts` order array and `src/features/shell/useFocusModel.ts`. |
| "Focus order skips regions that are hidden by a responsive fallback." (F-01, line 185) | `src/features/shell/useFocusModel.ts` with the layout mode from `ResponsiveGate.tsx`. |
| "The active region has a clear border and selection marker." (F-01, line 186) | `src/features/shell/AppShell.tsx` using `ui/Panel.tsx` and `ui/TextMarker.tsx`. |
| "Each scrollable list shows a scrollbar only when content overflows." (F-01, line 187) | `<scrollbox>` usage in `src/features/shell/Sidebar.tsx`. |
| "The footer hint bar is always visible, including when a modal is open, where it shows the modal keys." (F-01, line 188) | `src/features/shell/Footer.tsx` reading `OverlayProvider`. |
| "Transient status does not permanently replace hints." (F-01, line 189) | `src/features/shell/Footer.tsx` with `src/app/providers/StatusProvider.tsx`. |
| "The app remains usable at the target minimum size and shows a clear notice below it." (v1 acceptance, line 1727) | `src/features/shell/ResponsiveGate.tsx`. |
| "Focus changes are visible and footer hints match the focused region." (v1 acceptance, line 1693) | `src/app/providers/FocusProvider.tsx` and `src/features/shell/Footer.tsx`. |
| "The app restores the terminal before exit." (F-01 lifecycle, line 152) | `src/app/App.tsx` quit handler using `useRenderer`. |

## 13. Tests to add

- `src/features/shell/useFocusModel.test.ts`: Tab order matches the spec order; hidden regions are skipped in each layout mode; `focus.next` from the last region wraps to `top-bar`.
- `src/features/shell/regions.test.ts`: region IDs match the architecture section 8 list exactly and the Tab order array contains no duplicates.
- `src/features/shell/ResponsiveGate.test.tsx`: 120x40 renders `AppShell`; 95x30 renders narrow sidebar; 85x30 renders the collapsed switcher; 79x30 and 100x23 render the too-small notice with the current and minimum size text.
- `src/features/shell/Footer.test.tsx`: hints reflect the focused region; a context override hides the shadowed global hint; hints drop in priority order as the width shrinks and Help stays; modal keys replace region hints when an overlay is open.
- `src/features/shell/AppShell.test.tsx`: rendering with `@opentui/react` test-utils asserts the focus marker `>` moves with `focus.next` and that clicking a row focuses its region.
- `src/app/hooks/useHotkeys.test.ts`: precedence table covering overlay-open, text-input focus, region context, and global; `null` reset and `[]` unbind behavior come from the keymap tests in F-19.
- `src/app/providers/FocusProvider.test.tsx`: cursor survives a focus round trip and an unchanged refresh; `previousRegion` updates on focus change.

## 14. Open questions

- Product spec line 143 says the sidebar "collapses to a single active panel selected with Tab", but line 101 defines Tab as region traversal. This document resolves it by making the `<tab-select>` switcher respond to `nav.left` and `nav.right` while the sidebar region is focused, and keeping `focus.next` as region traversal. Confirm that is acceptable, or define a distinct `sidebar.nextPanel` action ID.
- `nav.left` and `nav.right` are listed under the Top bar context in product spec section 6.1 but are reused here for the collapsed sidebar. Confirm reuse is acceptable or add dedicated sidebar action IDs.
- The exact collapse threshold is not specified beyond "below 100 columns". This document chooses 90 columns for the collapse and keeps the narrow-but-full layout between 90 and 99 columns. Confirm the threshold.
- Whether the too-small notice should still allow `app.quit` and `app.help` while blocking the layout is unspecified; this document keeps both available.
- Whether the sidebar width should shrink in fixed steps or proportionally between 90 and 99 columns is unspecified; this document uses a fixed narrow width.
