/**
 * Conflict settlement and required-action warnings for the resolved keymap.
 *
 * `settleConflicts` rejects overrides that make two actions share a key in one context, and
 * `collectUnboundWarnings` reports the required actions that configuration left unreachable. Both
 * concerns decide whether the resolved keymap is usable, so they live together.
 */
import {
  ACTION_BY_ID,
  ACTION_CATALOGUE,
  type ActionId,
  isActionId,
  KEYMAP_CONTEXTS,
  REQUIRED_BINDING_ACTIONS,
  readDefaultBindings,
} from "./keymap.defaults";
import { formatBinding } from "./keymap.describe";
import { lookupBindingKey } from "./keymap.parse";
import type {
  ConflictSettlement,
  ContextProjection,
  KeymapConflict,
  KeymapContext,
  KeymapPlatform,
  ParsedBinding,
} from "./keymap.types";

/**
 * Rejects conflicting overrides until no overridden action still collides.
 *
 * Defaults never collide. When an override creates a collision in a context, the conflicting
 * overrides are reset to their built-in defaults and a warning names both actions and the key. A
 * collision that survives that reset is returned so the caller can report it and leave the first
 * catalogue action winning its key.
 *
 * @param bindings - The effective binding map to settle in place.
 * @param overridden - Action IDs touched by an override layer; reset actions are removed.
 * @param platform - Platform used to expand `mod` when resetting defaults.
 * @returns The settled projection, the remaining conflicts, and the reset warnings.
 */
export function settleConflicts(
  bindings: Map<ActionId, readonly ParsedBinding[]>,
  overridden: Set<ActionId>,
  platform: KeymapPlatform,
): ConflictSettlement {
  let projection = projectContexts(bindings);
  const warnings: string[] = [];

  for (let pass = 0; pass <= ACTION_CATALOGUE.length; pass += 1) {
    if (projection.conflicts.length === 0) {
      return { ...projection, warnings };
    }

    let reset = false;

    for (const conflict of projection.conflicts) {
      const conflictingOverrides = conflict.actions
        .filter(isActionId)
        .filter((actionId) => overridden.has(actionId));

      if (conflictingOverrides.length === 0) {
        continue;
      }

      warnings.push(formatConflictWarning(conflict));

      for (const actionId of conflictingOverrides) {
        bindings.set(actionId, readDefaultBindings(actionId, platform));
        overridden.delete(actionId);
        reset = true;
      }
    }

    if (!reset) {
      return { ...projection, warnings };
    }

    projection = projectContexts(bindings);
  }

  return { ...projection, warnings };
}

/**
 * Projects the effective action bindings into key-to-action maps per context.
 *
 * The first catalogue action to claim a key wins; a later action that wants the same key is
 * reported as a conflict instead of silently overwriting the map.
 *
 * @param bindings - The effective binding map.
 * @returns The context maps and collisions found while building them.
 */
export function projectContexts(
  bindings: ReadonlyMap<ActionId, readonly ParsedBinding[]>,
): ContextProjection {
  const contexts = new Map<KeymapContext, Map<string, string>>(
    KEYMAP_CONTEXTS.map((context) => [context, new Map<string, string>()]),
  );
  const conflicts: KeymapConflict[] = [];

  for (const action of ACTION_CATALOGUE) {
    const actionBindings = bindings.get(action.id) ?? [];

    for (const context of action.contexts) {
      const contextMap = contexts.get(context);

      if (!contextMap) {
        continue;
      }

      for (const binding of actionBindings) {
        const key = lookupBindingKey(binding);
        const existing = contextMap.get(key);

        if (existing !== undefined && existing !== action.id) {
          conflicts.push({
            context,
            key,
            displayKey: formatBinding(binding),
            actions: [existing, action.id],
          });
          continue;
        }

        contextMap.set(key, action.id);
      }
    }
  }

  return { contexts, conflicts };
}

/**
 * Formats one conflict for the warning list.
 *
 * @param conflict - The conflict to describe.
 * @returns A readable warning naming both actions and the key.
 */
export function formatConflictWarning(conflict: KeymapConflict): string {
  const actions = conflict.actions.map((actionId) => `"${actionId}"`).join(" and ");

  return `Conflicting key "${conflict.displayKey}" in context "${conflict.context}" for ${actions}.`;
}

/**
 * Reports actions that configuration left without any reachable binding.
 *
 * A binding displaced by the reserved quit chord is not reachable, so an action bound only to
 * `Ctrl+C` still counts as unbound. A required action with no bindings at all is always reported.
 *
 * @param bindings - The effective binding map.
 * @param contexts - The final key-to-action maps after the reserved chord is applied.
 * @returns One warning per required action without a reachable binding.
 */
export function collectUnboundWarnings(
  bindings: ReadonlyMap<ActionId, readonly ParsedBinding[]>,
  contexts: ReadonlyMap<KeymapContext, ReadonlyMap<string, string>>,
): readonly string[] {
  return REQUIRED_BINDING_ACTIONS.filter((actionId) => {
    const action = ACTION_BY_ID[actionId];
    const keys = (bindings.get(actionId) ?? []).map(lookupBindingKey);

    if (!action || keys.length === 0) {
      return true;
    }

    return !action.contexts.some((context) =>
      keys.some((key) => contexts.get(context)?.get(key) === actionId),
    );
  }).map((actionId) => `Action "${actionId}" has no binding.`);
}
