import { useCallback, useMemo, useRef, useState } from "react";
import { useActions } from "@/app/hooks/useAction";
import type { ActionRegistrationOptions } from "@/app/hooks/useAction.types";
import { useRepository } from "@/app/hooks/useRepository";
import { useStatus } from "@/app/hooks/useStatus";
import { selectRepositoryView } from "@/domain/repository/repository.selectors";
import { buildTopBarControls } from "@/features/top-bar/topBar.controls";
import { readTopBarStatusMode } from "@/features/top-bar/topBar.status";
import type {
  TopBarControlKind,
  TopBarHandle,
  UseTopBarOptions,
} from "@/features/top-bar/useTopBar.types";
import { useTopBarAvailability } from "@/features/top-bar/useTopBarAvailability";
import { useTopBarCommands } from "@/features/top-bar/useTopBarCommands";
import { useTopBarMenu } from "@/features/top-bar/useTopBarMenu";

/** Global registration options shared by every remote action. */
const GLOBAL_REMOTE_OPTIONS: ActionRegistrationOptions = {
  scope: "global",
  owner: "top-bar",
  targetKind: "none",
};

/** Global registration options for a branch-targeted remote action. */
const GLOBAL_BRANCH_OPTIONS: ActionRegistrationOptions = {
  scope: "global",
  owner: "top-bar",
  targetKind: "branch",
};

/**
 * Owns the top bar's derived data, focused control, and single action registration set.
 *
 * The hook registers every `remote.*` action once in the global scope with the `top-bar` owner, plus
 * `nav.left`, `nav.right`, and `nav.activate` in the `top-bar` scope. It never registers a command
 * executor: `useRemoteCommands` installs those once in the composition root.
 *
 * Focus is stored as a control kind, not a position. The visible control list drops the idle info
 * stop while an operation or message shows, so a positional index would silently move focus from
 * Pull to Push. The focused index is derived from the current list, and a hidden focus stays hidden:
 * `nav.activate` does nothing until Left or Right selects a visible control. Command routing and the
 * More menu overlay live in `useTopBarCommands` and `useTopBarMenu`.
 *
 * @param options - More menu renderer supplied by the `.tsx` component that owns the JSX.
 * @returns Controls, status mode, focused control, and activation helpers.
 */
export function useTopBar(options: UseTopBarOptions): TopBarHandle {
  const repository = useRepository();
  const { status, operation } = useStatus();
  const { branch, getAvailability } = useTopBarAvailability();
  const [focusedKind, setFocusedKind] = useState<TopBarControlKind>("info");
  const view = selectRepositoryView(
    repository.snapshot,
    repository.state,
    repository.upstreamStatus,
  );

  const controls = buildTopBarControls({
    branch,
    running: operation !== null,
    hasActiveStatus: status !== null,
    getAvailability,
  });
  const statusMode = readTopBarStatusMode({
    operation,
    status,
    view,
    lastRefreshError: repository.lastRefreshError,
  });
  const focusedIndex = controls.findIndex((control) => control.kind === focusedKind);

  const { activateCommand } = useTopBarCommands({
    branch,
    upstreamRef: repository.signals.upstream,
    getAvailability,
  });
  const { openMoreMenu } = useTopBarMenu({
    renderMoreMenu: options.renderMoreMenu,
    activateCommand,
  });

  const controlsRef = useRef(controls);
  controlsRef.current = controls;
  const focusedKindRef = useRef(focusedKind);
  focusedKindRef.current = focusedKind;

  /** Focuses a control by its current index and runs it; the idle info control does nothing. */
  const activateControl = useCallback(
    (index: number): void => {
      const control = controlsRef.current[index];

      if (control === undefined) {
        return;
      }

      setFocusedKind(control.kind);
      activateKind(control.kind, activateCommand, openMoreMenu);
    },
    [activateCommand, openMoreMenu],
  );

  /** Moves focus to the adjacent visible control, entering the list from a hidden focus. */
  const moveFocus = useCallback((direction: 1 | -1): void => {
    const current = controlsRef.current;

    if (current.length === 0) {
      return;
    }

    const index = current.findIndex((control) => control.kind === focusedKindRef.current);
    const targetIndex =
      index < 0
        ? direction > 0
          ? 0
          : current.length - 1
        : Math.max(0, Math.min(current.length - 1, index + direction));
    const target = current[targetIndex];

    if (target !== undefined) {
      setFocusedKind(target.kind);
    }
  }, []);

  /** Activates the focused control only when it is currently visible. */
  const activateFocused = useCallback((): void => {
    const control = controlsRef.current.find(
      (candidate) => candidate.kind === focusedKindRef.current,
    );

    if (control === undefined) {
      return;
    }

    activateKind(control.kind, activateCommand, openMoreMenu);
  }, [activateCommand, openMoreMenu]);

  useActions([
    {
      actionId: "remote.pull",
      options: GLOBAL_BRANCH_OPTIONS,
      handler: () => activateCommand("remote.pull"),
    },
    {
      actionId: "remote.push",
      options: GLOBAL_BRANCH_OPTIONS,
      handler: () => activateCommand("remote.push"),
    },
    {
      actionId: "remote.fetch",
      options: GLOBAL_REMOTE_OPTIONS,
      handler: () => activateCommand("remote.fetch"),
    },
    {
      actionId: "remote.fetchPrune",
      options: GLOBAL_REMOTE_OPTIONS,
      handler: () => activateCommand("remote.fetchPrune"),
    },
    {
      actionId: "remote.pushNoVerify",
      options: GLOBAL_BRANCH_OPTIONS,
      handler: () => activateCommand("remote.pushNoVerify"),
    },
    {
      actionId: "remote.more",
      options: GLOBAL_REMOTE_OPTIONS,
      handler: openMoreMenu,
    },
    {
      actionId: "remote.pushForceSafe",
      options: GLOBAL_BRANCH_OPTIONS,
      handler: () => activateCommand("remote.pushForceSafe"),
    },
    {
      actionId: "remote.pushForceOverwrite",
      options: GLOBAL_BRANCH_OPTIONS,
      handler: () => activateCommand("remote.pushForceOverwrite"),
    },
    {
      actionId: "nav.left",
      options: { scope: "top-bar" },
      handler: () => moveFocus(-1),
    },
    {
      actionId: "nav.right",
      options: { scope: "top-bar" },
      handler: () => moveFocus(1),
    },
    {
      actionId: "nav.activate",
      options: { scope: "top-bar" },
      handler: activateFocused,
    },
  ]);

  return useMemo(
    () => ({
      controls,
      focusedKind,
      focusedIndex,
      statusMode,
      activateControl,
    }),
    [activateControl, controls, focusedIndex, focusedKind, statusMode],
  );
}

/**
 * Activates one control kind when it is not the idle info stop.
 *
 * @param kind - Control kind.
 * @param activateCommand - Command router that confirms force variants.
 * @param openMoreMenu - Opens the More menu overlay.
 */
function activateKind(
  kind: TopBarControlKind,
  activateCommand: (commandId: string) => void,
  openMoreMenu: () => void,
): void {
  switch (kind) {
    case "info":
      return;
    case "pull":
      activateCommand("remote.pull");
      return;
    case "push":
      activateCommand("remote.push");
      return;
    case "more":
      openMoreMenu();
      return;
  }
}
