# Gitminal Project Architecture

Status: Draft for review
Last updated: 2026-10-22
Scope: Enforced file, folder, layering, and OpenTUI component rules for the Gitminal v1 implementation.
Product spec: `docs/product-spec.md`
Feature docs: `docs/technical-implmentations/01-*.md` through `20-*.md`
Visual reference: [`gitminal.png`](../../gitminal.png). The mockup is the authoritative UI target. Every UI feature must match the area of the mockup mapped to it in `01-app-shell-and-focus.md`.

This document is the contract. Feature documents describe behavior; this document decides where code lives, how layers depend on each other, and which OpenTUI component each concern uses. If a feature doc disagrees with this document on structure or components, this document wins.

## 1. Tech stack (fixed for v1)

| Concern | Choice | Version source |
| --- | --- | --- |
| Runtime | Bun | `>=1.3.0` (`package.json` engines) |
| Language | TypeScript, strict | `tsconfig.json` |
| UI | React 19 with `@opentui/react` | `package.json` |
| Terminal rendering | `@opentui/core` | `package.json` |
| Entry module | `src/index.tsx` | `package.json` module field |
| Git access | System git CLI, argument arrays, no shell | Product spec F-18 |
| Tests | `bun test` | This document |

No other runtime dependency is added without updating this document. No UI toolkit, state library, router, or HTTP client is introduced. The startup update check uses the runtime's global `fetch` and adds no dependency.

## 2. Architectural principles

1. Observable-first, incremental. Every slice must be runnable and inspectable before it grows. The shell and a single working panel land before git breadth.
2. Layered and one-directional. Dependencies point inward: `features -> ui/app -> domain -> lib`. Domain never imports React or OpenTUI.
3. One source of truth per concern. Repository state comes from git, config comes from the config loader, keybindings come from the keymap resolver, colors come from the theme resolver. Features do not keep parallel copies of these.
4. Commands are the only mutation path. UI dispatches named commands; the domain command runner only executes them and returns a result; the app-layer command orchestrator applies refresh, status, console, and error effects. No component calls git directly, and no domain module touches a provider or a React hook.
5. One mutation at a time. The command runner serializes writes and returns a blocked result with a visible reason when a second mutation is requested.
6. Explicit states. Every async surface has loading, empty, error, and disabled states with text markers, not color alone.
7. Composition over new renderables. Only existing OpenTUI components and React composition are used. A new renderable requires a documented reason in this file. The one sanctioned registration is OpenTUI's own `FrameBufferRenderable`, registered through `extend` for `ProgressBar`, because the built-in React catalogue has no frame-buffer binding.
8. Match the visual reference. The mockup at `gitminal.png` is the authoritative target for layout, hierarchy, spacing, and density. Behavior comes from the product spec; arrangement comes from the mockup.

## 3. Layer model and dependency direction

```text
src/index.tsx            bootstrap only (renderer + root)
   |
   v
src/app/**               providers, hooks, composition root
   |         \
   v          v
src/features/**   src/ui/**        feature UI and reusable presentational primitives
   |         \        |
   v          v       v
src/domain/**     (ui imports theme tokens + lib only)
   |
   v
src/lib/**               pure utilities, no React, no git
```

Allowed imports:

- `src/lib/**` imports only `src/lib/**`.
- `src/domain/**` imports `src/domain/**` and `src/lib/**`. Never React, never a React hook, never `@opentui/*`, never `src/features/**`, never `src/app/**`.
- `src/ui/**` imports `src/lib/**` and `src/theme/**` (token types/context) and React and `@opentui/*`. It does not import `src/domain/**` or `src/features/**`.
- `src/features/**` imports `src/ui/**`, `src/app/hooks/**`, `src/app/providers/**` (hooks only), `src/domain/**`, `src/lib/**`, `src/theme/**`, React, and `@opentui/*`.
- `src/app/**` imports everything.
- Feature to feature imports are forbidden. Cross-feature coordination goes through a provider, a domain command, or a selector exported from `src/domain/**`.

Forbidden imports (enforced by lint, see section 12):

- `node:child_process`, `Bun.spawn`, or any process spawn outside `src/domain/git/git.client.ts`.
- `fetch` or any other network call outside `src/domain/update/update.check.ts`.
- Hex color literals outside `src/domain/theme/theme.catppuccin.ts`.
- Raw key string comparisons outside `src/domain/keymap/**` and `src/app/hooks/useHotkeys.ts`.
- `@opentui/*` inside `src/domain/**`.
- Glyph or icon literals outside `src/theme/icons.ts`.

## 4. Enforced folder structure

```text
gitminal/
  package.json
  tsconfig.json
  docs/
    product-spec.md
    technical-implmentations/
      00-project-architecture.md
      01-app-shell-and-focus.md
      ...
      20-theme-and-colors.md
      21-startup-splash.md
  src/
    index.tsx
    app/
      App.tsx
      app.constants.ts
      providers/
        ConfigProvider.tsx
        ThemeProvider.tsx
        RepositoryProvider.tsx
        FocusProvider.tsx
        KeymapProvider.tsx
        OverlayProvider.tsx
        StatusProvider.tsx
        ConsoleProvider.tsx
      hooks/
        useHotkeys.ts
        useAction.ts
        useCommandRunner.ts
        useFocusRegion.ts
        useListCursor.ts
        useDebouncedValue.ts
        useOverlay.ts
        useStatus.ts
        useTheme.ts
        useConfig.ts
        useKeymap.ts
        useRepository.ts
        useConsoleLog.ts
        useTerminalSize.ts
    features/
      splash/
        SplashScreen.tsx
        useUpdateCheck.ts
      shell/
        AppShell.tsx
        Sidebar.tsx
        MainArea.tsx
        Footer.tsx
        ResponsiveGate.tsx
        regions.ts
        focus.types.ts
        useFocusModel.ts
      top-bar/
        TopBar.tsx
        TopBarStatus.tsx
        SyncStateBadge.tsx
        TopBarActions.tsx
        MoreMenu.tsx
        useTopBar.ts
      branches/
        BranchesPanel.tsx
        BranchRow.tsx
        NewBranchModal.tsx
        DeleteBranchModal.tsx
        useBranches.ts
      remotes/
        RemotesPanel.tsx
        RemoteRow.tsx
        RemoteFilter.tsx
        CreateLocalBranchModal.tsx
        useRemotes.ts
      tags/
        TagsPanel.tsx
        TagRow.tsx
        CreateTagModal.tsx
        DeleteTagModal.tsx
        useTags.ts
      stashes/
        StashesPanel.tsx
        StashRow.tsx
        CreateStashModal.tsx
        DeleteStashModal.tsx
        useStashes.ts
      worktrees/
        WorktreesPanel.tsx
        WorktreeRow.tsx
        NewWorktreeModal.tsx
        DeleteWorktreeModal.tsx
        useWorktrees.ts
      graph/
        CommitGraph.tsx
        CommitRow.tsx
        PendingChangesRow.tsx
        GraphLanes.tsx
        CommitSearchInput.tsx
        SearchResultRow.tsx
        useCommitGraph.ts
        useCommitSearch.ts
      composer/
        CommitComposer.tsx
        ComposerIdentity.tsx
        CommitOptionsMenu.tsx
        useComposer.ts
      commit-details/
        CommitDetails.tsx
        CommitMetaRow.tsx
        ParentRef.tsx
        useCommitDetails.ts
      diff/
        DiffPanel.tsx
        DiffSection.tsx
        DiffFileRow.tsx
        DiffContent.tsx
        ConflictBanner.tsx
        useDiffPanel.ts
        useFileDiff.ts
      palette/
        CommandPalette.tsx
        CommandRow.tsx
        useCommandPalette.ts
      console/
        ConsoleDrawer.tsx
        ConsoleEntryRow.tsx
        ConsoleOutput.tsx
        useConsole.ts
      help/
        HelpModal.tsx
        HelpSection.tsx
        HelpRow.tsx
        HelpConfiguration.tsx
        useHelp.ts
      overlays/
        ConfirmModal.tsx
        ErrorOverlay.tsx
        NoticeOverlay.tsx
        ModalFrame.tsx
      theme-picker/
        ThemePicker.tsx
        ThemeRow.tsx
        useThemePicker.ts
    ui/
      Panel.tsx
      PanelHeader.tsx
      ListView.tsx
      ListRow.tsx
      ScrollableList.tsx
      Button.tsx
      ButtonRow.tsx
      Badge.tsx
      StatusBadge.tsx
      TextMarker.tsx
      TruncatedText.tsx
      KeyHint.tsx
      HintBar.tsx
      Spinner.tsx
      ProgressBar.tsx
      EmptyState.tsx
      ErrorState.tsx
      LoadingRow.tsx
      Divider.tsx
      SearchField.tsx
      FormField.tsx
      Checkbox.tsx
      SelectField.tsx
      ModalFrame.tsx
      ModalActions.tsx
      Overlay.tsx
      Swatch.tsx
      SectionHeader.tsx
    domain/
      git/
        git.client.ts
        git.types.ts
        git.errors.ts
        git.redact.ts
        git.progress.ts
        git.repo.ts
        git.status.ts
        git.log.ts
        git.branches.ts
        git.remotes.ts
        git.tags.ts
        git.stashes.ts
        git.worktrees.ts
        git.diff.ts
        git.commit.ts
        git.watcher.ts
        parsers/
          parse.status.ts
          parse.log.ts
          parse.diff.ts
          parse.refs.ts
          parse.worktrees.ts
          parse.stash.ts
      repository/
        repository.types.ts
        repository.selectors.ts
        repository.upstream.ts
        repository.states.ts
      commands/
        commands.registry.ts
        commands.types.ts
        commands.runner.ts
        commands.availability.ts
      graph/
        graph.types.ts
        graph.paginate.ts
        graph.lanes.ts
        graph.search.ts
      diff/
        diff.types.ts
        diff.collapse.ts
        diff.limits.ts
      config/
        config.types.ts
        config.defaults.ts
        config.paths.ts
        config.loader.ts
        config.validate.ts
        config.writer.ts
      keymap/
        keymap.types.ts
        keymap.defaults.ts
        keymap.parse.ts
        keymap.resolve.ts
        keymap.conflicts.ts
        keymap.describe.ts
      theme/
        theme.types.ts
        theme.catppuccin.ts
        theme.resolve.ts
        theme.capability.ts
        theme.tokens.ts
      console/
        console.types.ts
        console.buffer.ts
        console.format.ts
      update/
        update.check.ts
        update.types.ts
        update.constants.ts
    theme/
      ThemeContext.tsx
      useTokens.ts
      icons.ts
    lib/
      paths.ts
      time.ts
      text.ts
      format.ts
      result.ts
      assert.ts
      async.ts
      invariant.ts
      semver.ts
```

Rules for this tree:

- Folders are kebab-case, singular, and match the feature name.
- `src/features/<name>/` owns exactly one feature from the feature catalog. A feature never adds a folder under another feature.
- Shared presentational code goes in `src/ui/`. Shared non-UI code goes in `src/lib/`. Shared git code goes in `src/domain/git/`.
- `src/app/providers/` holds React context providers only. `src/app/hooks/` holds cross-feature hooks only. A hook used by exactly one feature lives in that feature folder.

## 5. File naming rules

Enforced:

- React components: `PascalCase.tsx`, one exported component per file, file name equals the exported component name.
- Hooks: `useThing.ts` or `useThing.tsx`, file name equals the exported hook.
- Types only: `<name>.types.ts`. Constants only: `<name>.constants.ts`. Pure logic: `<name>.ts` matching the primary export.
- Tests: colocated `*.test.ts` or `*.test.tsx` next to the file under test. No separate `__tests__` tree.
- No `index.ts` barrels. Import from the exact module path. This keeps dependency edges visible and prevents cycles.
- No file is named `utils.ts`, `helpers.ts`, `common.ts`, or `misc.ts`. Name the concern.
- Path aliases: `@/*` maps to `src/*`. Use `@/domain/...`, `@/ui/...`, `@/features/...`. Relative imports are allowed only within the same folder.

Required `tsconfig.json` addition:

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] }
  }
}
```

### 5.1 Code documentation and function size

Enforced:

- Every function, class method, and exported arrow function has a standard JSDoc block that states what it does, its parameters, and its return value. Use `@param` and `@returns` tags. A one-line `/** ... */` is acceptable only for a trivial, self-evident helper.
- Non-obvious behavior, side effects, error cases, and invariants are documented in the JSDoc, not only in the implementation.
- React components are documented with JSDoc on the component function, describing the props and the rendered behavior.
- If a function becomes big, split it. The target is a function that does one thing and reads top to bottom without deep nesting. As a working limit, split a function that exceeds about 40 lines of body, that has more than three levels of nesting, or that mixes data preparation with side effects. Extract named helpers in the same module or the owning folder rather than growing the function.
- A hook follows the same rule. If a hook grows past a single concern, split it into a hook plus pure helpers in `@/lib` or `@/domain`, or into smaller hooks composed together.
- Pure logic that a JSDoc would otherwise duplicate belongs in `@/domain` or `@/lib` with its own tests, not inline in a component.

## 6. OpenTUI component usage rules

These are the only UI building blocks available. Features compose them. The catalog below is the full `@opentui/react` 0.6.6 intrinsic set plus the one registered OpenTUI renderable.

| OpenTUI component | Renderable | Use for | Do not use for |
| --- | --- | --- | --- |
| `<box>` | `BoxRenderable` | All layout, panels, borders, focus rings, rows, modals, overlays, buttons. | Rendering text content directly; always place `<text>` inside. |
| `<text>` | `TextRenderable` | Every string of UI text, labels, status, counts, hints. | Layout. |
| `<span>` | `SpanRenderable` | Inline styled runs inside `<text>`: badges, highlights, key hints. | Standalone layout blocks. |
| `<scrollbox>` | `ScrollBoxRenderable` | Any scrollable region: sidebar panels, graph, diff panel, console, help. Handles wheel scroll, scrollbars, `viewportCulling`. | Non-scrolling short content. |
| `<select>` | `SelectRenderable` | Vertical option lists: More menu, command palette results, commit options, modal option lists, theme picker list. | Primary data lists that need custom row rendering. |
| `<tab-select>` | `TabSelectRenderable` | Horizontal selectors: responsive single-panel switcher, top bar action strip. | Long lists. |
| `<input>` | `InputRenderable` | Single-line fields: branch name, tag name, worktree path, filter, commit search, help search, palette search. | Multiline text. |
| `<textarea>` | `TextareaRenderable` | Commit message composer and any multiline form field. | Single-line fields. |
| `<code>` | `CodeRenderable` | Syntax-highlighted read-only content: commit message bodies, console command text when a filetype is known. | Diffs; use `<diff>`. |
| `<diff>` | `DiffRenderable` | All diffs: working, staged, untracked, commit, stash. Unified view, line numbers, added/removed backgrounds. | General text. |
| `<line-number>` | `LineNumberRenderable` | Line-numbered read-only text that is not a diff, such as conflict-marker previews needing gutter signs. | Diffs; `<diff>` already draws gutters. |
| `<markdown>` | `MarkdownRenderable` | Help documentation blocks and configuration notes. | App chrome. |
| `<ascii-font>` | `ASCIIFontRenderable` | Startup splash wordmark and the empty-repository, non-repository, and terminal-too-small splash only. | Anywhere else. |
| `<image>` | `ImageRenderable` | Not used in v1. | v1. |
| `<frame-buffer>` | `FrameBufferRenderable` (registered via `extend`) | One-row progress bar in the top bar, rendered only through the `ProgressBar` primitive. | Any other graphics, text, animation, or layout. |
| `<b>`, `<i>`, `<u>`, `<strong>`, `<em>`, `<a>`, `<br>` | span variants | Inline emphasis and line breaks inside `<text>`. | Layout. |

`FrameBuffer` has no React intrinsic in 0.6.6. `src/ui/ProgressBar.tsx` registers OpenTUI's own `FrameBufferRenderable` once with `extend({ "frame-buffer": FrameBufferRenderable })`, augments `OpenTUIComponents` for JSX typing, draws the bar with `fillRect`, and calls `requestRender()` after each change. No custom renderable class is introduced. The drawing approach follows the [OpenTUI FrameBuffer progress-bar example](https://opentui.com/docs/components/frame-buffer/#example-progress-bar).

Hooks available from `@opentui/react` 0.6.6:

| Hook | Use for |
| --- | --- |
| `useKeyboard(handler, { release? })` | The single global key dispatcher, owned by `src/app/hooks/useHotkeys.ts`. The startup splash gate in `src/app/App.tsx` is the only other caller and only while the splash is visible. Features never call it directly. |
| `useOnResize(cb)` | Responsive layout fallbacks in `ResponsiveGate` and `AppShell`. |
| `useTerminalDimensions()` | Minimum-size checks, truncation budgets, hint fitting. |
| `useRenderer()` | Bootstrap access, focus management, console drawer access. |
| `useFocus(handler)` / `useBlur(handler)` | Terminal-window focus and blur only: refresh on terminal focus, pause work on blur. Never region focus. |
| `usePaste(handler)` | Commit message and field paste handling. |
| `useSelectionHandler(handler)` | Console log text selection and copy. |
| `useTimeline(options)` | `Spinner` animation and throttled progress-bar redraws in the top bar status strip. |

Component rules:

1. Keyboard ownership is centralized. `useHotkeys` is the only `useKeyboard` caller. It resolves precedence (open overlay, then text input, then native list widget, then focused region context, then global), and it calls `preventDefault()` only when it handles the key. Features register handlers by action ID through `useAction`. No feature inspects `KeyEvent` directly.
2. OpenTUI native focus is the single focus authority. The renderer's `currentFocusedRenderable` receives keys. `FocusProvider` is a projection: it derives `activeRegion` from the focused renderable's nearest ancestor region frame, derives `textInputFocused` from `currentFocusedEditor`, and stores `previousRegion` plus the per-region cursor map. It does not hold a competing writable `activeRegion`. Every region frame is a focusable `<box>` with a stable id and `focusedBorderColor`, so the border follows native focus, including when a descendant text input is focused. The focused region also gets a leading text marker; color is never the only signal.
3. Every navigable list is either a `<select>` (uniform rows, native up/down and Enter, focused when it is the active widget) or a non-focusable `<scrollbox>` of `<box>` rows when rows need custom content such as graph lanes, ref badges, diff headers, or inline actions. In the custom case, the region frame owns focus, and navigation, selection, and `g`/`G` are implemented by `useListCursor` and rendered as a leading marker plus a highlighted row background.
4. Mouse focus uses OpenTUI `autoFocus`. Clicking a text input focuses it; clicking any other element focuses the nearest focusable ancestor, normally the region frame. Region and row mouse handlers must not call `focus()` directly; they select the row and dispatch, and native focus follows the click. Double click is detected by `useListCursor` (two clicks on the same row inside a threshold). Mouse never exposes an action that has no keybinding.
5. Diffs always use `<diff>` with `view="unified"`, `showLineNumbers`, and theme-mapped `addedBg`, `removedBg`, `addedSignColor`, `removedSignColor`. Collapsed unchanged runs are computed in `@/domain/diff/diff.collapse.ts` before the diff string is passed in.
6. Long lists are bounded and virtualized by rendering only the visible window inside a `<scrollbox>` with `viewportCulling`. The graph keeps a loaded-page window in `@/domain/graph/graph.paginate.ts`.
7. The console drawer is app-owned UI (not the renderer's built-in console). It is a `<box>` docked above the footer containing a `<scrollbox>` of entry `<box>` rows, so it can show command, status, duration, and expandable output in the app style. The renderer console is used only for development logging.
8. Disabled controls are rendered with a `dim` token and a text reason, and remain visible. The command palette uses `<select>` options whose `description` carries the disabled reason.
9. Truncation uses `@/lib/text.ts` helpers with explicit budgets from `useTerminalDimensions`; it never hides the current branch, the selection marker, or the primary action.
10. Progress bars use `<frame-buffer>` through the `ProgressBar` primitive only. The bar is one row high, `0` to `100` percent clamped, drawn as colored cells with no glyphs, and always paired with a text phase and percentage. Redraw only when the filled cell count, width, or theme color changes, and redraw after a resize because a resize clears the buffer.
11. The startup splash is the only place `<ascii-font>` is used besides the empty-repository, non-repository, and terminal-too-small states. It renders the `GITMINAL` wordmark with `font="tiny"` above 40 columns and 10 rows and falls back to plain bold text below that, so the splash never wraps. See `21-startup-splash.md`.

### 6.1 Icon catalog and rules

All icons, markers, and glyphs live in exactly one file: `src/theme/icons.ts`. It exports a frozen `ICONS` object and the `IconName` type, and it is the single place to configure the visual vocabulary of the app. The file sits in the theme folder so the icon layer and the color layer are configured together.

Rules:

1. Single source. `src/theme/icons.ts` is the only place a glyph literal exists. Components import `ICONS` from `@/theme/icons` and never inline a glyph. The boundary check in section 12 fails on glyph literals outside this file.
2. ASCII-safe. Every value uses printable ASCII only. No unicode arrows, box-drawing characters, emoji, or Nerd Font glyphs. This is required by product spec F-18.
3. Never the only signal. Every icon that conveys state is rendered next to, or has, a text equivalent. Color is never the only signal either. For example the missing-upstream icon `[?]` is always shown with the words "upstream not found" or "remote branch deleted".
4. Plain data, no hook. `ICONS` is a static module, so both UI and non-UI code can read it. It is not resolved through React. Because it lives in the theme folder, a future user-override layer can be added in `ThemeProvider` without changing consumers.
5. User overrides are deferred. v1 centralizes icons in the file but does not read them from user configuration. Making them user-configurable would extend `theme.json` with an optional `icons` object and requires a product spec change to F-20.
6. One-line values. Multi-character markers such as `[?]`, `[ ]`, and `[x]` are still single-line strings rendered inside `<text>` or `<span>`. Icons never introduce layout.

Required `ICONS` groups and their default values:

| Group | Names | Defaults |
| --- | --- | --- |
| Focus and selection | `focus`, `selected`, `unselected` | `>`, `>`, ` ` |
| Expansion | `expanded`, `collapsed` | `v`, `>` |
| Branch and repo state | `currentBranch`, `worktree`, `detached`, `missingUpstream`, `noUpstream`, `locked`, `prunable`, `dirty` | `*`, `+`, `~`, `[?]`, `-`, `L`, `P`, `*` |
| File status | `modified`, `added`, `deleted`, `renamed`, `copied`, `conflicted`, `untracked` | `M`, `A`, `D`, `R`, `C`, `U`, `?` |
| Diff | `diffAdd`, `diffRemove`, `diffContext`, `diffNoNewline` | `+`, `-`, ` `, `\ No newline at end of file` |
| Tag scope | `tagLocal`, `tagRemote`, `tagUnpushed`, `tagLocalOnly` | `local`, `remote`, `unpushed`, `local only` |
| Operation status | `success`, `warning`, `error`, `info`, `pending`, `running`, `done` | `v`, `!`, `x`, `i`, `[ ]`, `[..]`, `[v]` |
| Spinner | `spinnerFrames` | `["|", "/", "-", "\\"]` |
| Toggle | `checkboxOn`, `checkboxOff` | `[x]`, `[ ]` |
| Overflow | `badgeOverflow` | `+` |
| Console | `omittedLines` | `... N lines omitted ...` |
| Graph lanes | `graphLanes` | `["*", "|", "/", "\\", "-", "+"]` |
| Truncation and hints | `ellipsis`, `hintSeparator` | `...`, `|` |

Consumers, all of which read from `ICONS`:

- `src/ui/TextMarker.tsx` renders focus, selection, and status markers.
- `src/ui/Badge.tsx` and `src/ui/StatusBadge.tsx` render tag, branch, and sync badges.
- `src/ui/Spinner.tsx` renders `spinnerFrames` through `useTimeline`.
- `src/ui/ProgressBar.tsx` draws a FrameBuffer bar; it uses theme colors and no glyphs.
- `src/ui/Checkbox.tsx` renders `checkboxOn` and `checkboxOff`.
- `src/ui/ListRow.tsx` and `src/ui/SectionHeader.tsx` render selection and expansion markers.
- `src/features/graph/GraphLanes.tsx` renders lane cells from `graphLanes`.
- `src/features/diff/DiffFileRow.tsx` renders file status letters.
- `src/features/console/ConsoleOutput.tsx` renders `omittedLines`.

Tests: `src/theme/icons.test.ts` asserts that every value is printable ASCII, that array values are non-empty, and that every state marker has an associated text equivalent.

## 7. UI primitive catalog

`src/ui/**` holds the only reusable presentational components. Each is a composition of the OpenTUI catalog above.

| Primitive | OpenTUI composition | Purpose |
| --- | --- | --- |
| `Panel` | `<box>` with border, optional `focusable`, stable `id`, `focusedBorderColor`, title | Bordered region with native focus-aware border. Region frames pass `focusable` and the region id. |
| `PanelHeader` | `<box>` + `<text>` + `<span>` | Section header with title, count, bulk actions. |
| `ListView` | `<scrollbox>` + `<ListRow>` children | Virtualized custom-row list. |
| `ListRow` | `<box>` + `<text>` + `<span>` | Row with marker, columns, actions. Marker from `ICONS` in `@/theme/icons`. |
| `ScrollableList` | `<scrollbox>` | Plain scroll container. |
| `Button` | `<box focusable>` + `<text>` | Text button with focused style and mouse activation. |
| `ButtonRow` | `<box>` + `Button` children | Horizontal action group with Left/Right. |
| `Badge` | `<span>` | Ref, status, and tag badges. Label from `ICONS`. |
| `StatusBadge` | `<span>` + `<text>` | Sync and operation status. Marker from `ICONS`. |
| `TextMarker` | `<text>` | Focus, selection, and state markers read from `ICONS` in `@/theme/icons`. |
| `TruncatedText` | `<text>` | Budget-aware truncation using `ICONS.ellipsis`. |
| `KeyHint` | `<span>` + `<text>` | One hint: key plus action, joined with `ICONS.hintSeparator`. |
| `HintBar` | `<box>` + `KeyHint` children | Footer hint line with priority-based dropping. |
| `Spinner` | `<text>` + `useTimeline` | Operation spinner cycling `ICONS.spinnerFrames`. |
| `ProgressBar` | `<box>` + `<frame-buffer>` via `FrameBufferRenderable` + `<text>` | One-row determinate progress using theme accent and surface cells, with a text percentage. No glyphs. |
| `EmptyState` | `<box>` + `<text>` | Empty message with optional action hint. |
| `ErrorState` | `<box>` + `<text>` + `Button` | Inline error with Retry. |
| `LoadingRow` | `<box>` + `<text>` + `Spinner` | Inline loading row in a list. |
| `Divider` | `<box>` height 1 | Separator. |
| `SearchField` | `<input>` | Filter and search fields with placeholder. |
| `FormField` | `<box>` + `<text>` + `<input>`/`<textarea>` + error text | Labeled field with inline validation. |
| `Checkbox` | `<box>` + `<text>` marker | Toggle rendered from `ICONS.checkboxOn`/`ICONS.checkboxOff`, keyboard and mouse. |
| `SelectField` | `<select>` | Field that picks from options. |
| `ModalFrame` | `<box>` overlay + `<Panel>` + title + `<ModalActions>` | Standard modal structure and focus trap. |
| `ModalActions` | `<ButtonRow>` | Footer actions with keys; destructive default focus is Cancel. |
| `Overlay` | `<box>` full-size dim layer | Background deactivation behind modals. |
| `Swatch` | `<box>` colored cell | Theme picker color preview. |
| `SectionHeader` | `<box>` + `<text>` + marker | Expand/collapse header using `ICONS.expanded`/`ICONS.collapsed`. |

A feature may compose these primitives but must not fork them. If a feature needs a variant, add a prop to the primitive instead of copying it.

## 8. Focus and keybinding architecture

Regions (stable IDs in `src/features/shell/regions.ts`):

```text
top-bar, branches, remotes, tags, stashes, worktrees, graph, right-pane, diff, console
```

Direct region jumps use the digits `1`-`9` in screen order: `1`-`5` are the five sidebar panels, `6` is `graph`, `7` is `right-pane`, `8` is `diff`, and `9` is `console`. `top-bar` has no default digit but keeps a `focus.region.topBar` action for configuration and the palette. `regions.ts` owns the region IDs and their `focus.region.*` action IDs, `keymap.defaults.ts` binds the digits, `useFocusModel` registers the handlers, and a jump calls `focusRegion` instead of writing focus state. A jump to a sidebar panel that the collapsed layout is not showing selects it in the `<tab-select>` first. Digits resolve in the global context, so native list widgets do not consume them, but an overlay or a focused text input owns them through precedence rules 1 and 2.

- OpenTUI native focus is the authority. `renderer.currentFocusedRenderable` decides which renderable receives keys.
- `FocusProvider` subscribes to `renderer` events `focused_renderable` and `focused_editor`. It derives `activeRegion` from the focused renderable's nearest ancestor region frame (`region-<regionId>`), derives `textInputFocused` from `currentFocusedEditor !== null`, and derives `nativeListFocused` from the focused renderable being a `SelectRenderable` or `TabSelectRenderable`. If focus is outside every region, such as in an overlay, `activeRegion` keeps its last value while the overlay owns keys. It stores `previousRegion`, `focusedRenderableId`, `previousFocusedRenderableId`, and the per-region cursor map. It exposes `focusRegion(regionId)`, `focusRenderable(id)`, and `restoreFocus(id)`. It does not expose a writable `activeRegion` or a manual text-input flag.
- `useFocusRegion(regionId)` returns `{ focused, focus(), regionProps, getCursor, setCursor }`. `regionProps` sets a stable id `region-<regionId>`, `focusable`, and `focusedBorderColor` on the region frame. `focused` is true when the focused renderable is the region frame or a descendant, including a text input inside it. It is false while focus is in an overlay.
- `useFocusModel` owns Tab and Shift+Tab traversal in the spec order, the `focus.region.*` direct jumps, skips regions hidden by responsive fallbacks, and calls `focusRegion(next)` instead of writing focus state directly.
- A text input or other widget that must be focused programmatically has a stable id and is focused with `focusRenderable(id)`. `focusRegion` is only for a region frame. Examples are `graph.search` focusing the search input and `commit.focus` focusing the composer textarea.
- Text input mode applies when `currentFocusedEditor` is not null. `Esc` leaves the input without clearing its value and normally returns focus to the owning region frame; a feature may consume the first `Esc` for a documented cancel or clear or define a different return target (the composer returns to the textarea's region), but the next `Esc` must leave the input. `Tab` and `Shift+Tab` follow the field type first: in a multiline `<textarea>`, `Tab` inserts the indent unit at the cursor and `Shift+Tab` removes up to one indent unit from the start of the current line, and neither moves focus, including inside an overlay; in a single-line `<input>`, they move to the next or previous region in the shell, or to the next or previous field or footer action inside an overlay. The textarea indent unit is `TEXT_INDENT_UNIT` (two spaces) in `src/lib/text.ts`, and replaces the selection when one exists. A textarea exposes `insertText` through its ref so the handler can insert the indent before calling `preventDefault()`.
- OpenTUI editing behavior is preserved. In text input mode, only an explicit text-input-safe allowlist of app actions may fire: `app.palette`, `app.console`, `commit.submit`, `commit.options`, and the focused form's submit action on `Ctrl/Cmd+Enter`. Every other key, including every modified key not in that allowlist, passes to the input or textarea untouched. This preserves `Enter` submit on single-line inputs, `Enter` newline on textareas, and the OpenTUI editing bindings: `Ctrl+A/E/F/B/W`, `Ctrl+Backspace/Delete`, `Ctrl+K/U`, `Ctrl+-/.`, `Super+A/Z`, and `Alt+D/F/B` plus arrow variants. Configured app bindings outside the allowlist never fire while typing, even when they use a modified key. `Ctrl+C` remains the hardcoded app quit path from the product spec and is the one deliberate exception.
- A feature may declare a search input mode that routes specific navigation keys (Up, Down, PageUp, PageDown, Enter) to a result list while printable keys stay in the input; search modes never swallow printable keys and are the only place where an app action deliberately takes `Enter` from a single-line input.
- `Ctrl`/`Cmd`-modified shortcuts do not resolve through the app keymap in text input mode. They do so only outside text input mode or when they are in the text-input-safe allowlist above. Unmodified keys always pass to the input.
- Native list mode applies when a `<select>` or `<tab-select>` is focused. That widget owns `nav.up`, `nav.down`, `nav.pageUp`, `nav.pageDown`, `nav.first`, `nav.last`, and `nav.activate`; `useHotkeys` must not prevent those keys from reaching it. Global modified shortcuts, `focus.next`/`focus.previous`, and the `focus.region.*` digit jumps still work.
- `overlay` is not a region. On open, `OverlayProvider` captures the current focused renderable, blurs it, and focuses the first focusable element in the modal after mount. While open, the overlay owns keys. The overlay context applies the same text-input and native-list delegation for keys it does not handle; region focus does not apply. On close, it restores the captured renderable if it is still mounted, otherwise it focuses that renderable's region frame.
- The startup splash is not a region and has no focus. It renders before the providers and the keymap mount, and its any-key handler is the only keyboard subscriber while it is visible. See `21-startup-splash.md`.
- Action IDs are exactly the IDs in product spec section 6.1 and live in `src/domain/keymap/keymap.defaults.ts`. Features receive action IDs only.
- Precedence is computed in `src/domain/keymap/keymap.resolve.ts`. A key may appear once per context. Context overrides global for the same key.
- Footer hints come from `src/domain/keymap/keymap.describe.ts` filtered by the focused region and current availability, so the footer, help, and palette always agree. The `focus.region.*` actions are help- and palette-only and are never emitted as footer hints.

## 9. State architecture

The startup splash (`21-startup-splash.md`) runs before any provider mounts. It owns only local view state and one background update check, then unmounts.

Providers, outermost to innermost:

1. `ConfigProvider`: resolved config, warnings, reload. Source: `@/domain/config`.
2. `ThemeProvider`: resolved tokens and color capability. Source: `@/domain/theme`. Exposes tokens through `@/theme/useTokens.ts`.
3. `KeymapProvider`: resolved action to keys map. Source: `@/domain/keymap`.
4. `RepositoryProvider`: repository snapshot, selected commit, selection and expansion state, and the refresh cycle. Source: `@/domain/repository` and `@/domain/git`.
5. `FocusProvider`: a projection of OpenTUI native focus, `previousRegion`, and the per-region cursor map. It is not a second focus authority.
6. `OverlayProvider`: modal stack, destructive confirmations, error overlay.
7. `StatusProvider`: transient status, footer hint mode, operation progress.
8. `ConsoleProvider`: bounded command log and follow mode.

Data flow for a mutation:

```text
key, click, or palette -> action ID -> useAction handler
   -> useCommandRunner.runCommand(request)                              (app layer, the only caller)
   -> commands.runner.ts (availability + serialization + execution)     (domain, no providers)
        -> @/domain/git/* -> git CLI -> CommandResult and progress events
   -> useCommandRunner applies the result:
        StatusProvider progress and status   <- git.progress.ts
        ConsoleProvider entry                <- git.redact.ts -> console.format.ts
        RepositoryProvider.refresh()         on success and failure
        OverlayProvider error                on failure
   -> features re-render
```

Read refresh (manual `app.refresh`, watcher, and terminal focus) does not pass through the command runner: `app.refresh` -> `useAction` handler in `useRepository` -> `RepositoryProvider.refresh()` -> domain read modules.

Rules:

- Command execution is split. `src/domain/commands/commands.runner.ts` is a pure executor: it owns availability, write serialization, execution, and progress reporting through a callback, and it returns a `CommandResult`. It never imports React, a hook, a provider, or `src/app/**`. `src/app/hooks/useCommandRunner.ts` is the app-layer orchestrator and the only caller of the runner; it owns `RepositoryProvider.refresh()`, `StatusProvider` progress and status, `ConsoleProvider` append, and `OverlayProvider` errors. Features call the orchestrator, never the runner. `commands.registry.ts` marks every entry with `kind: "mutation" | "read"`; only mutations reach the runner, while reads such as `app.refresh` call `RepositoryProvider.refresh()` directly.
- Features hold only view state: open/closed, focused control, local draft text, expansion of their own rows. Everything else is provider state.
- Repository reads are derived in `@/domain/repository/repository.selectors.ts`. Features never recompute ahead/behind, upstream state, or pending counts themselves.
- Every command declares availability in `@/domain/commands/commands.availability.ts` with a machine-readable reason string. The palette, footer, and buttons all read the same reason.
- Failures never clear drafts or staged files. The runner returns a result object; the orchestrator keeps the UI inputs and surfaces the error.

## 10. Git execution architecture

- `src/domain/git/git.client.ts` is the only module that spawns processes. It uses an argument array, `git.path` from config, `cwd` at the repository root, and no shell.
- Credential prompts are disabled through environment settings. A missing credential or network failure fails visibly and is logged; the app never hangs on a prompt.
- Writes are serialized inside `commands.runner.ts`. A second write while one is running returns a blocked result with a reason. The runner holds no provider state; the blocked reason and the running flag are projected to the UI through the orchestrator and `StatusProvider`.
- `commands.runner.ts` executes only. It returns a `CommandResult` with the operation label, argv, cwd, exit status, duration, stdout, stderr, and progress phases. It never refreshes the repository, appends a console entry, sets a status, or opens an overlay. `src/app/hooks/useCommandRunner.ts` applies those effects after the result.
- Remote operations stream progress through `git.progress.ts`; the runner forwards progress events to the orchestrator, which updates `StatusProvider`.
- `git.redact.ts` redacts credentials in URLs, authorization headers, and environment values before any console or error rendering. The orchestrator applies redaction to the `CommandResult` before it stores or renders output.
- `git.watcher.ts` watches the git directory and triggers refresh. Worktree watching is opt-in and off by default. Manual `r` refresh is always available.
- Parsers under `src/domain/git/parsers/` are pure and unit tested against recorded git output fixtures.

The executor contract lives in `src/domain/commands/commands.types.ts`:

```ts
type CommandRequest = { commandId: string; input: CommandInput }
type CommandInput = Readonly<Record<string, string | boolean | readonly string[]>>  // registry-declared target and form values
type CommandProgress = { phase: string; percent?: number }

type CommandResult = {
  commandId: string
  status: "success" | "failure" | "blocked"
  operationLabel: string
  argv: readonly string[]
  cwd: string
  exitCode: number | null
  durationMs: number
  stdout: string
  stderr: string
  progress: readonly CommandProgress[]
  blockedReason?: string
}

type CommandRunOptions = {
  state: RepositoryState
  signals: RepositorySignals
  onProgress?: (progress: CommandProgress) => void
}
```

`commands.runner.ts` exposes one entry point: `runCommand(request, options): Promise<CommandResult>`. It returns a failure result instead of throwing for a git failure, and a blocked result for an unavailable command or a rejected second write. `state` and `signals` are plain values from `RepositoryProvider`; the runner calls the pure `commands.availability.ts` itself. Provider data crosses the boundary as data, never as a hook or context. Only `src/app/hooks/useCommandRunner.ts` calls the runner in application code; tests call it directly.

`useCommandRunner` exposes `runCommand(request): Promise<CommandResult>` and applies the result in this order:

1. Capture the current `RepositoryState` and `RepositorySignals`, then compute availability with `commands.availability.ts`. If the command is unavailable, surface the reason as a transient status and return a blocked result without starting an operation, refreshing, or appending.
2. `StatusProvider.beginOperation` before invoking the runner.
3. Invoke `commands.runner.ts` with the captured state and signals. The runner re-checks availability and serialization as the authority; if it returns a blocked result, call `endOperation`, surface the reason, and skip refresh, console, and error effects.
4. `StatusProvider.updateOperation` for each progress event.
5. `git.redact.ts` on stdout, stderr, argv, and cwd.
6. `console.format.ts` then `useConsoleLog` to append exactly one entry.
7. `RepositoryProvider.refresh()` after success and failure.
8. `StatusProvider.endOperation` plus a success or warning status, or `OverlayProvider.showError` on failure.

A read path (`app.refresh`, watcher, focus refresh) never enters this flow. It calls `RepositoryProvider.refresh()` directly.

## 11. Configuration and theme architecture

- `@/domain/config/config.paths.ts` resolves `config.json`, `keybindings.json`, and `theme.json` using the precedence in product spec F-19 and F-20.
- Load order is defaults, `config.json`, `keybindings.json`, then runtime reload. Validation is per field; an invalid field falls back to the previous effective value and produces a warning.
- `@/domain/theme/theme.catppuccin.ts` is the only place hex colors exist. It defines the four flavors and the token table from F-20.
- `@/domain/theme/theme.capability.ts` detects truecolor, 256-color, and monochrome, and honors `NO_COLOR`. Token resolution returns final colors per capability.
- UI reads colors only through `useTokens()`. No component holds a hex literal.
- `@/theme/icons.ts` is the single configuration file for every icon, marker, and glyph. No component inlines a glyph. Icons are ASCII-only and always have a text equivalent. See section 6.1.
- The theme picker previews by swapping tokens in `ThemeProvider` without writing the file; Enter persists through `config.writer.ts`.

## 12. Enforcement

These rules are checked, not aspirational. Add the following to the repo as part of the first implementation slice:

- TypeScript strict mode is already on. Keep `noUncheckedIndexedAccess` and `noImplicitOverride`.
- `bun run typecheck` must pass before any change is considered done.
- Biome handles linting, formatting, and import organization. `bun run check` (or `bun run check:fix` to apply safe fixes) must pass before any change is considered done. Configuration lives in `biome.json`; Markdown under `docs/` is excluded from formatting because its tables are hand-aligned.
- Husky manages Git hooks. The pre-commit hook runs `fallow audit` against the merge base with the branch upstream and blocks commits that introduce error-severity findings (dead code, complexity, duplication, or styling). Configuration lives in `.fallowrc.jsonc`; the `.fallow/` cache is git-ignored. `bun run audit` runs the same analysis manually.
- `bun test` must pass. Domain parsers, keymap resolution, upstream classification, pagination, and diff collapse require tests.
- A dependency-boundary check script (a node script run through `bun`, per global instructions) walks `src/` and fails on:
  - `@opentui/*` or React imports under `src/domain/**` or `src/lib/**`.
  - any import from `src/app/**` or `src/features/**` under `src/domain/**`; the command runner must not reach a provider, a hook, or feature code.
  - any spawn call outside `src/domain/git/git.client.ts`.
  - any `fetch` or other network call outside `src/domain/update/update.check.ts`.
  - hex color literals outside `src/domain/theme/theme.catppuccin.ts`.
  - glyph or icon literals outside `src/theme/icons.ts`.
  - feature to feature imports.
  - `index.ts` barrel files.
  - files named `utils.ts`, `helpers.ts`, `common.ts`, `misc.ts`.
  - exported functions, class methods, and components without a JSDoc block, and function bodies above the size limit in section 5.1.
- A structure check script asserts the folder tree in section 4 exists and that every feature folder has a matching feature doc and vice versa.
- Review checklist for every change: layer direction respected, action IDs used instead of raw keys, tokens used instead of colors, icons used from `@/theme/icons` instead of inline glyphs, JSDoc present on every function and method, oversized functions split, states covered, tests added for domain logic, region frames focusable with stable ids, and no application code writes `activeRegion` directly or calls `focus()` from a mouse handler.

## 13. Testing strategy

- Domain: pure unit tests with recorded git fixtures. No spawning in unit tests.
- Keymap and config: table-driven tests for precedence, conflicts, `null` reset, `[]` unbind, and per-field fallback.
- Commands: availability matrix tests covering detached HEAD, no upstream, no remote, empty repository, and operation in progress. `commands.runner.test.ts` asserts pure execution, write serialization, the blocked result, and progress events. `useCommandRunner.test.tsx` asserts exactly one repository refresh, one console append, and one status transition per result, plus error routing and draft preservation on failure.
- UI: component tests with `@opentui/react` test-utils and `test-utils.ts` to assert rendered text markers, footer hints, and focus transitions.
- Focus: `FocusProvider` derives the region from native focus; a focused text input keeps its region active; `useHotkeys` does not consume unmodified typing keys; region frames are focusable and use `focusedBorderColor`; overlay open and close restores the previous renderable.
- Performance: fixture with a large synthetic log to assert page bounds, one in-flight page load, and stale-result discard.

## 14. Feature document contract

Each feature document `docs/technical-implmentations/NN-<name>.md` must contain, in order:

1. Header: status, spec reference, dependencies, and owned paths.
2. Scope and non-goals.
3. OpenTUI components used, as a table naming the component, where it is used, and why it is the right component. Each doc also states that icons come from `src/theme/icons.ts` and names the icon groups it uses.
4. Component tree with the exact components from section 6.
5. Enforced files and folders for the feature, matching section 4.
6. State model and where each piece of state lives.
7. Data flow and the git commands or domain modules involved.
8. Keyboard and focus behavior using action IDs.
9. Loading, empty, error, and disabled states.
10. Performance and bounds.
11. Safety and confirmations.
12. Acceptance mapping back to the product spec.
13. Tests to add.
14. Open questions.

## 15. Feature document index

| File | Feature |
| --- | --- |
| `01-app-shell-and-focus.md` | F-01 App shell and focus |
| `02-top-bar.md` | F-02 Top bar |
| `03-branches-panel.md` | F-03 Branches panel |
| `04-remotes-panel.md` | F-04 Remotes panel |
| `05-tags-panel.md` | F-05 Tags panel |
| `06-stashes-panel.md` | F-06 Stashes panel |
| `07-worktrees-panel.md` | F-07 Worktrees panel |
| `08-commit-graph.md` | F-08 Commit graph |
| `09-commit-composer.md` | F-09 Commit composer |
| `10-commit-details.md` | F-10 Commit details |
| `11-diffs-and-file-actions.md` | F-11 Diffs and file actions |
| `12-command-palette.md` | F-12 Command palette |
| `13-console.md` | F-13 Console |
| `14-help.md` | F-14 Help |
| `15-overlays-and-confirmations.md` | F-15 Overlays and confirmations |
| `16-repository-states.md` | F-16 Repository states |
| `17-freshness-and-performance.md` | F-17 Freshness and performance |
| `18-safety-and-platform-behavior.md` | F-18 Safety and platform behavior |
| `19-configuration-and-keybindings.md` | F-19 Configuration and keybindings |
| `20-theme-and-colors.md` | F-20 Theme and colors |
| `21-startup-splash.md` | F-21 Startup splash and update check |

## 16. How to add a feature or file

1. Confirm the feature exists in `docs/product-spec.md`. If not, update the spec first.
2. Add or update the feature doc in `docs/technical-implmentations/`.
3. Add the feature folder under `src/features/<name>/` with the exact files listed in section 4, or update this document if the structure changes.
4. Add domain modules under `src/domain/**` if new git or pure logic is needed.
5. Add any new icon to `src/theme/icons.ts` rather than inlining a glyph, and give it a text equivalent.
6. Add JSDoc to every new function, method, and component, and split any function that exceeds the size rule in section 5.1.
7. Add tests next to the code.
8. Run the boundary and structure checks, `bun run typecheck`, and `bun test`.
9. Update the index in section 15 if a feature is added.

Any change that breaks a rule in this document must update this document in the same change with the reason.
