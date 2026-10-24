import { useRenderer } from "@opentui/react";
import type { ReactNode } from "react";
import { useAction } from "@/app/hooks/useAction";
import { useCommandRunner } from "@/app/hooks/useCommandRunner";
import { useConsoleLog } from "@/app/hooks/useConsoleLog";
import { useFocusState } from "@/app/hooks/useFocusState";
import { useHotkeys } from "@/app/hooks/useHotkeys";
import { useOverlay } from "@/app/hooks/useOverlay";
import { useRemoteCommands } from "@/app/hooks/useRemoteCommands";
import { useRepositoryRefreshAction } from "@/app/hooks/useRepository";
import { useStatus } from "@/app/hooks/useStatus";
import { ConsoleDrawer } from "@/features/console/ConsoleDrawer";
import { OverlayHost } from "@/features/overlays/OverlayHost";
import { AppShell } from "@/features/shell/AppShell";
import type { RegionId, SidebarPanel } from "@/features/shell/focus.types";
import { PlaceholderSurface } from "@/features/shell/PlaceholderSurface";
import { ResponsiveGate } from "@/features/shell/ResponsiveGate";
import { TopBar } from "@/features/top-bar/TopBar";

/**
 * Composes the shell with the current feature surfaces.
 *
 * This is the only module allowed to import the shell together with feature surfaces. It owns
 * composition and global action registration only: the real top bar lives in `features/top-bar`, the
 * temporary console in `features/console`, the overlay host in `features/overlays`, and the generic
 * placeholder in `features/shell`. M6 replaces the console, so this composition root only swaps the
 * supplied surfaces. It installs the single keyboard dispatcher and applies quit and close behaviour
 * against the focus, status, repository, overlay, and console providers.
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

  useHotkeys();
  useRepositoryRefreshAction();
  useRemoteCommands();

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
    consoleLog.toggle();
  });

  return (
    <ResponsiveGate
      renderShell={(layoutMode) => (
        <AppShell
          layoutMode={layoutMode}
          topBar={<TopBar />}
          sidebarPanels={buildSidebarPanels()}
          graph={
            <PlaceholderSurface
              title="Commit graph"
              detail="History, refs, and the pending changes row arrive with the commit graph milestone."
            />
          }
          rightPane={
            <PlaceholderSurface
              title="Commit composer"
              detail="The composer and commit details follow the repository foundation."
            />
          }
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
 * Builds the five placeholder sidebar panels in stacked order.
 *
 * @returns The panel descriptors consumed by `Sidebar`.
 */
function buildSidebarPanels(): readonly SidebarPanel[] {
  return [
    {
      regionId: "branches",
      label: "Branches",
      content: (
        <PlaceholderSurface
          title="Branches"
          detail="Local branches, ahead and behind counts, and checkout arrive next."
        />
      ),
    },
    {
      regionId: "remotes",
      label: "Remotes",
      content: (
        <PlaceholderSurface
          title="Remotes"
          detail="Remote-tracking branches and the filter field arrive next."
        />
      ),
    },
    {
      regionId: "tags",
      label: "Tags",
      content: (
        <PlaceholderSurface
          title="Tags"
          detail="Local and remote tags and their push state arrive next."
        />
      ),
    },
    {
      regionId: "stashes",
      label: "Stashes",
      content: (
        <PlaceholderSurface title="Stashes" detail="Stash entries and actions arrive next." />
      ),
    },
    {
      regionId: "worktrees",
      label: "Worktrees",
      content: (
        <PlaceholderSurface title="Worktrees" detail="Worktree entries and actions arrive next." />
      ),
    },
  ];
}

/**
 * Closes the transient surface Esc owns when no overlay is open.
 *
 * A status message is cleared first, then an open console drawer closes, then a focused text input
 * returns focus to its region, and finally focus returns to the previous region. The callbacks own
 * the provider writes so this function stays a small, testable branch table.
 *
 * @param input - Whether each surface is active plus the callbacks that close it.
 */
function closeTransientSurface(input: {
  readonly hasStatus: boolean;
  readonly clearStatus: () => void;
  readonly consoleOpen: boolean;
  readonly closeConsole: () => void;
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
