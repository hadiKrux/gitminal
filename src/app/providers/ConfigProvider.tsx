import { createContext, type ReactNode, useCallback, useMemo, useState } from "react";
import type { ConfigContextValue, ConfigProviderProps } from "@/app/providers/ConfigProvider.types";
import { DEFAULT_CONFIG, UNRESOLVED_CONFIG_PATHS } from "@/domain/config/config.defaults";
import type { ConfigFilePaths, GitminalConfig } from "@/domain/config/config.types";

/** Context carrying the resolved configuration. */
export const ConfigContext = createContext<ConfigContextValue | null>(null);

/**
 * Provides the effective configuration to the app.
 *
 * The core provider starts from built-in defaults and requires no configuration file. File
 * loading, validation, and reload are deferred to the configuration loader, which will replace the
 * `reload` placeholder without changing this provider's contract.
 *
 * @param props - Initial configuration, paths, warnings, and provider content.
 * @returns The configuration context provider.
 */
export function ConfigProvider(props: ConfigProviderProps): ReactNode {
  const [config] = useState<GitminalConfig>(props.initialConfig ?? DEFAULT_CONFIG);
  const [paths] = useState<ConfigFilePaths>(props.initialPaths ?? UNRESOLVED_CONFIG_PATHS);
  const [warnings] = useState<readonly string[]>(props.initialWarnings ?? []);
  const reload = useCallback((): Promise<void> => Promise.resolve(), []);
  const value = useMemo<ConfigContextValue>(
    () => ({ config, paths, warnings, reload }),
    [config, paths, warnings, reload],
  );

  return <ConfigContext.Provider value={value}>{props.children}</ConfigContext.Provider>;
}
