import type { ReactNode } from "react";
import type {
  ConfigFileLoad,
  ConfigFilePaths,
  ConfigValidationStatus,
  GitminalConfig,
  LoadedConfigFiles,
} from "@/domain/config/config.types";
import type { KeybindingOverrides, KeymapPlatform } from "@/domain/keymap/keymap.types";

/**
 * One resolved configuration state: the effective values plus what the files contributed.
 *
 * The provider stores this whole value, so a reload replaces the effective configuration and every
 * load outcome in one transition instead of keeping parallel copies.
 */
export interface ConfigSnapshot {
  /** Merge outcome of the main `config.json`. */
  readonly status: ConfigValidationStatus;
  /** The effective configuration. */
  readonly config: GitminalConfig;
  /** Resolved configuration file paths. */
  readonly paths: ConfigFilePaths;
  /** Per-file load status, in `config`, `keybindings`, `theme` order. */
  readonly files: readonly ConfigFileLoad[];
  /** Bounded, non-blocking warnings from loading and validation. */
  readonly warnings: readonly string[];
  /** Validated overrides from `keybindings.json` only. */
  readonly keybindingsFile: KeybindingOverrides;
  /** Raw parsed `theme.json`, or `null` when it is absent or unusable. */
  readonly themeOverrides: unknown;
}

/** Outcome of one reload, reported to the action that requested it. */
export interface ConfigReloadResult {
  /** True when the reload applied its files; false when the main file was rejected. */
  readonly ok: boolean;
  /** Bounded warnings produced by this reload. */
  readonly warnings: readonly string[];
}

/**
 * Reads configuration into a snapshot.
 *
 * The composition root supplies the filesystem-backed implementation, so the provider depends on
 * this narrow contract instead of reaching into `@/domain/config` itself.
 */
export interface ConfigSource {
  /** Resolved paths this source reads. */
  readonly paths: ConfigFilePaths;
  /**
   * Reads the files and returns the resulting snapshot.
   *
   * @param previous - Effective configuration from the previous snapshot, used as the per-field
   * fallback so an invalid field keeps the value the session is running with.
   * @returns The resolved snapshot; the promise never rejects for a bad file.
   */
  readonly load: (previous?: GitminalConfig) => Promise<ConfigSnapshot>;
}

/** Value exposed by `ConfigProvider` and read through `useConfig`. */
export interface ConfigContextValue {
  /** Merge outcome of the main `config.json`, shown by Help as the load status. */
  readonly status: ConfigValidationStatus;
  /** The effective configuration. */
  readonly config: GitminalConfig;
  /** Resolved configuration file paths. */
  readonly paths: ConfigFilePaths;
  /** Per-file load status, so Help can say "not present" for an absent file. */
  readonly files: readonly ConfigFileLoad[];
  /** Bounded, non-blocking configuration warnings. */
  readonly warnings: readonly string[];
  /** Validated `keybindings.json` overrides, consumed by `KeymapProvider`. */
  readonly keybindingsFile: KeybindingOverrides;
  /** Raw parsed `theme.json`, consumed by `ThemeProvider`. */
  readonly themeOverrides: unknown;
  /** Re-reads configuration files and applies valid changes in place. */
  readonly reload: () => Promise<ConfigReloadResult>;
}

/** Injectable inputs for the filesystem-backed configuration source. */
export interface ConfigSourceOptions {
  /** Environment variables used for path resolution and companion overrides. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Platform family used for the Windows path fallback. */
  readonly platform?: KeymapPlatform;
  /** Home directory used for path resolution. */
  readonly homeDir?: string;
  /** File loading override used by tests; defaults to the real loader. */
  readonly loadFiles?: (paths: ConfigFilePaths) => Promise<LoadedConfigFiles>;
}

/** Props accepted by `ConfigProvider`. */
export interface ConfigProviderProps {
  /** Provider content. */
  readonly children?: ReactNode;
  /** Startup snapshot produced by the composition root; defaults to the built-in state. */
  readonly initialSnapshot?: ConfigSnapshot;
  /** Loader used by `reload`; when omitted, a reload resolves the current snapshot. */
  readonly source?: ConfigSource;
  /** Static effective configuration override for tests and embeddings. */
  readonly initialConfig?: GitminalConfig;
  /** Static resolved paths override for tests and embeddings. */
  readonly initialPaths?: ConfigFilePaths;
  /** Static warning override for tests and embeddings. */
  readonly initialWarnings?: readonly string[];
}
