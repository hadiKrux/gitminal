import type { InputMode } from "@/app/hooks/inputMode.types";

/**
 * Input mode per focused renderable id.
 *
 * A feature owns its input value but must not inspect key events, so it declares the routing mode
 * once for the renderable that owns focus. `useHotkeys` reads the mode of the current renderable and
 * resolves navigation keys accordingly. The registry is module state because native focus reports a
 * renderable id rather than the React owner of that id.
 */
const inputModes = new Map<string, InputMode>();

/**
 * Declares the key-routing mode of one input renderable.
 *
 * A later registration replaces the earlier mode for the same id, which lets a field change its
 * routing while it stays mounted. The cleanup removes this registration only, so an old unmount
 * cannot delete a newer owner.
 *
 * @param renderableId - Stable id of the focusable input.
 * @param mode - Routing mode the owner declares.
 * @returns A cleanup function that removes this registration.
 */
export function registerInputMode(renderableId: string, mode: InputMode): () => void {
  inputModes.set(renderableId, mode);

  return () => {
    if (inputModes.get(renderableId) === mode) {
      inputModes.delete(renderableId);
    }
  };
}

/**
 * Reads the routing mode of one focused input.
 *
 * @param renderableId - Focused renderable id, or null when no renderable owns focus.
 * @returns The registered mode, or null for an unregistered renderable.
 */
export function readInputMode(renderableId: string | null): InputMode | null {
  if (renderableId === null) {
    return null;
  }

  return inputModes.get(renderableId) ?? null;
}

/**
 * Removes every registered mode.
 *
 * This exists for test isolation only. Production modules never call it.
 */
export function resetInputModes(): void {
  inputModes.clear();
}
