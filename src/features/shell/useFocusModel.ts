import { useCallback, useEffect, useMemo, useState } from "react";
import { useActions } from "@/app/hooks/useAction";
import { useFocusState } from "@/app/hooks/useFocusState";
import type { FocusModel, FocusModelOptions, RegionId } from "@/features/shell/focus.types";
import {
  isSidebarRegion,
  resolveAdjacentRegion,
  resolveEffectiveTabOrder,
  sidebarPanelIndex,
} from "@/features/shell/regions";

/** Every focus action is a global action owned by the shell. */
const SHELL_SCOPE = Object.freeze({ scope: "global" as const, owner: "shell" as const });

/**
 * Owns Tab traversal and the direct region jumps for the shell.
 *
 * The hook computes the effective Tab order from the layout mode, skips sidebar panels hidden by
 * the collapsed layout, and registers every `focus.region.*` action plus `focus.next` and
 * `focus.previous` once with the shell owner. A jump to a collapsed sidebar panel first selects it
 * in the native switcher and then focuses the newly visible panel frame, so region-scoped keys work
 * immediately. The switcher itself stays focusable for mouse-driven switching. A jump to the closed
 * console opens it before focus is applied. Focus is always applied through `FocusProvider`, never
 * by writing region state.
 *
 * @param options - Layout mode, collapsed panel selection, and console state.
 * @returns The focus navigation helpers.
 */
export function useFocusModel(options: FocusModelOptions): FocusModel {
  const { focusRegion, state } = useFocusState();
  const [pendingTarget, setPendingTarget] = useState<RegionId | null>(null);
  const tabOrder = useMemo(
    () => resolveEffectiveTabOrder(options.layoutMode, options.activeSidebarPanel),
    [options.layoutMode, options.activeSidebarPanel],
  );

  /** Opens the console first when needed, then focuses the target region. */
  const focusTarget = useCallback(
    (regionId: RegionId) => {
      if (regionId === "console" && !options.consoleOpen) {
        options.onOpenConsole();
        setPendingTarget("console");
        return;
      }

      focusRegion(regionId);
    },
    [focusRegion, options.consoleOpen, options.onOpenConsole],
  );

  /** Applies one direct jump, selecting a collapsed sidebar panel before focusing it. */
  const jumpToRegion = useCallback(
    (regionId: RegionId) => {
      if (state.focusInsideRegion && state.activeRegion === regionId) {
        return;
      }

      if (options.layoutMode === "sidebar-collapsed" && isSidebarRegion(regionId)) {
        const index = sidebarPanelIndex(regionId);

        if (index !== options.activeSidebarPanel) {
          options.onSelectSidebarPanel(index);
          setPendingTarget(regionId);
          return;
        }
      }

      focusTarget(regionId);
    },
    [
      focusTarget,
      options.activeSidebarPanel,
      options.layoutMode,
      options.onSelectSidebarPanel,
      state.activeRegion,
      state.focusInsideRegion,
    ],
  );

  /** Focuses the next region in the effective Tab order. */
  const focusNext = useCallback(() => {
    const next = resolveAdjacentRegion(tabOrder, state.activeRegion, 1);

    if (next !== null) {
      focusTarget(next);
    }
  }, [focusTarget, state.activeRegion, tabOrder]);

  /** Focuses the previous region in the effective Tab order. */
  const focusPrevious = useCallback(() => {
    const previous = resolveAdjacentRegion(tabOrder, state.activeRegion, -1);

    if (previous !== null) {
      focusTarget(previous);
    }
  }, [focusTarget, state.activeRegion, tabOrder]);

  useEffect(() => {
    if (pendingTarget === null) {
      return;
    }

    if (pendingTarget === "console") {
      if (!options.consoleOpen) {
        return;
      }

      setPendingTarget(null);
      focusRegion("console");
      return;
    }

    if (options.layoutMode === "sidebar-collapsed" && isSidebarRegion(pendingTarget)) {
      if (sidebarPanelIndex(pendingTarget) !== options.activeSidebarPanel) {
        return;
      }
    }

    setPendingTarget(null);
    focusRegion(pendingTarget);
  }, [
    focusRegion,
    options.activeSidebarPanel,
    options.consoleOpen,
    options.layoutMode,
    pendingTarget,
  ]);

  useActions([
    { actionId: "focus.next", options: SHELL_SCOPE, handler: focusNext },
    { actionId: "focus.previous", options: SHELL_SCOPE, handler: focusPrevious },
    {
      actionId: "focus.region.topBar",
      options: SHELL_SCOPE,
      handler: () => jumpToRegion("top-bar"),
    },
    {
      actionId: "focus.region.branches",
      options: SHELL_SCOPE,
      handler: () => jumpToRegion("branches"),
    },
    {
      actionId: "focus.region.remotes",
      options: SHELL_SCOPE,
      handler: () => jumpToRegion("remotes"),
    },
    { actionId: "focus.region.tags", options: SHELL_SCOPE, handler: () => jumpToRegion("tags") },
    {
      actionId: "focus.region.stashes",
      options: SHELL_SCOPE,
      handler: () => jumpToRegion("stashes"),
    },
    {
      actionId: "focus.region.worktrees",
      options: SHELL_SCOPE,
      handler: () => jumpToRegion("worktrees"),
    },
    {
      actionId: "focus.region.graph",
      options: SHELL_SCOPE,
      handler: () => jumpToRegion("graph"),
    },
    {
      actionId: "focus.region.rightPane",
      options: SHELL_SCOPE,
      handler: () => jumpToRegion("right-pane"),
    },
    { actionId: "focus.region.diff", options: SHELL_SCOPE, handler: () => jumpToRegion("diff") },
    {
      actionId: "focus.region.console",
      options: SHELL_SCOPE,
      handler: () => jumpToRegion("console"),
    },
  ]);

  return { focusNext, focusPrevious, focusRegion };
}
