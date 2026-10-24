import { useRenderer } from "@opentui/react";
import type { ReactNode } from "react";
import { useAction } from "@/app/hooks/useAction";
import { useCommandRunner } from "@/app/hooks/useCommandRunner";
import { useConsoleLog } from "@/app/hooks/useConsoleLog";
import { useFocusState } from "@/app/hooks/useFocusState";
import { useHotkeys } from "@/app/hooks/useHotkeys";
import { useRemoteFetchCommand } from "@/app/hooks/useRemoteFetchCommand";
import { useRepositoryRefreshAction } from "@/app/hooks/useRepository";
import { useStatus } from "@/app/hooks/useStatus";
import { ConsoleDrawer } from "@/features/console/ConsoleDrawer";
import { AppShell } from "@/features/shell/AppShell";
import type { SidebarPanel } from "@/features/shell/focus.types";
import { PlaceholderSurface } from "@/features/shell/PlaceholderSurface";
import { ResponsiveGate } from "@/features/shell/ResponsiveGate";
import { TopBar } from "@/features/top-bar/TopBar";

/**
 * Composes the shell with the temporary M4 feature surfaces.
 *
 * This is the only module allowed to import the shell together with feature surfaces. It owns
 * composition and global action registration only: the temporary top bar lives in
 * `features/top-bar`, the temporary console in `features/console`, and the generic placeholder in
 * `features/shell`. M5 replaces the top bar and M6 replaces the console, so this composition root
 * only swaps the supplied surfaces. It installs the single keyboard dispatcher and applies quit and
 * close behaviour against the focus, status, repository, and console providers.
 *
 * @returns The responsive shell.
 */
export function AppShellHost(): ReactNode {
  const renderer = useRenderer();
  const { status, clearStatus } = useStatus();
  const { state, focusRegion } = useFocusState();
  const consoleLog = useConsoleLog();
  const commandRunner = useCommandRunner();

  useHotkeys();
  useRepositoryRefreshAction();
  useRemoteFetchCommand();

  useAction("app.quit", { scope: "global", owner: "app" }, () => {
    void (async () => {
      // Draft confirmation lands with the overlay stack. Until then quit always aborts the child
      // and waits for it to settle before tearing down the renderer.
      await commandRunner.abort();
      renderer.destroy();
    })();
  });

  useAction("remote.fetch", { scope: "global", owner: "top-bar" }, () => {
    void commandRunner.runCommand({ commandId: "remote.fetch", target: { kind: "none" } });
  });

  useAction("overlay.close", { scope: "global", owner: "app" }, () => {
    if (status !== null) {
      clearStatus();
    }

    if (consoleLog.isOpen) {
      consoleLog.close();

      // The console region unmounts when the drawer closes, so focus must return to the region that
      // owned it before the console opened instead of waiting for the next focus action.
      if (state.previousRegion !== null && state.previousRegion !== "console") {
        focusRegion(state.previousRegion);
      }

      return;
    }

    if (state.textInputFocused && state.activeRegion !== null) {
      focusRegion(state.activeRegion);
      return;
    }

    if (state.previousRegion !== null && state.previousRegion !== state.activeRegion) {
      focusRegion(state.previousRegion);
    }
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
