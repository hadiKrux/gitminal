# 19 - Configuration and Keybindings

## 1. Header

- Status: Draft for review
- Spec reference: `docs/product-spec.md` F-19 (lines 1108-1276), decisions D11 and D2, action IDs at lines 1583-1611.
- Dependencies: `01-app-shell-and-focus.md` (footer and help read effective bindings), `14-help.md` (Configuration section), `12-command-palette.md` (Reload configuration), `16-repository-states.md` (scope-dependent availability), `17-freshness-and-performance.md` (graph reload on scope change), `18-safety-and-platform-behavior.md` (non-configurability), `20-theme-and-colors.md` (theme path and reload).
- Owned paths:
  - `src/domain/config/config.types.ts`
  - `src/domain/config/config.defaults.ts`
  - `src/domain/config/config.paths.ts`
  - `src/domain/config/config.loader.ts`
  - `src/domain/config/config.validate.ts`
  - `src/domain/config/config.writer.ts`
  - `src/domain/keymap/keymap.types.ts`
  - `src/domain/keymap/keymap.defaults.ts`
  - `src/domain/keymap/keymap.parse.ts`
  - `src/domain/keymap/keymap.resolve.ts`
  - `src/domain/keymap/keymap.conflicts.ts`
  - `src/domain/keymap/keymap.describe.ts`
  - `src/app/providers/ConfigProvider.tsx`
  - `src/app/providers/KeymapProvider.tsx`
  - `src/app/hooks/useConfig.ts`
  - `src/app/hooks/useKeymap.ts`
  - `src/app/hooks/useHotkeys.ts`

## 2. Scope and non-goals

In scope: config file locations and precedence; keybindings and theme file resolution; load order; the config schema with defaults and ranges; unknown field and invalid value handling; the safety non-configurability rule; binding value forms; key syntax; conflict rules per context; `Ctrl+C`; the unbound quit, help, and palette warning; validation and warning surface; Reload configuration and what reloads immediately; help discovery of effective bindings.

Non-goals: a settings screen; hot watching config files; comments or JSON5; schema migration beyond version detection; per-repository config.

## 3. OpenTUI components used

| Component | Where used | Why it is the right component |
| --- | --- | --- |
| `<input>` | Help search field and palette search, which consume resolved bindings | Single-line fields; printable bindings must not fire while focused. |
| `<text>` | Configuration values, warning lines, "Unbound" labels | All configuration display is text. |
| `<span>` | Inline key chips in Help rows | Inline emphasis inside `<text>`. |
| `<markdown>` | Help Configuration notes | Documentation blocks. |
| `<select>` | Palette result list showing effective shortcuts | Uniform option list with descriptions. |
| `<scrollbox>` | Help and palette bodies | Scroll long lists. |
| `useKeyboard` | Only inside `src/app/hooks/useHotkeys.ts` | Single dispatcher; features register action IDs via `useAction`. |

No feature compares raw key strings; all matching uses resolved bindings from `keymap.resolve.ts`.

All icons and markers used by this feature come from `src/theme/icons.ts`; see architecture section 6.1. No glyph literal is written in feature code.

## 4. Component tree

```text
ConfigProvider                 (resolved config, warnings, reload)
  ThemeProvider
    KeymapProvider             (resolved action to keys map)
      RepositoryProvider
        AppShell
          Footer               (hints from keymap.describe)
          HelpModal
            HelpSection
              HelpRow          (effective keys or "Unbound")
            HelpConfiguration  (paths, load status, warnings)
          CommandPalette
            CommandRow         (effective shortcut and disabled reason)
```

## 5. Enforced files and folders

- `src/domain/config/config.types.ts`
- `src/domain/config/config.defaults.ts`
- `src/domain/config/config.paths.ts`
- `src/domain/config/config.loader.ts`
- `src/domain/config/config.validate.ts`
- `src/domain/config/config.writer.ts`
- `src/domain/keymap/keymap.types.ts`
- `src/domain/keymap/keymap.defaults.ts`
- `src/domain/keymap/keymap.parse.ts`
- `src/domain/keymap/keymap.resolve.ts`
- `src/domain/keymap/keymap.conflicts.ts`
- `src/domain/keymap/keymap.describe.ts`
- `src/app/providers/ConfigProvider.tsx`
- `src/app/providers/KeymapProvider.tsx`
- `src/app/hooks/useConfig.ts`
- `src/app/hooks/useKeymap.ts`
- `src/app/hooks/useHotkeys.ts`

## 6. State model

- `ConfigProvider` (provider state): the resolved config object, the resolved file paths (config, keybindings, theme), the warning list, and a reload function. Source: `@/domain/config`.
- `KeymapProvider` (provider state): the resolved action-to-keys map, the effective key-to-action map per context, and the conflict and warning list. Source: `@/domain/keymap`.
- `ThemeProvider` and `src/theme/useTokens.ts`: theme path and active theme name for Help; theme resolution is specified in `20-theme-and-colors.md`.
- Feature view state: none for config; features read `useConfig` and `useKeymap`. `useHotkeys` holds only the transient resolution context (overlay open, focused region, focused input).
- `ConfigProvider` sits outermost; `KeymapProvider` sits inside it because keybindings depend on resolved config.

## 7. Data flow

```text
launch -> config.paths resolves files -> config.loader reads -> config.validate per field
   -> ConfigProvider (resolved config + warnings)
   -> keymap.defaults + config.keybindings + keybindings.json -> keymap.parse
   -> keymap.resolve -> keymap.conflicts -> KeymapProvider
   -> useHotkeys dispatches action IDs -> useAction handlers -> commands.registry
```

Reload flow: `app.reloadConfig` -> `config.loader` re-reads the main config, keybindings, and theme -> `config.validate` -> if valid, `ConfigProvider` and `KeymapProvider` update in place; the graph reloads when `graph.scope` or `graph.initialPageSize` changed; diffs redraw with the new `diff.contextLines`; mouse and theme apply immediately; footer, help, and palette re-read effective bindings.

Resolution algorithm (exact, module level):

1. `config.paths.ts` resolves `config.json` by precedence: `$GITMINAL_CONFIG` when set and non-empty, then `$XDG_CONFIG_HOME/gitminal/config.json` when `XDG_CONFIG_HOME` is set, then `~/.config/gitminal/config.json` otherwise, then on Windows `%APPDATA%\gitminal\config.json` when the XDG and home paths are unavailable. It resolves `keybindings.json` from `$GITMINAL_KEYBINDINGS` when set and non-empty, otherwise next to the resolved config file, and `theme.json` from `$GITMINAL_THEME` when set and non-empty, otherwise next to the resolved config file.
2. `config.loader.ts` reads each file. A missing file yields no warning. An unreadable or malformed file yields a warning naming the file and parse error and never blocks launch.
3. `config.defaults.ts` provides built-in defaults. `config.validate.ts` merges per field: defaults, then `config.json`, then `keybindings.json` (keybindings only). Unknown fields and unknown action IDs are reported and ignored. An invalid field keeps the previous effective value and adds a warning. A missing `version` is treated as 1; a newer version is ignored with a warning.
4. `keymap.parse.ts` parses each binding value into a normalized key token: modifiers (`ctrl` or `control`, `shift`, `alt` or `option`, `cmd`, `command`, or `meta`, and `mod`) plus a base key (a named key or a printable character). Modifier order is irrelevant. Uppercase letters normalize to `shift` plus the lower letter. Unsupported keys and platform modifiers are reported and ignored on that platform. `mod` expands to Control on Linux and Windows and Command on macOS. Built-in defaults that display `Ctrl/Cmd` bind both `ctrl` and `mod`.
5. `keymap.resolve.ts` builds, per context, the effective key-to-action map: start from `keymap.defaults.ts`; apply `config.json` `keybindings` per action (a string or an array replaces the whole list); apply `keybindings.json` per action (it wins over `config.json` for the same action); apply `null` as reset-to-default and `[]` as unbind; actions not mentioned keep the previous value. Context actions override global actions for the same key. `Ctrl+C` is injected as a non-overridable quit and cancel entry.
6. `keymap.conflicts.ts` scans each context for two different actions sharing a key. On conflict it rejects the conflicting overrides, keeps the built-in defaults for those actions, and records a warning naming both action IDs and the key. It also warns when quit, help, and the palette end up with no binding.
7. `keymap.describe.ts` produces the footer hints and Help rows from the resolved map, filtered by focused region and current availability, so the footer, help, and palette always agree.

## 8. Keyboard and focus

Action IDs only. Configuration-relevant IDs: `app.quit`, `app.help`, `app.palette`, `app.console`, `app.refresh`, `app.reloadConfig`, `app.themePicker`, `overlay.close`, `focus.next`, `focus.previous`, plus every context action. Override syntax handling:

- String value: a single binding, replacing the list.
- Array value: replaces the whole list; it is not appended.
- `null`: resets to the built-in default (useful in `keybindings.json` to undo a value from `config.json`).
- `[]`: unbinds; the action still appears in the palette and help.
- Unknown action ID: ignored with a warning.
- Invalid binding: ignored; the previous effective binding remains.

Precedence at runtime: open overlay, then focused text input, then focused region context, then global. A plain printable binding never fires while a text input or filter field has focus; modified shortcuts still work. `Ctrl+C` is a hardcoded quit and cancel path and cannot be unbound.

## 9. Loading, empty, error, and disabled states

- Loading: config loads synchronously at startup with no visible loading state; reload shows a transient status.
- Empty: absent files produce no warning; Help shows "not present" for the keybindings and theme paths.
- Error: invalid JSON ignores the file, keeps defaults, and warns with the file and parse error; an invalid version ignores the file with a warning; an invalid field keeps the previous value; an invalid keybindings file leaves `config.json` keybindings applied and defaults elsewhere; an invalid theme file keeps the base theme.
- Disabled: a config that unbinds quit, help, and the palette still loads but shows a prominent warning. Actions with no binding render as "Unbound" in help.
- Warnings surface: a non-blocking message in the top bar status strip, plus a detailed entry in Help > Configuration and the console.

## 10. Performance and bounds

- Config files are read once at startup and on explicit reload; they are not watched.
- Keymap resolution is O(actions * bindings) and runs once per load; the resolved map is memoized in `KeymapProvider`.
- `useHotkeys` lookup is O(1) per key against the resolved maps.
- Warning lists are bounded by the number of distinct problems and are capped for display.

## 11. Safety and confirmations

- Safety behavior is not configurable: destructive confirmations, force-push warnings, credential prompt protection, and hook execution cannot be disabled. There is no "always no-verify" or "always force" setting. `config.validate.ts` reports such fields as unknown and ignores them.
- `git.path` is a local user setting executed directly without a shell (detail in `18-safety-and-platform-behavior.md`).
- Reload validates before applying; on failure it keeps the previous effective configuration and warns.

## 12. Acceptance mapping

- "Override a key in `config.json` or `keybindings.json` and see the new key in the footer and help." -> `keymap.resolve.ts`, `keymap.describe.ts`, `useKeymap`.
- "`keybindings.json` overrides `config.json`." -> resolution step 5.
- "`null` resets, `[]` unbinds." -> resolution step 5.
- "Conflicting keys in the same context are reported without making the app unusable." -> `keymap.conflicts.ts`.
- "Invalid configuration never prevents launch or loses work." -> `config.loader.ts`, `config.validate.ts`.
- "Reload configuration applies valid changes without restarting." -> the reload flow.
- "Safety confirmations cannot be disabled." -> `config.validate.ts`.
- "Printable overrides do not fire while typing." -> `useHotkeys` text-input precedence.
- File locations and load order -> `config.paths.ts`, `config.loader.ts`.

## 13. Tests to add

- `src/domain/keymap/keymap.resolve.test.ts`: precedence tables (defaults, config, keybindings.json, null reset, [] unbind, string versus array) and context-over-global.
- `src/domain/keymap/keymap.conflicts.test.ts`: conflict table with both action IDs and the key; unbound quit, help, and palette warning.
- `src/domain/keymap/keymap.parse.test.ts`: modifier aliases, `mod` per platform, named keys, uppercase handling, unsupported keys.
- `src/domain/config/config.validate.test.ts`: per-field fallback, unknown fields, unknown action IDs, version handling, safety fields ignored.
- `src/domain/config/config.paths.test.ts`: `GITMINAL_CONFIG`, XDG, home, Windows APPDATA, keybindings and theme resolution.
- `src/domain/config/config.loader.test.ts`: malformed JSON, unreadable file, missing file silent.
- `src/app/providers/ConfigProvider.test.tsx` and `KeymapProvider.test.tsx`: reload applies in place; footer, help, and palette agree.
- `src/app/hooks/useHotkeys.test.ts`: precedence order; printable suppressed in inputs.

## 14. Open questions

- Whether `config.writer.ts` should be shared with the theme picker persistence path or remain theme-only (the picker writes the `theme` field; see `20-theme-and-colors.md`).
- The exact cap for displayed warnings.
- Whether an unbind (`[]`) should also be reported in the footer as a dimmed unavailable hint or omitted entirely.
