# Gitminal Project Architecture

Last updated: 2026-10-25
Scope: Enforced file, folder, layering, and OpenTUI component rules for the Gitminal v1 implementation.
Product spec: `docs/product-spec.md`
Feature docs: `docs/technical-implmentations/01-*.md` through `20-*.md`
Visual reference: [`gitminal.png`](../../gitminal.png). The mockup is the authoritative UI target. Every UI feature must match the area of the mockup mapped to it in `01-app-shell-and-focus.md`.

This document is the contract. Feature documents describe behavior; this document decides where code lives, how layers depend on each other, and which OpenTUI component each concern uses. If a feature doc disagrees with this document on structure or components, this document wins.

## 1. Tech stack (fixed for v1)

| Concern | Choice | Version source |
| --- | --- | --- |
| Runtime | Bun | `>=1.3.14` (`package.json` engines), the floor required by the installed OpenTUI |
| Language | TypeScript, strict, `resolveJsonModule` | `tsconfig.json` |
| Package | `@im4all/gitminal`, version `0.1.0` | `package.json` `name` and `version`; the splash reads both |
| UI | React 19 with `@opentui/react` | `package.json` |
| Terminal rendering | `@opentui/core` | `package.json` |
| Entry module | `src/index.tsx` | `package.json` module field |
| Git access | System git CLI, argument arrays, no shell | Product spec F-18 |
| Tests | `bun test` | This document |

Supported git minimum: **Git >= 2.30.0**. The fixture floor and the integration skip threshold are both 2.30, and every command the app runs is available there. The narrowest requirements are `git branch --show-current` (2.22) and the unambiguous upstream atoms `%(upstream:remotename)` and `%(upstream:remoteref)` (2.28), so 2.30 is the safe floor rather than a version the app happens to be tested on.

No other runtime dependency is added without updating this document. No UI toolkit, state library, router, or HTTP client is introduced. The startup update check uses the runtime's global `fetch` and adds no dependency.

## 2. Architectural principles

1. Observable-first, incremental. Every slice must be runnable and inspectable before it grows. The shell and a single working panel land before git breadth.
2. Layered and one-directional. Dependencies point inward: `features -> ui/app -> domain -> lib`. Domain never imports React or OpenTUI.
3. One source of truth per concern. Repository state comes from git, config comes from the config loader, keybindings come from the keymap resolver, colors come from the theme resolver. Features do not keep parallel copies of these.
4. Commands are the only mutation path. UI dispatches command requests to a single command runner; the domain runner only executes them and returns a result; the app-layer command orchestrator applies refresh, status, console, and error effects. No component calls git directly, and no domain module touches a provider or a React hook.
5. One mutation at a time. The command runner serializes writes and returns a blocked result with a visible reason when a second mutation is requested.
6. One handler per action per scope. Action handlers are registered with an explicit scope and target policy, never flat by action ID for a component lifetime. The palette dispatches commands with an explicit target, never to a hidden surface's stale cursor.
7. Explicit states. Every async surface has loading, empty, error, and disabled states with text markers, not color alone.
8. Composition over new renderables. Only existing OpenTUI components and React composition are used. A new renderable requires a documented reason in this file. The one sanctioned registration is OpenTUI's own `FrameBufferRenderable`, registered through `extend` for `ProgressBar`, because the built-in React catalogue has no frame-buffer binding.
9. Match the visual reference. The mockup at `gitminal.png` is the authoritative target for layout, hierarchy, spacing, and density. Behavior comes from the product spec; arrangement comes from the mockup. Where the mockup shows a detail the sanctioned OpenTUI component cannot render, this document records the deliberate deviation; the unified `<diff>` one-gutter decision in section 6 is the only v1 deviation.

## 3. Layer model and dependency direction

```text
src/index.tsx            bootstrap only (renderer + root)
   |
   v
src/app/**               providers, hooks, composition root
   |         \             \
   v          v             v
src/features/**   src/ui/**   src/theme/**   feature UI, UI primitives, tokens and icons
   |         \        |          |
   v          v       v          v
src/domain/**     (ui composes ui primitives and theme; theme reads only domain theme and lib)
   |
   v
src/lib/**               pure utilities, no React, no git
```

Allowed imports:

- `src/lib/**` imports only `src/lib/**`.
- `src/domain/**` imports `src/domain/**` and `src/lib/**`. Never React, never a React hook, never `@opentui/*`, never `src/features/**`, never `src/app/**`.
- `src/ui/**` imports `src/ui/**`, `src/lib/**`, and `src/theme/**` (tokens, context, and icons) and React and `@opentui/*`. UI primitives compose other UI primitives. It does not import `src/domain/**`, `src/features/**`, or `src/app/**`.
- `src/features/**` imports `src/ui/**`, `src/app/hooks/**`, provider hooks under `src/app/providers/**`, `src/domain/**`, `src/lib/**`, `src/theme/**`, React, and `@opentui/*`.
- `src/theme/**` imports React, `@opentui/*`, `src/theme/**`, any module under `src/domain/theme/**`, and `src/lib/**`. Type-only use of the domain theme modules is the review norm for token types. It does not import `src/ui/**`, `src/features/**`, `src/app/**`, or a domain module outside `src/domain/theme/**`.
- `src/app/**` imports everything except the test-only imports: the test runners `bun:test` and `node:test`, and the harness under `src/test/**`. No production module imports any of them; only colocated `*.test.*` files and modules already under `src/test/` may.
- Feature to feature imports are forbidden. Cross-feature coordination goes through a provider, a domain command, or a selector exported from `src/domain/**`.
- `src/app/AppShellHost.tsx` is the composition root. It is the only module that imports `features/shell` together with the feature panels, graph, composer, details, diff, console, and overlays. `features/shell/AppShell.tsx` owns layout, region frames, and the shell's own UI, but it receives feature surfaces as `ReactNode` props or children and never imports another feature. The quit handler reads `hasUnsavedDraft` from `DraftProvider`, never from the composer feature.

Forbidden imports and key access (enforced by the section 12 scripts):

- Process spawning (`node:child_process`, `Bun.spawn`, `Bun.spawnSync`, `Bun.shell`, or `Bun.$`) outside `src/domain/git/git.client.ts` and `src/test/git.fixture.ts`.
- Network access (`fetch`, `Bun.fetch`, `globalThis.fetch`, `window.fetch`, `Bun.connect`, `WebSocket`, or a `node:http`, `node:https`, `node:http2`, `node:net`, `node:dgram`, `node:tls`, or `undici` import) outside `src/domain/update/update.check.ts`.
- Hex color literals outside `src/domain/theme/theme.catppuccin.ts`.
- Raw key string comparisons outside `src/domain/keymap/**` and `src/app/hooks/useHotkeys.ts`. `src/app/quit.key.ts` is the only exception: `SplashGate` runs before any provider mounts and compares only the fixed `Ctrl+C` quit chord (`key.ctrl` plus `key.name`) through that single helper. After dismissal the shell's `app.quit` action owns quit through the keymap. The boundary check flags equality comparisons between a string literal and a key-like `name`, `sequence`, `raw`, or `code` access, and allows only those three paths. See `21-startup-splash.md` section 8.
- Any external package import inside `src/domain/**` or `src/lib/**`, including React and `@opentui/*`. Node builtins are limited to this per-module allowlist; every other builtin is rejected under domain and lib:

  | Module | Allowed Node builtins |
  | --- | --- |
  | `src/domain/git/git.client.ts` | `node:child_process`, `node:path` |
  | `src/domain/git/git.watcher.ts` | `node:fs`, `node:fs/promises`, `node:path` |
  | `src/domain/config/**` | `node:fs`, `node:fs/promises`, `node:path`, `node:os` |
  | `src/lib/paths.ts` | `node:path`, `node:os` |

  `src/test/**` is test-only. It has no layer import rule of its own, so this builtin allowlist does not apply there. Every module under `src/test/**` remains subject to the spawn and network checks, and `src/test/git.fixture.ts` is the documented spawn exception.

- Non-ASCII or box-drawing glyph literals outside `src/theme/icons.ts`; reusable printable-ASCII markers must also come from `ICONS`.

## 4. Enforced folder structure

```text
gitminal/
  package.json
  tsconfig.json
  scripts/
    check-boundary.ts
    check-boundary.constants.ts
    check-boundary.files.ts
    check-boundary.files.test.ts
    check-boundary.imports.ts
    check-boundary.keys.ts
    check-boundary.process.ts
    check-boundary.types.ts
    check-boundary.test.ts
    check-glyph.ts
    check-glyph.test.ts
    check-structure.ts
    check-structure.types.ts
    check-structure.test.ts
    check-support.ts
    check-support.types.ts
    check-support.test.ts
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
      AppShellHost.tsx
      SplashGate.tsx
      app.constants.ts
      quit.key.ts
      providers/
        ConfigProvider.tsx
        ConfigProvider.types.ts
        ThemeProvider.tsx
        ThemeProvider.types.ts
        RepositoryProvider.tsx
        RepositoryProvider.store.ts
        RepositoryProvider.types.ts
        DraftProvider.tsx
        FocusProvider.tsx
        KeymapProvider.tsx
        KeymapProvider.types.ts
        OverlayProvider.tsx
        OverlayProvider.types.ts
        OverlayProvider.state.ts
        StatusProvider.tsx
        StatusProvider.types.ts
        ConsoleProvider.tsx
        ConsoleProvider.types.ts
      hooks/
        useHotkeys.ts
        useHotkeys.types.ts
        useAction.ts
        useAction.types.ts
        useActionAvailability.ts
        useCommandRunner.ts
        useCommandRunner.types.ts
        commandRunner.blocked.ts
        commandRunner.report.ts
        commandRunner.state.ts
        useFocusRegion.ts
        useFocusState.ts
        useListCursor.ts
        useListCursor.types.ts
        useFooterActionCycle.ts
        useFooterActionCycle.types.ts
        useModalControlCycle.ts
        useModalControlCycle.types.ts
        useScrollSelectedRow.ts
        useInputEscapeClear.ts
        useDebouncedValue.ts
        useDraft.ts
        useOverlay.ts
        useStatus.ts
        useTheme.ts
        useConfig.ts
        useKeymap.ts
        useRepository.ts
        useRepositoryRefresh.ts
        useRepositoryRefresh.types.ts
        useRepositoryRefresh.tasks.ts
        useRepositoryRuntime.ts
        useRepositoryRuntime.types.ts
        useRepositoryStore.ts
        useRepositoryStore.types.ts
        useRepositoryAvailability.ts
        useRepositoryAvailability.types.ts
        useRepositoryBranchRisk.ts
        useRepositoryBranchRisk.types.ts
        useRepositoryInitialRead.ts
        useOptionalRepository.ts
        useRepositoryInitialRead.types.ts
        useRepositoryStoreWatcher.ts
        useRepositoryStoreWatcher.types.ts
        useInFlightTask.ts
        useInFlightTask.types.ts
        useRemoteCommands.ts
        useRemoteCommands.types.ts
        usePanelCommands.ts
        usePanelCommands.types.ts
        useRepositoryEvidence.ts
        useRepositoryEvidence.types.ts
        useRepositoryRemoteTags.ts
        useRepositoryRemoteTags.types.ts
        useRepositoryWatcher.ts
        useRepositoryWatcher.types.ts
        useConsoleLog.ts
        useTerminalSize.ts
        useOverlaySurfaceState.ts
    features/
      splash/
        SplashScreen.tsx
        SplashScreen.constants.ts
        SplashUpdateNotice.tsx
        useUpdateCheck.ts
        useUpdateCheck.types.ts
      shell/
        AppShell.tsx
        AppShell.constants.ts
        Sidebar.tsx
        SidebarPanelFrame.tsx
        SidebarSwitcher.tsx
        MainArea.tsx
        Footer.tsx
        Footer.constants.ts
        PlaceholderSurface.tsx
        ResponsiveGate.tsx
        TooSmallNotice.tsx
        regions.ts
        focus.types.ts
        useFocusModel.ts
      top-bar/
        TopBar.tsx
        TopBar.constants.ts
        TopBarStatus.tsx
        TopBarStatus.constants.ts
        SyncStateBadge.tsx
        SyncStateBadge.constants.ts
        TopBarActions.tsx
        MoreMenu.tsx
        MoreMenuLive.tsx
        MoreMenu.constants.ts
        topBar.budgets.ts
        topBar.budgets.types.ts
        topBar.controls.ts
        topBar.status.ts
        useTopBar.ts
        useTopBar.types.ts
        useTopBarAvailability.ts
        useTopBarCommands.ts
        useTopBarMenu.ts
      branches/
        BranchesPanel.tsx
        BranchesPanel.constants.ts
        BranchRow.tsx
        BranchRow.constants.ts
        NewBranchModal.tsx
        NewBranchModal.constants.ts
        DeleteBranchModal.tsx
        DeleteBranchModalBody.tsx
        DeleteBranchModal.constants.ts
        DeleteBranchModal.types.ts
        DeleteBranchRiskSection.tsx
        deleteBranch.layout.ts
        deleteBranch.risk.ts
        useDeleteBranchRisk.ts
        useBranchRows.ts
        useBranchActions.ts
        useBranches.ts
        useBranches.types.ts
      remotes/
        RemotesPanel.tsx
        RemotesPanel.constants.ts
        RemoteRow.tsx
        RemoteRow.constants.ts
        RemoteFilter.tsx
        RemoteFilter.constants.ts
        CreateLocalBranchModal.tsx
        CreateLocalBranchModal.constants.ts
        CreateLocalBranchModal.types.ts
        useRemotes.ts
        useRemotes.types.ts
        useRemoteActions.ts
        useRemoteCreateLocal.ts
        useRemoteFilter.ts
        useRemoteRows.ts
      tags/
        TagsPanel.tsx
        TagsPanel.constants.ts
        TagRow.tsx
        TagRow.constants.ts
        CreateTagModal.tsx
        CreateTagModal.constants.ts
        CreateTagModal.types.ts
        DeleteTagModal.tsx
        DeleteTagModal.constants.ts
        DeleteTagModal.types.ts
        useTags.ts
        useTagActions.ts
        useCreateTagModal.ts
        useDeleteTagModal.ts
      stashes/
        StashesPanel.tsx
        StashesPanel.constants.ts
        StashRow.tsx
        StashRow.constants.ts
        StashDetails.tsx
        StashDetails.constants.ts
        CreateStashModal.tsx
        CreateStashModal.constants.ts
        CreateStashModal.types.ts
        DeleteStashModal.tsx
        DeleteStashModal.constants.ts
        stash.age.ts
        stash.availability.ts
        stash.prefill.ts
        stash.resolve.ts
        useStashes.ts
        useStashes.constants.ts
        useStashes.types.ts
        useStashAvailability.ts
        useStashCreateCommand.ts
        useStashMutations.ts
        useStashRows.ts
        useStashRowCommands.ts
        useStashSelection.ts
        useCreateStashModal.ts
        usePendingStashSelection.ts
      worktrees/
        WorktreesPanel.tsx
        WorktreesPanel.constants.ts
        WorktreeRow.tsx
        WorktreeRow.constants.ts
        WorktreeDetails.tsx
        WorktreeDetails.constants.ts
        NewWorktreeModal.tsx
        NewWorktreeModal.constants.ts
        NewWorktreeModal.types.ts
        DeleteWorktreeModal.tsx
        DeleteWorktreeModal.constants.ts
        DeleteWorktreeModal.types.ts
        worktree.path.ts
        useWorktrees.ts
        useNewWorktreeForm.ts
        useDeleteWorktreeModal.ts
        useWorktreeActions.ts
        useWorktreeAvailability.ts
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
        ConsoleDrawer.constants.ts
        ConsoleEntryRow.tsx
        ConsoleEntryRow.constants.ts
        ConsoleOutput.tsx
        ConsoleOutputBlock.tsx
        ConsoleOutput.constants.ts
        useConsole.ts
        useConsoleActions.ts
        useConsole.constants.ts
        useConsoleCursor.ts
        useConsoleFollowSync.ts
        useConsole.types.ts
      help/
        HelpModal.tsx
        HelpSection.tsx
        HelpRow.tsx
        HelpConfiguration.tsx
        useHelp.ts
      overlays/
        ConfirmModal.tsx
        ConfirmModal.constants.ts
        ErrorOverlay.tsx
        ErrorOverlay.constants.ts
        ErrorOverlay.types.ts
        OverlayEntrySurface.tsx
        OverlayEntrySurface.types.ts
        OverlayFocus.tsx
        OverlayHost.tsx
        useOverlayHostActions.ts
        useOverlayHostActions.types.ts
      theme-picker/
        ThemePicker.tsx
        ThemeRow.tsx
        useThemePicker.ts
    ui/
      Panel.tsx
      Panel.constants.ts
      PanelScrollContext.tsx
      PanelScrollContext.types.ts
      ListRow.tsx
      ScrollableList.tsx
      Button.tsx
      Button.constants.ts
      Button.types.ts
      ButtonRow.tsx
      StatusBadge.tsx
      TextMarker.tsx
      TruncatedText.tsx
      KeyHint.tsx
      HintBar.tsx
      HintBar.types.ts
      Spinner.tsx
      Spinner.constants.ts
      ProgressBar.tsx
      ProgressBar.constants.ts
      EmptyState.tsx
      ErrorState.tsx
      LoadingRow.tsx
      SearchField.tsx
      FormField.tsx
      Checkbox.tsx
      SelectField.tsx
      ModalFrame.tsx
      ModalFrame.constants.ts
      ModalActions.tsx
      Overlay.tsx
      Overlay.constants.ts
      Swatch.tsx
      SectionHeader.tsx
    domain/
      git/
        git.client.ts
        git.client.types.ts
        git.types.ts
        git.errors.ts
        git.redact.ts
        git.progress.ts
        git.repo.ts
        git.status.ts
        git.log.ts
        git.branches.ts
        git.remotes.ts
        git.remotes.types.ts
        git.remote-branches.ts
        git.remote-branches.types.ts
        git.plan.ts
        git.tags.ts
        git.tags.types.ts
        git.stashes.ts
        git.worktrees.ts
        git.diff.ts
        git.commit.ts
        git.watcher.ts
        parsers/
          parse.status.ts
          parse.status.types.ts
          parse.log.ts
          parse.diff.ts
          parse.refs.ts
          parse.worktrees.ts
          parse.worktrees.types.ts
          parse.stash.ts
      repository/
        repository.types.ts
        repository.selectors.ts
        repository.upstream.ts
        repository.read.ts
        repository.refs.ts
        repository.refs.types.ts
        repository.states.ts
      commands/
        commands.registry.ts
        commands.types.ts
        commands.runner.ts
        commands.availability.ts
        commands.reasons.ts
        commands.steps.ts
        commands.fetch.ts
        commands.fetch.types.ts
        commands.remote.ts
        commands.remote.types.ts
        commands.branches.ts
        commands.tags.ts
        commands.stashes.ts
        commands.stashes.types.ts
        commands.worktrees.ts
        commands.invoke.ts
        confirm.labels.ts
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
        console.constants.ts
        console.format.ts
        console.rows.ts
        console.sanitize.ts
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
      semver.types.ts
    test/
      git.fixture.ts
      git.fake.ts
      react.guard.tsx
      shell.harness.tsx
      app.harness.tsx
```

Rules for this tree:

- Folders are kebab-case, singular, and match the feature name.
- `src/features/<name>/` owns exactly one feature from the feature catalog. A feature never adds a folder under another feature.
- Shared presentational code goes in `src/ui/`. Shared non-UI code goes in `src/lib/`. Shared git code goes in `src/domain/git/`.
- `src/app/providers/` holds React context providers and their colocated `*.types.ts` files only. `src/app/hooks/` holds cross-feature hooks only. A hook used by exactly one feature lives in that feature folder.
- `src/test/` holds test-only harness code. `git.fixture.ts` creates, seeds, and removes temporary repositories for integration tests; no production module imports it, and the boundary check rejects a `src/test/**` import outside a colocated test file or another `src/test/**` module.
- `scripts/` holds the section 12 developer checks only. It is tooling, not a feature folder, so the feature naming rule does not apply.
- `AppShellHost.tsx` is the composition root. Feature components never import one another; they receive cross-feature data through providers, commands, or selectors.
- Sidebar panel features render only the panel body. `SidebarPanelFrame` owns the focusable region frame, the border title, and the scroll container, so a panel never renders a second `Panel`, region frame, or scrollbox. The body carries an optional filter row and the rows themselves; the panel count lives in the border title supplied by `AppShellHost`, and the body has no duplicate title or count row. Remote rows are one line: `<remote>/<branch>` plus an inline stale or unknown marker, with no commit summary or date line. The graph, right-pane, and diff surfaces are not sidebar panels and do own their `Panel` frames.
- The M4 temporary surfaces were `features/console/ConsoleDrawer.tsx` and `features/shell/PlaceholderSurface.tsx`. M6 replaced the console drawer; `AppShellHost` only swaps the surfaces it supplies, and each placeholder is documented as temporary in its own file. M5 replaced the temporary top bar with the real one.

## 5. File naming rules

Enforced:

- React components: `PascalCase.tsx`, one exported component per file, file name equals the exported component name.
- Hooks: `useThing.ts` or `useThing.tsx`, file name equals the exported hook.
- Types only: `<name>.types.ts`. Constants only: `<name>.constants.ts`. Pure logic: `<name>.ts` matching the primary export. Raw-key predicates: `<name>.key.ts` for a pure predicate in the documented pre-shell key path; `src/app/quit.key.ts` is the only current file.
- Value-derived aliases and catalogue-describing interfaces may stay beside the runtime value they describe, because splitting them would make the type and its source drift apart. These are the only named type exports allowed in a runtime module: `ActionId` in `keymap.defaults.ts`, `ThemeToken` and `ThemeTokenTarget` in `theme.tokens.ts`, and `IconName` in `icons.ts`. Every other feature-owned named type or interface belongs in the sibling `*.types.ts` file.
- Tests: colocated `*.test.ts` or `*.test.tsx` next to the file under test. No separate `__tests__` tree. Matching `AGENTS.md`, test files are exempt from the JSDoc, one-exported-component-per-file, component-constants, and function-size split guidance; test helpers and fixtures may stay inline and undocumented.
- No `index.ts` barrels. Import from the exact module path. This keeps dependency edges visible and prevents cycles.
- No file is named `utils.ts`, `helpers.ts`, `common.ts`, or `misc.ts`. Name the concern.
- Path aliases: `@/*` maps to `src/*`. Use `@/domain/...`, `@/ui/...`, `@/features/...`. Relative imports are allowed only within the same folder. One documented exception: `src/app/app.constants.ts` and its colocated test import the root manifest as `../../package.json`, because the app version and package name must have a single source and the manifest sits outside `src`. These are the only cross-folder relative imports; every other import uses `@/*`.

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

- Every function, class method, and exported arrow function has a standard JSDoc block that states what it does, its parameters, and its return value. Use `@param` and `@returns` tags. A one-line `/** ... */` is acceptable only for a trivial, self-evident helper. Colocated `*.test.ts` and `*.test.tsx` files are exempt from this requirement, and their helpers may stay undocumented.
- Non-obvious behavior, side effects, error cases, and invariants are documented in the JSDoc, not only in the implementation.
- React components are documented with JSDoc on the component function, describing the props and the rendered behavior.
- If a production function becomes big, split it. The target is a function that does one thing and reads top to bottom without deep nesting. Split a function that mixes data preparation with side effects, that nests more than three control-flow levels, or that fallow flags for complexity or size. The old "about 40 lines" rule is a review prompt, not a CI parser. Extract named helpers in the same module or the owning folder rather than growing the function.
- A hook follows the same rule. If a hook grows past a single concern, split it into a hook plus pure helpers in `@/lib` or `@/domain`, or into smaller hooks composed together.
- Pure logic that a JSDoc would otherwise duplicate belongs in `@/domain` or `@/lib` with its own tests, not inline in a component.
- Test files are exempt from the JSDoc, one-exported-component-per-file, component-constants, and function-size split guidance in this document, matching `AGENTS.md`. Test helpers and fixtures may stay inline and undocumented.

## 6. OpenTUI component usage rules

These are the only UI building blocks available. Features compose them. The catalog below is the full `@opentui/react` 0.6.6 intrinsic set plus the one registered OpenTUI renderable.

| OpenTUI component | Renderable | Use for | Do not use for |
| --- | --- | --- | --- |
| `<box>` | `BoxRenderable` | All layout, panels, borders, focus rings, rows, modals, overlays, buttons. | Rendering text content directly; always place `<text>` inside. |
| `<text>` | `TextRenderable` | Every string of UI text, labels, status, counts, hints. | Layout. |
| `<span>` | `SpanRenderable` | Inline styled runs inside `<text>`: badges, highlights, key hints. | Standalone layout blocks. |
| `<scrollbox>` | `ScrollBoxRenderable` | Any scrollable region: sidebar panels, graph, diff panel, console, help. Handles wheel scroll, scrollbars, `viewportCulling`. | Non-scrolling short content. |
| `<select>` | `SelectRenderable` | Vertical option lists: More menu, command palette results, commit options, modal option lists. | Primary data lists that need custom row rendering; the theme picker list (it uses a scrollbox of custom rows with swatches). |
| `<tab-select>` | `TabSelectRenderable` | Horizontal selectors: the responsive single-panel switcher in the collapsed sidebar. | Long lists; the top bar action strip (it uses buttons and a status strip). |
| `<input>` | `InputRenderable` | Single-line fields: branch name, tag name, worktree path, filter, commit search, help search, palette search. | Multiline text. |
| `<textarea>` | `TextareaRenderable` | Commit message composer and any multiline form field. | Single-line fields. |
| `<code>` | `CodeRenderable` | Syntax-highlighted read-only content: commit message bodies, console command text when a filetype is known. | Diffs; use `<diff>`. |
| `<diff>` | `DiffRenderable` | All diffs: working, staged, untracked, commit, stash, and conflicted files rendered from a synthetic unified patch. Unified view with one line-number gutter, added/removed backgrounds. | General text; combined `--cc` output, which the underlying patch parser reads as zero hunks. |
| `<line-number>` | `LineNumberRenderable` | Not used directly in v1; it is the fallback only if a future feature needs line-numbered non-diff text with gutter signs. | Diffs; `<diff>` already draws the gutter. Conflict previews use `<diff>` with a synthetic unified patch. |
| `<markdown>` | `MarkdownRenderable` | Help documentation blocks and configuration notes. | App chrome. |
| `<ascii-font>` | `ASCIIFontRenderable` | Startup splash wordmark and the empty-repository, non-repository, and terminal-too-small splash only. | Anywhere else. |
| `<image>` | `ImageRenderable` | Not used in v1. | v1. |
| `<frame-buffer>` | `FrameBufferRenderable` (registered via `extend`) | One-row progress bar in the top bar, rendered only through the `ProgressBar` primitive. | Any other graphics, text, animation, or layout. |
| `<b>`, `<i>`, `<u>`, `<strong>`, `<em>`, `<a>`, `<br>` | span variants | Inline emphasis and line breaks inside `<text>`. | Layout. |

`FrameBuffer` has no React intrinsic in 0.6.6. `src/ui/ProgressBar.tsx` registers OpenTUI's own `FrameBufferRenderable` once with `extend({ "frame-buffer": FrameBufferRenderable })`, augments `OpenTUIComponents` for JSX typing, draws the bar with `fillRect`, and calls `requestRender()` after each change. No custom renderable class is introduced. The drawing approach follows the [OpenTUI FrameBuffer progress-bar example](https://opentui.com/docs/components/frame-buffer/#example-progress-bar).

Hooks available from `@opentui/react` 0.6.6:

| Hook | Use for |
| --- | --- |
| `useKeyboard(handler, { release? })` | The single global key dispatcher, owned by `src/app/hooks/useHotkeys.ts`. `src/app/SplashGate.tsx` is the only other caller, and only while the splash is visible. The temporary splash quit path is replaced by the shell's `app.quit` path. Features never call it directly. See `21-startup-splash.md`. |
| `useOnResize(cb)` | Not used by M3. `useTerminalDimensions` drives responsive rendering; a breakpoint-memoized resize hook is deferred until a measured need. |
| `useTerminalDimensions()` | Responsive layout mode, minimum-size checks, truncation budgets, hint fitting. |
| `useRenderer()` | Bootstrap access, focus management, console drawer access. |
| `useFocus(handler)` / `useBlur(handler)` | Terminal-window focus and blur only: refresh on terminal focus, pause work on blur. Never region focus. |
| `usePaste(handler)` | Commit message and field paste handling. |
| `useSelectionHandler(handler)` | Console log text selection and copy. |
| `useTimeline(options)` | `Spinner` animation. `ProgressBar` throttles redraws with a 100 ms timer instead and redraws only when the rounded cells, width, or color change; this deliberate deviation keeps the frame-buffer draw loop independent of the animation timeline. |

Component rules:

1. Keyboard ownership is centralized. `useHotkeys` is the only `useKeyboard` caller after the shell mounts. `SplashGate` runs before the providers mount and is the documented exception while the splash is visible. It owns dismissal and quit, then unmounts as the shell's `useHotkeys` and `app.quit` path takes over. `useHotkeys` resolves precedence (open overlay, then text input, then native list widget, then focused region context, then global), and it calls `preventDefault()` only when it handles the key. Features register handlers by action ID through `useAction`. No feature inspects `KeyEvent` directly.
2. OpenTUI native focus is the single focus authority. The renderer's `currentFocusedRenderable` receives keys. `FocusProvider` is a projection: it derives `activeRegion` from the focused renderable's nearest ancestor region frame, derives `textInputFocused` from `currentFocusedEditor`, and stores `previousRegion` plus the per-region cursor map. It does not hold a competing writable `activeRegion`. Every region frame is a focusable `<box>` with a stable id and `focusedBorderColor`, so the border follows native focus, including when a descendant text input is focused. The focused frame switches its border to the focus token and its title to the text token; the title text itself never changes, so no marker is added to a boxed title. List rows and controls keep their own text markers.
3. Every navigable list is either a `<select>` (uniform rows, native up/down and Enter, focused when it is the active widget) or a non-focusable `<scrollbox>` of `<box>` rows when rows need custom content such as graph lanes, ref badges, diff headers, or inline actions. In the custom case, the region frame owns focus, and navigation and selection are implemented by `useListCursor` and rendered as a leading marker plus a highlighted row background. `useListCursor` implements `g`/`G` only where the keymap binds `nav.first` and `nav.last`; `tags`, `stashes`, and `worktrees` deliberately do not bind them.
4. Mouse focus uses OpenTUI `autoFocus`. Clicking a text input focuses it; clicking any other element focuses the nearest focusable ancestor, normally the region frame. Region and row mouse handlers must not call `focus()` directly; they select the row and dispatch, and native focus follows the click. Double click is detected by `useListCursor` (two clicks on the same row inside a threshold). Mouse never exposes an action that has no keybinding.
5. Diffs always use `<diff>` with `view="unified"`, `showLineNumbers`, and theme-mapped `addedBg`, `removedBg`, `addedSignColor`, `removedSignColor`. Collapsed unchanged runs are computed in `@/domain/diff/diff.collapse.ts` before the diff string is passed in. Every string passed to `<diff>` must be a valid unified patch with recomputed hunk headers; truncation cuts at hunk boundaries. The unified view draws one line-number gutter. The mockup's two-gutter appearance is illustrative; v1 deliberately renders one gutter rather than adding a custom renderer.
6. Long lists are bounded and virtualized by rendering only the visible window inside a `<scrollbox>` with `viewportCulling`. The graph keeps a loaded-page window in `@/domain/graph/graph.paginate.ts`.
7. The console drawer is app-owned UI (not the renderer's built-in console). It is a `<box>` docked above the footer containing a `<scrollbox>` of entry `<box>` rows, so it can show command, status, duration, and expandable output in the app style. The renderer console is used only for development logging.
8. Disabled controls are rendered with a `dim` token and a text reason, and remain visible. The command palette uses `<select>` options whose `description` carries the disabled reason.
9. Truncation uses `@/lib/text.ts` helpers with explicit budgets from `useTerminalDimensions`; it never hides the current branch, the selection marker, or the primary action.
10. Progress bars use `<frame-buffer>` through the `ProgressBar` primitive only. The bar is one row high, `0` to `100` percent clamped, drawn as colored cells with no glyphs, and always paired with a text phase and percentage. Redraw only when the filled cell count, width, a terminal resize, or the theme color changes, and redraw after a height-only resize because the resize clears the buffer. When no percentage is known the bar is not rendered at all; the status strip shows the spinner instead.
11. The startup splash is the only place `<ascii-font>` is used besides the empty-repository, non-repository, and terminal-too-small states. It renders the `GITMINAL` wordmark with `font="tiny"` above 40 columns and 10 rows and falls back to plain bold text below that, so the splash never wraps. See `21-startup-splash.md`.

### 6.1 Icon catalog and rules

All icons, markers, and glyphs live in exactly one file: `src/theme/icons.ts`. It exports a frozen `ICONS` object and the `IconName` type, and it is the single place to configure the visual vocabulary of the app. The file sits in the theme folder so the icon layer and the color layer are configured together.

Rules:

1. Single source. `src/theme/icons.ts` is the only place a reusable icon or marker value is defined. Components import `ICONS` from `@/theme/icons` and never inline a reusable marker. The glyph check in section 12 fails on non-ASCII and box-drawing characters outside this file; printable ASCII UI text is allowed, and intent is enforced by review.
2. ASCII-safe. Every value uses printable ASCII only. No unicode arrows, box-drawing characters, emoji, or Nerd Font glyphs. This is required by product spec F-18.
3. Never the only signal. Every icon that conveys state is rendered next to, or has, a text equivalent. Color is never the only signal either. For example the missing-upstream icon `[?]` is always shown with the words "upstream not found" or "remote branch deleted". This pairing is a design and review rule, not a machine-checked test, because the text equivalent is written where the icon is used.
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
| Remote actions | `push`, `pull` | `^`, `v` |
| Operation status | `success`, `warning`, `error`, `info`, `pending`, `running`, `done` | `v`, `!`, `x`, `i`, `[ ]`, `[..]`, `[v]` |
| Spinner | `spinnerFrames` | `["|", "/", "-", "\\"]` |
| Toggle | `checkboxOn`, `checkboxOff` | `[x]`, `[ ]` |
| Overflow | `badgeOverflow` | `+` |
| Console | `omittedLines` | `... N lines omitted ...` |
| Graph lanes | `graphLanes` | `["*", "|", "/", "\\", "-", "+"]` |
| Truncation and hints | `ellipsis`, `hintSeparator` | `...`, `|` |

Consumers, all of which read from `ICONS`:

- `src/ui/TextMarker.tsx` renders focus, selection, and status markers.
- `src/ui/Panel.tsx` renders the border title and its focus-dependent title color.
- `src/ui/StatusBadge.tsx` renders sync and operation status badges.
- `src/ui/Spinner.tsx` renders `spinnerFrames` through `useTimeline`.
- `src/ui/ProgressBar.tsx` draws a FrameBuffer bar; it uses theme colors and no glyphs.
- `src/ui/Checkbox.tsx` renders `checkboxOn` and `checkboxOff`.
- `src/ui/ListRow.tsx` and `src/ui/SectionHeader.tsx` render selection and expansion markers.
- `src/features/graph/GraphLanes.tsx` renders lane cells from `graphLanes`.
- `src/features/diff/DiffFileRow.tsx` renders file status letters.
- `src/features/console/ConsoleOutput.tsx` and `ConsoleOutputBlock.tsx` render `omittedLines`.

Tests: `src/theme/icons.test.ts` asserts that every required group and key from section 6.1 is present, that every value is printable ASCII, and that array values are non-empty and frozen.

## 7. UI primitive catalog

`src/ui/**` holds the only reusable presentational components. Each is a composition of the OpenTUI catalog above.

| Primitive | OpenTUI composition | Purpose |
| --- | --- | --- |
| `Panel` | `<box>` with border, optional `focusable`, stable `id`, `focusedBorderColor`, border title | Bordered region with a native focus-aware border and a title embedded in the top border (`┌─ Title ────────┐`). The border switches to the focus token and the title to the `text` token while the region owns focus, and the title stays `muted` otherwise. The title text is identical in both focus states. Region frames pass `focusable` and the region id. |
| `ListRow` | `<box>` + `<text>` + `<span>` | Row with marker, columns, actions. Marker from `ICONS` in `@/theme/icons`. The selected row uses the dark `surface` token as its background, so the fill stays subtle and the marker carries the selection signal. Native selects and focused buttons keep the `selection` token; the list-row fill is the deliberate exception. |
| `ScrollableList` | `<scrollbox>` | Plain scroll container. |
| `Button` | `<box>` + `<text>` | Filled text or icon-only button with a raised background, one cell of horizontal padding, a focused background and bold label, and mouse activation. Never adds a text marker. Not natively focusable: the owning feature keeps the focused control index. |
| `ButtonRow` | `<box>` + `Button` children | Horizontal action group with a small gap; presentational only. |
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
| `SearchField` | `<input>` | Filter and search fields with placeholder. |
| `FormField` | `<box>` + `<text>` + `<input>`/`<textarea>` + error text | Labeled field with inline validation. |
| `Checkbox` | `<box>` + `<text>` marker | Toggle rendered from `ICONS.checkboxOn`/`ICONS.checkboxOff`, keyboard and mouse. |
| `SelectField` | `<select>` | Field that picks from options. |
| `ModalFrame` | `<box>` centered overlay wrapper + focusable frame with border and title + `<ModalActions>` | Standard modal structure and native focus trap. |
| `ModalActions` | `<ButtonRow>` | Footer actions in caller order; destructive default focus is Cancel. |
| `Overlay` | `<box>` full-width layer that leaves the footer row visible | Background deactivation behind modals. |
| `Swatch` | `<box>` colored cell | Theme picker color preview. |
| `SectionHeader` | `<box>` + `<text>` + marker | Expand/collapse header using `ICONS.expanded`/`ICONS.collapsed`. |

A feature may compose these primitives but must not fork them. If a feature needs a variant, add a prop to the primitive instead of copying it.

Sidebar panel notes: a sidebar panel's count lives in the border title supplied by `AppShellHost`, and the panel body renders no duplicate title or count row. The collapsed layout's `<tab-select>` uses `SidebarPanel.shortLabel` (the plain section name) while the border title keeps `label` with the count, so the count is never duplicated in the tabs. Remote rows are one line: `<remote>/<branch>` plus an inline stale or unknown marker, with no commit summary or date line.

## 8. Focus and keybinding architecture

Regions (stable IDs in `src/features/shell/regions.ts`):

```text
top-bar, branches, remotes, tags, stashes, worktrees, graph, right-pane, diff, console
```

Direct region jumps use the digits `1`-`9` in screen order: `1`-`5` are the five sidebar panels, `6` is `graph`, `7` is `right-pane`, `8` is `diff`, and `9` is `console`. `top-bar` has no default digit but keeps a `focus.region.topBar` action for configuration and the palette. `regions.ts` owns the region IDs and their `focus.region.*` action IDs, `keymap.defaults.ts` binds the digits, `useFocusModel` registers the handlers, and a jump calls `focusRegion` instead of writing focus state. A jump to a sidebar panel that the collapsed layout is not showing selects it in the `<tab-select>` first. Digits resolve in the global context, so native list widgets do not consume them, but an overlay or a focused text input owns them through precedence rules 1 and 2.

- OpenTUI native focus is the authority. `renderer.currentFocusedRenderable` decides which renderable receives keys.
- `FocusProvider` subscribes to `renderer` events `focused_renderable` and `focused_editor`. It derives `activeRegion` from the focused renderable's nearest ancestor region frame (`region-<regionId>`), derives `textInputFocused` from `currentFocusedEditor !== null`, and derives `nativeListFocused` from the focused renderable being a `SelectRenderable` or `TabSelectRenderable`. If focus is outside every region, such as in an overlay, `activeRegion` keeps its last value while the overlay owns keys. It stores `previousRegion`, `focusedRenderableId`, `previousFocusedRenderableId`, and the per-region cursor map. It exposes `focusRegion(regionId)`, `focusRenderable(id)`, and `restoreFocus(id)`. It does not expose a writable `activeRegion` or a manual text-input flag.
- `useFocusRegion(regionId)` returns `{ focused, focus(), regionProps, getCursor, setCursor }`. `regionProps` sets a stable id `region-<regionId>`, `focusable`, and `focusedBorderColor` on the region frame. `focused` is true when the focused renderable is the region frame or a descendant, including a text input inside it. It is false while focus is in an overlay.
- `useFocusModel` owns Tab and Shift+Tab traversal in the spec order, the `focus.region.*` direct jumps, skips regions hidden by responsive fallbacks, appends the `console` region to the cycle only while the drawer is open, and calls `focusRegion(next)` instead of writing focus state directly.
- A text input or other widget that must be focused programmatically has a stable id and is focused with `focusRenderable(id)`. `focusRegion` is only for a region frame. Examples are `graph.search` focusing the search input and `commit.focus` focusing the composer textarea.
- Text input mode applies when `currentFocusedEditor` is not null. `Esc` leaves the input without clearing its value and normally returns focus to the owning region frame; a feature may consume the first `Esc` for a documented cancel or clear or define a different return target (the composer returns to the textarea's region), but the next `Esc` must leave the input. `Tab` and `Shift+Tab` follow the field type first: in a multiline `<textarea>`, `Tab` inserts the indent unit at the cursor and `Shift+Tab` removes up to one indent unit from the start of the current line, and neither moves focus, including inside an overlay; in a single-line `<input>`, they move to the next or previous region in the shell, or to the next or previous field or footer action inside an overlay. The textarea indent unit is `TEXT_INDENT_UNIT` (two spaces) in `src/lib/text.ts`, and replaces the selection when one exists. A textarea exposes `insertText` through its ref so the handler can insert the indent before calling `preventDefault()`.
- Input modes are part of keymap resolution, not exceptions handled ad hoc by features. Every focused editor resolves to one of three modes: `field` (plain single-line or multiline editing), `search` (a single-line search over a result list), or `form` (a modal or shell form with fields and footer actions). The mode is a pure function of the focused editor's registered `InputMode` metadata.
  - `field` owns every unmodified printable key, Backspace, Delete, arrows, Home, End, and Enter. A textarea's Enter inserts a newline; a single-line input's Enter invokes its native submit callback.
  - `search` keeps printable keys and editing keys in the field, but routes Up, Down, PageUp, PageDown, Home, and End to the bound result list, and routes Enter to `nav.activate` for the highlighted result. A search mode is declared by the owner when it registers the input.
  - `form` keeps printable keys and Enter in a single-line field, routes `Tab`/`Shift+Tab` between fields and footer actions, and maps `Ctrl/Cmd+Enter` to `form.submit`. A multiline form field keeps `Tab` for indentation and uses `Ctrl/Cmd+Enter` for `form.submit`.
- OpenTUI editing behavior is preserved. In text input mode, only an explicit text-input-safe allowlist of app actions may fire: `app.palette`, `app.console`, `commit.submit`, `commit.options`, and `form.submit`. Such an action fires only when its effective binding uses `Ctrl`, `Cmd`, or `Alt`; an unmodified default binding for the same action never fires while an editor is focused. This is why `commit.options` remains reachable as `Alt+.` in the composer while plain `.` types a period. Every other key, including every modified key not in that allowlist, passes to the input or textarea untouched. This preserves `Enter` submit on single-line inputs, `Enter` newline on textareas, and the OpenTUI editing bindings: `Ctrl+A/E/F/B/W`, `Ctrl+Backspace/Delete`, `Ctrl+K/U`, `Ctrl+-/.`, `Super+A/Z`, and `Alt+D/F/B` plus arrow variants. Configured app bindings outside the allowlist never fire while typing, even when they use a modified key. `Ctrl+C` remains the hardcoded app quit path from the product spec and is the one deliberate exception.
- `Ctrl`/`Cmd`-modified shortcuts do not resolve through the app keymap in text input mode. They do so only outside text input mode or when they are in the text-input-safe allowlist above and use a modifier. Unmodified keys always pass to the input.
- Native list mode applies when a `<select>` or `<tab-select>` is focused. That widget owns `nav.up`, `nav.down`, `nav.pageUp`, `nav.pageDown`, `nav.first`, `nav.last`, and `nav.activate`; `useHotkeys` must not prevent those keys from reaching it. A focused `<tab-select>` also consumes Left and Right natively, which is how the collapsed sidebar switches panels; no app action binds those keys in a sidebar context. Global modified shortcuts, `focus.next`/`focus.previous`, and the `focus.region.*` digit jumps still work.
- `overlay` is not a region. On open, `OverlayProvider` captures the current focused renderable, blurs it, and focuses the first focusable element in the modal after mount. While open, the overlay owns keys. The overlay context applies the same text-input and native-list delegation for keys it does not handle; region focus does not apply. On close, it restores the captured renderable if it is still mounted, otherwise it focuses that renderable's region frame.
- Outside a modal text field, the only global actions that may resolve while an overlay is open are the overlay's own toggle and `overlay.close`: `app.palette` when the palette is the open overlay, `app.help` when help is the open overlay, and `app.quit` as the hardcoded quit escape hatch. They toggle or close that overlay. No other global action, including `remote.*`, `app.themePicker`, or `app.reloadConfig`, is reachable until the overlay closes. Inside a modal text field, `overlay.close` on `Esc`, the hardcoded `Ctrl+C` quit path, and modifier-gated text-input-safe actions may fire; a plain unmodified global action never does. The console drawer is not an overlay; `app.console` stays global while it is open.
- The startup splash is not a region and has no focus. It renders before the providers and the keymap mount. `SplashGate` owns the only `useKeyboard` subscription while the splash is visible: `Ctrl+C` calls `onQuit` without dismissing, and every other key calls `onDismiss`. After dismissal `SplashGate` unmounts and the shell's `useHotkeys` owns keys, with `app.quit` as the quit path. `SplashGate` reads the fixed quit chord only through `src/app/quit.key.ts`. See `21-startup-splash.md`.
- Action IDs are exactly the IDs in product spec section 6.1 and live in `src/domain/keymap/keymap.defaults.ts`. Features receive action IDs only.
- `KeymapContext` uses the exact `RegionId` values plus `global` and `overlay`: `top-bar`, `branches`, `remotes`, `tags`, `stashes`, `worktrees`, `graph`, `right-pane`, `diff`, and `console`. `useHotkeys` therefore looks up `contexts.get(activeRegion)` directly, with no adapter or cast between the focus model and the keymap.
- `nav.left` and `nav.right` bind the top bar, the right pane, and overlays, with `Left`/`h` and `Right`/`l` as defaults. Sidebar panels do not bind them: the collapsed switcher is a native `<tab-select>` and owns those keys in native list mode.
- Precedence is computed in `src/domain/keymap/keymap.resolve.ts`. A key may appear once per context. Context overrides global for the same key.
- Footer hints come from `src/domain/keymap/keymap.describe.ts` filtered by the focused region and current availability. Help and the palette read the same effective keys and availability reasons, but they keep unavailable actions visible; only footer hints drop them. The `focus.region.*` actions are help- and palette-only and are never emitted as footer hints.

### 8.1 Action, command, and handler model

Action IDs and commands are related but distinct:

- An **action ID** is the stable, key-bindable intent from product spec section 6.1, for example `app.quit`, `branch.delete`, `nav.activate`, or `focus.region.graph`. Action IDs are the only names accepted in `config.json` and `keybindings.json`.
- A **command ID** is a stable, palette-invocable operation. Most commands reuse their action ID as the command ID. Internal commands such as `graph.selectCommit`, `stash.select`, and `worktree.select` are command IDs with no action ID and no default key. `nav.*` actions are key-only and are never palette commands. `focus.region.*` actions are key-bindable navigation commands and remain palette- and help-invocable because they are the discovery surface for direct region access.
- `src/domain/commands/commands.registry.ts` is the single catalogue. Each descriptor declares `id`, optional `actionId`, `kind` (`mutation`, `read`, or `navigation`), handler `scope` (`global`, a `RegionId`, or `overlay`), `targetKind`, label, description, keywords, category, `paletteInvocable`, and `needsInput`.

Targets are explicit values, not ambient cursors:

```ts
type CommandTarget =
  | { kind: "none" }
  | { kind: "branch"; name: string }
  | { kind: "remoteBranch"; remote: string; branch: string }
  | { kind: "tag"; name: string; remote?: string }
  | { kind: "stash"; objectName: string }
  | { kind: "worktree"; path: string }
  | { kind: "commit"; oid: string }
  | { kind: "pending" }
  | { kind: "diffFile"; section: DiffSection; path: string; oldPath?: string }
  | { kind: "form"; formId: string }
```

Two kinds of state feed a target. The right-pane selection union (`pending`, `commit`, `stash`, `worktree`, or a diff file) lives in `RepositoryProvider`. Per-region cursors live in `FocusProvider` keyed by stable identity. A command's owning feature derives its target from one of those sources through a selector, never from another feature's local component state.

Availability is target-aware:

```ts
type CommandContext = {
  state: RepositoryState
  signals: RepositorySignals
  target: CommandTarget
  region: RegionId | "overlay"
  operation: "idle" | "running"
}

getAvailability(commandId, context): { available: boolean; reason?: string }
```

`src/domain/repository/repository.states.ts` exposes `gateRepository(actionId, state, signals)` for repository-wide gates such as detached HEAD, empty repository, or missing remote. `src/domain/commands/commands.availability.ts` combines that result with target validation, so a branch action can explain "cannot delete the current branch" and a diff action can explain "read-only" from the same call. The footer, palette, help, buttons, and confirmations all read the same result.

Handlers are scoped and singular:

- `src/app/hooks/useAction.ts` exposes `useAction(actionId, { scope, targetKind }, handler)`. Exactly one handler may exist per `(actionId, scope)`. A duplicate registration is a development error and the later registration is rejected; last-mounted-wins is never allowed.
- Global actions (`app.*`, `focus.*`, `remote.*`, `overlay.close`) have exactly one designated owner: `src/app`, the shell, or the always-mounted top bar for the `remote.*` operations it presents. Features register only their region-scoped actions, such as `branch.delete`, `diff.stage`, or `nav.activate`. A panel that unmounts in the collapsed layout never owns a global handler.
- `useHotkeys` resolves the focused scope first, then the one global registration. `nav.activate` is registered by the focused region only, so the active surface owns it.
- The palette dispatches `{ commandId, target }`, captured when the palette opens from the selector above. On Enter it revalidates availability with fresh state. If the target is missing, stale, or the owning surface is hidden by the collapsed layout, the palette closes, focuses or reveals the owning region, and shows the availability reason; it never dispatches to a hidden panel's stale cursor.
- Commands with `needsInput` close the palette and open the owning modal with the resolved target. Commands whose target is the right-pane selection read `RepositoryProvider.selection`; commands whose target is a list row read the focused region's cursor projection.

## 9. State architecture

The startup splash (`21-startup-splash.md`) runs before any provider mounts. It owns only local view state and one background update check, then unmounts.

Providers, outermost to innermost:

1. `ConfigProvider`: resolved config, warnings, reload. Source: `@/domain/config`.
2. `ThemeProvider`: resolved tokens and color capability. Source: `@/domain/theme`. Exposes tokens through `@/theme/useTokens.ts` and the full resolved theme through `app/hooks/useTheme.ts`.
3. `KeymapProvider`: resolved action to keys map. Source: `@/domain/keymap`.
4. `RepositoryProvider`: repository snapshot, the right-pane selection union (`pending`, `commit`, `stash`, `worktree`, or `diffFile`), and the refresh cycle. Source: `@/domain/repository` and `@/domain/git`. It does not own row expansion.
5. `DraftProvider`: the composer draft string and `hasUnsavedDraft`. The shell's quit handler and the composer both read this provider; the composer does not duplicate it, and no feature imports another feature to answer the unsaved-work question. The footer reads the repository through `useOptionalRepository`, which returns null outside a provider so shell-only tests do not need the repository stack.
6. `FocusProvider`: a projection of OpenTUI native focus, `previousRegion`, and the per-region cursor map. It is not a second focus authority.
7. `OverlayProvider`: one open overlay entry at a time (a feature modal or a destructive/non-destructive confirmation) plus the focus captured when it opened. Opening a second entry replaces the first instead of stacking. The persistent error detail and the error overlay landed in M6. Success and informational messages are not overlays.
8. `StatusProvider`: transient status, footer hint mode, operation progress. It is the only surface for success and informational messages. Success and informational messages auto-dismiss after a short timeout; warning and error messages stay until another status replaces them or `clearStatus` removes them.
9. `ConsoleProvider`: drawer visibility, bounded command log, follow mode, new-entry count, expanded entry ids, and the pending cross-surface selection request (`pendingSelectionEntryId`).

Data flow for a mutation:

```text
key, click, or palette -> action ID or command ID + explicit CommandTarget
   -> useAction handler for the focused scope, or the single global handler
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
- State has exactly one owner: snapshot, selection union, and refresh generation in `RepositoryProvider`; composer draft in `DraftProvider`; cursors and previous region in `FocusProvider`; the single overlay entry and its captured focus in `OverlayProvider`; transient status and progress in `StatusProvider`; console entries, follow mode, and expanded entries in `ConsoleProvider`; config, keymap, and theme in their providers. Row expansion, focused control index, filter text, and modal form drafts are feature view state, owned by exactly one feature. `RepositoryProvider` never owns expansion, and a feature never keeps a second copy of the selection.
- The right-pane sub-mode is derived, not stored: `selection.kind === "pending"` renders the composer, `"commit"` renders commit details, `"stash"` renders stash details, `"worktree"` renders worktree details, and a diff-file selection leaves the current right-pane mode intact while the diff panel highlights the file. There is no separate sub-mode flag in a provider or a feature.
- Repository reads are derived in `@/domain/repository/repository.selectors.ts`. Features never recompute ahead/behind, upstream state, or pending counts themselves.
- Optional ref lists settle independently. A failed branch, remote-branch, tag, stash, or worktree read keeps that list's previous snapshot value and records the failure in `RepositoryProvider.listFailures` for the owning panel, while every successful list still applies. Status and the remote list are required reads: a failure there fails the whole read and the provider keeps the previous snapshot. A retained worktree or branch list re-derives the branch `worktreePath` values from the worktrees the snapshot stores, so the branch `+` marker, the selected-row worktree detail, and the `checked-out-in-worktree` delete guard stay consistent with the Worktrees rows that remain visible.
- Every command declares availability in `@/domain/commands/commands.availability.ts` with a machine-readable reason string and a target-aware context. The palette, footer, help, buttons, and confirmations all read the same reason.
- Failures never clear drafts or staged files. The runner returns a result object; the orchestrator keeps the UI inputs and surfaces the error.

## 10. Git execution architecture

- `src/domain/git/git.client.ts` is the only module that spawns processes. It uses an argument array, `git.path` from config, `cwd` at the repository root, no shell, and stdin ignored.
- Credential and editor prompts are disabled through an explicit environment matrix. The client sets `GIT_TERMINAL_PROMPT=0`, `GCM_INTERACTIVE=never`, `GIT_ASKPASS=""`, `SSH_ASKPASS=""`, `SSH_ASKPASS_REQUIRE=never`, `GIT_EDITOR=true`, `GIT_SEQUENCE_EDITOR=true`, `GIT_PAGER=cat`, `PAGER=cat`, `GIT_MERGE_AUTOEDIT=no`, and `LC_ALL=C`. It sets `GIT_SSH_COMMAND=ssh -o BatchMode=yes` only when the user has not configured `GIT_SSH_COMMAND` or `core.sshCommand`; a user-configured SSH command wins. The `core.sshCommand` probe caches only a conclusive answer, and a cancelled, timed-out, spawn-failed, or generic git failure is retried instead of overriding a configured command. A missing credential or network failure fails visibly and is logged; the app never hangs on a prompt.
- Every invocation has a timeout and a cancellation signal. Defaults are 10 seconds for local reads, 30 seconds for local writes, and 120 seconds for network operations. `git.client.ts` accepts an `AbortSignal`; on abort it sends `SIGTERM`, waits two seconds, then sends `SIGKILL`, and returns a cancelled result. Timeouts use the same path and are reported as "timed out after N seconds". A terminated child settles on its `exit` event; a normal exit waits for `close` only during a bounded 100 ms flush grace, so a backgrounded descendant that inherits the output pipes cannot defeat the timeout or delay quit. Once a normal exit is recorded the invocation timeout is cleared, so a late timeout or abort cannot rewrite a completed command as timed out or cancelled. Quit aborts the in-flight command through the orchestrator, waits for it to settle, and destroys the renderer only after the child has exited or been killed. M4 deviation: draft-based quit confirmation remains deferred beyond the M6 overlay work, so `app.quit` always aborts immediately; the abort-before-destroy order is implemented.
- Writes are serialized inside `commands.runner.ts`. Index-touching reads (`status`, `diff`, `log --raw`) are serialized against writes by `git.client.ts`, so a status read never observes a half-applied mutation. A second write while one is running returns a blocked result with a reason. The runner holds no provider state; the blocked reason and the running flag are projected to the UI through the orchestrator and `StatusProvider`.
- `commands.runner.ts` executes only. It returns a `CommandResult` with the operation label, the ordered `steps` (each with argv, exit status, duration, stdout, and stderr), cwd, progress phases, and the cancelled or timed-out flag. A composite operation such as create-with-checkout, delete-local-and-remote, or a grouped prune records one step per git invocation so the console can show each command. A step marked `nonFatal` does not make the result a failure: the documented case is a scoped Fetch whose configured upstream no longer exists on the remote, where the step stays in the console, the result stays a success, and `warnings` names the affected branch so the orchestrator shows a warning status instead of the error surface. A handler that refuses its scope before working returns `blockedReason`, which the runner turns into a blocked result with no steps. A handler that contacts remotes may also return `remoteResults`, a per-remote success list; `useRemoteCommands` records `RepositoryProvider.recordRemoteCheck(remote, "fetch", succeeded)` for each entry, so a completed fetch advances that remote's last successful fetch timestamp and a failed remote leaves it untouched. A Fetch --prune handler also returns `prunedUpstreamRefs` and `unknownUpstreamRefs`; the wrapper folds both lists into repository evidence and performs one refresh before returning, so the orchestrator's own refresh sees the new upstream classification without one full read per ref. A run whose every remote group failed and that fetched or pruned nothing sets `failed: true`, so a total failure reaches the error surface while a partial failure stays a success with warnings. The runner never refreshes the repository, appends a console entry, sets a status, or opens an overlay. `src/app/hooks/useCommandRunner.ts` applies those effects after the result.
- The scoped Fetch runs one invocation per upstream ref with `git fetch --progress -- <remote> +refs/heads/<branch>:refs/remotes/<remote>/<branch>`. The forced-update prefix keeps the remote-tracking ref a mirror of the remote after an amend, rebase, or force-push, and the destination is never a local branch. A missing remote ref is classified per step as `nonFatal`; a scope with no upstream refs is blocked. The scope is read from the tab-separated `%(refname:short)%09%(upstream:remotename)%09%(upstream:remoteref)` atoms and grouped by the exact remote name, so a remote whose name contains `/` is never split at the first slash.
- Network operations pass `--progress` (`git fetch --progress`, `git pull --progress --no-edit`, `git push --progress`) and stream stderr through `git.progress.ts`; the runner forwards progress events to the orchestrator, which updates `StatusProvider`. Commands without a meaningful percentage emit phase-only events, and a phase-only event for a new phase clears the previous percentage. Remote and ref arguments are validated as single safe argv values and passed after `--` where git supports it; `git update-ref` places `--` after `-d`. Push plans always name the configured upstream remote and an explicit `refs/heads/<branch>:refs/heads/<upstream.branch>` refspec after reading `git branch --show-current`, and the no-upstream path uses `--set-upstream origin refs/heads/<branch>:refs/heads/<branch>`, so `push.default=matching` cannot widen the scope and a stale snapshot cannot push the wrong branch. The configured upstream itself is read with `%(upstream:remotename)` and `%(upstream:remoteref)`, never by splitting `%(upstream:short)`, because a legal remote name may contain a slash; Fetch and Fetch --prune use the same atoms.
- `git.redact.ts` redacts credentials in URLs, authorization headers, and environment values before any console or error rendering. The orchestrator applies redaction to the `CommandResult` before it stores or renders output.
- `git.watcher.ts` watches the git directory and triggers refresh. Recursive watching is requested first; when the platform refuses it, the git directory and its ref directories are watched non-recursively and the limitation is published through the watcher status. Worktree watching is opt-in and off by default, filters a documented ignore set, and reports its own limitation. Because the default git-dir mode leaves the working tree unwatched, F-17 assigns a text hint to the footer or sidebar surface. The M5 top-bar status strip is reserved for branch information, operation progress, and transient status, and no component renders the hint yet; the deferral is recorded in `17-freshness-and-performance.md` so this contract does not claim a surface that does not exist. `.git/index.lock` churn never triggers a refresh, and a watch error closes the watch and publishes an inactive status. Manual `r` refresh is always available.
- Parsers under `src/domain/git/parsers/` are pure and unit tested against recorded git output fixtures. Process-spawning integration tests live in `*.integration.test.ts` files and use `src/test/git.fixture.ts` to create and remove temporary repositories.

The executor contract lives in `src/domain/commands/commands.types.ts`:

```ts
type CommandRequest = {
  commandId: string
  target: CommandTarget
  formValues?: Readonly<Record<string, string | boolean | readonly string[]>>
}
type CommandProgress = { phase: string; percent?: number }

type CommandStepResult = {
  argv: readonly string[]
  exitCode: number | null
  durationMs: number
  stdout: string
  stderr: string
  cancelled?: boolean
  timedOut?: boolean
  timedOutAfterMs?: number | null
  stdoutTruncated?: boolean
  stderrTruncated?: boolean
  nonFatal?: boolean
}

type CommandResult = {
  commandId: string
  status: "success" | "failure" | "blocked"
  operationLabel: string
  steps: readonly CommandStepResult[]
  cwd: string
  progress: readonly CommandProgress[]
  blockedReason?: string
  warnings?: readonly string[]
  cancelled?: boolean
  timedOut?: boolean
  timedOutAfterMs?: number | null
}

type CommandRunOptions = {
  state: RepositoryState
  signals: RepositorySignals
  target: CommandTarget
  region: RegionId | "overlay"
  signal?: AbortSignal
  onProgress?: (progress: CommandProgress) => void
}
```

`commands.runner.ts` exposes one entry point: `runCommand(request, options): Promise<CommandResult>`. It returns a failure result instead of throwing for a git failure, and a blocked result for an unavailable command, a missing target, or a rejected second write. `state`, `signals`, `target`, and `region` are plain values from `RepositoryProvider` and `FocusProvider`; the runner calls the pure `commands.availability.ts` itself. Provider data crosses the boundary as data, never as a hook or context. Only `src/app/hooks/useCommandRunner.ts` calls the runner in application code; tests call it directly.

`useCommandRunner` exposes `runCommand(request): Promise<CommandResult>` and applies the result in this order:

1. Capture the current `RepositoryState`, `RepositorySignals`, explicit `CommandTarget`, and region, then compute availability with `commands.availability.ts`. If the command is unavailable or the target is missing or stale, surface the reason as a transient status and return a blocked result without starting an operation, refreshing, or appending.
2. `StatusProvider.beginOperation` before invoking the runner.
3. Invoke `commands.runner.ts` with the captured values and an `AbortSignal` owned by `useCommandRunner`. The runner re-checks availability and serialization as the authority; if it returns a blocked result, call `endOperation`, surface the reason, and skip refresh, console, and error effects.
4. `StatusProvider.updateOperation` for each progress event.
5. `git.redact.ts` on every step's stdout, stderr, and argv, plus cwd, followed by the pure control-character sanitizer in `console.sanitize.ts`; argv, cwd, and warnings use its single-line mode, while stdout, stderr, and error messages keep newlines and tabs.
6. `console.format.ts` then `useConsoleLog` to append exactly one entry.
7. `RepositoryProvider.refresh()` after success and failure. A cancelled or timed-out result refreshes so the UI reflects any partial local change.
8. `StatusProvider.endOperation` plus a success or warning status, or `OverlayProvider.showError` on failure. A cancelled result sets a warning status "cancelled"; a timed-out result sets "timed out after N seconds" when the client reported the duration. Neither opens the error overlay. A requested mutation returns `operation-in-progress` before `beginOperation` while an orchestration still owns the post-result refresh, console, and status effects.

A settled result closes only the overlay entry that was open when the command started, through `OverlayProvider.closeEntry(entryId)`. An unrelated confirmation opened while the command runs, or a visible error detail, is left untouched. A caught exception is redacted and sanitized before it reaches the error detail, and it appends exactly one console entry that the overlay links to. When the exception follows an already-appended result entry, for example a rejected post-result refresh, that entry is replaced in place with a failure carrying the same summary, and the overlay reports the distinct operation `Refresh after <command>`, so the title, linked entry status, and summary agree. A thrown entry summary and decisive error are single-line, while the overlay message keeps newlines; both thrown and settled detail blocks are capped with the shared console rule. The retry closure consumes a rejected re-run because the error detail is already stored, so an unhandled rejection cannot terminate the TUI.

A read path (`app.refresh`, watcher, focus refresh) never enters this flow. It calls `RepositoryProvider.refresh()` directly.

M4 deviations, recorded here per the last rule in this document:

- The error overlay landed in M6. `useCommandRunner` routes settled failures to `OverlayProvider.showError` with redacted, sanitized details, the console entry link, and a retry closure for retryable remote commands; Retry re-runs the original request, including its form values.
- Draft-based quit confirmation remains deferred beyond M6. `app.quit` aborts the in-flight command and waits for it to settle before `renderer.destroy()`; it does not yet ask about `DraftProvider.hasUnsavedDraft`.
- M4 wired the first real mutation through the orchestrator: `remote.fetch` executes upstream-scoped `git fetch --progress` on the network class. M5 adds `remote.pull`, `remote.push`, `remote.pushForceSafe`, `remote.pushForceOverwrite`, `remote.pushNoVerify`, and `remote.fetchPrune` through the same registry, runner, and orchestrator path; the M5 top bar replaces the temporary trigger, not the path. Fetch and Fetch --prune are blocked with `no-local-upstreams` when the repository read resolves no local upstream, and a configured upstream whose remote ref is gone is a non-fatal warning that names the branch rather than a command failure. Pull requires a configured upstream, plain push and push --no-verify auto-create `origin/<branch>` when none exists, and the force variants require an existing upstream. Fetch --prune confirms remote absence with `git ls-remote --heads -- <remote>` before any `git update-ref -d`, and a failed, timed-out, or truncated check leaves its refs unknown instead of deleted. Push and its variants read the current branch from git, fail on a mismatch with the captured target, and use an explicit configured-upstream remote and `refs/heads/<branch>:refs/heads/<upstream.branch>` refspec. The configured upstream remote and branch come from `%(upstream:remotename)` and `%(upstream:remoteref)`, and Fetch and Fetch --prune group the same atoms by the exact remote name, so a slash-named remote is never split. `commands.remote.ts` stays above the file-review threshold as documented M5 debt; the extraction target is `commands.prune.ts` for the prune orchestration and, if useful, `commands.remote.push.ts` for the push and upstream readers, when a fourth composite remote command lands or before the v1 freeze.
- Repository reads expose an explicit `failureKind`. Cancelled, timed-out, auth-network, and unknown failures keep the previous snapshot and record a redacted `lastRefreshError`; only a genuine not-a-repository classification produces `not-a-repository`, and only a genuine missing-git or permission failure produces those environment states.

## 11. Configuration and theme architecture

- `@/domain/config/config.paths.ts` resolves `config.json`, `keybindings.json`, and `theme.json` using the precedence in product spec F-19 and F-20.
- Load order is defaults, `config.json`, `keybindings.json`, then runtime reload. Validation is per field; an invalid field falls back to the previous effective value and produces a warning.
- `@/domain/theme/theme.catppuccin.ts` is the only place hex colors exist. It defines the four flavors and the token table from F-20.
- `@/domain/theme/theme.capability.ts` detects truecolor, 256-color, and monochrome, and honors `NO_COLOR`. Token resolution returns final colors per capability.
- UI reads colors only through `useTokens()`. No component holds a hex literal.
- The sidebar `ListRow` selected fill uses `surface` as a deliberate exception to the generic selected-row `selection` token; native selects and focused buttons still use `selection`. `THEME_TOKEN_TARGETS` and product F-20 record the exception.
- `@/theme/icons.ts` is the single configuration file for every icon, marker, and glyph. No component inlines a glyph. Icons are ASCII-only and always have a text equivalent; the pairing is enforced by review, not by a module test. See section 6.1.
- The theme picker previews by swapping tokens in `ThemeProvider` without writing the file; Enter persists through `config.writer.ts`.

## 12. Enforcement

These rules are checked, not aspirational. Enforcement lands in slices, not all at once:

1. Slice 1 enables typecheck, Biome, unit tests, and all three enforcement scripts: `scripts/check-boundary.ts`, `scripts/check-glyph.ts`, and `scripts/check-structure.ts`. The structure check runs in warning mode for folders that are planned but not yet created.
2. Each later slice adds the checks for the code it introduces and turns the structure warning for its own folders into an error.
3. The v1 freeze runs `bun run check:structure --strict`, which asserts the full tree in section 4 and the complete doc-to-folder map in section 15.

Package commands:

- `bun run check` runs `biome check .`, then `check:boundary`, `check:glyph`, and `check:structure`.
- `bun run check:all` runs `bun run check`, `bun run typecheck`, and `bun run test`.
- `bun run check:fix` stays the Biome autofix only.
- `bun run check:boundary`, `bun run check:glyph`, and `bun run check:structure` run the TypeScript checkers directly through Bun. `bun run check:structure --strict` promotes planned path warnings to errors.

Rules:

- TypeScript strict mode is already on. Keep `noUncheckedIndexedAccess` and `noImplicitOverride`. `resolveJsonModule` is on for `app.constants.ts`.
- `bun run typecheck` must pass before any change is considered done.
- Biome handles linting, formatting, and import organization. `bun run check` (or `bun run check:fix` to apply safe fixes) must pass before any change is considered done. Configuration lives in `biome.json`; Markdown under `docs/` is excluded from formatting because its tables are hand-aligned.
- Husky manages Git hooks. The pre-commit hook runs `fallow audit` against the merge base with the branch upstream and blocks commits that introduce error-severity findings (dead code, complexity, duplication, or styling). Configuration lives in `.fallowrc.jsonc`; the `.fallow/` cache is git-ignored. `bun run audit` runs the same analysis manually. Function-size and complexity review uses fallow's findings, not a hand-written line-count parser. The `scripts/**` enforcement checkers use the default health ceilings and have colocated unit tests, so no `health.thresholdOverrides` entry is needed.
- `bun test` runs the unit suite and must pass. `bun test:integration` runs `*.integration.test.ts` against temporary repositories created by `src/test/git.fixture.ts`. CI runs both. Unit tests never spawn a process; integration tests may spawn the system git only through the fixture.
- `scripts/check-boundary.ts` (`bun run check:boundary`) walks every `.ts`, `.tsx`, `.js`, and `.jsx` file under `src/` with the TypeScript AST and fails on:
  - any external package import under `src/domain/**` or `src/lib/**`; React and `@opentui/*` are included, so domain and lib stay free of runtime packages. Any Node builtin under domain or lib outside the per-module allowlist in section 3 is rejected the same way.
  - any local import under `src/domain/**` outside `src/domain/**` and `src/lib/**`.
  - any local import under `src/lib/**` outside `src/lib/**`.
  - any external package or builtin import under `src/ui/**` other than React and `@opentui/*`; any local import under `src/ui/**` outside `src/ui/**`, `src/lib/**`, and `src/theme/**`. UI may import only React, `@opentui/*`, `src/ui/**` primitives, `src/lib/**`, and `src/theme/**`.
  - any external package or builtin import under `src/theme/**` other than React and `@opentui/*`; any local import outside `src/theme/**`, `src/domain/theme/**`, and `src/lib/**`. Theme may import any module under `src/domain/theme/**`, using token types type-only as the review norm. It never imports UI, features, app, or another domain folder.
  - any import of a test-only module from a production module. The test-only imports are the test runners `bun:test` and `node:test`, plus `src/test` and any module under `src/test/**`. A colocated `*.test.*` file and a module already under `src/test/` may import both a test runner and a module under `src/test/**`. The domain, lib, ui, theme, and feature rules reject all of them with their own layer message; the app layer and `src/index.tsx` are otherwise unconstrained, so this guard is the one edge they cannot cross.
  - any external package or builtin import under `src/features/**` other than React and `@opentui/*`; any local import outside `src/ui/**`, `src/domain/**`, `src/lib/**`, `src/theme/**`, and the same feature folder; any `src/app/**` import other than `src/app/hooks/**` and provider hooks under `src/app/providers/**` (a file whose basename starts with `use`). `src/app/App.tsx`, `src/app/AppShellHost.tsx`, and other app modules are never allowed from a feature.
  - feature to feature imports (covered by the same rule). `src/app/AppShellHost.tsx` is the composition root and is exempt because the app layer may import everything except the test-only imports, `bun:test`, `node:test`, and `src/test/**`.
  - process spawning through a `node:child_process` or `child_process` import, or a `Bun.spawn`, `Bun.spawnSync`, `Bun.shell`, or `Bun.$` call or tagged template outside `src/domain/git/git.client.ts` and `src/test/git.fixture.ts`.
  - network access through a `node:http`, `node:https`, `node:http2`, `node:net`, `node:dgram`, `node:tls`, or `undici` import; a `fetch`, `Bun.fetch`, `globalThis.fetch`, or `window.fetch` call; a `Bun.connect` call; or a `WebSocket` construction outside `src/domain/update/update.check.ts`.
  - raw key string comparisons: an equality operator (`===`, `==`, `!==`, `!=`) between a string literal and a key-like `name`, `sequence`, `raw`, or `code` property access outside `src/domain/keymap/**`, `src/app/hooks/useHotkeys.ts`, and `src/app/quit.key.ts`. A receiver named `key` or ending in `Key` is key-like for every key field. A receiver named `e`, `ev`, `event`, or ending in `Event` is key-like only in a key-aware file, so outside a key-aware file a plain `catch (e) { e.code === "ENOENT" }` and a non-key-aware `event.code` are not flagged. `name` and `sequence` follow the same receiver rule. A bare `name`, `sequence`, `raw`, or `code` identifier is flagged only in a file that mentions `KeyEvent`, `useKeyboard`, or `key.name`/`key.sequence`. Ordinary data fields such as `error.code` and `branch.name` are not key fields. Two known limitations are deliberate heuristics to revisit when the keymap layer adds type-aware checks: in a key-aware file a `catch` binding named `e` is treated as a key receiver, so `catch (e) { e.code === "ENOENT" }` is a known false positive; and the checker inspects only equality comparisons and property access, so element access such as `key["name"] === "c"` and `switch (key.name)` are known false negatives.
  - hex color literals outside `src/domain/theme/theme.catppuccin.ts`.
  - `index.ts`, `index.tsx`, `index.js`, and `index.jsx` barrel files other than the bootstrap `src/index.tsx`.
  - files named `utils`, `helpers`, `common`, or `misc`.
  - top-level functions, class methods, and exported arrow functions without a JSDoc block, checked with the TypeScript AST. Colocated `*.test.*` files are exempt. Function body size is not machine-checked; fallow owns complexity and size findings for production files. Test files are exempt from the split guidance but are still reported by fallow as review signals.
  - `bun:test` and `node:test` imports are allowed in colocated `*.test.*` files and modules under `src/test/`; these imports are test-only and rejected from every production module. Colocated test files and `src/test/**` modules may also import the shared fixture under `src/test/**`; every other external and local import still follows the layer rule.
- `scripts/check-glyph.ts` (`bun run check:glyph`) walks string, template, and JSX text literals in every `.ts`, `.tsx`, `.js`, and `.jsx` file under `src/` with the TypeScript AST and fails on non-ASCII codepoints outside `src/theme/icons.ts`. It deliberately allows printable ASCII punctuation and letters such as `>`, `v`, `M`, `[?]`, and `|`; those are UI text in many places and cannot be distinguished mechanically from icon values. Icon intent is enforced by review and by the rule that all reusable markers come from `ICONS`.
- `scripts/check-structure.ts` (`bun run check:structure`) reads the section 4 tree and the section 15 doc map. It fails when an implemented source file under `src/` or `scripts/`, including a `.js` or `.jsx` file, is absent from the section 4 tree; when a section 15 doc file does not exist under `docs/technical-implmentations/`; or when an implemented feature folder has no section 15 doc entry. Colocated `*.test.*` files are excluded from the unlisted-file scan. If the architecture document itself is missing or unreadable, or the section 4 or section 15 heading, fence, or tree cannot be parsed, it reports a file diagnostic against the architecture document instead of throwing. It warns for planned paths that do not exist yet; `--strict` promotes those warnings to errors for the v1 freeze. It compresses a missing planned folder to one warning instead of one per planned file.
- Review checklist for every change: layer direction respected, action IDs and command targets used instead of raw keys, exactly one handler per action and scope, tokens used instead of colors, icons used from `@/theme/icons` instead of inline reusable glyphs, JSDoc present on every production function and method (test files are exempt), oversized production functions split (test files are exempt from the split guidance), states covered, tests added for domain logic, region frames focusable with stable ids, and no application code writes `activeRegion` directly or calls `focus()` from a mouse handler.

## 13. Testing strategy

- Domain: pure unit tests with recorded git fixtures. No spawning in unit tests.
- Integration: `*.integration.test.ts` uses `src/test/git.fixture.ts` to create a temporary repository, configure a local identity, seed commits, run the real git commands through `git.client.ts`, and remove the directory. Colocated test files may import `@/test/git.fixture`; production modules must not, and external package rules still apply inside tests. Fixtures cover prompting hooks, merge and rebase conflicts, empty and bare repositories, index lock files, and fixture-owned cleanup. They are skipped when `git --version` is below the supported minimum, Git >= 2.30.0, which is also the fixture floor.
- Keymap and config: table-driven tests for precedence, conflicts, `null` reset, `[]` unbind, and per-field fallback.
- Commands: availability matrix tests covering detached HEAD, no upstream, no remote, empty repository, operation in progress, missing target, and stale target. `commands.runner.test.ts` asserts pure execution, write serialization, the blocked result, progress events, and cancellation. `useCommandRunner.test.tsx` asserts exactly one repository refresh, one console append, and one status transition per result, plus error routing and draft preservation on failure.
- UI: component tests with `@opentui/react` test-utils and `test-utils.ts` to assert rendered text markers, footer hints, and focus transitions.
- Focus: `FocusProvider` derives the region from native focus; a focused text input keeps its region active; `useHotkeys` does not consume unmodified typing keys; region frames are focusable and use `focusedBorderColor`; overlay open and close restores the previous renderable. Handler registration tests assert that duplicate `(actionId, scope)` registrations are rejected and that palette targets are explicit.
- Performance: fixture with a large synthetic log to assert page bounds, one in-flight page load, stale-result discard, and window-preserving refresh.

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

Ticket index: [`index.md`](index.md). Recommended build order: [`index.md`](index.md).

| File | Feature | Feature folder(s) and cross-cutting paths |
| --- | --- | --- |
| `01-app-shell-and-focus.md` | F-01 App shell and focus | `features/shell`, `app/AppShellHost.tsx`, `app/providers/FocusProvider.tsx`, `app/providers/StatusProvider.tsx`, `app/hooks/useHotkeys.ts` |
| `02-top-bar.md` | F-02 Top bar | `features/top-bar` |
| `03-branches-panel.md` | F-03 Branches panel | `features/branches` |
| `04-remotes-panel.md` | F-04 Remotes panel | `features/remotes` |
| `05-tags-panel.md` | F-05 Tags panel | `features/tags` |
| `06-stashes-panel.md` | F-06 Stashes panel | `features/stashes` |
| `07-worktrees-panel.md` | F-07 Worktrees panel | `features/worktrees` |
| `08-commit-graph.md` | F-08 Commit graph | `features/graph`, `domain/graph` |
| `09-commit-composer.md` | F-09 Commit composer | `features/composer`, `app/providers/DraftProvider.tsx` |
| `10-commit-details.md` | F-10 Commit details | `features/commit-details` |
| `11-diffs-and-file-actions.md` | F-11 Diffs and file actions | `features/diff`, `domain/diff` |
| `12-command-palette.md` | F-12 Command palette | `features/palette`, `domain/commands` |
| `13-console.md` | F-13 Console | `features/console`, `domain/console`, `app/providers/ConsoleProvider.tsx` |
| `14-help.md` | F-14 Help | `features/help` |
| `15-overlays-and-confirmations.md` | F-15 Overlays and confirmations | `features/overlays`, `app/providers/OverlayProvider.tsx`, `app/providers/OverlayProvider.state.ts`, `app/hooks/useOverlaySurfaceState.ts`, `domain/commands/confirm.labels.ts` |
| `16-repository-states.md` | F-16 Repository states | `domain/repository/repository.states.ts` |
| `17-freshness-and-performance.md` | F-17 Freshness and performance | `app/providers/RepositoryProvider.tsx`, `app/hooks/useRepositoryRefresh.ts`, `app/hooks/useRepositoryRuntime.ts`, `app/hooks/useRepositoryStore.ts`, `app/hooks/useRepositoryAvailability.ts`, `app/hooks/useRepositoryInitialRead.ts`, `app/hooks/useRepositoryStoreWatcher.ts`, `app/hooks/useInFlightTask.ts`, `app/hooks/useRemoteCommands.ts`, `app/hooks/useRemoteCommands.types.ts`, `domain/git/git.client.ts`, `domain/git/git.watcher.ts`, `domain/git/git.progress.ts`, `domain/git/git.remotes.ts`, `domain/git/git.remotes.types.ts`, `domain/graph/graph.paginate.ts`, `domain/graph/graph.search.ts`, `domain/diff/diff.limits.ts`, `domain/repository/repository.read.ts`, `domain/commands/commands.runner.ts`, `domain/commands/commands.reasons.ts`, `domain/commands/commands.steps.ts`, `domain/commands/commands.fetch.ts`, `domain/commands/commands.remote.ts`, `domain/commands/commands.remote.types.ts` |
| `18-safety-and-platform-behavior.md` | F-18 Safety and platform behavior | `domain/git/git.errors.ts`, `domain/git/git.redact.ts`, `domain/console/console.sanitize.ts`, `app/hooks/useCommandRunner.ts`, `app/hooks/commandRunner.report.ts` |
| `19-configuration-and-keybindings.md` | F-19 Configuration and keybindings | `domain/config`, `domain/keymap`, `app/providers/ConfigProvider.tsx`, `app/providers/ConfigProvider.types.ts`, `app/providers/KeymapProvider.tsx`, `app/providers/KeymapProvider.types.ts` |
| `20-theme-and-colors.md` | F-20 Theme and colors | `features/theme-picker`, `domain/theme`, `theme`, `app/providers/ThemeProvider.tsx`, `app/providers/ThemeProvider.types.ts`, `app/hooks/useTheme.ts` |
| `21-startup-splash.md` | F-21 Startup splash and update check | `features/splash`, `features/splash/SplashScreen.constants.ts`, `features/splash/SplashUpdateNotice.tsx`, `domain/update`, `app/App.tsx`, `app/SplashGate.tsx`, `app/quit.key.ts`, `lib/semver.ts`, `lib/semver.types.ts` |

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
