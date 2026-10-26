import { isActionId } from "@/domain/keymap/keymap.defaults";
import type { BindingValue, KeybindingOverrides } from "@/domain/keymap/keymap.types";
import { isPlainObject } from "./config.validate.guards";

/** An empty, frozen override map shared by every silent outcome. */
const EMPTY_KEYBINDING_OVERRIDES: KeybindingOverrides = Object.freeze({});

/**
 * Validates the `keybindings` object of `config.json`.
 *
 * Only the shape of each entry is checked here. Key syntax and platform support belong to
 * `keymap.parse.ts`, which names the source layer when it rejects a binding. An unusable value keeps
 * the previous effective overrides, so the keymap resolver still applies what already worked.
 *
 * @param raw - Raw `keybindings` value from the file.
 * @param previous - Effective overrides from the previous configuration.
 * @param warnings - Warning accumulator.
 * @returns The validated override map.
 */
export function mergeConfigKeybindings(
  raw: unknown,
  previous: KeybindingOverrides,
  warnings: string[],
): KeybindingOverrides {
  if (raw === undefined) {
    return previous;
  }

  if (!isPlainObject(raw)) {
    warnings.push('"keybindings" in config.json must be an object; it was ignored.');

    return previous;
  }

  return validateBindingEntries(raw, "config.json", warnings);
}

/**
 * Validates `keybindings.json` as a whole file.
 *
 * The dedicated keybindings file is a direct action map, so it needs no wrapper. A file that is not
 * an object is ignored with a warning, leaving the `config.json` keybindings and the defaults
 * applied.
 *
 * @param raw - Raw parsed `keybindings.json`.
 * @param warnings - Warning accumulator.
 * @returns The validated override map.
 */
export function validateFileKeybindings(raw: unknown, warnings: string[]): KeybindingOverrides {
  if (raw === null || raw === undefined) {
    return EMPTY_KEYBINDING_OVERRIDES;
  }

  if (!isPlainObject(raw)) {
    warnings.push("keybindings.json must be a JSON object; it was ignored.");

    return EMPTY_KEYBINDING_OVERRIDES;
  }

  return validateBindingEntries(raw, "keybindings.json", warnings);
}

/**
 * Validates one binding map of action IDs to accepted values.
 *
 * Unknown action IDs are reported and removed so the keymap resolver never re-reports the same
 * entry. Internal command IDs such as `graph.selectCommit` are not action IDs, so they are reported
 * here instead of silently binding.
 *
 * @param raw - Field source object.
 * @param sourceName - File name used in warnings.
 * @param warnings - Warning accumulator.
 * @returns The validated overrides, containing only known action IDs with accepted shapes.
 */
function validateBindingEntries(
  raw: Record<string, unknown>,
  sourceName: string,
  warnings: string[],
): KeybindingOverrides {
  const overrides: Record<string, BindingValue> = {};

  for (const [actionId, binding] of Object.entries(raw)) {
    if (!isActionId(actionId)) {
      warnings.push(`Unknown action ID "${actionId}" in ${sourceName}; it was ignored.`);

      continue;
    }

    if (!isAcceptedBindingShape(binding)) {
      warnings.push(
        `Invalid binding value for action "${actionId}" in ${sourceName}; the previous binding was kept.`,
      );

      continue;
    }

    overrides[actionId] = binding;
  }

  return Object.freeze(overrides);
}

/**
 * Reports whether a binding value has one of the accepted shapes.
 *
 * A binding is a string, `null` to reset, or an array of strings that replaces the list.
 *
 * @param value - Raw binding value.
 * @returns True when the value shape is accepted.
 */
function isAcceptedBindingShape(value: unknown): value is string | readonly string[] | null {
  return (
    typeof value === "string" ||
    value === null ||
    (Array.isArray(value) && value.every((entry) => typeof entry === "string"))
  );
}
