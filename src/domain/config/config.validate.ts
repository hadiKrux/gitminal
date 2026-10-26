import { DEFAULT_CONFIG, DEFAULT_CONFIG_VERSION } from "./config.defaults";
import type {
  GitminalConfig,
  MainConfigRead,
  ValidateConfigInput,
  ValidatedConfigResult,
} from "./config.types";
import { CONFIG_GROUP_FIELDS, mergeFieldValues } from "./config.validate.fields";
import { isPlainObject } from "./config.validate.guards";
import { validateFileKeybindings } from "./config.validate.keybindings";

/** Fields whose values configure safety behavior; they are always reported and ignored. */
const SAFETY_FIELD_NAMES: ReadonlySet<string> = new Set([
  "safety",
  "disableConfirmations",
  "skipConfirmations",
  "alwaysNoVerify",
  "alwaysForce",
  "forcePushWarning",
  "credentialPrompt",
  "disableHooks",
  "skipHooks",
]);

/** Top-level field names of `config.json`; anything else is reported and ignored. */
const TOP_LEVEL_FIELDS: ReadonlySet<string> = new Set([
  "version",
  "git",
  "theme",
  "ui",
  "graph",
  "diff",
  "stash",
  "remote",
  "keybindings",
]);

/** Inputs with no file values, used as the default when the caller supplies nothing. */
const EMPTY_VALIDATE_INPUT: ValidateConfigInput = Object.freeze({
  rawConfig: null,
  rawKeybindings: null,
  rawTheme: null,
});

/**
 * Merges the built-in defaults with the optional configuration files.
 *
 * Merge order is defaults, `config.json`, then `keybindings.json` (keybindings only). Validation is
 * per field, so an invalid field keeps the base value and adds a warning while the valid fields
 * around it still apply. Unknown fields, unknown action IDs, and safety settings are reported and
 * never accepted. A missing `version` is treated as 1. A main file that is not an object, or whose
 * version is unsupported, applies no fields at all and reports `rejected`, so a reload can keep its
 * previous effective configuration intact.
 *
 * @param input - Raw file values, the main file's load status, and the fallback base.
 * @returns The effective merged configuration with its merge status and warnings.
 */
export function buildEffectiveConfig(
  input: ValidateConfigInput = EMPTY_VALIDATE_INPUT,
): ValidatedConfigResult {
  const warnings: string[] = [];
  const base = input.previousConfig ?? DEFAULT_CONFIG;
  const main = readMainConfigFile(input, warnings);
  const config =
    main.source === null ? base : mergeValidatedFields(main.source, main.version, base, warnings);

  return {
    status: main.status,
    config,
    keybindingsFile: validateFileKeybindings(input.rawKeybindings, warnings),
    themeFile: input.rawTheme ?? null,
    warnings,
  };
}

/**
 * Reads the main `config.json` as one unit.
 *
 * A missing file leaves the base configuration in place silently. A file the loader already reported
 * as failed is rejected, and a readable file must be an object with a supported schema version.
 *
 * @param input - Raw file value and its load status.
 * @param warnings - Warning accumulator.
 * @returns The merge status, the field source when usable, and the schema version.
 */
function readMainConfigFile(input: ValidateConfigInput, warnings: string[]): MainConfigRead {
  if (input.configFileStatus === "failed") {
    return rejectMainConfig(
      "config.json could not be read or parsed; the file was ignored.",
      warnings,
    );
  }

  if (input.rawConfig === null || input.rawConfig === undefined) {
    if (input.configFileStatus === "loaded") {
      return rejectMainConfig("config.json is not a JSON object; the file was ignored.", warnings);
    }

    return { status: "missing", source: null, version: DEFAULT_CONFIG_VERSION };
  }

  if (!isPlainObject(input.rawConfig)) {
    return rejectMainConfig("config.json is not a JSON object; the file was ignored.", warnings);
  }

  return readSchemaVersion(input.rawConfig, warnings);
}

/**
 * Reads the schema `version` of the main file.
 *
 * A missing version is treated as 1 per F-19 and keeps the file applied. A newer schema is ignored
 * with a warning that names the version, and any other value is an invalid version.
 *
 * @param source - Field source object.
 * @param warnings - Warning accumulator.
 * @returns The merge status, the field source when usable, and the schema version.
 */
function readSchemaVersion(source: Record<string, unknown>, warnings: string[]): MainConfigRead {
  const version = source["version"];

  if (version === undefined || version === DEFAULT_CONFIG_VERSION) {
    return { status: "applied", source, version: DEFAULT_CONFIG_VERSION };
  }

  if (
    typeof version === "number" &&
    Number.isInteger(version) &&
    version > DEFAULT_CONFIG_VERSION
  ) {
    return rejectMainConfig(
      `Unsupported version ${version} in config.json; the file was ignored.`,
      warnings,
    );
  }

  return rejectMainConfig("Invalid version in config.json; the file was ignored.", warnings);
}

/**
 * Rejects the main file as a whole.
 *
 * @param warning - Why the file was rejected.
 * @param warnings - Warning accumulator.
 * @returns A rejected result with no applied file.
 */
function rejectMainConfig(warning: string, warnings: string[]): MainConfigRead {
  warnings.push(warning);

  return { status: "rejected", source: null, version: DEFAULT_CONFIG_VERSION };
}

/**
 * Merges one validated file onto the base configuration and reports its unknown fields.
 *
 * @param source - Field source object.
 * @param version - Schema version read from the file.
 * @param base - Fallback configuration.
 * @param warnings - Warning accumulator.
 * @returns The merged configuration.
 */
function mergeValidatedFields(
  source: Record<string, unknown>,
  version: number,
  base: GitminalConfig,
  warnings: string[],
): GitminalConfig {
  collectUnknownFields(source, warnings);

  return mergeFieldValues(source, version, base, warnings);
}

/**
 * Collects the unknown fields of `config.json`, including safety settings.
 *
 * Safety fields are reported with their dedicated message so "no safety setting may ever be
 * accepted" is explicit in the warning surface; they stay unknown and ignored.
 *
 * @param source - Field source object.
 * @param warnings - Warning accumulator.
 */
function collectUnknownFields(source: Record<string, unknown>, warnings: string[]): void {
  for (const key of Object.keys(source)) {
    if (!TOP_LEVEL_FIELDS.has(key)) {
      warnings.push(readUnknownFieldMessage(key));
    }
  }

  for (const [group, fields] of Object.entries(CONFIG_GROUP_FIELDS)) {
    const container = source[group];

    if (!isPlainObject(container)) {
      continue;
    }

    for (const key of Object.keys(container)) {
      if (!fields.includes(key)) {
        warnings.push(readUnknownFieldMessage(`${group}.${key}`));
      }
    }
  }
}

/**
 * Builds the warning for one unknown field or safety key.
 *
 * @param fieldKey - Document path of the reported key.
 * @returns One single-line warning.
 */
function readUnknownFieldMessage(fieldKey: string): string {
  if (isSafetyField(fieldKey)) {
    return `Safety behavior cannot be configured; "${fieldKey}" in config.json was ignored.`;
  }

  return `Unknown field "${fieldKey}" in config.json; it was ignored.`;
}

/**
 * Reports whether a key names a safety behavior that configuration cannot change.
 *
 * Nested paths such as `git.path` are compared by their final key only, matching the intent that a
 * safety setting can never be accepted under any group.
 *
 * @param key - Candidate field name or document path.
 * @returns True when the key names a safety setting.
 */
function isSafetyField(key: string): boolean {
  const leafKey = key.split(".").at(-1) ?? "";

  return SAFETY_FIELD_NAMES.has(leafKey);
}
