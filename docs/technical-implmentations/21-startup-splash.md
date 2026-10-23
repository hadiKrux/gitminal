# 21 - Startup splash and update check

## 1. Header

Status: Ready for dev.
Spec reference: `docs/product-spec.md` section 3 "Application shell" (lines 67-162), section 5 F-21 "Startup splash and update check" (lines 1488-1538), section 6 "Keyboard map" startup splash (lines 1543-1549), decision D19 (line 1887), and the assumed defaults for the splash and npm check (lines 1890-1908).
Dependencies: none at runtime. This feature runs before the providers in `01-app-shell-and-focus.md` mount. `01-app-shell-and-focus.md` owns the shell that appears after dismissal, including the `app.quit` path and the `exitOnCtrlC: false` renderer contract.
Owned paths: `src/features/splash/SplashScreen.tsx`, `src/features/splash/useUpdateCheck.ts`, `src/app/App.tsx` (splash gate), `src/app/app.constants.ts`, `src/domain/update/update.check.ts`, `src/domain/update/update.types.ts`, `src/domain/update/update.constants.ts`, `src/lib/semver.ts`.

This document follows the 14-section contract in `00-project-architecture.md` section 14 and conforms to the layer model in section 3, the OpenTUI catalog in section 6, and the state rules in section 9. Where this document and the architecture contract disagree, the architecture contract wins.

## 2. Scope and non-goals

In scope: the full-screen startup splash; the `GITMINAL` wordmark in the tiny ASCII font; the running version line from `package.json`; the any-key dismissal; the `Ctrl+C` quit path through the same app quit path used after the shell mounts; the small-terminal wordmark fallback; the one-shot npm registry update check; the semantic version comparison; and the update notice with the exact install command.

Non-goals: auto-update, self-update, install execution, changelog display, release notes, download progress, update scheduling, cached or periodic checks, telemetry, usage reporting, splash configuration, a splash animation, and any repository read. The splash never touches the repository, the index, or configuration files.

## 3. OpenTUI components used

| Component | Where used | Why it is the right component |
| --- | --- | --- |
| `<box>` | Splash root layout, the update notice block, the wordmark fallback container, and the press-any-key row. | The only layout primitive. Text is never rendered directly on a box. |
| `<text>` | The version line, the checking hint, the update notice lines, the install command, the press-any-key hint, and the small-terminal wordmark fallback. | Every string of UI text goes through `<text>`. |
| `<ascii-font>` | The `GITMINAL` wordmark with `font="tiny"`. | The sanctioned wordmark renderer for the startup splash, matching the OpenTUI tiny font. |
| `<span>` | Not used. The splash has no inline mixed styling. | N/A. |
| `<select>`, `<input>`, `<scrollbox>`, `<diff>`, `<code>`, `<markdown>`, `<textarea>`, `<image>`, `<frame-buffer>` | Not used. | N/A. The splash is non-interactive beyond dismissal. |

OpenTUI hooks used:

| Hook | Where used | Note |
| --- | --- | --- |
| `useKeyboard` | `SplashGate` in `src/app/App.tsx`, mounted only while the splash is visible. | The splash gate owns the only keyboard subscription during the splash. `useHotkeys` owns keys after the shell mounts. The two are never active at the same time. |
| `useTerminalDimensions` | `SplashScreen` chooses between the ASCII wordmark and the plain-text fallback. | Single source for columns and rows. |
| `useRenderer` | Not used by the splash directly. `src/index.tsx` creates the renderer with `exitOnCtrlC: false`, so `Ctrl+C` is delivered as a key and never exits the renderer by default. | The splash gate routes `Ctrl+C` through the app quit path, the same path as `app.quit` after the shell mounts; the shell owns terminal restore. |

Icons: the splash uses no glyphs or markers. All splash text is words, so it does not read `src/theme/icons.ts`. Any future marker on the splash must be added to `src/theme/icons.ts` and given a text equivalent rather than inlined. See `00-project-architecture.md` section 6.1.

## 4. Component tree

```text
src/index.tsx (bootstrap: createCliRenderer({ exitOnCtrlC: false }) + createRoot)
-> src/app/App.tsx                       (root: chooses splash or workspace)
   -> SplashGate                         (mounted only while the splash is visible)
      -> SplashScreen                    (src/features/splash/SplashScreen.tsx)
         -> ascii-font                   (wordmark, or plain text below the fallback size)
         -> SplashUpdateNotice           (same file, private component)
   -> (after dismissal) the app shell (see `01-app-shell-and-focus.md`)
```

`SplashGate` calls `useUpdateCheck` and `useKeyboard`, then renders `SplashScreen`. It unmounts on dismissal, which removes the keyboard subscription before the shell mounts. Because the renderer is created with `exitOnCtrlC: false`, `Ctrl+C` reaches the splash gate as a key event; the gate quits through the app quit path instead of relying on a renderer default exit.

## 5. Enforced files and folders

| File | Responsibility |
| --- | --- |
| `src/app/App.tsx` | Root component and splash gate: holds the `splashDismissed` state, owns the any-key `useKeyboard` handler, routes `Ctrl+C` through the app quit path, runs the update check, and mounts the workspace after dismissal. |
| `src/app/app.constants.ts` | Exports `APP_PACKAGE_NAME` and `APP_VERSION` read from `package.json`. Single source for the version shown on the splash, the registry URL, the install command, and the version comparison. |
| `src/features/splash/SplashScreen.tsx` | Presentational splash: wordmark, version, update notice, press-any-key hint, and the small-terminal fallback. It does not subscribe to keys and does not perform the check. |
| `src/features/splash/useUpdateCheck.ts` | Feature hook: runs one `checkForUpdate` call on mount, ignores late results after unmount, and returns `checking` or the settled result. |
| `src/domain/update/update.check.ts` | The only network module: builds the registry URL, fetches bounded by `AbortSignal.timeout`, parses the payload, and compares versions. It never blocks the splash. No React, no OpenTUI. |
| `src/domain/update/update.types.ts` | `UpdateCheckResult` union: `available`, `up-to-date`, and `unavailable`. |
| `src/domain/update/update.constants.ts` | `NPM_REGISTRY_URL` and `UPDATE_CHECK_TIMEOUT_MS`. |
| `src/lib/semver.ts` | `parseVersion`, `compareVersions`, and `isNewerVersion`. Pure, tested, and free of React, git, and network code. |

Package baseline: `package.json` declares `name` `@im4all/gitminal` and `version` `0.1.0`, and its `engines.bun` floor is `>=1.3.14`. `tsconfig.json` enables `resolveJsonModule`, so `src/app/app.constants.ts` imports the manifest statically. `APP_PACKAGE_NAME` and `APP_VERSION` come from that manifest rather than duplicated literals; the splash version line, the registry request, the install command, and the comparison all read them.

## 6. State model

View state only. No provider is introduced because the splash precedes the provider tree.

- `App` owns `splashDismissed: boolean`. It flips once and never flips back.
- `SplashGate` owns the update state through `useUpdateCheck`, typed as `{ status: "checking" } | UpdateCheckResult`.
- `SplashScreen` is stateless. It receives `version`, `packageName`, and `update` as props.
- `src/lib/semver.ts` and `src/domain/update/update.check.ts` are pure or injectable and hold no state.

The update result is intentionally not lifted into a provider or persisted. It lives only for the lifetime of `SplashGate`, so a dismissed splash discards it, matching F-21. If a later release surfaces updates outside the splash, that state moves to a provider and this document is updated.

## 7. Data flow

```text
launch -> App renders SplashGate
SplashGate -> useUpdateCheck -> checkForUpdate({ packageName, currentVersion })
   -> fetch https://registry.npmjs.org/<encoded package>/latest  (AbortSignal.timeout(UPDATE_CHECK_TIMEOUT_MS))
   -> read payload.version -> isNewerVersion(latest, current)
   -> UpdateCheckResult -> setState -> SplashScreen re-renders the notice
any key -> useKeyboard -> onDismiss -> App.splashDismissed = true -> SplashGate unmounts -> workspace mounts
Ctrl+C -> useKeyboard in SplashGate -> shared quit path used by app.quit -> renderer.destroy() -> terminal restored
```

The check is fire-and-forget. `packageName` and `currentVersion` are `APP_PACKAGE_NAME` and `APP_VERSION` from `package.json`. The splash renders on the first frame and never awaits the request. `AbortSignal.timeout` bounds the request and aborts it after the timeout; any thrown error, including an abort, becomes `unavailable`, which the splash renders as nothing. The check never blocks rendering, dismissal, or quit.

## 8. Keyboard and focus

The splash is not a focus region. The shell providers, the keymap, and `useHotkeys` are not mounted while the splash is visible.

| Key | Behavior |
| --- | --- |
| Any key | Dismiss the splash and mount the workspace. |
| `Ctrl+C` | Quit through the app quit path. The renderer is created with `exitOnCtrlC: false`, so `Ctrl+C` arrives as a key event and never exits the renderer by default; the splash gate maps it to the shared quit path that `app.quit` also uses, then destroys the renderer and restores the terminal. |

Splash keys are fixed. They are not configurable and do not appear as action IDs in `src/domain/keymap/keymap.defaults.ts`, because the splash runs before the keymap loads. `Ctrl+C` is checked before the any-key dismissal, so it quits rather than dismissing. No raw key comparison outside the splash gate is introduced. After dismissal, `useHotkeys` becomes the only keyboard subscriber. A digit pressed on the splash only dismisses it; the jump happens on the next digit press once the shell is mounted.

## 9. Loading, empty, error, and disabled states

| State | Splash behavior |
| --- | --- |
| Checking | Shows `Checking for updates...` in dim text. |
| Update available | Shows `Update available: <latest> (current <current>)` in bold, then `Run npm i -g @im4all/gitminal`. |
| Up to date | Shows nothing in the update area. No success message. |
| Unavailable | Shows nothing in the update area. Offline, timeout, HTTP error, and malformed payload are all silent. |
| Small terminal | Below 40 columns or 10 rows, replaces the ASCII wordmark with `GITMINAL` in bold text. The version, notice, and hint still render. |

There is no disabled state: the splash has no controls. There is no error overlay: a failed check is not an app failure.

## 10. Performance and bounds

- The splash renders in the first frame and never blocks on the update check.
- The check has a two second timeout through `AbortSignal.timeout` and is not retried. The signal aborts the in-flight request; the splash does not wait for the abort to settle before rendering, dismissing, or quitting.
- The check runs at most once per process launch and is not cached or persisted.
- A late result after dismissal is ignored through the `active` flag in `useUpdateCheck`, so no state update happens after unmount.
- The wordmark is fixed-width ASCII art and never wraps; below the fallback size the plain wordmark is used instead.
- The update notice is bounded to two lines and never wraps the install command.
- No app-owned timers, polling, or scheduled work survive the splash. The only pending work is the bounded registry request, and its result is discarded on dismissal.

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
| "Pressing any key opens the workspace, and `Ctrl+C` quits." (F-21) | `SplashGate` in `src/app/App.tsx`: any key dismisses, while `Ctrl+C` takes the app quit path because `createCliRenderer` uses `exitOnCtrlC: false`. |
| "A newer version shows the published version, the running version, and `npm i -g @im4all/gitminal`." (F-21) | `SplashUpdateNotice` in `src/features/splash/SplashScreen.tsx` with `src/domain/update/update.check.ts`; the install command derives from `APP_PACKAGE_NAME`. |
| "A current or failed check shows no update notice and no warning." (F-21) | `UpdateCheckResult` handling in `SplashUpdateNotice`. |
| "The splash appears and dismisses promptly and never waits on the check." (F-21) | `useUpdateCheck` fire-and-forget flow with `AbortSignal.timeout`; dismissal and quit do not await the request. |
| "A running version newer than the registry version does not show a notice." (F-21) | `isNewerVersion` in `src/lib/semver.ts`. |

## 13. Tests to add

- `src/lib/semver.test.ts`: parse release, `v` prefix, build metadata, and prerelease identifiers; compare release ordering, prerelease precedence, and invalid input; assert `isNewerVersion` is true only for a strictly newer candidate.
- `src/app/app.constants.test.ts`: `APP_PACKAGE_NAME` is `@im4all/gitminal` and `APP_VERSION` equals the `version` in `package.json`, proving the manifest import works with `resolveJsonModule`.
- `src/domain/update/update.check.test.ts`: newer registry version returns `available`; equal or older returns `up-to-date`; scoped package name is URL-encoded; HTTP error, malformed payload, thrown network error, and `AbortSignal.timeout` abort return `unavailable`; the function never throws; a pending request does not block the caller.
- `src/features/splash/SplashScreen.test.tsx`: renders the wordmark and the version from `APP_VERSION`; renders the checking hint; renders the update lines and install command for `available`; renders nothing for `up-to-date` and `unavailable`; uses the plain wordmark below the fallback size.
- `src/app/App.test.tsx`: first key press dismisses the splash and mounts the workspace; a `Ctrl+C` press quits through the app quit path and destroys the renderer instead of dismissing; the splash gate unmounts so only one keyboard subscriber remains; an in-flight update check does not delay the first frame, dismissal, or quit.

## 14. Open questions

- Whether the splash should be skippable through configuration, for example a `ui.splash` flag. This document keeps it always on for v1, because it is the version and update surface.
- Whether the update check should be disableable, for example an `updates.check` flag. This document keeps it always on, silent on failure, and free of telemetry, so it is safe by default.
- Whether an update result that settles after dismissal should surface in the top bar status strip. This document discards it for v1 and notes the provider move as the path for a later release.
- Whether a minimum splash display time is needed so the notice is readable on fast machines. This document does not add one and dismisses on the first key.
- Whether the fallback thresholds of 40 columns and 10 rows are right for every bundled font. Confirm after the wordmark is rendered in a real terminal.
