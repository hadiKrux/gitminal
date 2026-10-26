import type { GitminalConfig } from "./config.types";
import {
  isBooleanValue,
  isContextLines,
  isFetchScope,
  isGraphScope,
  isNonEmptyString,
  isPageSize,
  isPlainObject,
  isStringValue,
} from "./config.validate.guards";
import { mergeConfigKeybindings } from "./config.validate.keybindings";

/** Key of every nested scalar group; any other key inside a group is reported and ignored. */
export const CONFIG_GROUP_FIELDS: Readonly<
  Record<Exclude<keyof GitminalConfig, "version" | "theme" | "keybindings">, readonly string[]>
> = Object.freeze({
  git: Object.freeze(["path"]),
  ui: Object.freeze(["mouse"]),
  graph: Object.freeze(["scope", "initialPageSize"]),
  diff: Object.freeze(["contextLines", "expandFirstWorkingFile"]),
  stash: Object.freeze(["includeUntrackedByDefault"]),
  remote: Object.freeze(["fetchScope"]),
});

/**
 * Merges every field of `config.json` onto a base configuration.
 *
 * Each field validates on its own, so a valid field applies while an invalid neighbour keeps the
 * base value and adds a warning. The base is the built-in configuration at startup and the previous
 * effective configuration on a reload, which is what makes "an invalid field keeps the previous
 * effective value" hold across reloads.
 *
 * @param source - Field source object.
 * @param version - Schema version read from the file.
 * @param base - Configuration used as the fallback for every field.
 * @param warnings - Warning accumulator.
 * @returns The merged configuration.
 */
export function mergeFieldValues(
  source: Record<string, unknown>,
  version: number,
  base: GitminalConfig,
  warnings: string[],
): GitminalConfig {
  return {
    version,
    git: {
      path: readScalarField(source, "git", "git.path", isNonEmptyString, base.git.path, warnings),
    },
    theme: readScalarField(source, null, "theme", isStringValue, base.theme, warnings),
    ui: {
      mouse: readScalarField(source, "ui", "ui.mouse", isBooleanValue, base.ui.mouse, warnings),
    },
    graph: {
      scope: readScalarField(
        source,
        "graph",
        "graph.scope",
        isGraphScope,
        base.graph.scope,
        warnings,
      ),
      initialPageSize: readScalarField(
        source,
        "graph",
        "graph.initialPageSize",
        isPageSize,
        base.graph.initialPageSize,
        warnings,
      ),
    },
    diff: {
      contextLines: readScalarField(
        source,
        "diff",
        "diff.contextLines",
        isContextLines,
        base.diff.contextLines,
        warnings,
      ),
      expandFirstWorkingFile: readScalarField(
        source,
        "diff",
        "diff.expandFirstWorkingFile",
        isBooleanValue,
        base.diff.expandFirstWorkingFile,
        warnings,
      ),
    },
    stash: {
      includeUntrackedByDefault: readScalarField(
        source,
        "stash",
        "stash.includeUntrackedByDefault",
        isBooleanValue,
        base.stash.includeUntrackedByDefault,
        warnings,
      ),
    },
    remote: {
      fetchScope: readScalarField(
        source,
        "remote",
        "remote.fetchScope",
        isFetchScope,
        base.remote.fetchScope,
        warnings,
      ),
    },
    keybindings: mergeConfigKeybindings(source["keybindings"], base.keybindings, warnings),
  };
}

/**
 * Reads one scalar field from an optional group or from the file root.
 *
 * @param source - Field source object.
 * @param group - Group name, or `null` for a root field such as `theme`.
 * @param key - Document path used in warnings, for example `graph.scope`.
 * @param guard - Accepts valid values for the field.
 * @param fallback - The value to keep when the field is missing or invalid.
 * @param warnings - Warning accumulator.
 * @returns The validated value, or the fallback.
 */
function readScalarField<T>(
  source: Record<string, unknown>,
  group: string | null,
  key: string,
  guard: (value: unknown) => boolean,
  fallback: T,
  warnings: string[],
): T {
  const container = group === null ? source : readGroupObject(source, group, warnings);
  const value = container?.[readLeafKey(key)];

  if (value === undefined) {
    return fallback;
  }

  if (!guard(value)) {
    warnings.push(`Invalid value for "${key}" in config.json; the previous value was kept.`);

    return fallback;
  }

  return value as T;
}

/**
 * Reads the leaf key of a document path.
 *
 * The warning names the full path (`ui.mouse`), while the value lives under the leaf key (`mouse`)
 * inside its group object.
 *
 * @param key - Document path of the field.
 * @returns The final path segment.
 */
function readLeafKey(key: string): string {
  return key.split(".").at(-1) ?? key;
}

/**
 * Reads one optional group object.
 *
 * A group whose value is not an object is reported and ignored, so every field inside it keeps its
 * fallback rather than half-applying.
 *
 * @param source - Field source object.
 * @param name - Group name, for example `git`.
 * @param warnings - Warning accumulator.
 * @returns The group object, or `null` when it is absent or unusable.
 */
function readGroupObject(
  source: Record<string, unknown>,
  name: string,
  warnings: string[],
): Record<string, unknown> | null {
  const value = source[name];

  if (value === undefined) {
    return null;
  }

  if (!isPlainObject(value)) {
    warnings.push(`Group "${name}" in config.json must be a JSON object; it was ignored.`);

    return null;
  }

  return value;
}
