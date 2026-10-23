import type { KeybindingOverrides } from "@/domain/keymap/keymap.types";

/** Commit graph scope accepted by `config.json`. */
export type GraphScope = "all" | "local" | "current";

/** Fetch scope accepted by `config.json`. */
export type RemoteFetchScope = "local" | "current";

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
    /** Fetch scope used by `remote.fetch`. */
    readonly fetchScope: RemoteFetchScope;
  };
  /** Action ID to binding overrides from the main configuration file. */
  readonly keybindings: KeybindingOverrides;
}

/** Resolved locations of the three optional configuration files. */
export interface ConfigFilePaths {
  /** Resolved `config.json` path, or `null` until path resolution lands. */
  readonly config: string | null;
  /** Resolved `keybindings.json` path, or `null` until path resolution lands. */
  readonly keybindings: string | null;
  /** Resolved `theme.json` path, or `null` until path resolution lands. */
  readonly theme: string | null;
}
