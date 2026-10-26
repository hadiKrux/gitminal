import { useTerminalDimensions } from "@opentui/react";
import { type ReactNode, useCallback, useMemo, useSyncExternalStore } from "react";
import {
  getActionRegistryVersion,
  hasRegisteredAction,
  subscribeActionRegistry,
} from "@/app/hooks/useAction";
import type { ActionScope } from "@/app/hooks/useAction.types";
import {
  getActionAvailabilityVersion,
  readActionAvailability,
  subscribeActionAvailability,
} from "@/app/hooks/useActionAvailability";
import { useConsoleLog } from "@/app/hooks/useConsoleLog";
import { useFocusState } from "@/app/hooks/useFocusState";
import { useKeymap } from "@/app/hooks/useKeymap";
import { useOptionalRepository } from "@/app/hooks/useOptionalRepository";
import { useStatus } from "@/app/hooks/useStatus";
import { getCommandDescriptor } from "@/domain/commands/commands.registry";
import type { CommandTarget } from "@/domain/commands/commands.types";
import { ACTION_BY_ID } from "@/domain/keymap/keymap.defaults";
import { describeContextHints, formatBinding } from "@/domain/keymap/keymap.describe";
import type { KeymapContext, ResolvedKeymap } from "@/domain/keymap/keymap.types";
import { HIDDEN_CONTEXT_HINT_ACTIONS, MODAL_HINT_ACTIONS } from "@/features/shell/Footer.constants";
import { HintBar } from "@/ui/HintBar";

/**
 * Renders the contextual footer hint bar.
 *
 * Hints come from the resolved keymap for the focused region plus globals, minus actions whose
 * global key is shadowed by the focused context and minus self-evident actions such as Tab
 * traversal, arrow movement, quit, the console toggle, the More menu trigger, and Esc cancel, which
 * Help documents instead. A `remote.*` hint is shown only when the same target-aware availability
 * the top bar uses reports it available; another action's published availability, when the owning
 * surface published one for its selected target, decides the hint before any fallback. Actions with
 * no publication fall back to handler presence, so a placeholder surface never advertises a feature
 * that is not mounted. The footer therefore agrees with the top bar in detached HEAD, no-remote, and
 * no-upstream states, and with the panels when the selected row makes an action unavailable. When
 * focus leaves every region, the footer falls back to the global hints instead of keeping the last
 * region's context.
 *
 * Modal hints come from `StatusProvider.hintMode`, which `OverlayHost` sets while an overlay entry
 * exists. Hints are priority ordered and dropped as the width shrinks.
 *
 * @returns The footer hint line.
 */
export function Footer(): ReactNode {
  const { width } = useTerminalDimensions();
  const keymap = useKeymap();
  const { state } = useFocusState();
  const { hintMode, operation } = useStatus();
  const repository = useOptionalRepository();
  const consoleLog = useConsoleLog();
  const registryVersion = useSyncExternalStore(
    subscribeActionRegistry,
    getActionRegistryVersion,
    getActionRegistryVersion,
  );
  const availabilityVersion = useSyncExternalStore(
    subscribeActionAvailability,
    getActionAvailabilityVersion,
    getActionAvailabilityVersion,
  );
  const isAvailable = useCallback(
    (actionId: string, scope: ActionScope): boolean => {
      void registryVersion;
      void availabilityVersion;

      const published = readActionAvailability(scope, actionId);

      if (published !== undefined) {
        return published;
      }

      if (actionId === "console.clear") {
        return consoleLog.entries.length > 0;
      }

      if (actionId.startsWith("remote.") && repository !== null) {
        return readRemoteHintAvailability(actionId, repository, operation !== null);
      }

      return hasRegisteredAction(actionId, scope);
    },
    [availabilityVersion, consoleLog.entries.length, operation, registryVersion, repository],
  );

  const hints = useMemo(() => {
    if (hintMode === "modal") {
      return buildModalHints(keymap, isAvailable);
    }

    const context: KeymapContext = state.focusInsideRegion
      ? (state.activeRegion ?? "global")
      : "global";

    return describeContextHints(keymap, context, { isAvailable })
      .filter((hint) => !HIDDEN_CONTEXT_HINT_ACTIONS.has(hint.actionId))
      .map((hint) => ({
        key: hint.keys[0] ?? "",
        label: hint.label,
      }));
  }, [hintMode, isAvailable, keymap, state.activeRegion, state.focusInsideRegion]);

  return (
    <box height={1} flexShrink={0}>
      <HintBar hints={hints} maxWidth={width} />
    </box>
  );
}

/**
 * Applies the top bar's availability rules to one remote hint.
 *
 * @param actionId - Remote action id.
 * @param repository - Current repository context.
 * @param operationRunning - True while the status strip renders a running operation.
 * @returns True when the action can run with the current branch target.
 */
function readRemoteHintAvailability(
  actionId: string,
  repository: NonNullable<ReturnType<typeof useOptionalRepository>>,
  operationRunning: boolean,
): boolean {
  const target = resolveRemoteHintTarget(actionId, repository);
  const availability = repository.getAvailability(actionId, target, "top-bar");

  if (!availability.available) {
    return false;
  }

  return !(operationRunning && getCommandDescriptor(actionId)?.kind === "mutation");
}

/**
 * Resolves the explicit target a remote hint would dispatch.
 *
 * @param actionId - Remote action id.
 * @param repository - Current repository context.
 * @returns The branch target for branch commands, or the none target.
 */
function resolveRemoteHintTarget(
  actionId: string,
  repository: NonNullable<ReturnType<typeof useOptionalRepository>>,
): CommandTarget {
  if (getCommandDescriptor(actionId)?.targetKind !== "branch") {
    return { kind: "none" };
  }

  return {
    kind: "branch",
    name: repository.snapshot?.branch ?? repository.signals.branch ?? "",
  };
}

/**
 * Builds the modal footer hints from effective bindings and catalogue labels.
 *
 * @param keymap - The resolved keymap.
 * @param isAvailable - Availability predicate for a registered handler.
 * @returns The modal hints that have a binding and a registered handler.
 */
function buildModalHints(
  keymap: ResolvedKeymap,
  isAvailable: (actionId: string, scope: ActionScope) => boolean,
): readonly { readonly key: string; readonly label: string }[] {
  return MODAL_HINT_ACTIONS.flatMap((hint) => {
    const binding = keymap.bindings.get(hint.actionId)?.[0];

    if (binding === undefined || !isAvailable(hint.actionId, hint.scope)) {
      return [];
    }

    return [{ key: formatBinding(binding), label: ACTION_BY_ID[hint.actionId].label }];
  });
}
