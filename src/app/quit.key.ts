import type { KeyEvent } from "@opentui/core";

/**
 * Detects the fixed app quit chord.
 *
 * The renderer is created with `exitOnCtrlC: false`, so `Ctrl+C` arrives as a key event and must be
 * handled explicitly. This is the single raw-key comparison for the temporary quit path shared by
 * the splash gate and the workspace placeholder until `app.quit` lands in the shell milestone.
 *
 * @param key - The keyboard event received by a pre-shell keyboard handler.
 * @returns `true` when the event is `Ctrl+C`.
 */
export function isQuitKey(key: KeyEvent): boolean {
  return key.ctrl && key.name.toLowerCase() === "c";
}
