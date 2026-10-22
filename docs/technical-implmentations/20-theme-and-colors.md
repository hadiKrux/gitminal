# 20 - Theme and Colors

## 1. Header

- Status: Draft for review
- Spec reference: `docs/product-spec.md` F-20 (lines 1278-1440), decisions D12 and D18, theme token table at lines 1383-1413.
- Dependencies: `01-app-shell-and-focus.md` (tokens for borders and focus), `08-commit-graph.md` (graph lane colors), `11-diffs-and-file-actions.md` (diff token mapping), `13-console.md` (console tokens), `15-overlays-and-confirmations.md` (error and warning tokens), `17-freshness-and-performance.md` (progress tokens), `19-configuration-and-keybindings.md` (theme file path, reload, config writing).
- Owned paths:
  - `src/domain/theme/theme.types.ts`
  - `src/domain/theme/theme.catppuccin.ts`
  - `src/domain/theme/theme.resolve.ts`
  - `src/domain/theme/theme.capability.ts`
  - `src/domain/theme/theme.tokens.ts`
  - `src/theme/ThemeContext.tsx`
  - `src/theme/useTokens.ts`
  - `src/theme/icons.ts`
  - `src/features/theme-picker/ThemePicker.tsx`
  - `src/features/theme-picker/ThemeRow.tsx`
  - `src/features/theme-picker/useThemePicker.ts`
  - `src/ui/Swatch.tsx`

## 2. Scope and non-goals

In scope: the four Catppuccin flavors with Mocha default; the token table; `theme.json` location and precedence; the `theme.json` schema including per-token override and graph lane array; the theme picker opened with `t` and from the palette; picker rows with name, light or dark label, active marker, and swatch; live preview on highlight; Enter applies and persists by writing the `theme` field while preserving other fields; creating a minimal config when absent; session-only apply with a warning when malformed or unwritable; Esc restoring the previous theme; overrides layering over any base theme; capability detection (truecolor, 256-color, monochrome, NO_COLOR); text markers carrying all meaning; the token-to-OpenTUI-prop mapping; the single central icon file `src/theme/icons.ts`.

Non-goals: non-Catppuccin built-in themes; automatic light and dark switching; layout or wording changes from theming; theming safety behavior; hot watching `theme.json`.

## 3. OpenTUI components used

| Component | Where used | Why it is the right component |
| --- | --- | --- |
| `<box>` | Theme picker modal and `Swatch` cells | Layout; `Swatch` is a `box` primitive with a background color. |
| `<text>` | Theme names, light or dark labels, active marker, note below the list | Names and markers are text, so the picker works without color. |
| `<span>` | Active `*` marker and label inline | Inline runs inside `<text>`. |
| `<select>` | Not used for the theme list | The list needs custom rows with a swatch, so it is a `<scrollbox>` of `<box>` rows. |
| `<scrollbox>` | Theme picker list | Four rows today but scrollable and consistent with other lists. |
| `<diff>` | Diff panel | Diff colors are mapped from tokens: `addedBg`, `removedBg`, `addedSignColor`, and `removedSignColor` from `diffAddBackground`, `diffRemoveBackground`, `diffAdd`, and `diffRemove`. |
| `useKeyboard` | Not used directly | Centralized in `useHotkeys`; the picker registers `app.themePicker` and `overlay.close` via `useAction`. |
| `useTimeline` | Not used here | Animation belongs to `Spinner` and `ProgressBar`. |

Theme application: `ThemeProvider` holds resolved tokens; every component reads them through `useTokens()`. No component holds a hex literal (enforced by the boundary check; hex colors exist only in `theme.catppuccin.ts`).

Icons: this feature owns `src/theme/icons.ts`, the single configuration file for every icon, marker, and glyph in the app. It exports a frozen `ICONS` object and the `IconName` type, lives next to the token files, and is the only place a glyph literal exists. All values are printable ASCII and every state marker has a text equivalent, so the app works without color and on low-color terminals. Components read `ICONS` from `@/theme/icons`; they never inline a glyph. User-level icon overrides are deferred in v1 and would extend `theme.json` with an optional `icons` object, which requires a product spec change to F-20. See architecture section 6.1 for the required groups and defaults.

All icons and markers used by this feature come from `src/theme/icons.ts`; see architecture section 6.1. No glyph literal is written in feature code.

## 4. Component tree

```text
ConfigProvider
  ThemeProvider                (resolved tokens + capability)
    KeymapProvider
      RepositoryProvider
        AppShell
          OverlayProvider
            ThemePicker        (ModalFrame + scrollbox)
              ThemeRow         (box + text + span + Swatch)
```

`ThemePicker` uses the shared `ModalFrame` (via `src/ui/ModalFrame.tsx` and `ModalActions`) so Esc and focus trapping match other modals. `Swatch` is the `src/ui/Swatch.tsx` primitive.

## 5. Enforced files and folders

- `src/domain/theme/theme.types.ts`
- `src/domain/theme/theme.catppuccin.ts`
- `src/domain/theme/theme.resolve.ts`
- `src/domain/theme/theme.capability.ts`
- `src/domain/theme/theme.tokens.ts`
- `src/theme/ThemeContext.tsx`
- `src/theme/useTokens.ts`
- `src/theme/icons.ts`
- `src/features/theme-picker/ThemePicker.tsx`
- `src/features/theme-picker/ThemeRow.tsx`
- `src/features/theme-picker/useThemePicker.ts`
- `src/ui/Swatch.tsx`

## 6. State model

- `ThemeProvider` (provider state): the active base theme name, the resolved token set for the current capability, and the override layer loaded from `theme.json`. It also exposes a preview override used during picker highlight.
- `src/theme/useTokens.ts`: the read-only hook returning resolved tokens; the only way components read colors.
- `ConfigProvider` (provider state): the `theme` field and the resolved `theme.json` path.
- `useThemePicker` (view state): the highlighted index, the previously active theme (for Esc), the list of built-in flavors, and the preview-in-progress flag.
- `RepositoryProvider`: untouched; the picker is read-only with respect to git refs and the index.

## 7. Data flow

```text
launch -> theme.resolve(config.theme, theme.json, capability)
   -> ThemeProvider -> useTokens -> components + OpenTUI props
picker highlight -> ThemeProvider.preview(name) -> live re-render
picker Enter -> config.writer writes the theme field -> ThemeProvider.commit(name)
picker Esc -> ThemeProvider.restore(previous)
reload -> config.loader + theme.resolve -> ThemeProvider update
```

`theme.resolve.ts` layers, in order: the selected built-in flavor from `theme.catppuccin.ts`, then `theme.json` per-token overrides and the graph lane array. `theme.capability.ts` then maps each final color to truecolor, the nearest 256-color value, or monochrome, honoring `NO_COLOR`. `theme.tokens.ts` defines the token names and the token-to-OpenTUI-prop mapping.

Token-to-OpenTUI-prop mapping (the resolver supplies a final color per prop):

| Token | OpenTUI target | Prop |
| --- | --- | --- |
| `background` | root `<box>` and `<text>` base | `backgroundColor` |
| `panel` | `Panel`, `PanelHeader`, sidebar `<box>` | `backgroundColor` |
| `surface` | raised rows, modals, inputs, `ProgressBar` track cells | `backgroundColor`; FrameBuffer fill color for the progress track |
| `border` | inactive `<box>` borders and separators | `borderColor` |
| `focus` | focused `<box>` border | `focusedBorderColor` |
| `text` | `<text>` | `fg` |
| `muted` | secondary `<text>` | `fg` |
| `dim` | hints and disabled text | `fg` (with the dim attribute) |
| `selection` | selected `<box>` row | `backgroundColor` |
| `accent` | `Button`, ref badges, and `ProgressBar` filled cells | `backgroundColor` on `Button`, `fg` on `Badge`, FrameBuffer fill color for the progress fill |
| `success` | `StatusBadge`, add counts | `fg` |
| `warning` | `StatusBadge`, pending state | `fg` |
| `error` | `StatusBadge`, destructive labels | `fg` |
| `info` | `StatusBadge`, hunk headers | `fg` |
| `scrollbar` | `<scrollbox>` thumb | scrollbar thumb color |
| `tag` | tag `Badge` | `fg` |
| `branchLocal` | local branch `Badge` | `fg` |
| `branchRemote` | remote branch `Badge` | `fg` |
| `diffAdd` | `<diff>` | `addedSignColor` |
| `diffRemove` | `<diff>` | `removedSignColor` |
| `diffAddBackground` | `<diff>` | `addedBg` |
| `diffRemoveBackground` | `<diff>` | `removedBg` |
| `diffContext` | `<diff>` | context line color |
| `diffHunk` | `<diff>` | hunk header color |
| `graph` | `GraphLanes` per-lane `<box>` and `<text>` | `fg` and `backgroundColor` per lane |

The `<diff>` component is always rendered with `view="unified"`, `showLineNumbers`, and the four diff props above, per architecture section 6.

`ProgressBar` converts the resolved `accent` and `surface` tokens to `RGBA` for the FrameBuffer fill. When capability detection reduces the palette or `NO_COLOR` removes color, the filled and empty cells may look alike; the adjacent percentage and phase text remain the authoritative signal, and the bar is never the only indication of progress.

## 8. Keyboard and focus

Action IDs only:

- `app.themePicker`: opens the picker; default `t`, from anywhere outside a text input or another modal.
- `overlay.close`: `Esc` restores the previously active theme and closes.
- `nav.up`, `nav.down`: move the highlight and preview live; `j` and `k` are the same action IDs.
- `nav.activate`: `Enter` applies the highlighted theme, persists it, and closes.
- `focus.next`, `focus.previous`: move between the list and the modal actions.

While the picker is open it owns all keys except the quit escape hatch. The footer includes `t Theme` when space permits; help and the palette always expose it.

## 9. Loading, empty, error, and disabled states

- Loading: none; resolution is synchronous.
- Empty: not applicable; four flavors always exist.
- Error: a malformed `theme.json` or missing `colors` object leaves the base theme active and warns; unknown tokens and invalid color values are reported and ignored, keeping the base token; a newer `version` is ignored with a warning.
- Session-only apply: if `config.json` is malformed, read-only, or unwritable, the picker applies the theme for the session, leaves the file untouched, and shows a warning such as "theme applied for this session; could not save".
- No-color: with `NO_COLOR` or a monochrome terminal, swatches render as plain markers and all meaning is carried by names, the active `*` marker, and the light or dark label.

## 10. Performance and bounds

- Token resolution is O(tokens) and runs on load, on preview, and on commit; the token set is memoized by `ThemeProvider`.
- Live preview re-renders by swapping the token object; it does not re-read files.
- `theme.json` is read once at startup and on reload; it is not watched.
- The graph lane list is bounded by the number of provided lanes; lanes cycle.

## 11. Safety and confirmations

- Theme selection is non-destructive and needs no confirmation.
- Applying writes only the `theme` field in `config.json`, preserving other fields, and never modifies `theme.json`.
- The picker never touches git refs or the index.
- Theme overrides cannot change layout, wording, safety behavior, or keybindings.

## 12. Acceptance mapping

- "Fresh install shows Catppuccin Mocha without configuration." -> the theme default in `config.defaults.ts` plus `theme.catppuccin.ts` Mocha.
- "`t` opens the picker with all four flavors and marks the active one." -> `app.themePicker`, `ThemePicker.tsx`, `ThemeRow.tsx`.
- "Highlight previews; Enter applies and saves; Esc restores." -> `useThemePicker.ts`, `ThemeProvider`, `config.writer.ts`.
- "Selected theme persists across restart when writable." -> the `theme` field write in `config.writer.ts`.
- "If saving fails, applies for the session with a warning." -> `useThemePicker.ts` plus the warning surface.
- "`theme.json` overrides apply over any base theme." -> layering in `theme.resolve.ts`.
- "A subset of tokens changes only those." -> per-token merge in `theme.resolve.ts`.
- "Invalid theme value keeps the base color and warns." -> `theme.resolve.ts`, `config.validate.ts`.
- "`NO_COLOR` removes color, keeps markers, names, and the active marker." -> `theme.capability.ts`, `TextMarker.tsx`.
- "Overrides cannot change layout or safety." -> token-only resolution.
- "Reload applies a valid theme without restart." -> the reload flow with `theme.resolve.ts`.
- The token table at spec lines 1383-1413 -> `theme.catppuccin.ts` and `theme.tokens.ts`.

## 13. Tests to add

- `src/domain/theme/theme.resolve.test.ts`: base selection, per-token override, graph lane override, subset merge, unknown token ignored, invalid color ignored.
- `src/domain/theme/theme.capability.test.ts`: truecolor, 256-color nearest match, monochrome, `NO_COLOR`, markers preserved.
- `src/domain/theme/theme.catppuccin.test.ts`: all four flavors define every token; Mocha default values match the spec roles.
- `src/domain/theme/theme.tokens.test.ts`: every token maps to the documented OpenTUI props.
- `src/features/theme-picker/useThemePicker.test.ts`: highlight preview, Enter persist, Esc restore, same-theme Enter closes.
- `src/features/theme-picker/ThemePicker.test.tsx`: active `*` marker, light or dark label, note below the list when `theme.json` is present.
- `src/domain/config/config.writer.test.ts`: writes only the theme field, preserves others, creates a minimal config when absent, leaves the file untouched when unwritable.

## 14. Open questions

- The exact contrast-safe blend function and its threshold for deriving `diffAddBackground` and `diffRemoveBackground` when omitted.
- Whether the swatch should be a solid `box` fill only or a two-cell foreground and background pair on low-color terminals.
- Whether `config.writer.ts` should live in `domain/config` (shared) with the picker calling it, versus a theme-owned writer.
