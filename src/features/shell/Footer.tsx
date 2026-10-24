import { useTerminalDimensions } from "@opentui/react";
import { type ReactNode, useCallback, useMemo, useSyncExternalStore } from "react";
import {
  getActionRegistryVersion,
  hasRegisteredAction,
  subscribeActionRegistry,
} from "@/app/hooks/useAction";
import type { ActionScope } from "@/app/hooks/useAction.types";
import { useFocusState } from "@/app/hooks/useFocusState";
import { useKeymap } from "@/app/hooks/useKeymap";
import { useStatus } from "@/app/hooks/useStatus";
import { ACTION_BY_ID } from "@/domain/keymap/keymap.defaults";
import { describeContextHints, formatBinding } from "@/domain/keymap/keymap.describe";
import type { KeymapContext, ResolvedKeymap } from "@/domain/keymap/keymap.types";
import { MODAL_HINT_ACTIONS } from "@/features/shell/Footer.constants";
import { useTokens } from "@/theme/useTokens";
import { HintBar } from "@/ui/HintBar";

/**
 * Renders the contextual footer hint bar.
 *
 * Hints come from the resolved keymap for the focused region plus globals, minus actions whose
 * global key is shadowed by the focused context. Until the command availability model lands, an
 * action is shown only when a handler is registered for its context, so the footer never advertises
 * a feature that is only a placeholder. M3 ships global-only hints because no panel registers a
 * region-scoped action yet; the mechanism already supports region hints. When focus leaves every
 * region, the footer falls back to the global hints instead of keeping the last region's context.
 * Modal hints come from `StatusProvider.hintMode` until `OverlayProvider` lands in M6. Hints are
 * priority ordered and dropped as the width shrinks.
 *
 * @returns The footer hint line.
 */
export function Footer(): ReactNode {
  const { width } = useTerminalDimensions();
  const keymap = useKeymap();
  const { state } = useFocusState();
  const { hintMode } = useStatus();
  const tokens = useTokens();
  const registryVersion = useSyncExternalStore(
    subscribeActionRegistry,
    getActionRegistryVersion,
    getActionRegistryVersion,
  );
  const isAvailable = useCallback(
    (actionId: string, scope: ActionScope): boolean => {
      void registryVersion;

      return hasRegisteredAction(actionId, scope);
    },
    [registryVersion],
  );

  const hints = useMemo(() => {
    if (hintMode === "modal") {
      return buildModalHints(keymap, isAvailable);
    }

    const context: KeymapContext = state.focusInsideRegion
      ? (state.activeRegion ?? "global")
      : "global";

    return describeContextHints(keymap, context, { isAvailable }).map((hint) => ({
      key: hint.keys[0] ?? "",
      label: hint.label,
    }));
  }, [hintMode, isAvailable, keymap, state.activeRegion, state.focusInsideRegion]);

  return (
    <box height={1} flexShrink={0} backgroundColor={tokens.surface}>
      <HintBar hints={hints} maxWidth={width} />
    </box>
  );
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
