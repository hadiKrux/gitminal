import type { ReactNode } from "react";
import type { ConfigFilePaths, GitminalConfig } from "@/domain/config/config.types";

/** Value exposed by `ConfigProvider` and read through `useConfig`. */
export interface ConfigContextValue {
  /** The effective configuration. */
  readonly config: GitminalConfig;
  /** Resolved configuration file paths, or `null` entries until path resolution lands. */
  readonly paths: ConfigFilePaths;
  /** Non-blocking configuration warnings. */
  readonly warnings: readonly string[];
  /** Re-reads configuration files and applies valid changes in place. */
  readonly reload: () => Promise<void>;
}

/** Props accepted by `ConfigProvider`. */
export interface ConfigProviderProps {
  /** Provider content. */
  readonly children?: ReactNode;
  /** Initial effective configuration; defaults to the built-in configuration. */
  readonly initialConfig?: GitminalConfig;
  /** Initial resolved file paths; defaults to unresolved paths. */
  readonly initialPaths?: ConfigFilePaths;
  /** Initial non-blocking warnings. */
  readonly initialWarnings?: readonly string[];
}
