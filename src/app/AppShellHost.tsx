import { TextAttributes } from "@opentui/core";
import { useRenderer } from "@opentui/react";
import { type ReactNode, useState } from "react";
import { useAction } from "@/app/hooks/useAction";
import { useFocusState } from "@/app/hooks/useFocusState";
import { useHotkeys } from "@/app/hooks/useHotkeys";
import { useStatus } from "@/app/hooks/useStatus";
import type { StatusKind } from "@/app/providers/StatusProvider.types";
import type { ThemeTokens } from "@/domain/theme/theme.types";
import { AppShell } from "@/features/shell/AppShell";
import type { SidebarPanel } from "@/features/shell/focus.types";
import { ResponsiveGate } from "@/features/shell/ResponsiveGate";
import { useTokens } from "@/theme/useTokens";

/**
 * Composes the shell with placeholder feature surfaces.
 *
 * This is the only module allowed to import the shell together with feature surfaces. Until the
 * panel, graph, diff, composer, and console milestones land, every surface is a local placeholder;
 * the composition root still supplies them as `ReactNode` props so feature-to-feature imports never
 * appear. It registers the global actions it owns, installs the single keyboard dispatcher, and
 * applies quit and close behaviour against the focus and status providers. The right-pane surface
 * becomes a derivation from `RepositoryProvider.selection` when the repository milestone lands, and
 * quit confirmation plus operation abort join when the draft, overlay, and command-runner modules
 * exist; until then quit refuses while an operation is marked as running. `overlay.close` clears a
 * transient status and continues to the focus restore in the same press.
 *
 * @returns The responsive shell.
 */
export function AppShellHost(): ReactNode {
  const renderer = useRenderer();
  const { status, operation, setStatus, clearStatus } = useStatus();
  const { state, focusRegion } = useFocusState();
  const [consoleOpen, setConsoleOpen] = useState(false);

  useHotkeys();

  useAction("app.quit", { scope: "global", owner: "app" }, () => {
    // Interim M3 guard. Confirmation and operation abort land with OverlayProvider and
    // useCommandRunner; until then a running operation must not be detached silently.
    if (operation !== null) {
      setStatus({
        kind: "warning",
        message: "Wait for the running operation to finish before quitting.",
      });
      return;
    }

    renderer.destroy();
  });

  useAction("overlay.close", { scope: "global", owner: "app" }, () => {
    if (status !== null) {
      clearStatus();
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
    setConsoleOpen((open) => !open);
  });

  const sidebarPanels = buildSidebarPanels();

  return (
    <ResponsiveGate
      renderShell={(layoutMode) => (
        <AppShell
          layoutMode={layoutMode}
          topBar={<TopBarPlaceholder />}
          sidebarPanels={sidebarPanels}
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
          console={
            <PlaceholderSurface
              title="Command console"
              detail="Command entries and output arrive with the console milestone."
            />
          }
          consoleOpen={consoleOpen}
          onOpenConsole={() => setConsoleOpen(true)}
        />
      )}
    />
  );
}

/**
 * Renders the placeholder top bar with the live status strip.
 *
 * This is a temporary composition-root placeholder. The real top bar surface replaces it in M5.
 *
 * @returns The identity, repository placeholder, and current status text.
 */
function TopBarPlaceholder(): ReactNode {
  const tokens = useTokens();
  const { status, operation } = useStatus();
  const message =
    operation === null
      ? (status?.message ?? "ready")
      : `${operation.phase}${operation.percent === null ? "" : ` ${Math.round(operation.percent)}%`}`;
  const color = statusColor(status?.kind, tokens);

  return (
    <>
      <text fg={tokens.text} wrapMode="none" attributes={TextAttributes.BOLD}>
        Gitminal
      </text>
      <text fg={tokens.muted} wrapMode="none">
        {"  "}branch: no repository
      </text>
      <box flexGrow={1} />
      <text fg={color} wrapMode="none">
        {message}
      </text>
    </>
  );
}

/**
 * Renders one placeholder surface inside a shell region.
 *
 * This is a temporary composition-root placeholder. Each feature surface replaces it in its own
 * milestone.
 *
 * @param props - Surface title and the feature milestone that will replace it.
 * @returns The placeholder content.
 */
function PlaceholderSurface(props: { title: string; detail: string }): ReactNode {
  const tokens = useTokens();

  return (
    <box flexDirection="column" flexGrow={1} paddingLeft={1} paddingRight={1}>
      <text fg={tokens.text} wrapMode="none" attributes={TextAttributes.BOLD}>
        {props.title}
      </text>
      <text fg={tokens.dim} wrapMode="none">
        {props.detail}
      </text>
      <text fg={tokens.dim} wrapMode="none">
        Placeholder until its feature milestone lands.
      </text>
    </box>
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
 * Maps a status severity to its theme color.
 *
 * @param kind - Status kind, or `undefined` when there is no message.
 * @param tokens - Active theme tokens.
 * @returns The color for the status strip text.
 */
function statusColor(kind: StatusKind | undefined, tokens: ThemeTokens): string {
  switch (kind) {
    case "success":
      return tokens.success;
    case "warning":
      return tokens.warning;
    case "error":
      return tokens.error;
    case "info":
      return tokens.info;
    default:
      return tokens.muted;
  }
}
