import { useRenderer } from "@opentui/react";
import type { ReactNode } from "react";
import { useAction } from "@/app/hooks/useAction";
import { useCommandRunner } from "@/app/hooks/useCommandRunner";
import { useConsoleLog } from "@/app/hooks/useConsoleLog";
import { useFocusState } from "@/app/hooks/useFocusState";
import { useHotkeys } from "@/app/hooks/useHotkeys";
import { clearFocusedInput } from "@/app/hooks/useInputEscapeClear";
import { useOverlay } from "@/app/hooks/useOverlay";
import { usePanelCommands } from "@/app/hooks/usePanelCommands";
import { useRemoteCommands } from "@/app/hooks/useRemoteCommands";
import { useRepository, useRepositoryRefreshAction } from "@/app/hooks/useRepository";
import { useStatus } from "@/app/hooks/useStatus";
import { selectRepositoryPath, selectTagRows } from "@/domain/repository/repository.selectors";
import type {
  RemoteTagChecks,
  RepositorySelection,
  RepositorySnapshot,
} from "@/domain/repository/repository.types";
import { BranchesPanel } from "@/features/branches/BranchesPanel";
import { ConsoleDrawer } from "@/features/console/ConsoleDrawer";
import { OverlayHost } from "@/features/overlays/OverlayHost";
import { RemotesPanel } from "@/features/remotes/RemotesPanel";
import { AppShell } from "@/features/shell/AppShell";
import type { RegionId, SidebarPanel } from "@/features/shell/focus.types";
import { PlaceholderSurface } from "@/features/shell/PlaceholderSurface";
import { ResponsiveGate } from "@/features/shell/ResponsiveGate";
import { StashDetails } from "@/features/stashes/StashDetails";
import { StashesPanel } from "@/features/stashes/StashesPanel";
import { TagsPanel } from "@/features/tags/TagsPanel";
import { TopBar } from "@/features/top-bar/TopBar";
import { WorktreeDetails } from "@/features/worktrees/WorktreeDetails";
import { WorktreesPanel } from "@/features/worktrees/WorktreesPanel";

/**
 * Composes the shell with the current feature surfaces.
 *
 * This is the only module allowed to import the shell together with feature surfaces. It owns
 * composition and global action registration only: the real top bar lives in `features/top-bar`,
 * the five sidebar panels in `features/branches`, `features/remotes`, `features/tags`,
 * `features/stashes`, and `features/worktrees`, the console drawer in `features/console`, the
 * overlay host in `features/overlays`, and the generic placeholder for the graph, composer, and diff
 * milestones in `features/shell`. It installs the single keyboard dispatcher, registers the panel
 * command executors once, and applies quit and close behaviour against the focus, status, repository,
 * overlay, and console providers.
 *
 * @returns The responsive shell.
 */
export function AppShellHost(): ReactNode {
  const renderer = useRenderer();
  const { status, clearStatus } = useStatus();
  const overlay = useOverlay();
  const { state, focusRegion } = useFocusState();
  const consoleLog = useConsoleLog();
  const commandRunner = useCommandRunner();
  const repository = useRepository();

  useHotkeys();
  useRepositoryRefreshAction();
  useRemoteCommands();
  usePanelCommands();

  useAction("app.quit", { scope: "global", owner: "app" }, () => {
    void (async () => {
      // Draft confirmation lands with the overlay stack. Until then quit always aborts the child
      // and waits for it to settle before tearing down the renderer.
      await commandRunner.abort();
      renderer.destroy();
    })();
  });

  useAction("overlay.close", { scope: "global", owner: "app" }, () => {
    if (overlay.isOpen) {
      overlay.close();
      return;
    }

    closeTransientSurface({
      hasStatus: status !== null,
      clearStatus,
      consoleOpen: consoleLog.isOpen,
      closeConsole: () => {
        consoleLog.close();
        returnFromConsoleFocus(state.previousRegion, focusRegion);
      },
      clearFocusedInput: () => clearFocusedInput(state.focusedRenderableId),
      returnFromTextInput: () => {
        if (state.textInputFocused && state.activeRegion !== null) {
          focusRegion(state.activeRegion);
          return true;
        }

        return false;
      },
      returnToPreviousRegion: () => {
        if (state.previousRegion !== null && state.previousRegion !== state.activeRegion) {
          focusRegion(state.previousRegion);
        }
      },
    });
  });

  useAction("app.console", { scope: "global", owner: "app" }, () => {
    if (consoleLog.isOpen && state.focusInsideRegion && state.activeRegion === "console") {
      consoleLog.close();
      returnFromConsoleFocus(state.previousRegion, focusRegion);
      return;
    }

    consoleLog.toggle();
  });

  return (
    <ResponsiveGate
      renderShell={(layoutMode) => (
        <AppShell
          layoutMode={layoutMode}
          topBar={<TopBar />}
          topBarTitle={selectRepositoryPath(repository.snapshot, repository.signals)}
          sidebarPanels={buildSidebarPanels(repository.snapshot, repository.remoteTagChecks)}
          graph={
            <PlaceholderSurface
              title="Commit graph"
              detail="History, refs, and the pending changes row arrive with the commit graph milestone."
            />
          }
          rightPane={buildRightPane(repository.selection)}
          diffPanel={
            <PlaceholderSurface
              title="Diffs"
              detail="Working, staged, and untracked diffs arrive with the diff milestone."
            />
          }
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
 * A stash or worktree selection renders its read-only summary. Every other selection keeps the
 * composer placeholder until the M8 composer and commit details land. The selection is provider
 * state keyed by stable identity, so the pane never keeps a second mode flag.
 *
 * @param selection - Current right-pane selection.
 * @returns The right-pane surface.
 */
function buildRightPane(selection: RepositorySelection): ReactNode {
  if (selection.kind === "stash") {
    return <StashDetails />;
  }

  if (selection.kind === "worktree") {
    return <WorktreeDetails />;
  }

  return (
    <PlaceholderSurface
      title="Commit composer"
      detail="The composer and commit details follow the repository foundation."
    />
  );
}

/**
 * Closes the transient surface Esc owns when no overlay is open.
 *
 * A status message is cleared first, then an open console drawer closes, then a focused text input
 * that registered a first-Esc clear clears and keeps focus, then a focused text input returns focus
 * to its region, and finally focus returns to the previous region. The callbacks own the provider
 * writes so this function stays a small, testable branch table.
 *
 * @param input - Whether each surface is active plus the callbacks that close it.
 */
function closeTransientSurface(input: {
  readonly hasStatus: boolean;
  readonly clearStatus: () => void;
  readonly consoleOpen: boolean;
  readonly closeConsole: () => void;
  readonly clearFocusedInput: () => boolean;
  readonly returnFromTextInput: () => boolean;
  readonly returnToPreviousRegion: () => void;
}): void {
  if (input.hasStatus) {
    input.clearStatus();
  }

  if (input.consoleOpen) {
    input.closeConsole();
    return;
  }

  if (input.clearFocusedInput()) {
    return;
  }

  if (input.returnFromTextInput()) {
    return;
  }

  input.returnToPreviousRegion();
}

/**
 * Returns focus to the region that owned it before the console opened.
 *
 * The console region unmounts when the drawer closes, so waiting for the next focus action would
 * leave focus nowhere. The console itself is never a valid restore target.
 *
 * @param previousRegion - Region active before the console opened, or null.
 * @param focusRegion - Native focus helper for a region frame.
 */
function returnFromConsoleFocus(
  previousRegion: RegionId | null,
  focusRegion: (region: RegionId) => void,
): void {
  if (previousRegion !== null && previousRegion !== "console") {
    focusRegion(previousRegion);
  }
}
