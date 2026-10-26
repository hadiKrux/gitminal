/**
 * First-Esc clear callbacks registered by focused surfaces.
 *
 * A feature owns its filter value but must not inspect key events, so it registers a clear callback
 * for a renderable id while the value is non-empty. The global `overlay.close` handler consults the
 * registry before it returns focus from a text input and before it closes an open overlay, which
 * makes the first Esc clear and keep the surface open and the next Esc leave it. A modal registers
 * the ids it owns, so the search clears whether its field or its frame has focus.
 */
const clearRegistry = new Map<string, () => void>();

/**
 * Registers the first-Esc clear callback for one input renderable.
 *
 * Only one callback may exist per renderable id. A later registration replaces the earlier one,
 * because a filter value is owned by a single hook. The cleanup removes this exact callback only.
 *
 * @param renderableId - Stable id of the focusable input.
 * @param clear - Callback that clears the input value.
 * @returns A cleanup function that removes this registration.
 */
export function registerInputEscapeClear(renderableId: string, clear: () => void): () => void {
  clearRegistry.set(renderableId, clear);

  return () => {
    if (clearRegistry.get(renderableId) === clear) {
      clearRegistry.delete(renderableId);
    }
  };
}

/**
 * Clears the focused input when it registered a first-Esc clear callback.
 *
 * @param renderableId - Focused renderable id, or `null` when no renderable owns focus.
 * @returns True when a callback ran and the caller should keep focus in the field.
 */
export function clearFocusedInput(renderableId: string | null): boolean {
  if (renderableId === null) {
    return false;
  }

  const clear = clearRegistry.get(renderableId);

  if (clear === undefined) {
    return false;
  }

  clear();

  return true;
}

/**
 * Removes every registered clear callback.
 *
 * This exists for test isolation only. Production modules never call it.
 */
export function resetInputEscapeClear(): void {
  clearRegistry.clear();
}
