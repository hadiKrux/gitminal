import os from "node:os";
import path from "node:path";
import type { KeymapPlatform } from "@/domain/keymap/keymap.types";
import type { ConfigFilePaths, ResolveConfigPathsOptions } from "./config.types";

/** File name of the main configuration file. */
const CONFIG_FILE_NAME = "config.json";

/** File name of the dedicated keybindings file. */
const KEYBINDINGS_FILE_NAME = "keybindings.json";

/** File name of the theme override file. */
const THEME_FILE_NAME = "theme.json";

/** Directory name created under the XDG, home, or APPDATA location. */
const APP_DIRECTORY_NAME = "gitminal";

/**
 * Resolves the three optional configuration file locations.
 *
 * `config.json` uses the documented precedence: `$GITMINAL_CONFIG` when set and non-empty, then
 * `$XDG_CONFIG_HOME/gitminal/config.json` when that variable is set, then
 * `~/.config/gitminal/config.json` when a home directory is available, and finally on Windows
 * `%APPDATA%\gitminal\config.json` when the XDG and home paths are unavailable.
 * `keybindings.json` and `theme.json` come from `GITMINAL_KEYBINDINGS` and `GITMINAL_THEME`, or live
 * next to the resolved `config.json`.
 *
 * Environment, platform, home directory, and working directory inputs are injectable so per-OS
 * resolution stays testable; production reads the process environment and the launch working
 * directory. Every result is an absolute path, or `null` when the precedence runs out: a relative
 * `$GITMINAL_CONFIG`, `$GITMINAL_KEYBINDINGS`, or `$GITMINAL_THEME` value is resolved against the
 * launch working directory, while directory values (`$XDG_CONFIG_HOME`, `$APPDATA`, and the home
 * directory) must already be absolute, so a relative one is ignored and the next documented
 * fallback decides the location. An explicit override whose relative value cannot be resolved
 * because the launch working directory is unavailable is ignored the same way. No file existence is
 * checked here.
 *
 * @param options - Environment, platform, home directory, and working directory inputs.
 * @returns The resolved paths for the three files.
 */
export function resolveConfigPaths(options: ResolveConfigPathsOptions = {}): ConfigFilePaths {
  const env = options.env ?? process.env;
  const platform = options.platform ?? detectPlatform();
  const workingDirectory = readWorkingDirectory(options.cwd);
  const homeDir = readHomeDir(options.homeDir);
  const explicitConfig = resolveOverridePath(
    readEnvironmentValue(env, "GITMINAL_CONFIG"),
    workingDirectory,
  );
  const directory = resolveConfigDirectory(env, platform, homeDir, explicitConfig);

  return {
    config: explicitConfig ?? joinDirectory(directory, CONFIG_FILE_NAME),
    keybindings:
      resolveOverridePath(readEnvironmentValue(env, "GITMINAL_KEYBINDINGS"), workingDirectory) ??
      joinDirectory(directory, KEYBINDINGS_FILE_NAME),
    theme:
      resolveOverridePath(readEnvironmentValue(env, "GITMINAL_THEME"), workingDirectory) ??
      joinDirectory(directory, THEME_FILE_NAME),
  };
}

/**
 * Resolves the directory that holds `config.json`, `keybindings.json`, and `theme.json`.
 *
 * An explicit `$GITMINAL_CONFIG` keeps its own file but still hosts the companion files, so a
 * private directory can hold all three. The Windows `%APPDATA%\gitminal` fallback applies only when
 * no explicit file and no XDG override exist and the home directory could not be resolved, so the
 * documented precedence stays literal on every platform. Both directory variables are read only
 * when they are absolute, because the XDG base directory specification requires it and a relative
 * `APPDATA` would otherwise leak a relative result.
 *
 * @param env - Environment variables.
 * @param platform - Platform family.
 * @param homeDir - Absolute home directory, or `null` when unavailable.
 * @param explicitConfig - Resolved `$GITMINAL_CONFIG` value, or `null` when unset.
 * @returns The directory, or `null` when no location could be resolved.
 */
function resolveConfigDirectory(
  env: Readonly<Record<string, string | undefined>>,
  platform: KeymapPlatform,
  homeDir: string | null,
  explicitConfig: string | null,
): string | null {
  if (explicitConfig !== null) {
    return path.dirname(explicitConfig);
  }

  const xdgHome = readAbsoluteEnvironmentValue(env, "XDG_CONFIG_HOME");

  if (xdgHome !== null) {
    return path.join(xdgHome, APP_DIRECTORY_NAME);
  }

  if (homeDir !== null) {
    return path.join(homeDir, ".config", APP_DIRECTORY_NAME);
  }

  const appData = readAbsoluteEnvironmentValue(env, "APPDATA");

  if (platform === "windows" && appData !== null) {
    return path.join(appData, APP_DIRECTORY_NAME);
  }

  return null;
}

/**
 * Joins a file name onto a directory.
 *
 * @param directory - Resolved directory, or `null` when no location exists.
 * @param fileName - File name to append.
 * @returns The joined path, or `null` when the directory is unresolved.
 */
function joinDirectory(directory: string | null, fileName: string): string | null {
  return directory === null ? null : path.join(directory, fileName);
}

/**
 * Reads one trimmed, non-empty environment value.
 *
 * @param env - Environment variables.
 * @param name - Variable name.
 * @returns The trimmed value, or `null` when the variable is unset or blank.
 */
function readEnvironmentValue(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
): string | null {
  const value = env[name]?.trim() ?? "";

  return value.length === 0 ? null : value;
}

/**
 * Reads one environment value that must already be an absolute path.
 *
 * The XDG base directory specification requires an absolute `$XDG_CONFIG_HOME`, and the same rule
 * keeps a relative `%APPDATA%` from producing a relative result, so a relative directory value is
 * ignored and the next documented fallback decides the location.
 *
 * @param env - Environment variables.
 * @param name - Variable name.
 * @returns The absolute value, or `null` when the variable is unset, blank, or relative.
 */
function readAbsoluteEnvironmentValue(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
): string | null {
  const value = readEnvironmentValue(env, name);

  return value !== null && path.isAbsolute(value) ? value : null;
}

/**
 * Resolves one explicit file override to an absolute path.
 *
 * An absolute value is used unchanged. A relative value is resolved against the launch working
 * directory, so `GITMINAL_CONFIG=config.json` names the file the user meant instead of inheriting
 * whatever directory a later working-directory change selects. When the launch working directory is
 * unavailable, the override is ignored and the documented fallback decides the path.
 *
 * @param value - Trimmed environment value, or `null` when unset.
 * @param workingDirectory - Absolute launch working directory, or `null` when unavailable.
 * @returns The absolute override path, or `null` when it is unset or cannot be resolved.
 */
function resolveOverridePath(value: string | null, workingDirectory: string | null): string | null {
  if (value === null) {
    return null;
  }

  if (path.isAbsolute(value)) {
    return value;
  }

  return workingDirectory === null ? null : path.resolve(workingDirectory, value);
}

/**
 * Reads the home directory.
 *
 * Only an absolute value is used, so every resolved path stays absolute; a relative value is
 * treated as unavailable and resolution continues with the documented fallback order.
 *
 * @param injected - Home directory passed by the caller, when known.
 * @returns The absolute home directory, or `null` when unavailable.
 */
function readHomeDir(injected: string | undefined): string | null {
  const homeDir = injected === undefined ? readProcessHomeDir() : injected.trim();

  return homeDir === null || !path.isAbsolute(homeDir) ? null : homeDir;
}

/**
 * Reads the launch working directory used to resolve relative overrides.
 *
 * `process.cwd()` throws when the launch directory has been removed, so that failure is read as "no
 * working directory" and a relative override is ignored instead of aborting the launch.
 *
 * @param injected - Working directory passed by the caller, when known.
 * @returns The absolute working directory, or `null` when unavailable.
 */
function readWorkingDirectory(injected: string | undefined): string | null {
  const workingDirectory = injected === undefined ? readProcessWorkingDirectory() : injected.trim();

  return workingDirectory === null || !path.isAbsolute(workingDirectory) ? null : workingDirectory;
}

/**
 * Reads the process working directory defensively.
 *
 * @returns The working directory, or `null` when it is blank or cannot be read.
 */
function readProcessWorkingDirectory(): string | null {
  try {
    const workingDirectory = process.cwd();

    return workingDirectory.trim() === "" ? null : workingDirectory;
  } catch {
    return null;
  }
}

/**
 * Reads the process home directory defensively.
 *
 * `os.homedir()` can throw in restricted environments, so the failure regresses the resolution into
 * the documented fallback order instead of aborting the launch.
 *
 * @returns The home directory, or `null` when unavailable.
 */
function readProcessHomeDir(): string | null {
  try {
    const homeDir = os.homedir();

    return homeDir.trim() === "" ? null : homeDir;
  } catch {
    return null;
  }
}

/**
 * Detects the platform family that decides the Windows fallback.
 *
 * @returns `windows` on `win32`, otherwise `linux`, which stands for every POSIX-like platform.
 */
function detectPlatform(): KeymapPlatform {
  return process.platform === "win32" ? "windows" : "linux";
}
