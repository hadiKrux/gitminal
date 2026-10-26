import {
  createContext,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  ConfigContextValue,
  ConfigProviderProps,
  ConfigReloadResult,
  ConfigSnapshot,
  ConfigSource,
} from "@/app/providers/ConfigProvider.types";
import { DEFAULT_CONFIG_SNAPSHOT } from "@/app/providers/config.source";
import { DEFAULT_CONFIG, UNRESOLVED_CONFIG_PATHS } from "@/domain/config/config.defaults";
import { boundConfigWarnings } from "@/domain/config/config.warnings";

/** Context carrying the resolved configuration. */
export const ConfigContext = createContext<ConfigContextValue | null>(null);

/**
 * Provides the effective configuration and the per-file load metadata to the app.
 *
 * The composition root loads the files before the first render and passes the resulting snapshot,
 * so there is no visible loading state; an unconfigured install simply receives the built-in
 * defaults. `reload` re-reads the files through the injected source, validates them against the
 * configuration the session is running with, and applies the result in one state transition. A
 * rejected main file keeps the previous effective configuration and reports the warnings, so a
 * broken file during a reload can never break a running session.
 *
 * @param props - Startup snapshot, reload source, static overrides, and provider content.
 * @returns The configuration context provider.
 */
export function ConfigProvider(props: ConfigProviderProps): ReactNode {
  const [snapshot, setSnapshot] = useState<ConfigSnapshot>(() => readInitialSnapshot(props));
  const latest = useRef(snapshot);

  useEffect(() => {
    latest.current = snapshot;
  }, [snapshot]);

  /** Re-reads the files and applies a valid result in place. */
  const reload = useCallback(async (): Promise<ConfigReloadResult> => {
    if (props.source === undefined) {
      return { ok: true, warnings: [] };
    }

    return await reloadFromSource(props.source.load, latest.current, setSnapshot);
  }, [props.source]);

  const value = useMemo<ConfigContextValue>(
    () => ({
      status: snapshot.status,
      config: snapshot.config,
      paths: snapshot.paths,
      files: snapshot.files,
      warnings: snapshot.warnings,
      keybindingsFile: snapshot.keybindingsFile,
      themeOverrides: snapshot.themeOverrides,
      reload,
    }),
    [snapshot, reload],
  );

  return <ConfigContext.Provider value={value}>{props.children}</ConfigContext.Provider>;
}

/**
 * Reads the snapshot the provider starts from.
 *
 * A snapshot from the composition root wins. The static `initialConfig`, `initialPaths`, and
 * `initialWarnings` props exist for tests and embeddings; when none of them is supplied the shared
 * default snapshot is used, which is what keeps the built-in state identity-stable.
 *
 * @param props - Provider props.
 * @returns The startup snapshot.
 */
function readInitialSnapshot(props: ConfigProviderProps): ConfigSnapshot {
  if (props.initialSnapshot !== undefined) {
    return props.initialSnapshot;
  }

  if (
    props.initialConfig === undefined &&
    props.initialPaths === undefined &&
    props.initialWarnings === undefined
  ) {
    return DEFAULT_CONFIG_SNAPSHOT;
  }

  return {
    status: "missing",
    config: props.initialConfig ?? DEFAULT_CONFIG,
    paths: props.initialPaths ?? UNRESOLVED_CONFIG_PATHS,
    files: Object.freeze([]),
    warnings: Object.freeze([...(props.initialWarnings ?? [])]),
    keybindingsFile: Object.freeze({}),
    themeOverrides: null,
  };
}

/**
 * Runs one reload and stores its result.
 *
 * A rejected main file keeps the previous effective configuration, keybindings file, and theme
 * overrides, because F-19 requires an invalid reload to leave the session exactly as it was. A
 * thrown loader is treated the same way and reported as a warning rather than an exception.
 *
 * @param load - Source loader.
 * @param previous - Snapshot the session is currently running with.
 * @param store - Snapshot state setter.
 * @returns Whether the reload applied, plus the resulting warnings.
 */
async function reloadFromSource(
  load: ConfigSource["load"],
  previous: ConfigSnapshot,
  store: (snapshot: ConfigSnapshot) => void,
): Promise<ConfigReloadResult> {
  let next: ConfigSnapshot;

  try {
    next = await load(previous.config);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const warnings = boundConfigWarnings([`Could not reload configuration: ${reason}`]);

    store(keepPrevious(previous, warnings));

    return { ok: false, warnings };
  }

  if (next.status !== "rejected") {
    store(next);

    return { ok: true, warnings: next.warnings };
  }

  store(keepPrevious(previous, next.warnings));

  return { ok: false, warnings: next.warnings };
}

/**
 * Keeps the previous effective configuration while reporting the new warnings.
 *
 * @param previous - Snapshot the session is running with.
 * @param warnings - Warnings produced by the rejected reload.
 * @returns The snapshot to store.
 */
function keepPrevious(previous: ConfigSnapshot, warnings: readonly string[]): ConfigSnapshot {
  return {
    status: previous.status,
    config: previous.config,
    paths: previous.paths,
    files: previous.files,
    warnings,
    keybindingsFile: previous.keybindingsFile,
    themeOverrides: previous.themeOverrides,
  };
}
