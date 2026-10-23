# 21 - Startup splash and update check

## 1. Header

Spec reference: `docs/product-spec.md` section 3 "Application shell" (lines 67-162), section 5 F-21 "Startup splash and update check" (lines 1488-1538), section 6 "Keyboard map" startup splash (lines 1543-1549), decision D19 (line 1887), and the assumed defaults for the splash and npm check (lines 1890-1908).
Dependencies: none for the splash at runtime. The splash runs before the providers in `01-app-shell-and-focus.md` mount. The post-dismissal `WorkspacePlaceholder` mounts inside the config, theme, and keymap providers from `19-configuration-and-keybindings.md` and `20-theme-and-colors.md`, and reads their resolved values only for its status line. `01-app-shell-and-focus.md` owns the shell that appears after dismissal, including the `app.quit` path and the `exitOnCtrlC: false` renderer contract.
Owned paths: `src/features/splash/SplashScreen.tsx`, `src/features/splash/SplashScreen.constants.ts`, `src/features/splash/SplashUpdateNotice.tsx`, `src/features/splash/useUpdateCheck.ts`, `src/features/splash/useUpdateCheck.types.ts`, `src/app/App.tsx` (splash state and temporary quit callback), `src/app/SplashGate.tsx`, `src/app/WorkspacePlaceholder.tsx`, `src/app/quit.key.ts`, `src/app/app.constants.ts`, `src/domain/update/update.check.ts`, `src/domain/update/update.types.ts`, `src/domain/update/update.constants.ts`, `src/lib/semver.ts`, `src/lib/semver.types.ts`.

This document follows the 14-section contract in `00-project-architecture.md` section 14 and conforms to the layer model in section 3, the OpenTUI catalog in section 6, and the state rules in section 9. Where this document and the architecture contract disagree, the architecture contract wins.

## 2. Scope and non-goals

In scope: the full-screen startup splash; the `GITMINAL` wordmark in the tiny ASCII font; the running version line from `package.json`; the any-key dismissal through `SplashGate`; the `Ctrl+C` quit path before and after dismissal through the temporary app quit callback that the shell's `app.quit` replaces; the provider-backed placeholder status line that proves the M2 config, theme, and keymap core resolved without any configuration file; the small-terminal wordmark fallback; the one-shot npm registry update check; the semantic version comparison; and the update notice with the exact install command.

Non-goals: auto-update, self-update, install execution, changelog display, release notes, download progress, update scheduling, cached or periodic checks, telemetry, usage reporting, splash configuration, a splash animation, and any repository read. The splash never touches the repository, the index, or configuration files.

## 3. OpenTUI components used

| Component | Where used | Why it is the right component |
| --- | --- | --- |
| `<box>` | Splash root layout, the update notice block, the wordmark fallback container, and the press-any-key row. | The only layout primitive. Text is never rendered directly on a box. |
| `<text>` | The version line, the checking hint, the update notice lines, the install command, the press-any-key hint, the small-terminal wordmark fallback, and the provider-backed core status line on the post-dismissal placeholder. | Every string of UI text goes through `<text>`. |
| `<ascii-font>` | The `GITMINAL` wordmark with `font="tiny"`. | The sanctioned wordmark renderer for the startup splash, matching the OpenTUI tiny font. |
| `<span>` | Not used. The splash has no inline mixed styling. | N/A. |
| `<select>`, `<input>`, `<scrollbox>`, `<diff>`, `<code>`, `<markdown>`, `<textarea>`, `<image>`, `<frame-buffer>` | Not used. | N/A. The splash is non-interactive beyond dismissal. |

OpenTUI hooks used:

| Hook | Where used | Note |
| --- | --- | --- |
| `useKeyboard` | `SplashGate` owns the only subscription while the splash is visible; `WorkspacePlaceholder` owns the only quit-only subscription after dismissal. | Exactly one app keyboard subscriber is mounted at a time. `SplashGate` dismisses on any key except `Ctrl+C` and routes `Ctrl+C` to the quit callback. `WorkspacePlaceholder` mounts inside the config, theme, and keymap providers but does not dispatch the resolved keymap; it handles only `Ctrl+C` until `useHotkeys` owns keys after the shell mounts. |
| `useTerminalDimensions` | `SplashScreen` chooses between the ASCII wordmark and the plain-text fallback. | Single source for columns and rows. |
| `useRenderer` | Used by `App` to build the quit callback that destroys the renderer. `src/index.tsx` creates the renderer with `exitOnCtrlC: false`, so `Ctrl+C` is delivered as a key and never exits the renderer by default. | `SplashGate` and `WorkspacePlaceholder` receive that callback as `onQuit`, which routes `Ctrl+C` through the same terminal restore path the shell will use; the shell will own `app.quit` and terminal restore from the next milestone. |

Icons: the splash uses no glyphs or markers. All splash text is words, so it does not read `src/theme/icons.ts`. Any future marker on the splash must be added to `src/theme/icons.ts` and given a text equivalent rather than inlined. See `00-project-architecture.md` section 6.1.

## 4. Component tree

```text
src/index.tsx (bootstrap: createCliRenderer({ exitOnCtrlC: false }) + createRoot)
-> src/app/App.tsx                          (root: splash state + temporary quit callback)
   -> src/app/SplashGate.tsx                (mounted only while the splash is visible)
      -> src/features/splash/SplashScreen.tsx
         -> ascii-font                      (wordmark, or plain text below the fallback size)
         -> src/features/splash/SplashUpdateNotice.tsx
   -> src/app/providers/ConfigProvider.tsx  (after dismissal)
      -> src/app/providers/ThemeProvider.tsx
         -> src/app/providers/KeymapProvider.tsx
            -> src/app/WorkspacePlaceholder.tsx   (provider-backed, until the app shell mounts)
```

`App` owns `splashDismissed` and the temporary quit callback, and it does not subscribe to keys. `SplashGate` is mounted only while the splash is visible; it calls `useUpdateCheck`, owns the single splash `useKeyboard` subscription, and renders `SplashScreen`. On dismissal `SplashGate` unmounts and the config, theme, and keymap providers mount with `WorkspacePlaceholder`, which has the quit-only subscription, so exactly one app keyboard subscriber exists at a time. The placeholder reads `useTheme`, `useTokens`, and `useKeymap` for its status line only; it does not dispatch keys through the keymap until `useHotkeys` lands with the shell. Both gate components compare the quit chord through `src/app/quit.key.ts`. Because the renderer is created with `exitOnCtrlC: false`, `Ctrl+C` reaches the mounted gate as a key event and quits through the temporary quit path instead of relying on a renderer default exit.

## 5. Enforced files and folders

| File | Responsibility |
| --- | --- |
| `src/app/App.tsx` | Root component: holds the `splashDismissed` state and the temporary quit callback that destroys the renderer, then renders either `SplashGate` or the config, theme, and keymap providers around `WorkspacePlaceholder`. It does not subscribe to keys. |
| `src/app/SplashGate.tsx` | Splash gate: runs `useUpdateCheck`, owns the single splash `useKeyboard` subscription, routes `Ctrl+C` to `onQuit`, dismisses on any other key through `onDismiss`, and renders `SplashScreen`. |
| `src/app/WorkspacePlaceholder.tsx` | Post-dismissal placeholder: mounts inside the config, theme, and keymap providers, renders the provider-backed status line (resolved theme label and action count), owns the single quit-only `useKeyboard` subscription, and routes `Ctrl+C` to `onQuit`. It ignores every other key until `useHotkeys` replaces it. |
| `src/app/quit.key.ts` | `isQuitKey`: the single raw-key comparison for the temporary `Ctrl+C` quit path shared by `SplashGate` and `WorkspacePlaceholder`. |
| `src/app/app.constants.ts` | Exports `APP_PACKAGE_NAME` and `APP_VERSION` read from `package.json`. Single source for the version shown on the splash, the registry URL, the install command, and the version comparison. |
| `src/features/splash/SplashScreen.tsx` | Presentational splash: wordmark, version, update notice, press-any-key hint, and the small-terminal fallback. It imports the wordmark thresholds from `SplashScreen.constants.ts` and the notice from `SplashUpdateNotice.tsx`. It does not subscribe to keys and does not perform the check. |
| `src/features/splash/SplashScreen.constants.ts` | `WORDMARK_MIN_COLUMNS` and `WORDMARK_MIN_ROWS`: the thresholds for the ASCII wordmark. |
| `src/features/splash/SplashUpdateNotice.tsx` | Presentational update area: the checking hint, the available-version notice and install command, and nothing for up-to-date or unavailable results. |
| `src/features/splash/useUpdateCheck.ts` | Feature hook: runs one `checkForUpdate` call on mount, follows the latest checker prop in a ref so a new checker identity does not restart it, ignores late results after unmount, and returns `checking` or the settled result. Changing `packageName` or `currentVersion` resets the state to `checking` before the replacement request starts. Changing only the checker does not restart the one-shot check because the effect depends only on the package name and version. A rejected checker becomes `unavailable` while mounted. |
| `src/features/splash/useUpdateCheck.types.ts` | `UpdateCheckState`: the splash-owned `checking` state unioned with the settled `UpdateCheckResult`. |
| `src/domain/update/update.check.ts` | The only network module: builds the registry URL, fetches bounded by `AbortSignal.timeout` and a local timeout race, parses the payload, and compares versions. Request and parse failures become `unavailable`. No React, no OpenTUI. |
| `src/domain/update/update.types.ts` | `UpdateCheckResult` union: `available`, `up-to-date`, and `unavailable`, plus the fetch and checker contracts. |
| `src/domain/update/update.constants.ts` | `NPM_REGISTRY_URL` and `UPDATE_CHECK_TIMEOUT_MS`. |
| `src/lib/semver.ts` | `parseVersion`, `compareVersions`, and `isNewerVersion`. Pure, tested, and free of React, git, and network code. |
| `src/lib/semver.types.ts` | `ParsedVersion`: the parsed release, prerelease, and build parts. |

Package baseline: `package.json` declares `name` `@im4all/gitminal` and `version` `0.1.0`, and its `engines.bun` floor is `>=1.3.14`. `tsconfig.json` enables `resolveJsonModule`, so `src/app/app.constants.ts` imports the manifest statically. `APP_PACKAGE_NAME` and `APP_VERSION` come from that manifest rather than duplicated literals; the splash version line, the registry request, the install command, and the comparison all read them.

## 6. State model

View state only in the splash. `SplashGate` owns the update state; the placeholder owns no state and only reads provider values.

- `App` owns `splashDismissed: boolean`. It flips once and never flips back. `App` also owns the temporary quit callback that destroys the renderer; it is the path shared by `SplashGate` and `WorkspacePlaceholder` until `app.quit` lands in the shell milestone.
- `SplashGate` owns the update state through `useUpdateCheck`, typed as `UpdateCheckState` (`{ status: "checking" }` or `UpdateCheckResult`) from `src/features/splash/useUpdateCheck.types.ts`. The `checking` lifecycle state belongs to the feature, not the domain.
- `WorkspacePlaceholder` holds no state. It receives `onQuit`, reads the resolved theme, tokens, and keymap from the mounted providers, and subscribes only to quit. Its status line shows the resolved theme label, not the configured string, so an unknown configured theme visibly falls back to Catppuccin Mocha.
- `SplashScreen` is stateless. It receives `version`, `packageName`, and `update` as props.
- `SplashUpdateNotice` is stateless. It receives `packageName` and `update` as props and derives all three render states from the union.
- `src/lib/semver.ts` and `src/domain/update/update.check.ts` are pure or injectable and hold no state.

The update result is intentionally not lifted into a provider or persisted. It lives only for the lifetime of `SplashGate`, so a dismissed splash discards it, matching F-21. If a later release surfaces updates outside the splash, that state moves to a provider and this document is updated.

## 7. Data flow

```text
launch -> App renders SplashGate
SplashGate -> useUpdateCheck -> checkForUpdate({ packageName, currentVersion })
   -> fetch https://registry.npmjs.org/<encoded package>/latest  (AbortSignal.timeout(UPDATE_CHECK_TIMEOUT_MS) + local timeout race)
   -> read payload.version -> isNewerVersion(latest, current)
   -> UpdateCheckResult -> setState -> SplashScreen -> SplashUpdateNotice re-renders the notice
any key except Ctrl+C -> SplashGate useKeyboard -> onDismiss -> App.splashDismissed = true -> SplashGate unmounts -> config, theme, and keymap providers mount -> WorkspacePlaceholder mounts
Ctrl+C on the splash -> SplashGate useKeyboard -> isQuitKey -> onQuit -> renderer.destroy() -> terminal restored
Ctrl+C after dismissal -> WorkspacePlaceholder useKeyboard -> isQuitKey -> onQuit -> renderer.destroy() -> terminal restored
provider-backed status line -> useTheme + useKeymap + useTokens -> resolved theme label, action count, muted foreground -> <text id="workspace-core-status">
```

The check is fire-and-forget. `packageName` and `currentVersion` are `APP_PACKAGE_NAME` and `APP_VERSION` from `package.json`. The splash renders on the first frame and never awaits the request. `AbortSignal.timeout` bounds the request, and `checkForUpdate` also races the request and parse against its own timer so a fetch implementation that ignores the signal still resolves to `unavailable` after `UPDATE_CHECK_TIMEOUT_MS`. Any request, response, or payload failure becomes `unavailable`, which the splash renders as nothing. Errors outside that boundary, such as a defect in the version comparison, are not swallowed. The check never blocks rendering, dismissal, or quit.

## 8. Keyboard and focus

The splash is not a focus region. No provider, keymap, or `useHotkeys` dispatch is mounted while the splash is visible.

| Key | Behavior |
| --- | --- |
| Any key except `Ctrl+C` | `SplashGate` calls `onDismiss`, which sets `App.splashDismissed`, mounts the config, theme, and keymap providers, and shows the workspace placeholder. |
| `Ctrl+C` while the splash is visible | `SplashGate` calls `onQuit` without dismissing. The renderer is created with `exitOnCtrlC: false`, so `Ctrl+C` arrives as a key event, and the callback destroys the renderer and restores the terminal. |
| `Ctrl+C` after dismissal | `WorkspacePlaceholder` calls `onQuit`, which destroys the renderer and restores the terminal. Every other key is ignored. |

Splash keys are fixed. They are not configurable and do not appear as action IDs in `src/domain/keymap/keymap.defaults.ts`, because the splash runs before the keymap resolves. The placeholder mounts after the keymap resolves, but app key dispatch is not wired until `useHotkeys` lands, so it still handles only the quit chord and never resolves an action ID. Exactly one app keyboard subscriber is mounted at a time: `SplashGate` while the splash is visible, and `WorkspacePlaceholder` after dismissal. `isQuitKey` in `src/app/quit.key.ts` is the only raw key comparison in this feature and the documented exception in `00-project-architecture.md` section 3. A quit never dismisses the splash, because `SplashGate` returns after routing `Ctrl+C` to `onQuit`. A digit pressed on the splash only dismisses it; the jump happens on the next digit press once the shell is mounted.

## 9. Loading, empty, error, and disabled states

| State | Splash behavior |
| --- | --- |
| Checking | `SplashUpdateNotice` shows `Checking for updates...` in dim text. |
| Update available | `SplashUpdateNotice` shows `Update available: <latest> (current <current>)` in bold, then `Run npm i -g @im4all/gitminal`. |
| Up to date | `SplashUpdateNotice` renders nothing. No success message. |
| Unavailable | `SplashUpdateNotice` renders nothing. Offline, timeout, HTTP error, and malformed payload are all silent. |
| Small terminal | Below `WORDMARK_MIN_COLUMNS` (40) or `WORDMARK_MIN_ROWS` (10) from `SplashScreen.constants.ts`, `SplashScreen` replaces the ASCII wordmark with `GITMINAL` in bold text. The version, notice, and hint still render. Each variable-length line uses `wrapMode="none"`, so it clips rather than wrapping; the install command never splits across rows. |

The three update states live in `SplashUpdateNotice`; the wordmark breakpoint lives in `SplashScreen.constants.ts`. There is no disabled state: the splash has no controls. There is no error overlay: a failed check is not an app failure.

## 10. Performance and bounds

- The splash renders in the first frame and never blocks on the update check.
- The check has a two second timeout, applied twice: `AbortSignal.timeout` is passed to fetch and `checkForUpdate` races the request and parse against its own timer. A fetch that ignores the signal still resolves to `unavailable` after `UPDATE_CHECK_TIMEOUT_MS`. The check is not retried.
- The check runs at most once per process launch and is not cached or persisted. The hook keeps the latest checker in a ref and depends only on the package name and running version, so a new inline checker identity on a parent render does not start a second request. Changing only the checker updates the ref for a later rerun but does not restart the one-shot check. Changing the package name or running version does start a replacement request, and the hook resets to `checking` before that request begins so the old result is never shown for the new identity.
- A late result after dismissal is ignored through the `active` flag in `useUpdateCheck`, so no state update happens after unmount.
- The wordmark is fixed-width ASCII art and never wraps; below the fallback size the plain wordmark is used instead.
- The update notice is at most two lines. The version, both notice lines, and the press-any-key hint use `wrapMode="none"`, so narrow terminals clip them instead of wrapping; the install command never splits across rows.
- No app-owned timers, polling, or scheduled work survive the splash. The local timeout timer is cleared when the request settles. The only pending work is the bounded registry request, and its result is discarded on dismissal.

## 11. Safety and confirmations

- The app never downloads, installs, or executes an update. It only prints the install command for the user to run.
- The install command is built from `APP_PACKAGE_NAME`, which is read from `package.json` and runs no code from the registry. A registry payload can never supply a package name, a URL, or a command.
- The check sends no credentials and reads no configuration, repository, or environment secrets.
- Failures stay silent and never block launch or claim an update exists.
- An unparseable local or registry version is treated as "no update", never as an update.
- The splash cannot perform a destructive action. There is nothing to confirm.
- Dismissal never loses work: the workspace has not started yet.

## 12. Acceptance mapping

| Product spec acceptance bullet | Implementing module or component |
| --- | --- |
| "Launching the app shows the splash with the wordmark, the running version, and the press-any-key hint." (F-21) | `src/features/splash/SplashScreen.tsx` and `src/app/app.constants.ts`; the version is `APP_VERSION` from `package.json` (`0.1.0` at baseline). |
| "Pressing any key opens the workspace, and `Ctrl+C` quits." (F-21) | `SplashGate` in `src/app/SplashGate.tsx`, `WorkspacePlaceholder` in `src/app/WorkspacePlaceholder.tsx`, and `isQuitKey` in `src/app/quit.key.ts`: any key except `Ctrl+C` dismisses, while `Ctrl+C` takes the temporary quit path because `createCliRenderer` uses `exitOnCtrlC: false`. |
| "A newer version shows the published version, the running version, and `npm i -g @im4all/gitminal`." (F-21) | `SplashUpdateNotice` in `src/features/splash/SplashUpdateNotice.tsx` with `src/domain/update/update.check.ts`; the install command derives from `APP_PACKAGE_NAME`. |
| "A current or failed check shows no update notice and no warning." (F-21) | `UpdateCheckResult` handling in `SplashUpdateNotice`. |
| "The splash appears and dismisses promptly and never waits on the check." (F-21) | `useUpdateCheck` fire-and-forget flow with `AbortSignal.timeout` and the local timeout race; dismissal and quit do not await the request. |
| "A running version newer than the registry version does not show a notice." (F-21) | `isNewerVersion` in `src/lib/semver.ts`. |

## 13. Tests to add

- `src/lib/semver.test.ts`: parse release, `v` prefix, build metadata, and prerelease identifiers; compare release ordering, prerelease precedence, and invalid input; reject whitespace-padded versions and release parts above `Number.MAX_SAFE_INTEGER`; compare numeric prerelease identifiers above `Number.MAX_SAFE_INTEGER` without precision loss; assert `isNewerVersion` is true only for a strictly newer candidate.
- `src/app/app.constants.test.ts`: `APP_PACKAGE_NAME` is `@im4all/gitminal` and `APP_VERSION` equals the `version` in `package.json`, proving the manifest import works with `resolveJsonModule`.
- `src/domain/update/update.check.test.ts`: newer registry version returns `available`; equal or older returns `up-to-date`; the scoped package name produces the literal `https://registry.npmjs.org/%40im4all%2Fgitminal/latest` URL; HTTP error, malformed payload, thrown network error, and `AbortSignal.timeout` abort return `unavailable`; a fetch that ignores the signal still returns `unavailable` through the local timeout; the function never throws; a pending request does not block the caller.
- `src/features/splash/SplashScreen.test.tsx`: renders the wordmark and the version from `APP_VERSION`; renders the checking hint through `SplashUpdateNotice`; renders the update lines and install command for `available`; renders nothing for `up-to-date` and `unavailable`; uses the plain wordmark below the `SplashScreen.constants.ts` thresholds and keeps the ASCII wordmark at exactly 40 columns and 10 rows; keeps every frame line within the terminal width, proves the full install command stays on one line where it fits, and proves a narrower width clips the command tail instead of wrapping it. The notice states are exercised through `SplashScreen`, so no separate `SplashUpdateNotice` test file duplicates them.
- `src/features/splash/useUpdateCheck.test.tsx`: a rejected checker becomes `unavailable` while mounted; a result that settles after unmount is discarded; a new inline checker identity does not start a second request; changing the package identity resets the state to `checking` before the replacement request settles.
- `src/app/App.test.tsx`: renders the splash wordmark and running version through `App`; first key press dismisses the splash and mounts the provider-backed workspace placeholder with the resolved theme label and action count; exactly one app keyboard subscriber is mounted while the splash is visible and exactly one quit-only subscriber after dismissal; `Ctrl+C` on the splash and after dismissal quits through the temporary quit path and destroys the renderer; a plain `c` never quits; an in-flight update check does not delay the first frame, dismissal, or quit. Render, flush, and dispose steps are wrapped in `act` so the suite runs without act warnings.

## 14. Open questions

- Whether the splash should be skippable through configuration, for example a `ui.splash` flag. This document keeps it always on for v1, because it is the version and update surface.
- Whether the update check should be disableable, for example an `updates.check` flag. This document keeps it always on, silent on failure, and free of telemetry, so it is safe by default.
- Whether an update result that settles after dismissal should surface in the top bar status strip. This document discards it for v1 and notes the provider move as the path for a later release.
- Whether a minimum splash display time is needed so the notice is readable on fast machines. This document does not add one and dismisses on the first key.
- Whether the fallback thresholds of 40 columns and 10 rows are right for every bundled font. Confirm after the wordmark is rendered in a real terminal.
