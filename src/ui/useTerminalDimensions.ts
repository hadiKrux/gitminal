import type { CliRenderer } from "@opentui/core";
import { useRenderer } from "@opentui/react";
import { useSyncExternalStore } from "react";
import type { TerminalDimensions, TerminalDimensionsStore } from "./useTerminalDimensions.types";

const stores = new WeakMap<CliRenderer, TerminalDimensionsStore>();

/**
 * Reads terminal dimensions through one resize listener shared by all consumers of the renderer.
 * The listener is removed when the last consumer unmounts; separate renderers remain isolated.
 *
 * @returns The current terminal width and height in cells, stable until either changes.
 */
export function useTerminalDimensions(): TerminalDimensions {
  const renderer = useRenderer();
  let store = stores.get(renderer);

  if (store === undefined) {
    store = createDimensionsStore(renderer);
    stores.set(renderer, store);
  }

  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

/**
 * Creates a lazily subscribed store without retaining unused renderers globally.
 *
 * @param renderer - Renderer whose terminal dimensions are observed.
 * @returns A store with stable React subscription and snapshot functions.
 */
function createDimensionsStore(renderer: CliRenderer): TerminalDimensionsStore {
  let snapshot: TerminalDimensions = { width: renderer.width, height: renderer.height };
  const listeners = new Set<() => void>();

  /** Reads live dimensions, including changes while the store had no subscribers. */
  function getSnapshot(): TerminalDimensions {
    if (snapshot.width !== renderer.width || snapshot.height !== renderer.height) {
      snapshot = { width: renderer.width, height: renderer.height };
    }

    return snapshot;
  }

  /** Notifies React consumers after the renderer updates its terminal dimensions. */
  function notify(): void {
    for (const listener of listeners) {
      listener();
    }
  }

  /**
   * Attaches one renderer listener for the first consumer and removes it after the last.
   *
   * @param listener - React's snapshot-change callback.
   * @returns Cleanup for this consumer's subscription.
   */
  function subscribe(listener: () => void): () => void {
    listeners.add(listener);

    if (listeners.size === 1) {
      renderer.on("resize", notify);
    }

    return () => {
      listeners.delete(listener);

      if (listeners.size === 0) {
        renderer.off("resize", notify);
      }
    };
  }

  return { getSnapshot, subscribe };
}
