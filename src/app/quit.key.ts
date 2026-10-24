import type { KeyEvent } from "@opentui/core";

/**
 * Detects the fixed app quit chord.
 *
 * The renderer is created with `exitOnCtrlC: false`, so `Ctrl+C` arrives as a key event and must be
 * handled explicitly. This is the single raw-key comparison for the splash quit path. After the
 * splash dismisses, the shell's `useHotkeys` dispatches `app.quit` instead.
 *
 * @param key - The keyboard event received by the splash keyboard handler.
 * @returns `true` when the event is `Ctrl+C`.
 */
export function isQuitKey(key: KeyEvent): boolean {
  return key.ctrl && key.name.toLowerCase() === "c";
}
