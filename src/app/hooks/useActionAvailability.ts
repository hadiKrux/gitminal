import type { ActionScope } from "@/app/hooks/useAction.types";

/**
 * Availability values published by the surface that owns an action.
 *
 * A panel computes availability for its selected target and publishes it here, so the footer can
 * agree with the same result without importing the feature. The registry is the cross-cutting
 * bridge only: it stores the last published boolean per `(scope, actionId)` and never derives
 * availability itself.
 */
const registry = new Map<ActionScope, Map<string, { readonly available: boolean }>>();

/** Version bumped whenever a publication is added or removed. */
let registryVersion = 0;

/** Listeners that re-render consumers such as the footer when a publication changes. */
const registryListeners = new Set<() => void>();

/**
 * Notifies subscribers that a publication changed.
 */
function notifyRegistryChange(): void {
  registryVersion += 1;

  for (const listener of registryListeners) {
    listener();
  }
}

/**
 * Publishes the availability one surface computed for an action.
 *
 * The caller publishes while its selected target is visible and calls the returned cleanup when it
 * unmounts or the action stops being owned, which removes the value so the footer falls back to its
 * other checks instead of keeping a stale hint state.
 *
 * @param scope - Scope that owns the action, normally the panel region.
 * @param actionId - Stable action id the surface owns.
 * @param available - True when the action can run for the current target.
 * @returns A cleanup function that removes this exact publication.
 */
export function publishActionAvailability(
  scope: ActionScope,
  actionId: string,
  available: boolean,
): () => void {
  const publication = { available };
  const scopeEntries = registry.get(scope) ?? new Map<string, { readonly available: boolean }>();

  scopeEntries.set(actionId, publication);
  registry.set(scope, scopeEntries);
  notifyRegistryChange();

  return () => {
    if (scopeEntries.get(actionId) !== publication) {
      return;
    }

    scopeEntries.delete(actionId);

    if (scopeEntries.size === 0 && registry.get(scope) === scopeEntries) {
      registry.delete(scope);
    }

    notifyRegistryChange();
  };
}

/**
 * Reads the last availability published for an action.
 *
 * @param scope - Scope that owns the action.
 * @param actionId - Stable action id.
 * @returns The published value, or `undefined` when no surface published one.
 */
export function readActionAvailability(scope: ActionScope, actionId: string): boolean | undefined {
  return registry.get(scope)?.get(actionId)?.available;
}

/**
 * Subscribes to publication changes.
 *
 * @param listener - Callback invoked after every publication or removal.
 * @returns An unsubscribe function.
 */
export function subscribeActionAvailability(listener: () => void): () => void {
  registryListeners.add(listener);

  return () => {
    registryListeners.delete(listener);
  };
}

/**
 * Reads the current publication version for `useSyncExternalStore`.
 *
 * @returns A monotonically increasing version number.
 */
export function getActionAvailabilityVersion(): number {
  return registryVersion;
}

/**
 * Clears every publication and notifies subscribers.
 *
 * This exists for test isolation only. Production modules never call it.
 */
export function resetActionAvailability(): void {
  registry.clear();
  notifyRegistryChange();
}
