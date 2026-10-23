import { isFunctionKey, isLetterKey, isShiftSignificant } from "./keymap.parse";
import type { ParsedBinding } from "./keymap.types";

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
