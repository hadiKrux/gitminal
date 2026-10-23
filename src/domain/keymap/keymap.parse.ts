/**
 * Binding parsing, canonical identity, and event matching.
 *
 * These three concerns stay together until the M3 dispatcher lands: parsing produces the canonical
 * token, `lookupBindingKey` decides which tokens collide in a context, and
 * `readKeyEvent`/`matchesBinding` compare a live event against that same token. Display formatting
 * is a read-only projection used by help, footer hints, and warnings, so it lives in
 * `keymap.describe.ts`.
 */
import type { KeyEventLike, KeymapPlatform, ParsedBinding } from "./keymap.types";

/** Canonical names accepted before the `+` base-key separator. */
const MODIFIER_ALIASES: ReadonlyMap<string, "ctrl" | "shift" | "alt" | "meta" | "mod"> = new Map([
  ["ctrl", "ctrl"],
  ["control", "ctrl"],
  ["shift", "shift"],
  ["alt", "alt"],
  ["option", "alt"],
  ["cmd", "meta"],
  ["command", "meta"],
  ["meta", "meta"],
  ["mod", "mod"],
]);

/** Named keys accepted in binding strings. */
const NAMED_KEYS: ReadonlySet<string> = new Set([
  "enter",
  "esc",
  "tab",
  "space",
  "backspace",
  "delete",
  "insert",
  "up",
  "down",
  "left",
  "right",
  "home",
  "end",
  "pageup",
  "pagedown",
]);

/** Terminal and configuration aliases for a canonical named key. */
const BASE_KEY_ALIASES: ReadonlyMap<string, string> = new Map([
  ["escape", "esc"],
  ["return", "enter"],
  ["linefeed", "enter"],
  ["backtick", "`"],
]);

/** Matches function keys f1 through f12. */
const FUNCTION_KEY_PATTERN = /^f(?:[1-9]|1[0-2])$/;

/** Matches a single lowercase letter. */
const LOWERCASE_LETTER_PATTERN = /^[a-z]$/;

/**
 * Detects the keymap platform from a Node or Bun platform string.
 *
 * @param platform - The process platform, normally `process.platform`.
 * @returns The keymap platform used to expand `mod`.
 */
export function detectKeymapPlatform(platform: string = process.platform): KeymapPlatform {
  if (platform === "darwin") {
    return "macos";
  }

  if (platform === "win32") {
    return "windows";
  }

  return "linux";
}

/**
 * Parses one binding string into a normalized key token.
 *
 * Modifier order is irrelevant, aliases are accepted, and an uppercase letter is normalized to
 * Shift plus the lowercase letter. `mod` expands to Command on macOS and Control elsewhere.
 * Unsupported modifiers, unsupported named keys, and empty segments return `null` so the caller
 * can keep the previous effective binding.
 *
 * A literal space is written as the named key `space`, because every segment is trimmed and an
 * empty segment is invalid. `+` is the modifier separator, so a plus key cannot be expressed as a
 * binding value.
 *
 * @param value - A binding such as `ctrl+p`, `shift+tab`, or `cmd+enter`.
 * @param platform - Platform used to expand `mod`.
 * @returns The normalized binding, or `null` when the value is invalid.
 */
export function parseBinding(
  value: string,
  platform: KeymapPlatform = detectKeymapPlatform(),
): ParsedBinding | null {
  const parts = value.split("+").map((part) => part.trim());

  if (parts.length === 0 || parts.some((part) => part.length === 0)) {
    return null;
  }

  const baseText = parts.pop();

  if (baseText === undefined) {
    return null;
  }

  const modifiers = readModifiers(parts, platform);
  const base = readBaseKey(baseText);

  if (modifiers === null || base === null) {
    return null;
  }

  return {
    key: base.key,
    ctrl: modifiers.ctrl,
    shift: modifiers.shift || base.shift,
    alt: modifiers.alt,
    meta: modifiers.meta,
  };
}

/**
 * Parses a list of binding strings and keeps only valid, unique bindings.
 *
 * @param values - Binding strings for one action.
 * @param platform - Platform used to expand `mod`.
 * @returns The parsed bindings plus the invalid values that were ignored.
 */
export function parseBindingValues(
  values: readonly string[],
  platform: KeymapPlatform = detectKeymapPlatform(),
): { bindings: readonly ParsedBinding[]; invalid: readonly string[] } {
  const bindings: ParsedBinding[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    const parsed = parseBinding(value, platform);

    if (parsed === null) {
      invalid.push(value);
      continue;
    }

    const key = lookupBindingKey(parsed);

    if (!seen.has(key)) {
      seen.add(key);
      bindings.push(parsed);
    }
  }

  return { bindings, invalid };
}

/**
 * Builds the full canonical identifier for a binding.
 *
 * @param binding - The binding to identify.
 * @returns A stable identifier such as `ctrl+shift+p`.
 */
export function bindingKey(binding: ParsedBinding): string {
  const modifiers: string[] = [];

  if (binding.ctrl) {
    modifiers.push("ctrl");
  }

  if (binding.shift) {
    modifiers.push("shift");
  }

  if (binding.alt) {
    modifiers.push("alt");
  }

  if (binding.meta) {
    modifiers.push("meta");
  }

  return [...modifiers, binding.key].join("+");
}

/**
 * Builds the lookup identifier used by resolved context maps.
 *
 * Shift is irrelevant for digits and symbols because the terminal already reports the shifted
 * character. Removing it keeps `?` and `Shift+?` on the same lookup key.
 *
 * @param binding - The binding to identify.
 * @returns A stable lookup identifier.
 */
export function lookupBindingKey(binding: ParsedBinding): string {
  const normalized = isShiftSignificant(binding.key) ? binding : { ...binding, shift: false };

  return bindingKey(normalized);
}

/**
 * Normalizes a key event into the same token shape as a parsed binding.
 *
 * This is the only event-to-binding conversion in the app. Features never inspect key events; the
 * dispatcher compares this token with resolved bindings from the keymap.
 *
 * @param event - The key event reported by the terminal.
 * @returns The normalized event binding.
 */
export function readKeyEvent(event: KeyEventLike): ParsedBinding {
  const rawName = event.name.length > 0 ? event.name : event.sequence;
  const base = readBaseKey(rawName);

  return {
    key: base?.key ?? rawName.toLowerCase(),
    ctrl: event.ctrl,
    shift: event.shift || (base?.shift ?? false),
    alt: event.option,
    meta: event.meta || event.super === true,
  };
}

/**
 * Reports whether a key event matches one binding.
 *
 * Shift is compared for letters and named keys, and ignored for symbols and digits because the
 * terminal reports the shifted character as the base name.
 *
 * @param binding - The resolved binding.
 * @param event - The key event to compare.
 * @returns `true` when every relevant modifier and the base key match.
 */
export function matchesBinding(binding: ParsedBinding, event: KeyEventLike): boolean {
  const eventBinding = readKeyEvent(event);

  if (
    binding.key !== eventBinding.key ||
    binding.ctrl !== eventBinding.ctrl ||
    binding.alt !== eventBinding.alt ||
    binding.meta !== eventBinding.meta
  ) {
    return false;
  }

  if (!isShiftSignificant(binding.key)) {
    return true;
  }

  return binding.shift === eventBinding.shift;
}

/**
 * Reads and validates the modifier segments of a binding.
 *
 * @param parts - Modifier segments before the base key.
 * @param platform - Platform used to expand `mod`.
 * @returns The modifier flags, or `null` for an unsupported modifier.
 */
function readModifiers(
  parts: readonly string[],
  platform: KeymapPlatform,
): Omit<ParsedBinding, "key"> | null {
  const modifiers = { ctrl: false, shift: false, alt: false, meta: false };

  for (const part of parts) {
    const modifier = MODIFIER_ALIASES.get(part.toLowerCase());

    if (modifier === undefined) {
      return null;
    }

    if (modifier === "mod") {
      if (platform === "macos") {
        modifiers.meta = true;
      } else {
        modifiers.ctrl = true;
      }

      continue;
    }

    modifiers[modifier] = true;
  }

  return modifiers;
}

/**
 * Normalizes one base-key segment.
 *
 * @param value - The segment after the last `+`.
 * @returns The canonical key and whether the value itself implies Shift, or `null` when invalid.
 */
function readBaseKey(value: string): { key: string; shift: boolean } | null {
  return value.length === 1 ? readPrintableKey(value) : readNamedKey(value);
}

/**
 * Normalizes a single printable character.
 *
 * @param value - One-character base-key segment.
 * @returns The canonical key and implied Shift, or `null` when the character is not printable.
 */
function readPrintableKey(value: string): { key: string; shift: boolean } | null {
  if (value >= "A" && value <= "Z") {
    return { key: value.toLowerCase(), shift: true };
  }

  if (isPrintableAscii(value)) {
    return { key: value, shift: false };
  }

  return null;
}

/**
 * Reports whether a character is printable ASCII.
 *
 * @param value - One-character value.
 * @returns `true` for space through tilde.
 */
function isPrintableAscii(value: string): boolean {
  const code = value.charCodeAt(0);

  return code >= 32 && code <= 126;
}

/**
 * Normalizes a multi-character named key or alias.
 *
 * @param value - Base-key segment longer than one character.
 * @returns The canonical key without Shift, or `null` when the name is unknown.
 */
function readNamedKey(value: string): { key: string; shift: boolean } | null {
  const lower = value.toLowerCase();
  const alias = BASE_KEY_ALIASES.get(lower);

  if (alias !== undefined) {
    return { key: alias, shift: false };
  }

  if (NAMED_KEYS.has(lower) || FUNCTION_KEY_PATTERN.test(lower)) {
    return { key: lower, shift: false };
  }

  return null;
}

/**
 * Reports whether a key is a single lowercase letter.
 *
 * @param key - The canonical base key.
 * @returns `true` for `a` through `z`.
 */
export function isLetterKey(key: string): boolean {
  return LOWERCASE_LETTER_PATTERN.test(key);
}

/**
 * Reports whether a key is a function key from F1 through F12.
 *
 * @param key - The canonical base key.
 * @returns `true` for `f1` through `f12`.
 */
export function isFunctionKey(key: string): boolean {
  return FUNCTION_KEY_PATTERN.test(key);
}

/**
 * Reports whether Shift changes the meaning of a key.
 *
 * Letters and named keys distinguish Shift; digits and symbols do not, because the terminal
 * reports the shifted character as the base key. Display formatting and lookup both use this
 * predicate so a chord is rendered with the same modifiers that identify it.
 *
 * @param key - The canonical base key.
 * @returns `true` for letters and named keys.
 */
export function isShiftSignificant(key: string): boolean {
  return key.length > 1 || isLetterKey(key);
}
