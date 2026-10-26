import { TextareaRenderable } from "@opentui/core";
import { useKeyboard, useRenderer } from "@opentui/react";
import { readInputMode } from "@/app/hooks/inputMode.registry";
import type { InputMode } from "@/app/hooks/inputMode.types";
import { resolveActionHandler } from "@/app/hooks/useAction";
import type { ActionScope } from "@/app/hooks/useAction.types";
import { useFocusState } from "@/app/hooks/useFocusState";
import type { HotkeyResolution, HotkeyResolutionInput } from "@/app/hooks/useHotkeys.types";
import { useKeymap } from "@/app/hooks/useKeymap";
import { useOverlay } from "@/app/hooks/useOverlay";
import { lookupBindingKey, readKeyEvent } from "@/domain/keymap/keymap.parse";
import type { KeyEventLike, KeymapContext, ResolvedKeymap } from "@/domain/keymap/keymap.types";
import type { RegionId } from "@/features/shell/focus.types";
import { outdentLeadingIndent, TEXT_INDENT_UNIT } from "@/lib/text";

/** App actions that may fire while a text input owns keys, when their binding has a modifier. */
const TEXT_INPUT_SAFE_ACTIONS: ReadonlySet<string> = new Set([
  "app.palette",
  "app.console",
  "commit.submit",
  "commit.options",
  "form.submit",
]);

/** Actions a focused native list widget consumes before the app dispatcher sees them. */
const NATIVE_LIST_ACTIONS: ReadonlySet<string> = new Set([
  "nav.up",
  "nav.down",
  "nav.pageUp",
  "nav.pageDown",
  "nav.first",
  "nav.last",
  "nav.activate",
  "nav.left",
  "nav.right",
]);

/** Global actions that stay reachable while an overlay owns keys. */
const OVERLAY_ALLOWED_ACTIONS: ReadonlySet<string> = new Set(["overlay.close", "app.quit"]);

/**
 * Physical keys a search input routes to the bound result list.
 *
 * The lookup key keeps modifiers, so only the plain key reaches the list. Printable keys such as
 * `j` and `k` keep editing the query even though the region also binds them to navigation.
 */
const SEARCH_INPUT_ACTIONS: ReadonlyMap<string, string> = new Map([
  ["up", "nav.up"],
  ["down", "nav.down"],
  ["pageup", "nav.pageUp"],
  ["pagedown", "nav.pageDown"],
  ["enter", "nav.activate"],
]);

/** The hardcoded quit action that always survives text-input ownership. */
const QUIT_ACTION_ID = "app.quit";

/** The close/cancel action that leaves a text input. */
const CLOSE_ACTION_ID = "overlay.close";

/**
 * Installs the single application keyboard dispatcher.
 *
 * The hook is the only `useKeyboard` caller after the shell mounts. It resolves an action through
 * `resolveHotkeyAction`, looks up the handler for the resolved scope, and calls `preventDefault()`
 * only when a handler actually ran. Unhandled keys pass through to a focused input, a native list
 * widget, or OpenTUI's editing bindings untouched. While an overlay is open, the overlay inputs
 * give that overlay ownership of the keyboard. Outside a modal text field only `overlay.close`,
 * `app.quit`, and the same overlay's toggle resolve from the global context; inside a modal text
 * field, `overlay.close` on `Esc`, the hardcoded `Ctrl+C` quit path, and modifier-gated
 * text-input-safe actions may also resolve, and a plain unmodified global action never does.
 */
export function useHotkeys(): void {
  const keymap = useKeymap();
  const { state } = useFocusState();
  const overlay = useOverlay();
  const renderer = useRenderer();

  useKeyboard((key) => {
    if (state.textInputFocused && state.multilineInputFocused && isTabEvent(key)) {
      const editor = renderer.currentFocusedEditor;

      if (editor instanceof TextareaRenderable) {
        applyTextareaIndent(editor, key.shift);
        key.preventDefault();
      }

      return;
    }

    const resolution = resolveHotkeyAction({
      keymap,
      key,
      activeRegion: state.activeRegion,
      textInputFocused: state.textInputFocused,
      textInputMode: readInputMode(state.focusedRenderableId),
      nativeListFocused: state.nativeListFocused,
      focusInsideRegion: state.focusInsideRegion,
      overlayOpen: overlay.isOpen,
      overlayToggleActionId: overlay.toggleActionId ?? undefined,
    });

    if (resolution === null) {
      return;
    }

    const handler = resolveActionHandler(resolution.actionId, resolution.scope);

    if (handler === undefined) {
      return;
    }

    key.preventDefault();
    handler();
  });
}

/**
 * Resolves a key event to an action and scope using the documented precedence.
 *
 * Precedence is overlay, text input, native list widget, focused region, then global. A context
 * action shadows a global one for the same key even when no handler exists, so an unimplemented
 * feature never falls through to an unrelated global command. When `focusInsideRegion` is false and
 * no overlay is open, the stale `activeRegion` is ignored and only globals resolve.
 *
 * @param input - Key event plus the focus and overlay state.
 * @returns The action and scope to run, or `null` when the key is unhandled.
 */
export function resolveHotkeyAction(input: HotkeyResolutionInput): HotkeyResolution | null {
  const lookupKey = lookupBindingKey(readKeyEvent(input.key));
  const focusInsideRegion = input.focusInsideRegion ?? true;

  if (input.overlayOpen) {
    return resolveOverlayAction(input, lookupKey);
  }

  if (input.textInputFocused) {
    return resolveTextInputAction(
      input.keymap,
      input.key,
      lookupKey,
      focusInsideRegion ? input.activeRegion : null,
      input.textInputMode ?? null,
    );
  }

  const activeRegion = focusInsideRegion ? input.activeRegion : null;
  const resolution = resolveRegionAction(input.keymap, activeRegion, lookupKey);

  if (
    resolution !== null &&
    input.nativeListFocused &&
    NATIVE_LIST_ACTIONS.has(resolution.actionId)
  ) {
    return null;
  }

  return resolution;
}

/**
 * Resolves a key while an overlay owns the keyboard.
 *
 * Only the overlay's own context, `overlay.close` on Esc, the hardcoded `Ctrl+C` quit path, and
 * modifier-gated text-input-safe actions may run. No plain unmodified global action fires from a
 * modal text field, so typing `q` inserts a character instead of quitting. Text inputs and native
 * lists inside the modal keep their own keys.
 *
 * @param input - Resolution inputs.
 * @param lookupKey - Canonical lookup key for the event.
 * @returns The resolution, or `null` when the overlay does not allow the key.
 */
function resolveOverlayAction(
  input: HotkeyResolutionInput,
  lookupKey: string,
): HotkeyResolution | null {
  const overlayAction = readContextAction(input.keymap, "overlay", lookupKey);

  if (overlayAction !== undefined) {
    return resolveOverlayOwnedAction(input, overlayAction);
  }

  return resolveOverlayGlobalAction(input, lookupKey);
}

/**
 * Resolves a key bound in the overlay context itself.
 *
 * The reserved quit chord stays global even though keymap resolution injects it into every context.
 * A focused native list keeps its navigation keys, and a focused modal field keeps every unmodified
 * printable key.
 *
 * @param input - Resolution inputs.
 * @param actionId - Action bound in the overlay context.
 * @returns The resolution, or `null` when the overlay or its focused widget keeps the key.
 */
function resolveOverlayOwnedAction(
  input: HotkeyResolutionInput,
  actionId: string,
): HotkeyResolution | null {
  if (actionId === QUIT_ACTION_ID && input.key.ctrl) {
    return { actionId, scope: "global" };
  }

  if (input.nativeListFocused && NATIVE_LIST_ACTIONS.has(actionId)) {
    return null;
  }

  if (input.textInputFocused && !isAllowedWhileTyping(actionId, input.key)) {
    return null;
  }

  return { actionId, scope: "overlay" };
}

/**
 * Resolves a key bound globally while an overlay is open.
 *
 * With no focused field, only `overlay.close`, `app.quit`, and the overlay's own toggle may run.
 * With a focused field, `overlay.close` on Esc, the hardcoded `Ctrl+C` quit path, and
 * modifier-gated text-input-safe actions may run; a plain global action never escapes into the
 * modal.
 *
 * @param input - Resolution inputs.
 * @param lookupKey - Canonical lookup key for the event.
 * @returns The resolution, or `null` when the key stays with the overlay.
 */
function resolveOverlayGlobalAction(
  input: HotkeyResolutionInput,
  lookupKey: string,
): HotkeyResolution | null {
  const actionId = readContextAction(input.keymap, "global", lookupKey);

  if (actionId === undefined) {
    return null;
  }

  if (!input.textInputFocused) {
    const allowed =
      OVERLAY_ALLOWED_ACTIONS.has(actionId) || actionId === input.overlayToggleActionId;

    return allowed ? { actionId, scope: "global" } : null;
  }

  if (actionId === CLOSE_ACTION_ID || (actionId === QUIT_ACTION_ID && input.key.ctrl)) {
    return { actionId, scope: "global" };
  }

  return isAllowedWhileTyping(actionId, input.key) ? { actionId, scope: "global" } : null;
}

/**
 * Resolves a key while an editor owns focus.
 *
 * Esc leaves the field, Tab and Shift+Tab move to the next or previous region for a single-line
 * input, and only the documented allowlist fires, and only when its effective binding carries a
 * primary modifier. Every other key stays with the editor.
 *
 * @param keymap - The resolved keymap.
 * @param key - The physical key event.
 * @param lookupKey - Canonical lookup key for the event.
 * @param activeRegion - Region that owns the focused editor, or `null` when focus is outside every
 * region.
 * @param inputMode - Routing mode declared by the focused editor, or `null` when it declares none.
 * @returns The resolution, or `null` when the editor should keep the key.
 */
function resolveTextInputAction(
  keymap: ResolvedKeymap,
  key: KeyEventLike,
  lookupKey: string,
  activeRegion: RegionId | null,
  inputMode: InputMode | null,
): HotkeyResolution | null {
  if (inputMode === "search" && activeRegion !== null) {
    const routed = SEARCH_INPUT_ACTIONS.get(lookupKey);

    if (routed !== undefined) {
      return { actionId: routed, scope: activeRegion };
    }
  }

  const globalAction = readContextAction(keymap, "global", lookupKey);
  const special = resolveTextInputSpecialAction(globalAction, key);

  if (special !== null) {
    return special;
  }

  if (activeRegion !== null) {
    const regionAction = readContextAction(keymap, activeRegion, lookupKey);
    const allowed = resolveAllowedTypingAction(regionAction, key, activeRegion);

    if (allowed !== null) {
      return allowed;
    }
  }

  return resolveAllowedTypingAction(globalAction, key, "global");
}

/**
 * Resolves keys that always leave a text input: quit, close, and region traversal.
 *
 * @param actionId - Global action bound to the key, when any.
 * @param key - Physical key event.
 * @returns The resolution, or `null` when the key is not a text-input escape.
 */
function resolveTextInputSpecialAction(
  actionId: string | undefined,
  key: KeyEventLike,
): HotkeyResolution | null {
  if (actionId === QUIT_ACTION_ID && key.ctrl) {
    return { actionId, scope: "global" };
  }

  if (actionId === CLOSE_ACTION_ID || actionId === "focus.next" || actionId === "focus.previous") {
    return { actionId, scope: "global" };
  }

  return null;
}

/**
 * Resolves an allowlisted app action for the focused editor.
 *
 * @param actionId - Action bound to the key, when any.
 * @param key - Physical key event.
 * @param scope - Scope that owns the action.
 * @returns The resolution, or `null` when the action may not fire while typing.
 */
function resolveAllowedTypingAction(
  actionId: string | undefined,
  key: KeyEventLike,
  scope: ActionScope,
): HotkeyResolution | null {
  if (actionId === undefined || !isAllowedWhileTyping(actionId, key)) {
    return null;
  }

  return { actionId, scope };
}

/**
 * Resolves a key against the focused region and then the global context.
 *
 * @param keymap - The resolved keymap.
 * @param activeRegion - Region that currently owns focus, or `null` to resolve globals only.
 * @param lookupKey - Canonical lookup key for the event.
 * @returns The resolution, or `null` when neither context binds the key.
 */
function resolveRegionAction(
  keymap: ResolvedKeymap,
  activeRegion: RegionId | null,
  lookupKey: string,
): HotkeyResolution | null {
  if (activeRegion !== null) {
    const regionAction = readContextAction(keymap, activeRegion, lookupKey);

    if (regionAction !== undefined) {
      // The reserved quit chord is injected into every context, but the action stays global.
      const scope = regionAction === QUIT_ACTION_ID ? "global" : activeRegion;

      return { actionId: regionAction, scope };
    }
  }

  const globalAction = readContextAction(keymap, "global", lookupKey);

  return globalAction === undefined ? null : { actionId: globalAction, scope: "global" };
}

/**
 * Reads the action bound to a lookup key in one context.
 *
 * @param keymap - The resolved keymap.
 * @param context - Context to read.
 * @param lookupKey - Canonical lookup key.
 * @returns The action id, or `undefined` when the context does not bind the key.
 */
function readContextAction(
  keymap: ResolvedKeymap,
  context: KeymapContext,
  lookupKey: string,
): string | undefined {
  return keymap.contexts.get(context)?.get(lookupKey);
}

/**
 * Reports whether an action may run while an editor owns focus.
 *
 * @param actionId - Candidate action.
 * @param key - Physical key event that resolved to it.
 * @returns True when the action is allowlisted and the binding uses a primary modifier.
 */
function isAllowedWhileTyping(actionId: string, key: KeyEventLike): boolean {
  return (
    TEXT_INPUT_SAFE_ACTIONS.has(actionId) &&
    (key.ctrl || key.meta || key.option || key.super === true)
  );
}

/**
 * Reports whether a key event is Tab in either direction.
 *
 * @param key - Physical key event.
 * @returns True for Tab with or without Shift.
 */
function isTabEvent(key: KeyEventLike): boolean {
  return readKeyEvent(key).key === "tab";
}

/**
 * Applies Tab indentation or Shift+Tab outdent to a multiline editor.
 *
 * Tab inserts the shared two-space indent at the cursor. Shift+Tab removes up to one indent unit
 * from the start of the cursor's line and keeps the cursor on the same character where possible.
 *
 * @param editor - Focused textarea renderable.
 * @param outdent - True for Shift+Tab.
 */
function applyTextareaIndent(editor: TextareaRenderable, outdent: boolean): void {
  if (!outdent) {
    editor.insertText(TEXT_INDENT_UNIT);
    return;
  }

  const buffer = editor.editBuffer;
  const cursor = buffer.getCursorPosition();
  const lineStart = buffer.getLineStartOffset(cursor.row);
  const cursorOffset = buffer.positionToOffset(cursor.row, cursor.col);
  const line = buffer.getTextRange(lineStart, cursorOffset);
  const result = outdentLeadingIndent(line);

  if (result.removed === 0) {
    return;
  }

  buffer.deleteRange(cursor.row, 0, cursor.row, result.removed);
  buffer.setCursor(cursor.row, Math.max(0, cursor.col - result.removed));
}
