import { collectUnboundWarnings, formatConflictWarning, settleConflicts } from "./keymap.conflicts";
import {
  ACTION_CATALOGUE,
  type ActionId,
  HARDCODED_QUIT_BINDING,
  isActionId,
  KEYMAP_CONTEXTS,
  readDefaultBindings,
} from "./keymap.defaults";
import { formatBinding } from "./keymap.describe";
import {
  detectKeymapPlatform,
  lookupBindingKey,
  parseBinding,
  parseBindingValues,
} from "./keymap.parse";
import type {
  KeybindingOverrides,
  KeymapContext,
  KeymapPlatform,
  ParsedBinding,
  ResolvedKeymap,
  ResolveKeymapOptions,
} from "./keymap.types";

/**
 * Resolves the effective keymap from built-in defaults and optional override layers.
 *
 * Override layers apply in order, so `keybindings.json` wins over `config.json` for the same
 * action. A string or array replaces the whole binding list, `null` restores the built-in default,
 * and `[]` unbinds the action. Invalid bindings are reported and ignored, keeping the previous
 * effective value. Collisions are settled by `keymap.conflicts.ts`, which rejects the conflicting
 * overrides and keeps the built-in defaults, so a bad configuration never makes the app unusable.
 * The hardcoded quit chord is injected last and cannot be rebound.
 *
 * @param options - Override layers and the platform used to expand `mod`.
 * @returns The resolved action and context projections with warnings.
 */
export function resolveKeymap(options: ResolveKeymapOptions = {}): ResolvedKeymap {
  const platform = options.platform ?? detectKeymapPlatform();
  const warnings: string[] = [];
  const overridden = new Set<ActionId>();
  const bindings = createDefaultBindingMap(platform);

  applyOverrideLayer(bindings, options.config, "config.json", platform, warnings, overridden);
  applyOverrideLayer(
    bindings,
    options.keybindings,
    "keybindings.json",
    platform,
    warnings,
    overridden,
  );

  const settled = settleConflicts(bindings, overridden, platform);

  warnings.push(...settled.warnings);

  for (const conflict of settled.conflicts) {
    const message = formatConflictWarning(conflict);

    if (!warnings.includes(message)) {
      warnings.push(message);
    }
  }

  const contexts = withHardcodedQuit(settled.contexts, platform, warnings);

  warnings.push(...collectUnboundWarnings(bindings, contexts));

  return {
    platform,
    bindings,
    contexts,
    conflicts: settled.conflicts,
    warnings,
  };
}

/**
 * Builds the initial action-to-bindings map from the catalogue defaults.
 *
 * @param platform - Platform used to expand `mod`.
 * @returns A mutable copy of every action's default bindings.
 */
function createDefaultBindingMap(
  platform: KeymapPlatform,
): Map<ActionId, readonly ParsedBinding[]> {
  return new Map(
    ACTION_CATALOGUE.map((action) => [action.id, readDefaultBindings(action.id, platform)]),
  );
}

/**
 * Applies one override layer on top of the current effective bindings.
 *
 * @param bindings - The mutable effective binding map.
 * @param overrides - The override layer, when present.
 * @param source - File name used in warnings.
 * @param platform - Platform used to expand `mod`.
 * @param warnings - Warning accumulator.
 * @param overridden - Action IDs touched by any override layer.
 */
function applyOverrideLayer(
  bindings: Map<ActionId, readonly ParsedBinding[]>,
  overrides: KeybindingOverrides | undefined,
  source: string,
  platform: KeymapPlatform,
  warnings: string[],
  overridden: Set<ActionId>,
): void {
  if (!overrides) {
    return;
  }

  for (const [actionId, value] of Object.entries(overrides)) {
    if (!isActionId(actionId)) {
      warnings.push(`Unknown action ID "${actionId}" in ${source}; it was ignored.`);
      continue;
    }

    overridden.add(actionId);

    if (value === null) {
      bindings.set(actionId, readDefaultBindings(actionId, platform));
      continue;
    }

    const values = readBindingValues(value);

    if (values === null) {
      warnings.push(`Invalid binding value for action "${actionId}" in ${source}; it was ignored.`);
      continue;
    }

    const parsed = parseBindingValues(values, platform);

    if (parsed.invalid.length > 0) {
      warnings.push(
        `Invalid binding "${parsed.invalid[0]}" for action "${actionId}" in ${source}; the previous binding was kept.`,
      );
      continue;
    }

    bindings.set(actionId, parsed.bindings);
  }
}

/**
 * Normalizes an override value into the list of strings to parse.
 *
 * @param value - A string, an array of strings, or an unsupported JSON value.
 * @returns The binding strings, or `null` when the value shape is invalid.
 */
function readBindingValues(value: unknown): readonly string[] | null {
  if (typeof value === "string") {
    return [value];
  }

  if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) {
    return value;
  }

  return null;
}

/**
 * Injects the hardcoded quit chord into every context.
 *
 * @param contexts - The settled context maps.
 * @param platform - Platform used to parse the quit chord.
 * @param warnings - Warning accumulator for bindings displaced by the reserved chord.
 * @returns The context maps with the hardcoded quit chord applied.
 */
function withHardcodedQuit(
  contexts: ReadonlyMap<KeymapContext, ReadonlyMap<string, string>>,
  platform: KeymapPlatform,
  warnings: string[],
): ReadonlyMap<KeymapContext, ReadonlyMap<string, string>> {
  const quit = parseBinding(HARDCODED_QUIT_BINDING, platform);

  if (quit === null) {
    return contexts;
  }

  const quitKey = lookupBindingKey(quit);
  const result = new Map<KeymapContext, ReadonlyMap<string, string>>();

  for (const context of KEYMAP_CONTEXTS) {
    const source = contexts.get(context) ?? new Map<string, string>();
    const target = new Map(source);
    const displaced = target.get(quitKey);

    if (displaced !== undefined && displaced !== "app.quit") {
      warnings.push(
        `Key "${formatBinding(quit)}" is reserved for "app.quit"; "${displaced}" in context "${context}" was ignored.`,
      );
    }

    target.set(quitKey, "app.quit");
    result.set(context, target);
  }

  return result;
}
