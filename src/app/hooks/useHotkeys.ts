import type { KeyEvent } from "@opentui/core";
import { SelectRenderable, TabSelectRenderable, TextareaRenderable } from "@opentui/core";
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
import type { FocusState, RegionId } from "@/features/shell/focus.types";
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
]);

/** Actions only a focused native tab select consumes; a plain select leaves them to the app. */
const NATIVE_TAB_SELECT_ACTIONS: ReadonlySet<string> = new Set(["nav.left", "nav.right"]);

/** Global actions that stay reachable while an overlay owns keys. */
const OVERLAY_ALLOWED_ACTIONS: ReadonlySet<string> = new Set(["overlay.close", "app.quit"]);

/**
 * Physical keys a search input routes to the bound result list.
 *
 * The lookup key keeps modifiers, so only the plain key reaches the list. Printable keys such as
 * `j` and `k` keep editing the query even though the region also binds them to navigation. Home and
 * End map to the first and last bound result, matching architecture section 8.
 */
const SEARCH_INPUT_ACTIONS: ReadonlyMap<string, string> = new Map([
  ["up", "nav.up"],
  ["down", "nav.down"],
  ["pageup", "nav.pageUp"],
  ["pagedown", "nav.pageDown"],
  ["home", "nav.first"],
  ["end", "nav.last"],
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
 *
 * Native widget and text-input ownership are read from the renderer at key time rather than from the
 * `FocusProvider` projection. A focus move is applied synchronously by the renderer but reaches the
 * projection on its next render, so a key that arrives in the same input burst as the focus move
 * would otherwise be routed by stale state and could be handled by the surface that just lost focus.
 */
export function useHotkeys(): void {
  const keymap = useKeymap();
  const { state } = useFocusState();
  const overlay = useOverlay();
  const renderer = useRenderer();

  useKeyboard((key) => {
    const focus = readLiveFocus(renderer);

    if (applyTextInputIndent(renderer, state.multilineInputFocused, focus.textInputFocused, key)) {
      return;
    }

    dispatchBoundAction({ keymap, key, state, overlay, focus });
  });
}

/** Focus facts read from the renderer at key time rather than from the React projection. */
interface LiveFocus {
  /** Renderable id that currently owns native focus, or null. */
  readonly focusedId: string | null;
  /** True while an editor owns focus. */
  readonly textInputFocused: boolean;
  /** True while a select or tab select owns focus. */
  readonly nativeListFocused: boolean;
  /** True while a tab select owns focus. */
  readonly nativeTabSelectFocused: boolean;
}

/**
 * Reads the focused widget and editor from the renderer.
 *
 * The renderer applies a focus move synchronously, while the `FocusProvider` projection reaches
 * React on its next render. Reading the authority at key time keeps a key that arrives in the same
 * input burst as the focus move on the surface that now owns it.
 *
 * @param renderer - Active renderer.
 * @returns The live focus facts used for key ownership.
 */
function readLiveFocus(renderer: ReturnType<typeof useRenderer>): LiveFocus {
  const focused = renderer.currentFocusedRenderable;

  return {
    focusedId: focused?.id ?? null,
    textInputFocused: renderer.currentFocusedEditor !== null,
    nativeListFocused:
      focused instanceof SelectRenderable || focused instanceof TabSelectRenderable,
    nativeTabSelectFocused: focused instanceof TabSelectRenderable,
  };
}

/**
 * Applies Tab indentation or outdent while a multiline editor owns focus.
 *
 * @param renderer - Active renderer.
 * @param multilineInputFocused - True while the projection reports a textarea.
 * @param textInputFocused - True while an editor owns live focus.
 * @param key - Physical key event.
 * @returns True when the key was an indentation key and was consumed.
 */
function applyTextInputIndent(
  renderer: ReturnType<typeof useRenderer>,
  multilineInputFocused: boolean,
  textInputFocused: boolean,
  key: KeyEvent,
): boolean {
  if (!multilineInputFocused || !textInputFocused || !isTabEvent(key)) {
    return false;
  }

  const editor = renderer.currentFocusedEditor;

  if (!(editor instanceof TextareaRenderable)) {
    return false;
  }

  applyTextareaIndent(editor, key.shift);
  key.preventDefault();

  return true;
}

/**
 * Resolves one key and runs the handler for the resolved action and scope.
 *
 * @param input - Keymap, key event, focus projection, live focus facts, and overlay state.
 */
function dispatchBoundAction(input: {
  readonly keymap: ResolvedKeymap;
  readonly key: KeyEvent;
  readonly state: FocusState;
  readonly overlay: ReturnType<typeof useOverlay>;
  readonly focus: LiveFocus;
}): void {
  const resolution = resolveHotkeyAction({
    keymap: input.keymap,
    key: input.key,
    activeRegion: input.state.activeRegion,
    textInputFocused: input.focus.textInputFocused,
    textInputMode: readInputMode(input.focus.focusedId),
    nativeListFocused: input.focus.nativeListFocused,
    nativeTabSelectFocused: input.focus.nativeTabSelectFocused,
    focusInsideRegion: input.state.focusInsideRegion,
    overlayOpen: input.overlay.isOpen,
    overlayToggleActionId: input.overlay.toggleActionId ?? undefined,
  });

  if (resolution === null) {
    return;
  }

  const handler = resolveActionHandler(resolution.actionId, resolution.scope);

  if (handler === undefined) {
    return;
  }

  input.key.preventDefault();
  handler();
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

  if (resolution !== null && isNativeOwnedAction(input, resolution.actionId)) {
    return null;
  }

  return resolution;
}

/**
 * Resolves a key while an overlay owns the keyboard.
 *
 * A focused field that declares the `search` mode routes Up, Down, PageUp, PageDown, Home, End, and
 * Enter to the overlay's bound result list before the modal typing rules apply, which is how the
 * command palette moves its results while the search input keeps focus. Otherwise only the overlay's own
 * context, `overlay.close` on Esc, the hardcoded `Ctrl+C` quit path, modifier-gated
 * text-input-safe actions, and Tab traversal may run. No plain unmodified global action fires from a
 * modal text field, so typing `q` inserts a character instead of quitting.
 *
 * @param input - Resolution inputs.
 * @param lookupKey - Canonical lookup key for the event.
 * @returns The resolution, or `null` when the overlay does not allow the key.
 */
function resolveOverlayAction(
  input: HotkeyResolutionInput,
  lookupKey: string,
): HotkeyResolution | null {
  if (input.textInputFocused && input.textInputMode === "search") {
    const routed = SEARCH_INPUT_ACTIONS.get(lookupKey);

    if (routed !== undefined) {
      return { actionId: routed, scope: "overlay" };
    }
  }

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

  if (isNativeOwnedAction(input, actionId)) {
    return null;
  }

  if (input.textInputFocused && !isAllowedWhileTyping(actionId, input.key)) {
    return null;
  }

  return { actionId, scope: "overlay" };
}

/**
 * Reports whether the focused native widget consumes an action before the app dispatcher.
 *
 * A plain select owns the vertical navigation and activation keys. Left and Right belong to a tab
 * select only, so an overlay keeps its horizontal control rule while a plain select is focused.
 *
 * @param input - Resolution inputs carrying the focused native widget kind.
 * @param actionId - Action bound to the pressed key.
 * @returns True when the native widget should receive the key untouched.
 */
function isNativeOwnedAction(input: HotkeyResolutionInput, actionId: string): boolean {
  if (!input.nativeListFocused) {
    return false;
  }

  return (
    NATIVE_LIST_ACTIONS.has(actionId) ||
    (input.nativeTabSelectFocused === true && NATIVE_TAB_SELECT_ACTIONS.has(actionId))
  );
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

  if (actionId === "focus.next" || actionId === "focus.previous") {
    // Tab traversal inside a modal belongs to the modal's own control cycle. An overlay that does
    // not register it simply leaves the key to the focused widget, because no overlay handler runs.
    return { actionId, scope: "overlay" };
  }

  return input.textInputFocused
    ? resolveOverlayFieldAction(actionId, input)
    : resolveOverlayIdleAction(actionId, input);
}

/**
 * Resolves a global action while an overlay field owns focus.
 *
 * Esc always closes, `Ctrl+C` always quits, and every other action needs the text-input-safe
 * allowlist plus a primary modifier, so typing a plain letter never fires a global action from
 * inside a modal.
 *
 * @param actionId - Global action bound to the key.
 * @param input - Resolution inputs.
 * @returns The resolution, or `null` when the field keeps the key.
 */
function resolveOverlayFieldAction(
  actionId: string,
  input: HotkeyResolutionInput,
): HotkeyResolution | null {
  if (actionId === CLOSE_ACTION_ID) {
    return { actionId, scope: "global" };
  }

  if (actionId === QUIT_ACTION_ID) {
    return input.key.ctrl ? { actionId, scope: "global" } : null;
  }

  return isAllowedWhileTyping(actionId, input.key) ? { actionId, scope: "global" } : null;
}

/**
 * Resolves a global action while no overlay field owns focus.
 *
 * Only the overlay allowlist and the overlay's own toggle escape into the modal, so an unfocused
 * overlay never leaks an unrelated global action.
 *
 * @param actionId - Global action bound to the key.
 * @param input - Resolution inputs.
 * @returns The resolution, or `null` when the overlay keeps the key.
 */
function resolveOverlayIdleAction(
  actionId: string,
  input: HotkeyResolutionInput,
): HotkeyResolution | null {
  const allowed = OVERLAY_ALLOWED_ACTIONS.has(actionId) || actionId === input.overlayToggleActionId;

  return allowed ? { actionId, scope: "global" } : null;
}

/**
 * Resolves a key while an editor owns focus.
 *
 * Esc leaves the field, Tab and Shift+Tab move to the next or previous region for a single-line
 * input, and only the documented allowlist fires, and only when its effective binding carries a
 * primary modifier. A `search` field routes the documented navigation keys to its result list first.
 * Every other key stays with the editor.
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
