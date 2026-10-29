import type { KeybindingOverrides, KeymapPlatform } from "@/domain/keymap/keymap.types";

/** Commit graph scope accepted by `config.json`. */
export type GraphScope = "all" | "local" | "current";

/** Upstream scope for Fetch --prune accepted by `config.json`. */
export type RemoteFetchScope = "local" | "current";

/**
 * Commit graph glyph style accepted by `config.json`.
 *
 * `rounded` is the lazygit-style arc corner set. `sharp` uses the WGL4 and CP437 safe sharp corner
 * set, a `+` merge symbol, and no half-line characters, for terminals or fonts with partial box
 * drawing coverage.
 */
export type GraphStyle = "rounded" | "sharp";

/** The effective application configuration. */
export interface GitminalConfig {
  /** Configuration schema version. */
  readonly version: number;
  /** Git executable settings. */
  readonly git: {
    /** Git executable executed directly without a shell. */
    readonly path: string;
  };
  /** Built-in base theme name. Unknown names fall back to Mocha with a warning. */
  readonly theme: string;
  /** UI behavior settings. */
  readonly ui: {
    /** Whether mouse reporting is enabled. */
    readonly mouse: boolean;
  };
  /** Commit graph settings. */
  readonly graph: {
    /** Commit graph scope. */
    readonly scope: GraphScope;
    /** Initial and per-page commit count. */
    readonly initialPageSize: number;
    /** Glyph style of the commit graph lanes. */
    readonly style: GraphStyle;
  };
  /** Diff settings. */
  readonly diff: {
    /** Context lines shown around each diff hunk. */
    readonly contextLines: number;
    /** Whether the first working directory file diff is expanded. */
    readonly expandFirstWorkingFile: boolean;
  };
  /** Stash settings. */
  readonly stash: {
    /** Initial state of the include-untracked checkbox. */
    readonly includeUntrackedByDefault: boolean;
  };
  /** Remote settings. */
  readonly remote: {
    /** Upstream scope used only by `remote.fetchPrune`; ordinary fetch always uses a named remote. */
    readonly fetchScope: RemoteFetchScope;
  };
  /** Action ID to binding overrides from the main configuration file. */
  readonly keybindings: KeybindingOverrides;
}

/** Resolved locations of the three optional configuration files. */
export interface ConfigFilePaths {
  /** Resolved `config.json` path, or `null` when no location could be resolved. */
  readonly config: string | null;
  /** Resolved `keybindings.json` path, or `null` when no location could be resolved. */
  readonly keybindings: string | null;
  /** Resolved `theme.json` path, or `null` when no location could be resolved. */
  readonly theme: string | null;
}

/** The three optional configuration files the loader can read. */
export type ConfigFileKey = "config" | "keybindings" | "theme";

/** Outcome of reading one optional configuration file. */
export type ConfigFileLoadStatus = "loaded" | "missing" | "failed";

/** One file load outcome: raw parsed value plus the read status. */
export interface ConfigFileLoad {
  /** The file key this outcome belongs to. */
  readonly key: ConfigFileKey;
  /** Read status; a missing file is expected and silent. */
  readonly status: ConfigFileLoadStatus;
  /** Raw parsed JSON value, or `null` when the file is missing or unusable. */
  readonly value: unknown;
  /** Path that was attempted, or `null` when no path could be resolved. */
  readonly path: string | null;
}

/** Raw read result for the three optional configuration files. */
export interface LoadedConfigFiles {
  /** One load outcome per file, in `config`, `keybindings`, `theme` order. */
  readonly files: readonly ConfigFileLoad[];
  /** Non-blocking warnings; a missing file never warns. */
  readonly warnings: readonly string[];
}

/** One file read outcome paired with the warning it produced, if any. */
export interface ConfigFileRead {
  /** The load outcome stored in the snapshot. */
  readonly file: ConfigFileLoad;
  /** Warning text when the file failed, otherwise `null`. */
  readonly reason: string | null;
}

/** Inputs for file path resolution; defaults use the real environment. */
export interface ResolveConfigPathsOptions {
  /** Environment variables read for overrides and directories. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Platform family used to decide the Windows fallback; defaults to the process platform. */
  readonly platform?: KeymapPlatform;
  /** Home directory; defaults to `os.homedir()` when omitted. */
  readonly homeDir?: string;
  /**
   * Launch working directory used to resolve a relative explicit override; defaults to
   * `process.cwd()` when omitted.
   */
  readonly cwd?: string;
}

/** Reads one file as text; injectable so tests can avoid the filesystem. */
export type ConfigFileReader = (path: string) => Promise<string>;

/** Options accepted by the configuration file loader. */
export interface LoadConfigFilesOptions {
  /** Reader override used by tests; defaults to `fs/promises`. */
  readonly readFile?: ConfigFileReader;
}

/**
 * Merge outcome of the main `config.json`.
 *
 * `applied` means the file contributed its valid fields, `missing` means there was no file to
 * apply, and `rejected` means the file was ignored as a whole so a reload keeps the previous
 * effective configuration.
 */
export type ConfigValidationStatus = "applied" | "missing" | "rejected";

/** Result of merging defaults with the configuration files. */
export interface ValidatedConfigResult {
  /** Merge outcome of the main `config.json`. */
  readonly status: ConfigValidationStatus;
  /** The effective configuration, built from the base value plus the applied files. */
  readonly config: GitminalConfig;
  /** Overrides from `keybindings.json` only; per-action validation already ran. */
  readonly keybindingsFile: KeybindingOverrides;
  /** Raw parsed `theme.json`, or `null` when it is missing or unusable. */
  readonly themeFile: unknown;
  /** Non-blocking warnings produced while merging and validating. */
  readonly warnings: readonly string[];
}

/** One read of the main `config.json`: its merge status, field source, and schema version. */
export interface MainConfigRead {
  /** Merge outcome of the file. */
  readonly status: ConfigValidationStatus;
  /** Field source when the file applies, otherwise `null`. */
  readonly source: Record<string, unknown> | null;
  /** Schema version carried into the effective configuration. */
  readonly version: number;
}

/** Inputs accepted by the validation merge. */
export interface ValidateConfigInput {
  /** Raw parsed `config.json`, or `null` when it is missing or unusable. */
  readonly rawConfig: unknown;
  /** Raw parsed `keybindings.json`, or `null` when it is missing or unusable. */
  readonly rawKeybindings: unknown;
  /** Raw parsed `theme.json`, or `null` when it is missing or unusable. */
  readonly rawTheme: unknown;
  /** Load status of the main `config.json`, used to classify and reject an unreadable file. */
  readonly configFileStatus?: ConfigFileLoadStatus;
  /**
   * Previous effective configuration used as the fallback base.
   *
   * A reload passes the configuration it already applied, so an invalid field keeps the value the
   * session is running with instead of reverting to a built-in default.
   */
  readonly previousConfig?: GitminalConfig;
}

/** Result of persisting the selected theme to `config.json`. */
export interface ThemeWriteResult {
  /** True when the file was written successfully. */
  readonly ok: boolean;
  /** Human-readable reason when the write failed; it never names credentials or secrets. */
  readonly reason?: string;
}

/** Outcome of reading the existing `config.json` before a theme write. */
export interface ExistingConfigRead {
  /** Parsed configuration object, present only when the read succeeded. */
  readonly value: Record<string, unknown> | null;
  /** Failure reason, or `null` when the read succeeded. */
  readonly reason: string | null;
}

/** Inputs accepted by the theme file writer. */
export interface WriteThemeOptions {
  /** `config.json` path to write; defaults to the resolved main configuration path. */
  readonly configPath?: string;
  /** File reader override used by tests; defaults to `fs/promises`. */
  readonly readFile?: (path: string) => Promise<string>;
  /**
   * File writer override used by tests; defaults to `fs/promises`.
   *
   * When supplied, it performs the final write itself and the atomic temp-file flow is skipped, so
   * an injected-filesystem test never touches the real directory.
   */
  readonly writeFile?: (path: string, content: string) => Promise<void>;
  /**
   * Rename override used by tests on the atomic path; defaults to `fs/promises`.
   *
   * It receives the sibling temp path and the target path, and a thrown error must leave the
   * previous file untouched.
   */
  readonly renameFile?: (source: string, destination: string) => Promise<void>;
  /** Environment variables used to resolve the default `config.json` path. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Home directory used to resolve the default `config.json` path. */
  readonly homeDir?: string;
  /** Platform family used to resolve the default `config.json` path. */
  readonly platform?: KeymapPlatform;
}
