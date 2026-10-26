# 19 - Configuration and Keybindings

## 1. Header

- Spec reference: `docs/product-spec.md` F-19 (lines 1154-1323), decisions D11 and D2, section 6 "Keyboard map" (lines 1539-1704), and section 6.1 "Action IDs" (lines 1705-1742).
- Dependencies: `01-app-shell-and-focus.md` (footer and help read effective bindings), `14-help.md` (Configuration section), `12-command-palette.md` (Reload configuration), `16-repository-states.md` (scope-dependent availability), `17-freshness-and-performance.md` (graph reload on scope change), `18-safety-and-platform-behavior.md` (non-configurability), `20-theme-and-colors.md` (theme path and reload).
- Owned paths:
  - `src/domain/config/config.types.ts`
  - `src/domain/config/config.defaults.ts`
  - `src/domain/config/config.paths.ts`
  - `src/domain/config/config.loader.ts`
  - `src/domain/config/config.validate.ts`
  - `src/domain/config/config.validate.fields.ts`
  - `src/domain/config/config.validate.guards.ts`
  - `src/domain/config/config.validate.keybindings.ts`
  - `src/domain/config/config.warnings.ts`
  - `src/domain/config/config.writer.ts`
  - `src/domain/config/config.atomic.ts`
  - `src/domain/config/config.atomic.constants.ts`
  - `src/domain/config/config.atomic.types.ts`
  - `src/domain/config/config.errors.ts`
  - `src/domain/keymap/keymap.types.ts`
  - `src/domain/keymap/keymap.defaults.ts`
  - `src/domain/keymap/keymap.parse.ts`
  - `src/domain/keymap/keymap.resolve.ts`
  - `src/domain/keymap/keymap.conflicts.ts`
  - `src/domain/keymap/keymap.describe.ts`
  - `src/app/providers/ConfigProvider.tsx`
  - `src/app/providers/ConfigProvider.types.ts`
  - `src/app/providers/config.source.ts`
  - `src/app/providers/KeymapProvider.tsx`
  - `src/app/providers/KeymapProvider.types.ts`
  - `src/app/hooks/useConfig.ts`
  - `src/app/hooks/useConfigActions.ts`
  - `src/app/hooks/useMouseSetting.ts`
  - `src/app/hooks/useKeymap.ts`
  - `src/app/hooks/useHotkeys.ts`

Consumed paths (not owned):
- `src/domain/commands/commands.registry.ts`
- `src/domain/commands/commands.types.ts`
- `src/domain/commands/commands.availability.ts`
- `src/app/hooks/useAction.ts`
- `src/features/shell/regions.ts` (region IDs and their `focus.region.*` action IDs)
- `src/domain/repository/repository.states.ts` (`gateRepository`)

## 2. Scope and non-goals

In scope: config file locations and precedence; keybindings and theme file resolution; load order; the config schema with defaults and ranges; unknown field and invalid value handling; the safety non-configurability rule; binding value forms; key syntax; conflict rules per context; `Ctrl+C`; the unbound quit, help, and palette warning; validation and warning surface; Reload configuration and what reloads immediately; the action catalogue and its relationship to command IDs; the three input modes; scoped handler registration; the two keymap describe outputs; target-aware availability; help discovery of effective bindings.

Non-goals: a settings screen; hot watching config files; comments or JSON5; schema migration beyond version detection; per-repository config; implementing command behavior, which belongs to the owning feature docs.

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
| `useAction` | Handler registration in the app, the shell, and the owning feature | One handler per `(actionId, scope)`; the resolved scope selects the handler. |

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
- `src/domain/config/config.validate.fields.ts`
- `src/domain/config/config.validate.guards.ts`
- `src/domain/config/config.validate.keybindings.ts`
- `src/domain/config/config.writer.ts`
- `src/domain/config/config.atomic.ts`
- `src/domain/config/config.atomic.constants.ts`
- `src/domain/config/config.atomic.types.ts`
- `src/domain/config/config.errors.ts`
- `src/domain/keymap/keymap.types.ts`
- `src/domain/keymap/keymap.defaults.ts`
- `src/domain/keymap/keymap.parse.ts`
- `src/domain/keymap/keymap.resolve.ts`
- `src/domain/keymap/keymap.conflicts.ts`
- `src/domain/keymap/keymap.describe.ts`
- `src/app/providers/ConfigProvider.tsx`
- `src/app/providers/ConfigProvider.types.ts`
- `src/app/providers/config.source.ts`
- `src/app/providers/KeymapProvider.tsx`
- `src/app/providers/KeymapProvider.types.ts`
- `src/app/hooks/useConfig.ts`
- `src/app/hooks/useConfigActions.ts`
- `src/app/hooks/useKeymap.ts`
- `src/app/hooks/useHotkeys.ts`

## 6. State model

- `ConfigProvider` (provider state): the resolved config object, the resolved file paths (config, keybindings, theme), the per-file load status, the validated `keybindings.json` overrides, the raw `theme.json` layer, the bounded warning list, and a reload function. Source: `@/domain/config`, loaded before the first render by `src/app/providers/config.source.ts`.
- `KeymapProvider` (provider state): the resolved action-to-keys map, the effective key-to-action map per context, and the conflict and warning list. It resolves both override layers: `config.json` keybindings, then `keybindings.json`. Source: `@/domain/keymap`.
- `ThemeProvider` and `src/theme/useTokens.ts`: theme path and active theme name for Help; theme resolution is specified in `20-theme-and-colors.md`.
- Handler registry (`src/app/hooks/useAction.ts`): one registered handler per `(actionId, scope)`, keyed by the action ID and an explicit scope of `global`, a `RegionId`, or `overlay`. It is not provider state and not a feature-local copy; the key resolution in section 8 selects the scope, and a duplicate registration is rejected rather than last-mounted-wins.
- Input mode metadata: each focused editor declares `field`, `search`, or `form` when its owner registers it. `useHotkeys` reads that declaration as part of resolution; it is not a provider flag and no feature decides a mode ad hoc.
- Feature view state: none for config; features read `useConfig` and `useKeymap`. `useHotkeys` holds only the transient resolution context (overlay open, focused region, focused input).
- `ConfigProvider` sits outermost; `KeymapProvider` sits inside it because keybindings depend on resolved config.

## 7. Data flow

```text
launch -> config.paths resolves files -> config.loader reads -> config.validate per field
   -> ConfigProvider (resolved config + per-file status + warnings)
   -> keymap.defaults + config.keybindings + keybindings.json -> keymap.parse
   -> keymap.resolve -> keymap.conflicts -> KeymapProvider
   -> useHotkeys dispatches action IDs -> useAction handler for the resolved scope
   -> command ID + explicit CommandTarget -> commands.registry / useCommandRunner
```

The bootstrap calls `config.source.ts` before the first render, so there is no loading state. `app.reloadConfig` is registered once by `src/app/hooks/useConfigActions.ts`: it re-runs the same source, and `ConfigProvider` applies the result in one transition or keeps the previous effective configuration when the main file is rejected. The same hook reports every load warning, and every theme resolution warning from `ThemeProvider`, as a top-bar warning status plus one console notice, never as an overlay; theme warnings carry a `Theme:` prefix and the combined list is bounded and deduplicated.

Reload flow: `app.reloadConfig` -> `config.loader` re-reads the main config, keybindings, and theme -> `config.validate` -> if valid, `ConfigProvider` and `KeymapProvider` update in place; the graph reloads when `graph.scope` or `graph.initialPageSize` changed; diffs redraw with the new `diff.contextLines`; mouse and theme apply immediately; footer, help, and palette re-read effective bindings.

Theme persistence: the theme picker saves through `config.writer.ts`, which writes only the `theme` field of the main file and hands the replacement to `config.atomic.ts`. The atomic writer creates the parent directory when it is missing and replaces `config.json` through a sibling temp file and a rename. An existing `config.json` that is a symlink is resolved to its target first, so a dotfiles-managed file is updated in place and the link stays a link; a link whose target does not exist yet keeps its recorded target, so the write creates that file instead of replacing the link with a regular one. The existing file's permission bits are carried onto the temp file before the rename, so a user-hardened `0600` file stays `0600`, while a new file uses the platform default mode. Temp files left behind by a killed process are swept before the next write: only siblings matching this writer's own `.config.json.<digits>-<base36 token>.tmp` pattern and older than 60 seconds by `mtime` are removed, best-effort and with no effect on the write result. The age bound keeps a second gitminal process's in-flight temp file safe: a same-host, same-clock writer is protected, while a skewed clock can still misjudge the age. The writer still expects to be the only long-lived writer of the target, and a sibling with a different name is never touched.

Resolution algorithm (exact, module level):

1. `config.paths.ts` resolves `config.json` by precedence: `$GITMINAL_CONFIG` when set and non-empty, then `$XDG_CONFIG_HOME/gitminal/config.json` when `XDG_CONFIG_HOME` is set, then `~/.config/gitminal/config.json` otherwise, then on Windows `%APPDATA%\gitminal\config.json` when the XDG and home paths are unavailable. It resolves `keybindings.json` from `$GITMINAL_KEYBINDINGS` when set and non-empty, otherwise next to the resolved config file, and `theme.json` from `$GITMINAL_THEME` when set and non-empty, otherwise next to the resolved config file. Every result is absolute: a relative `$GITMINAL_CONFIG`, `$GITMINAL_KEYBINDINGS`, or `$GITMINAL_THEME` value is resolved against the launch working directory, while `XDG_CONFIG_HOME`, `APPDATA`, and the home directory are used only when they are already absolute, so a relative value is ignored and the next step of the precedence decides the location.
2. `config.loader.ts` reads each file. A missing file yields no warning. An unreadable or malformed file yields a warning naming the file and parse error and never blocks launch.
3. `config.defaults.ts` provides built-in defaults. `config.validate.ts` merges per field: defaults, then `config.json`, then `keybindings.json` (keybindings only). Unknown fields and unknown action IDs are reported and ignored. An invalid field keeps the previous effective value and adds a warning. A missing `version` is treated as 1; a newer version is ignored with a warning.
4. `keymap.parse.ts` parses each binding value into a normalized key token: modifiers (`ctrl` or `control`, `shift`, `alt` or `option`, `cmd`, `command`, or `meta`, and `mod`) plus a base key (a named key or a printable character). Modifier order is irrelevant. Uppercase letters normalize to `shift` plus the lower letter. Unsupported keys and platform modifiers are reported and ignored on that platform. `mod` expands to Control on Linux and Windows and Command on macOS. Built-in defaults that display `Ctrl/Cmd` bind both `ctrl` and `mod`. A literal space is written as `space` because every segment is trimmed, and `+` is the separator, so a plus key cannot be expressed as a binding.
5. `keymap.resolve.ts` builds, per context, the effective key-to-action map: start from `keymap.defaults.ts`; apply `config.json` `keybindings` per action (a string or an array replaces the whole list); apply `keybindings.json` per action (it wins over `config.json` for the same action); apply `null` as reset-to-default and `[]` as unbind; actions not mentioned keep the previous value. Context actions override global actions for the same key. `Ctrl+C` is injected as a non-overridable quit and cancel entry.
6. `keymap.conflicts.ts` scans each context for two different actions sharing a key. On conflict it rejects the conflicting overrides, keeps the built-in defaults for those actions, and records a warning naming both action IDs and the key. It also warns when quit, help, and the palette end up with no binding.
7. `keymap.describe.ts` reads the resolved map and produces two distinct outputs from the same resolution. `describeFooterHints(keymap, context, options)` returns footer hints filtered by the focused region and current availability. `describeHelpRows()` returns every implemented action, including actions that are currently unavailable or unbound, and attaches the availability reason as data rather than removing the row. Help never filters unavailable actions out. The `focus.region.*` actions are included in Help and the palette but are not emitted as footer hints, so nine jump hints never crowd out the per-region hints.

Action catalogue and command boundary:

- `keymap.defaults.ts` is the action catalogue and contains exactly the action IDs from product spec section 6.1 with their default bindings. It includes the remote variants `remote.pushForceSafe`, `remote.pushForceOverwrite`, and `remote.pushNoVerify`; the commit variants `commit.submitNoVerify`, `commit.amend`, and `commit.amendNoVerify`; the diff intents `diff.deleteUntracked` and `diff.deleteAllUntracked`; and `form.submit`. The remote and commit variants have no default key, and `form.submit` defaults to `Ctrl/Cmd+Enter` as the submit action for every multiline form while single-line forms keep native `Enter`. `app.help` binds `?` and `F1`, and `app.palette` binds `Ctrl/Cmd+P` and `F2`; each pair is two alternative bindings for one action ID and resolves to the same scoped handler, not to separate actions.
- Command IDs are not action IDs. `src/domain/commands/commands.registry.ts` is the single command catalogue, and each descriptor declares `id`, optional `actionId`, `kind` (`mutation`, `read`, or `navigation`), handler `scope` (`global`, a `RegionId`, or `overlay`), `targetKind`, label, description, keywords, category, `paletteInvocable`, and `needsInput`. Most commands reuse their action ID as the command ID. Internal commands such as `graph.selectCommit`, `stash.select`, `worktree.select`, and `graph.selectPending` are command IDs with no action ID and no default key; they are never accepted in configuration and never appear in the action catalogue.
- Availability is target-aware. `commands.availability.ts` exposes `getAvailability(commandId, context)`; it combines `gateRepository(actionId, state, signals)` from `repository.states.ts` with target validation for the descriptor's `targetKind` and returns `{ available, reason }`. Footer hints, help rows, palette entries, buttons, and confirmations all read that same result. A target is the explicit `CommandTarget` derived from the right-pane selection union or the owning region's cursor projection, never another feature's local state or a hidden panel's stale cursor.

## 8. Keyboard and focus

Action IDs only. The key-bindable IDs include `app.quit`, `app.help`, `app.palette`, `app.console`, `app.refresh`, `app.reloadConfig`, `app.themePicker`, `overlay.close`, `focus.next`, `focus.previous`, `focus.region.*`, `form.submit`, the remote variants `remote.pull`, `remote.push`, `remote.pushForceSafe`, `remote.pushForceOverwrite`, `remote.pushNoVerify`, `remote.fetch`, `remote.fetchPrune`, `remote.more`, the commit variants `commit.submit`, `commit.submitNoVerify`, `commit.amend`, `commit.amendNoVerify`, `commit.options`, the diff intents `diff.deleteUntracked` and `diff.deleteAllUntracked`, plus every other context action in product spec section 6.1. Override syntax handling:

- String value: a single binding, replacing the list.
- Array value: replaces the whole list; it is not appended.
- `null`: resets to the built-in default (useful in `keybindings.json` to undo a value from `config.json`).
- `[]`: unbinds; the action still appears in the palette and help.
- Unknown action ID: ignored with a warning.
- Invalid binding: ignored; the previous effective binding remains.
- Direct focus: `focus.region.branches`, `focus.region.remotes`, `focus.region.tags`, `focus.region.stashes`, `focus.region.worktrees`, `focus.region.graph`, `focus.region.rightPane`, `focus.region.diff`, and `focus.region.console` default to `1`-`9`; `focus.region.topBar` defaults to unbound. All ten are ordinary global actions, so they accept any override form, including `null` to restore the digit and `[]` to unbind. Rebinding a digit to another action produces a conflict warning in the global context rather than silently changing the jump map.
- Alternative defaults: `app.help` binds `?` and `F1`, and `app.palette` binds `Ctrl/Cmd+P` and `F2`. Both keys in each pair belong to the same action ID; an override replaces the whole pair unless it names both keys again. The alternate keys keep both actions reachable when a terminal reserves the primary binding.
- No default key: `remote.pushForceSafe`, `remote.pushForceOverwrite`, `remote.pushNoVerify`, `commit.submitNoVerify`, `commit.amend`, `commit.amendNoVerify`, `app.reloadConfig`, and `focus.region.topBar`. They stay reachable from their menu, the palette, and help.
- Internal command IDs are not configurable and have no action ID: `graph.selectCommit`, `stash.select`, `worktree.select`, and `graph.selectPending` never resolve from this keymap and never appear in `keybindings.json`.

Keymap resolution is context-only: one action per `(KeymapContext, key)`. `KeymapContext` uses the exact `RegionId` strings plus `global` and `overlay`, so `useHotkeys` passes `FocusProvider.activeRegion` straight to the resolved map without an adapter. Target-aware intent selection belongs to the owning feature handler, not the keymap. For example `d` and `D` always resolve to `diff.discard` and `diff.discardAll`, and `useDiffPanel` routes them to `diff.deleteUntracked` or `diff.deleteAllUntracked` when the target section is untracked. `nav.left` and `nav.right` bind the top bar, the right pane, and overlays with `Left`/`h` and `Right`/`l`; sidebar panels do not bind them because the collapsed switcher is a native `<tab-select>` and owns those keys in native list mode. `nav.up` and `nav.down` bind every list context plus the right pane for its parent list, while the composer textarea keeps those unmodified keys through its focused input mode. Shared paging binds `graph`, `console`, and `overlay`; the sidebar panels and `diff` do not bind paging. `nav.first` and `nav.last` bind `branches`, `remotes`, `graph`, `console`, and `overlay`; `tags`, `stashes`, `worktrees`, and `diff` do not bind them.

Handler registration: every handler is registered with `useAction(actionId, { scope, targetKind }, handler)`. Exactly one handler may exist per `(actionId, scope)`, and a duplicate registration is a development error that is rejected, never last-mounted-wins. The resolved keymap selects which scope handles a key, and `useAction` invokes exactly that scope's handler; a key handled in the focused region context does not reach the global handler. Global actions (`app.*`, `focus.*`, `remote.*`, `overlay.close`) have one designated owner in `src/app`, the shell, or the always-mounted top bar. Features register only their region-scoped actions, such as `branch.delete`, `diff.stage`, or `nav.activate`; a panel that unmounts in the collapsed layout never owns a global handler, and a feature cannot register a global action.

Input modes are part of keymap resolution, not exceptions handled ad hoc by features. Every focused editor resolves to exactly one declared `InputMode`:

- `field` owns every unmodified printable key, Backspace, Delete, arrows, Home, End, and Enter. A textarea's Enter inserts a newline; a single-line input's Enter invokes its native submit callback.
- `search` keeps printable keys and editing keys in the field, but routes Up, Down, PageUp, PageDown, Home, and End to the bound result list and routes Enter to `nav.activate` for the highlighted result. The owner declares the mode when it registers the input.
- `form` keeps printable keys and Enter in a single-line field, routes `Tab` and `Shift+Tab` between fields and footer actions, and maps `Ctrl/Cmd+Enter` to `form.submit`. A multiline form field keeps `Tab` for indentation and also uses `Ctrl/Cmd+Enter` for `form.submit`.

`form.submit` defaults to `Ctrl/Cmd+Enter` and is the submit action for every multiline form; single-line forms keep native `Enter`. In text input mode, only the explicit text-input-safe allowlist `app.palette`, `app.console`, `commit.submit`, `commit.options`, and `form.submit` may fire. An allowlisted action fires only when its effective binding uses `Ctrl`, `Cmd`, or `Alt`; an unmodified default binding for the same action never fires while an editor is focused, which is why `commit.options` remains reachable as `Alt+.` in the composer while plain `.` types a period. `form.submit` satisfies this rule through its default `Ctrl/Cmd+Enter` binding. Every other key, including every modified key outside the allowlist and OpenTUI editing shortcuts such as `Ctrl+A/E/F/B/W`, `Ctrl+Backspace/Delete`, `Ctrl+K/U`, `Ctrl+-/.`, `Super+A/Z`, and `Alt+D/F/B` plus arrow variants, passes to the input or textarea untouched. A plain printable binding never fires while a text input or filter field has focus. `Ctrl+C` is a hardcoded quit and cancel path and cannot be unbound.

Precedence at runtime: open overlay, then text input mode, then native list widget, then focused region context, then global. In text input mode, `Esc` leaves the field and normally returns focus to the owning region frame; a feature may consume the first `Esc` for a documented clear or cancel, but the next one leaves. `Tab` on a single-line input moves to the next region, or to the next field or action inside a modal; `Tab` on a textarea inserts the indent unit and `Shift+Tab` outdents, including inside a modal. Help reflects effective bindings after overrides, and `describeHelpRows()` lists every action, including unavailable and unbound ones, with its availability reason.

## 9. Loading, empty, error, and disabled states

- Loading: config loads synchronously at startup with no visible loading state; reload shows a transient status.
- Empty: absent files produce no warning; Help shows "not present" for the keybindings and theme paths.
- Error: invalid JSON ignores the file, keeps defaults, and warns with the file and parse error; an invalid version ignores the file with a warning; an invalid field keeps the previous value; an invalid keybindings file leaves `config.json` keybindings applied and defaults elsewhere; an invalid theme file keeps the base theme.
- Disabled: a config that unbinds quit, help, and the palette still loads but shows a prominent warning. Actions with no binding render as "Unbound" in help. Unbinding a direct region jump is not warned about, because `Tab` and the palette command remain available.
- Unavailable versus unbound: an action that is bound but cannot run now stays in help with its effective keys, description, and availability reason. Only `describeFooterHints()` drops it from the footer; `describeHelpRows()` never drops it. Unbound is a separate state rendered as "Unbound" and is still listed, searchable, and palette-visible.
- Warnings surface: a non-blocking message in the top bar status strip, plus a detailed entry in Help > Configuration and the console. Configuration warnings and theme resolution warnings share that surface, stay distinguishable by the `Theme:` prefix on theme messages, and are reported once per distinct combined set.

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
- "Printable overrides do not fire while typing." -> `useHotkeys` text-input mode.
- Alternative bindings `?`/`F1` for `app.help` and `Ctrl/Cmd+P`/`F2` for `app.palette` -> `keymap.defaults.ts` and resolution step 5, which resolves each pair to one action ID.
- Multiline `form.submit` on `Ctrl/Cmd+Enter`, with native `Enter` kept for single-line forms -> `keymap.defaults.ts`, the `form` input mode in `keymap.resolve.ts`, and `useHotkeys`.
- Unavailable actions stay listed in help with a reason, while only footer hints drop them -> the two `keymap.describe.ts` outputs plus `commands.availability.ts`.
- Internal selection commands are command IDs, not configurable action IDs -> `keymap.defaults.ts` versus `commands.registry.ts`.
- Target-aware availability with one reason shared by footer, help, palette, and buttons -> `commands.availability.ts`.
- File locations and load order -> `config.paths.ts`, `config.loader.ts`.

## 13. Tests to add

- `src/domain/keymap/keymap.resolve.test.ts`: precedence tables (defaults, config, keybindings.json, null reset, [] unbind, string versus array) and context-over-global; the default `focus.region.*` bindings are `1`-`9` in screen order with `focus.region.topBar` unbound; `app.help` resolves both `?` and `F1`, `app.palette` resolves both `Ctrl/Cmd+P` and `F2`, and a single override replaces the pair; `form.submit` defaults to `Ctrl/Cmd+Enter`; the no-default variants (`remote.pushForceSafe`, `remote.pushForceOverwrite`, `remote.pushNoVerify`, `commit.submitNoVerify`, `commit.amend`, `commit.amendNoVerify`, `app.reloadConfig`, `focus.region.topBar`) resolve to an empty binding list; shared paging resolves in `graph`, `console`, and `overlay`; `nav.first` and `nav.last` resolve in `branches`, `remotes`, `graph`, `console`, and `overlay`; `tags`, `stashes`, `worktrees`, and `diff` resolve neither `g` nor `G`; `nav.up` and `nav.down` resolve in `right-pane`; the catalogue, its actions, its context and default lists, and the required-action list are frozen.
- `src/domain/keymap/keymap.conflicts.test.ts`: conflict table with both action IDs and the key; a digit rebound to another action in the global context is reported; unbound quit, help, and palette warning; the two keys of one action never conflict with each other.
- `src/domain/keymap/keymap.parse.test.ts`: modifier aliases, `mod` per platform, named keys, uppercase handling, unsupported keys, the literal space rejected while `space` is accepted, and `enter` plus `Ctrl/Cmd+Enter` staying distinct.
- `src/domain/keymap/keymap.describe.test.ts`: `formatBinding` uppercases a modified single-letter base key (`ctrl+p` becomes `Ctrl+P`, `mod+p` becomes `Cmd+P`, `ctrl+c` becomes `Ctrl+C`), keeps a plain `q` lowercase, renders a shifted letter as the uppercase letter, leaves symbols and named keys alone, and omits `Shift` for symbols and digits whose Shift lookup ignores.
- `src/domain/config/config.validate.test.ts`: per-field fallback, unknown fields, unknown action IDs, version handling, safety fields ignored; every new action ID (`remote.pushForceSafe`, `remote.pushForceOverwrite`, `remote.pushNoVerify`, `commit.submitNoVerify`, `commit.amend`, `commit.amendNoVerify`, `diff.deleteUntracked`, `diff.deleteAllUntracked`, `form.submit`) is accepted; internal command IDs (`graph.selectCommit`, `stash.select`, `worktree.select`, `graph.selectPending`) are reported as unknown action IDs and ignored.
- `src/domain/config/config.paths.test.ts`: `GITMINAL_CONFIG`, XDG, home, Windows APPDATA, keybindings and theme resolution, including relative and absolute environment values on POSIX and Windows.
- `src/domain/config/config.loader.test.ts`: malformed JSON, unreadable file, missing file silent.
- `src/domain/config/config.errors.test.ts`: a missing-file error is detected by its `ENOENT` code and every other value is not, and a thrown message is flattened to one line.
- `src/domain/config/config.atomic.test.ts`: the temp-name predicate matches the `<digits>-<base36 token>` shape and rejects a differently shaped sibling, another target's temp file, an empty token, and uppercase letters; the age predicate treats an old file as stale, a recent file as still in flight, a file exactly at the 60 000 ms bound or one millisecond under it as still in flight while one millisecond past the bound is stale, and a missing file as not stale.
- `src/domain/config/config.writer.test.ts`: writes only the theme field and preserves every other field; creates a minimal configuration when the file is absent; refuses an oversized, malformed, or non-object file and leaves it untouched; creates a missing configuration directory and leaves no temp file behind; keeps the original file and removes the temp file when the rename fails; fails without throwing when the parent path is not a directory or no config path resolves; writes through a symlinked config, including a dangling link into a directory that does not exist yet, and keeps the link a symlink; sweeps a matching temp file older than the age bound while keeping a recent one, a differently shaped sibling, and unrelated files; fails without touching the original file in a read-only directory; preserves the mode of an existing file.
- `src/app/providers/ConfigProvider.test.tsx` and `KeymapProvider.test.tsx`: reload applies in place; footer, help, and palette agree.
- `src/domain/keymap/keymap.describe.test.ts`: `describeHelpRows()` returns every implemented action regardless of availability, including unavailable actions with their reason and unbound actions labeled "Unbound"; `describeFooterHints()` drops unavailable actions; the `focus.region.*` actions appear in Help and the palette with their effective keys but never in the footer hint list; both outputs agree on effective keys.
- `src/app/hooks/useHotkeys.test.ts`: precedence order; printable suppressed in inputs; `field`, `search`, and `form` routing; `form.submit` on `Ctrl/Cmd+Enter`; the allowlist fires only when the effective binding has a modifier.
- `src/app/hooks/useAction.test.tsx`: exactly one handler per `(actionId, scope)`; a duplicate is rejected rather than last-mounted-wins; resolution selects the scoped handler before the global one; a feature registration for a global action is rejected.
- `src/domain/commands/commands.availability.test.ts`: target-aware reasons for tracked versus untracked diff targets, commit variants, and force-push variants; the same `{ available, reason }` feeds footer, help, palette, and buttons.

## 14. Open questions

- The exact cap for displayed warnings.
- Whether an unbind (`[]`) should also be reported in the footer as a dimmed unavailable hint or omitted entirely.
