import { useEffect, useRef } from "react";
import type {
  ActionBatchRegistration,
  ActionHandler,
  ActionOwner,
  ActionRegistrationOptions,
  ActionScope,
} from "@/app/hooks/useAction.types";

/** Prefixes each designated owner is allowed to register as a global action. */
const OWNER_ACTION_PREFIXES: Readonly<Record<ActionOwner, readonly string[]>> = Object.freeze({
  app: ["app.", "overlay.", "commit."],
  shell: ["focus."],
  "top-bar": ["remote."],
});

/** Handler registry keyed by scope and then action id. */
const registry = new Map<ActionScope, Map<string, ActionHandler>>();

/** Version bumped whenever a registration is added or removed. */
let registryVersion = 0;

/** Listeners that re-render consumers such as the footer when the registry changes. */
const registryListeners = new Set<() => void>();

/**
 * Subscribes to registry changes.
 *
 * @param listener - Callback invoked after every successful registration or removal.
 * @returns An unsubscribe function.
 */
export function subscribeActionRegistry(listener: () => void): () => void {
  registryListeners.add(listener);

  return () => {
    registryListeners.delete(listener);
  };
}

/**
 * Reads the current registry version for `useSyncExternalStore`.
 *
 * @returns A monotonically increasing version number.
 */
export function getActionRegistryVersion(): number {
  return registryVersion;
}

/**
 * Notifies subscribers that the registry changed.
 */
function notifyRegistryChange(): void {
  registryVersion += 1;

  for (const listener of registryListeners) {
    listener();
  }
}

/**
 * Registers one handler for an action in a scope.
 *
 * Exactly one handler may exist per `(actionId, scope)`. A duplicate is a development error: the
 * later registration is rejected and the first handler keeps ownership. Global registrations must
 * also name a designated owner whose namespace matches the action ID, so a feature cannot silently
 * take over `app.quit`, `focus.next`, or `remote.pull`.
 *
 * @param actionId - Stable action id.
 * @param options - Scope, target kind, and optional owner.
 * @param handler - Callback invoked when the action runs.
 * @returns A cleanup function that removes this exact registration.
 */
export function registerAction(
  actionId: string,
  options: ActionRegistrationOptions,
  handler: ActionHandler,
): () => void {
  const ownerError = validateOwner(actionId, options);

  if (ownerError !== null) {
    console.error(ownerError);
    return () => {};
  }

  const scopeHandlers = registry.get(options.scope) ?? new Map<string, ActionHandler>();
  const existing = scopeHandlers.get(actionId);

  if (existing !== undefined) {
    console.error(
      `Duplicate action handler for "${actionId}" in scope "${options.scope}"; the later registration was rejected.`,
    );
    return () => {};
  }

  scopeHandlers.set(actionId, handler);
  registry.set(options.scope, scopeHandlers);
  notifyRegistryChange();

  return () => {
    if (scopeHandlers.get(actionId) === handler) {
      scopeHandlers.delete(actionId);
      notifyRegistryChange();
    }
  };
}

/**
 * Resolves the handler for an action in one scope.
 *
 * @param actionId - Stable action id.
 * @param scope - Context that owns the handler.
 * @returns The handler, or `undefined` when no handler is registered.
 */
export function resolveActionHandler(
  actionId: string,
  scope: ActionScope,
): ActionHandler | undefined {
  return registry.get(scope)?.get(actionId);
}

/**
 * Reports whether a handler is registered for an action in a scope.
 *
 * Footer hints use this as the availability proxy until the command availability model lands.
 *
 * @param actionId - Stable action id.
 * @param scope - Context that would own the handler.
 * @returns True when a handler exists.
 */
export function hasRegisteredAction(actionId: string, scope: ActionScope): boolean {
  return resolveActionHandler(actionId, scope) !== undefined;
}

/**
 * Clears every registered handler.
 *
 * This exists for test isolation only. Production modules never call it.
 */
export function resetActionRegistry(): void {
  registry.clear();
  notifyRegistryChange();
}

/**
 * Registers an action handler for the lifetime of the calling component.
 *
 * The handler is read through a ref so a component can pass an inline callback without
 * re-registering on every render. Registration happens after mount and is removed on unmount.
 *
 * @param actionId - Stable action id.
 * @param options - Scope, target kind, and optional owner.
 * @param handler - Callback invoked when the action runs.
 */
export function useAction(
  actionId: string,
  options: ActionRegistrationOptions,
  handler: ActionHandler,
): void {
  const handlerRef = useRef(handler);
  const { scope, owner, targetKind } = options;

  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(
    () =>
      registerAction(actionId, { scope, owner, targetKind }, () => {
        handlerRef.current();
      }),
    [actionId, scope, owner, targetKind],
  );
}

/**
 * Registers a batch of action handlers for the lifetime of the calling component.
 *
 * This is the same contract as `useAction` with a single effect, so a component that owns many
 * actions, such as the focus model, does not call one hook per action. Duplicate and owner checks
 * still apply per entry, and the batch re-registers only when an action id or option changes.
 *
 * @param registrations - Action ids, options, and handlers.
 */
export function useActions(registrations: readonly ActionBatchRegistration[]): void {
  const latest = useRef(registrations);
  const handlers = useRef(new Map<string, ActionHandler>());
  const signature = registrations
    .map((registration) => registrationSignature(registration))
    .join("|");

  useEffect(() => {
    latest.current = registrations;
    handlers.current = new Map(
      registrations.map((registration) => [
        registrationSignature(registration),
        registration.handler,
      ]),
    );
  });

  useEffect(() => {
    // `signature` decides when the batch changes. The latest registrations are read through a ref
    // so inline handlers do not force a re-registration on every render.
    void signature;

    const cleanups = latest.current.map((registration) =>
      registerAction(registration.actionId, registration.options, () => {
        handlers.current.get(registrationSignature(registration))?.();
      }),
    );

    return () => {
      for (const cleanup of cleanups) {
        cleanup();
      }
    };
  }, [signature]);
}

/**
 * Builds the stable identity used to look up a batch handler.
 *
 * @param registration - Batch entry.
 * @returns The scope and action id joined with a printable separator.
 */
function registrationSignature(registration: ActionBatchRegistration): string {
  const { scope, owner, targetKind } = registration.options;

  return `${scope}:${owner ?? ""}:${targetKind ?? ""}:${registration.actionId}`;
}

/**
 * Validates the owner of a global action registration.
 *
 * @param actionId - Action being registered.
 * @param options - Registration options.
 * @returns An error message, or `null` when the registration is allowed.
 */
function validateOwner(actionId: string, options: ActionRegistrationOptions): string | null {
  if (options.scope !== "global") {
    return null;
  }

  if (options.owner === undefined) {
    return `Global action "${actionId}" must declare a designated owner.`;
  }

  const allowed = OWNER_ACTION_PREFIXES[options.owner].some((prefix) =>
    actionId.startsWith(prefix),
  );

  return allowed ? null : `Owner "${options.owner}" cannot register global action "${actionId}".`;
}
