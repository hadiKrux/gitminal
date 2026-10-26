import type { ReactNode } from "react";
import { useConfigActions } from "@/app/hooks/useConfigActions";
import { useConsoleLog } from "@/app/hooks/useConsoleLog";
import { useHelpAction } from "@/app/hooks/useHelpAction";
import { useHotkeys } from "@/app/hooks/useHotkeys";
import { useMainCommands } from "@/app/hooks/useMainCommands";
import { useMouseSetting } from "@/app/hooks/useMouseSetting";
import { usePaletteAction } from "@/app/hooks/usePaletteAction";
import { usePanelCommands } from "@/app/hooks/usePanelCommands";
import { useRemoteCommands } from "@/app/hooks/useRemoteCommands";
import { useRepository, useRepositoryRefreshAction } from "@/app/hooks/useRepository";
import { useShellActions } from "@/app/hooks/useShellActions";
import { useThemePickerAction } from "@/app/hooks/useThemePickerAction";
import { selectRepositoryPath, selectTagRows } from "@/domain/repository/repository.selectors";
import type {
  RemoteTagChecks,
  RepositorySelection,
  RepositorySnapshot,
} from "@/domain/repository/repository.types";
import { BranchesPanel } from "@/features/branches/BranchesPanel";
import { CommitDetails } from "@/features/commit-details/CommitDetails";
import { CommitComposer } from "@/features/composer/CommitComposer";
import { ConsoleDrawer } from "@/features/console/ConsoleDrawer";
import { DiffPanel } from "@/features/diff/DiffPanel";
import { CommitGraph } from "@/features/graph/CommitGraph";
import { OverlayHost } from "@/features/overlays/OverlayHost";
import { RemotesPanel } from "@/features/remotes/RemotesPanel";
import { AppShell } from "@/features/shell/AppShell";
import type { SidebarPanel } from "@/features/shell/focus.types";
import { ResponsiveGate } from "@/features/shell/ResponsiveGate";
import { StashDetails } from "@/features/stashes/StashDetails";
import { StashesPanel } from "@/features/stashes/StashesPanel";
import { TagsPanel } from "@/features/tags/TagsPanel";
import { TopBar } from "@/features/top-bar/TopBar";
import { WorktreeDetails } from "@/features/worktrees/WorktreeDetails";
import { WorktreesPanel } from "@/features/worktrees/WorktreesPanel";

/**
 * Composes the shell with the real feature surfaces.
 *
 * This is the only module allowed to import the shell together with feature surfaces. It owns
 * composition and global action registration only: the real top bar lives in `features/top-bar`, the
 * five sidebar panels in `features/branches`, `features/remotes`, `features/tags`,
 * `features/stashes`, and `features/worktrees`, the commit graph in `features/graph`, the right-pane
 * modes in `features/composer`, `features/commit-details`, `features/stashes`, and
 * `features/worktrees`, the diff panel in `features/diff`, the console drawer in `features/console`,
 * and the overlay host in `features/overlays`.
 *
 * It installs the single keyboard dispatcher and registers the panel and main-area command
 * executors once. Global quit, close, console, and commit-focus behaviour lives in
 * `useShellActions`, which applies it against the focus, status, repository, overlay, console, and
 * draft providers; refresh keeps its own `useRepositoryRefreshAction` handler. The app-surface
 * actions that own an overlay or a reload keep their own hooks: `useThemePickerAction` is the single
 * owner of `app.themePicker`, `usePaletteAction` owns `app.palette`, `useHelpAction` owns `app.help`,
 * and `useConfigActions` owns `app.reloadConfig` plus the configuration warning surface.
 * `useMouseSetting` keeps the renderer's mouse reporting in step with `ui.mouse` after a reload. The
 * graph is mounted for the lifetime of the shell because it owns the commit navigator and the
 * graph-window refresher; only the right pane changes with `RepositoryProvider.selection`.
 *
 * @returns The responsive shell.
 */
export function AppShellHost(): ReactNode {
  const consoleLog = useConsoleLog();
  const repository = useRepository();

  useHotkeys();
  useRepositoryRefreshAction();
  useRemoteCommands();
  usePanelCommands();
  useMainCommands();
  useShellActions();
  useThemePickerAction();
  usePaletteAction();
  useHelpAction();
  useConfigActions();
  useMouseSetting();

  return (
    <ResponsiveGate
      renderShell={(layoutMode) => (
        <AppShell
          layoutMode={layoutMode}
          topBar={<TopBar />}
          topBarTitle={selectRepositoryPath(repository.snapshot, repository.signals)}
          sidebarPanels={buildSidebarPanels(repository.snapshot, repository.remoteTagChecks)}
          graph={<CommitGraph />}
          rightPane={buildRightPane(repository.selection)}
          diffPanel={<DiffPanel />}
          console={<ConsoleDrawer />}
          consoleOpen={consoleLog.isOpen}
          onOpenConsole={consoleLog.open}
          overlays={<OverlayHost />}
        />
      )}
    />
  );
}

/**
 * Builds the five sidebar panels in stacked order.
 *
 * Each panel renders only its body. The shell owns the focusable frame, the border title, and the
 * scroll container, so the composition root never supplies a second frame or scrollbox. The border
 * title also carries the row count, which is the only title the panel shows; each count is read from
 * the same rows its panel renders, not from a filtered or capped panel view, and is 0 before the
 * first read. Tags therefore counts the merged local and remote rows rather than local tags alone.
 * The collapsed switcher uses `shortLabel`, so its compact tabs name the section while the bordered
 * title keeps the count and the two never duplicate it.
 *
 * @param snapshot - Latest repository snapshot, or null before the first successful read.
 * @param remoteTagChecks - Last known tag names per remote, used for the merged tag row count.
 * @returns The panel descriptors consumed by `Sidebar`.
 */
function buildSidebarPanels(
  snapshot: RepositorySnapshot | null,
  remoteTagChecks: RemoteTagChecks,
): readonly SidebarPanel[] {
  return [
    {
      regionId: "branches",
      label: `Branches (${snapshot?.branches.length ?? 0})`,
      shortLabel: "Branches",
      content: <BranchesPanel />,
    },
    {
      regionId: "remotes",
      label: `Remotes (${snapshot?.remoteBranches.length ?? 0})`,
      shortLabel: "Remotes",
      content: <RemotesPanel />,
    },
    {
      regionId: "tags",
      label: `Tags (${snapshot === null ? 0 : selectTagRows(snapshot, remoteTagChecks).length})`,
      shortLabel: "Tags",
      content: <TagsPanel />,
    },
    {
      regionId: "stashes",
      label: `Stashes (${snapshot?.stashes.length ?? 0})`,
      shortLabel: "Stashes",
      content: <StashesPanel />,
    },
    {
      regionId: "worktrees",
      label: `Worktrees (${snapshot?.worktrees.length ?? 0})`,
      shortLabel: "Worktrees",
      content: <WorktreesPanel />,
    },
  ];
}

/**
 * Derives the right-pane surface from the repository selection.
 *
 * The selection is the only source of the right-pane mode, so no provider or feature keeps a second
 * sub-mode flag. A commit selection renders commit details, a stash selection its summary, and a
 * worktree selection its summary. Every remaining selection, including the pending changes row,
 * renders the composer; a diff-file selection is treated as the composer as a safe fallback because
 * the diff panel keeps its cursor local and does not write that selection.
 *
 * @param selection - Current right-pane selection.
 * @returns The right-pane surface.
 */
function buildRightPane(selection: RepositorySelection): ReactNode {
  if (selection.kind === "commit") {
    return <CommitDetails />;
  }

  if (selection.kind === "stash") {
    return <StashDetails />;
  }

  if (selection.kind === "worktree") {
    return <WorktreeDetails />;
  }

  return <CommitComposer />;
}
