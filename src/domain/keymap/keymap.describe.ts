import { ACTION_BY_ID, isActionId } from "./keymap.defaults";
import { isFunctionKey, isLetterKey, isShiftSignificant, lookupBindingKey } from "./keymap.parse";
import type {
  KeymapContext,
  KeymapHint,
  KeymapHintOptions,
  ParsedBinding,
  ResolvedKeymap,
} from "./keymap.types";

/** Display labels for named keys. */
const NAMED_KEY_LABELS: ReadonlyMap<string, string> = new Map([
  ["enter", "Enter"],
  ["esc", "Esc"],
  ["tab", "Tab"],
  ["space", "Space"],
  ["backspace", "Backspace"],
  ["delete", "Delete"],
  ["insert", "Insert"],
  ["up", "Up"],
  ["down", "Down"],
  ["left", "Left"],
  ["right", "Right"],
  ["home", "Home"],
  ["end", "End"],
  ["pageup", "PageUp"],
  ["pagedown", "PageDown"],
]);

/**
 * Formats a binding for help, the footer, and warnings.
 *
 * A single-letter base key is uppercase whenever the binding carries any modifier, so
 * `ctrl+p`, `mod+p`, and `ctrl+c` render as `Ctrl+P`, `Cmd+P`, and `Ctrl+C`. Shift alone on a
 * letter keeps its existing form, the uppercase letter. Shift is omitted for digits and symbols
 * because lookup ignores it there, so the display names the chord a user can actually press.
 *
 * The result is display-only and is not valid input to `parseBinding` for modifier-plus-letter
 * chords: `formatBinding(parseBinding("ctrl+p"))` is `Ctrl+P`, while `parseBinding("Ctrl+P")`
 * means `ctrl+shift+p` because an uppercase letter implies Shift. A consumer that persists or
 * re-parses a chord needs a config-safe formatter instead.
 *
 * @param binding - The binding to format.
 * @returns A display string such as `Ctrl+Shift+P`.
 */
export function formatBinding(binding: ParsedBinding): string {
  const parts: string[] = [];

  if (binding.ctrl) {
    parts.push("Ctrl");
  }

  if (binding.shift && isShiftSignificant(binding.key) && !isShiftCarriedByLetter(binding)) {
    parts.push("Shift");
  }

  if (binding.alt) {
    parts.push("Alt");
  }

  if (binding.meta) {
    parts.push("Cmd");
  }

  parts.push(formatBaseKey(binding));

  return parts.join("+");
}

/**
 * Reports whether an uppercase letter already displays the Shift modifier.
 *
 * Shift plus a letter is rendered as the uppercase letter when no other modifier is present. With
 * another modifier, `Shift` stays explicit so `Ctrl+Shift+P` never reads as `Ctrl+P`.
 *
 * @param binding - The binding being formatted.
 * @returns `true` when the base letter carries the Shift meaning.
 */
function isShiftCarriedByLetter(binding: ParsedBinding): boolean {
  const hasOtherModifier = binding.ctrl || binding.alt || binding.meta;

  return !hasOtherModifier && isLetterKey(binding.key);
}

/**
 * Formats the base key of a binding.
 *
 * @param binding - The binding whose base key should be displayed.
 * @returns The display form of the base key.
 */
function formatBaseKey(binding: ParsedBinding): string {
  const named = NAMED_KEY_LABELS.get(binding.key);

  if (named !== undefined) {
    return named;
  }

  if (isFunctionKey(binding.key)) {
    return binding.key.toUpperCase();
  }

  if (hasModifier(binding) && isLetterKey(binding.key)) {
    return binding.key.toUpperCase();
  }

  return binding.key;
}

/**
 * Reports whether a binding carries any modifier.
 *
 * @param binding - The binding to inspect.
 * @returns `true` when Ctrl, Shift, Alt, or Cmd is held.
 */
function hasModifier(binding: ParsedBinding): boolean {
  return binding.ctrl || binding.shift || binding.alt || binding.meta;
}

/**
 * Derives footer-ready hints for one focus context.
 *
 * Context actions are listed before globals. A global action is dropped when the focused context
 * binds any of its effective keys to a different action, matching the precedence rule that a
 * context key shadows a global key. Direct region jumps never appear in the footer; Help and the
 * palette are their discovery surfaces. Hints are sorted by priority so a width-constrained footer
 * can drop the least important ones first.
 *
 * @param keymap - The resolved keymap.
 * @param context - Focused region, or `global` when no region owns focus.
 * @param options - Optional handler availability filter.
 * @returns Hints sorted from keep-first to drop-first.
 */
export function describeContextHints(
  keymap: ResolvedKeymap,
  context: KeymapContext,
  options: KeymapHintOptions = {},
): readonly KeymapHint[] {
  const contextMap = keymap.contexts.get(context) ?? new Map<string, string>();
  const globalMap = keymap.contexts.get("global") ?? new Map<string, string>();
  const hints: KeymapHint[] = [];
  const seen = new Set<string>();

  if (context !== "global") {
    for (const actionId of new Set(contextMap.values())) {
      addHint(hints, seen, keymap, actionId, context, options);
    }
  }

  for (const actionId of new Set(globalMap.values())) {
    if (context !== "global" && isShadowedByContext(keymap, actionId, contextMap)) {
      continue;
    }

    addHint(hints, seen, keymap, actionId, "global", options);
  }

  return hints.sort((left, right) => left.priority - right.priority);
}

/**
 * Adds one action to the hint list when it is displayable.
 *
 * @param hints - Result accumulator.
 * @param seen - Action ids already emitted.
 * @param keymap - The resolved keymap.
 * @param actionId - Candidate action id.
 * @param scope - Context that supplied the action.
 * @param options - Availability filter.
 */
function addHint(
  hints: KeymapHint[],
  seen: Set<string>,
  keymap: ResolvedKeymap,
  actionId: string,
  scope: KeymapContext,
  options: KeymapHintOptions,
): void {
  if (seen.has(actionId) || actionId.startsWith("focus.region.")) {
    return;
  }

  const definition = isActionId(actionId) ? ACTION_BY_ID[actionId] : undefined;
  const bindings = keymap.bindings.get(actionId) ?? [];

  if (!definition || bindings.length === 0) {
    return;
  }

  if (options.isAvailable && !options.isAvailable(actionId, scope)) {
    return;
  }

  seen.add(actionId);
  hints.push({
    actionId,
    label: definition.label,
    keys: bindings.map(formatBinding),
    priority: hintPriority(actionId, scope, definition.category),
  });
}

/**
 * Reports whether a context binding shadows any key of a global action.
 *
 * @param keymap - The resolved keymap.
 * @param actionId - Global action being considered.
 * @param contextMap - Key-to-action map of the focused context.
 * @returns True when the context owns at least one of the action's keys.
 */
function isShadowedByContext(
  keymap: ResolvedKeymap,
  actionId: string,
  contextMap: ReadonlyMap<string, string>,
): boolean {
  const bindings = keymap.bindings.get(actionId) ?? [];

  return bindings.some((binding) => {
    const mapped = contextMap.get(lookupBindingKey(binding));

    return mapped !== undefined && mapped !== actionId;
  });
}

/** Drop priorities for named global actions; lower values survive shrinking widths longer. */
const GLOBAL_HINT_PRIORITIES: Readonly<Record<string, number>> = Object.freeze({
  "app.help": 0,
  "app.quit": 2,
  "app.console": 3,
  "app.palette": 3,
  "app.refresh": 3,
  "focus.next": 4,
  "focus.previous": 4,
});

/**
 * Assigns a footer drop priority to an action.
 *
 * Help is kept longest, then context actions, quit, the common shell actions, focus traversal, and
 * finally ordinary globals and navigation. Lower values survive shrinking widths longer.
 *
 * @param actionId - Action being ranked.
 * @param scope - Context that supplied the action.
 * @param category - Catalogue category of the action.
 * @returns The numeric priority.
 */
function hintPriority(actionId: string, scope: KeymapContext, category: string): number {
  if (scope !== "global") {
    return 1;
  }

  return GLOBAL_HINT_PRIORITIES[actionId] ?? (category === "navigation" ? 6 : 5);
}
