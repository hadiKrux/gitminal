import type {
  ConfigSnapshot,
  ConfigSource,
  ConfigSourceOptions,
} from "@/app/providers/ConfigProvider.types";
import { DEFAULT_CONFIG, UNRESOLVED_CONFIG_PATHS } from "@/domain/config/config.defaults";
import { loadConfigFiles } from "@/domain/config/config.loader";
import { resolveConfigPaths } from "@/domain/config/config.paths";
import type {
  ConfigFileKey,
  ConfigFileLoad,
  ConfigFileLoadStatus,
  ConfigFilePaths,
  GitminalConfig,
  LoadedConfigFiles,
} from "@/domain/config/config.types";
import { buildEffectiveConfig } from "@/domain/config/config.validate";
import { boundConfigWarnings } from "@/domain/config/config.warnings";

/** The configuration state used before any file is read. */
export const DEFAULT_CONFIG_SNAPSHOT: ConfigSnapshot = Object.freeze({
  status: "missing",
  config: DEFAULT_CONFIG,
  paths: UNRESOLVED_CONFIG_PATHS,
  files: Object.freeze([]),
  warnings: Object.freeze([]),
  keybindingsFile: Object.freeze({}),
  themeOverrides: null,
});

/**
 * Creates the filesystem-backed configuration source.
 *
 * Paths resolve once, at launch, because configuration files are read at startup and on explicit
 * reload only; they are never watched. The returned `load` never rejects, so a reload can always
 * report a result instead of breaking the shell.
 *
 * @param options - Environment, platform, home directory, and loader override.
 * @returns The source the composition root passes to `ConfigProvider`.
 */
export function createConfigSource(options: ConfigSourceOptions = {}): ConfigSource {
  const paths = resolveConfigPaths(options);
  const loadFiles = options.loadFiles ?? loadConfigFiles;

  return {
    paths,
    /**
     * Reads the three files and merges them onto the previous effective configuration.
     *
     * @param previous - Effective configuration from the previous snapshot.
     * @returns The resolved snapshot.
     */
    load: async (previous?: GitminalConfig): Promise<ConfigSnapshot> => {
      const loaded = await loadFiles(paths);

      return buildConfigSnapshot(loaded, paths, previous);
    },
  };
}

/**
 * Builds one snapshot from loaded files.
 *
 * Loader warnings and validation warnings are collected in that order, bounded, and stored with the
 * validated configuration so the provider never recomputes them.
 *
 * @param loaded - Raw file read outcomes.
 * @param paths - Paths the read used.
 * @param previous - Effective configuration from the previous snapshot, when reloading.
 * @returns The resolved snapshot.
 */
function buildConfigSnapshot(
  loaded: LoadedConfigFiles,
  paths: ConfigFilePaths,
  previous?: GitminalConfig,
): ConfigSnapshot {
  const validated = buildEffectiveConfig({
    rawConfig: readFileValue(loaded.files, "config"),
    rawKeybindings: readFileValue(loaded.files, "keybindings"),
    rawTheme: readFileValue(loaded.files, "theme"),
    configFileStatus: readFileStatus(loaded.files, "config"),
    previousConfig: previous,
  });

  return {
    status: validated.status,
    config: validated.config,
    paths,
    files: loaded.files,
    warnings: boundConfigWarnings([...loaded.warnings, ...validated.warnings]),
    keybindingsFile: validated.keybindingsFile,
    themeOverrides: validated.themeFile,
  };
}

/**
 * Reads the raw value of one loaded file.
 *
 * @param files - Per-file load outcomes.
 * @param key - File key to read.
 * @returns The parsed value, or `null` when the file is missing or unusable.
 */
function readFileValue(files: readonly ConfigFileLoad[], key: ConfigFileKey): unknown {
  return files.find((file) => file.key === key)?.value ?? null;
}

/**
 * Reads the load status of one file.
 *
 * @param files - Per-file load outcomes.
 * @param key - File key to read.
 * @returns The status, or `undefined` when the loader did not report the file.
 */
function readFileStatus(
  files: readonly ConfigFileLoad[],
  key: ConfigFileKey,
): ConfigFileLoadStatus | undefined {
  return files.find((file) => file.key === key)?.status;
}
