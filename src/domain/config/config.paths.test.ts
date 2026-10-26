import { describe, expect, it } from "bun:test";
import path from "node:path";
import { resolveConfigPaths } from "@/domain/config/config.paths";
import type { ResolveConfigPathsOptions } from "@/domain/config/config.types";

/** Home directory used by the injected cases. */
const HOME_DIR = path.join("/home", "tester");

/** Launch working directory used by the injected cases. */
const LAUNCH_DIR = path.join("/work", "gitminal");

/** XDG directory used by the injected cases. */
const XDG_DIR = path.join("/xdg", "config");

/** APPDATA directory used on the Windows case. */
const APPDATA_DIR = path.join("/appdata", "roaming");

/**
 * Resolves paths with a fixed environment and platform.
 *
 * @param options - Environment, platform, home directory, and working directory overrides.
 * @returns The resolved paths.
 */
function resolve(options: ResolveConfigPathsOptions): ReturnType<typeof resolveConfigPaths> {
  return resolveConfigPaths({
    env: {},
    platform: "linux",
    homeDir: HOME_DIR,
    cwd: LAUNCH_DIR,
    ...options,
  });
}

describe("resolveConfigPaths on POSIX", () => {
  it("prefers GITMINAL_CONFIG and keeps the companion files beside it", () => {
    const explicit = path.join("/custom", "gitminal-config.json");
    const paths = resolve({ env: { GITMINAL_CONFIG: explicit, XDG_CONFIG_HOME: XDG_DIR } });

    expect(paths).toEqual({
      config: explicit,
      keybindings: path.join("/custom", "keybindings.json"),
      theme: path.join("/custom", "theme.json"),
    });
  });

  it("uses XDG_CONFIG_HOME when no explicit config file is set", () => {
    const paths = resolve({ env: { XDG_CONFIG_HOME: XDG_DIR } });
    const directory = path.join(XDG_DIR, "gitminal");

    expect(paths).toEqual({
      config: path.join(directory, "config.json"),
      keybindings: path.join(directory, "keybindings.json"),
      theme: path.join(directory, "theme.json"),
    });
  });

  it("falls back to the home directory when XDG is unset", () => {
    const paths = resolve({ env: {} });
    const directory = path.join(HOME_DIR, ".config", "gitminal");

    expect(paths.config).toBe(path.join(directory, "config.json"));
    expect(paths.keybindings).toBe(path.join(directory, "keybindings.json"));
    expect(paths.theme).toBe(path.join(directory, "theme.json"));
  });

  it("prefers XDG over the home directory", () => {
    const paths = resolve({ env: { XDG_CONFIG_HOME: XDG_DIR } });

    expect(paths.config).toBe(path.join(XDG_DIR, "gitminal", "config.json"));
  });

  it("prefers an explicit file over XDG and home", () => {
    const explicit = path.join("/custom", "config.json");
    const paths = resolve({ env: { GITMINAL_CONFIG: explicit } });

    expect(paths.config).toBe(explicit);
  });

  it("honors GITMINAL_KEYBINDINGS and GITMINAL_THEME over the companion defaults", () => {
    const keybindings = path.join("/custom", "keys.json");
    const theme = path.join("/custom", "colors.json");
    const paths = resolve({ env: { GITMINAL_KEYBINDINGS: keybindings, GITMINAL_THEME: theme } });

    expect(paths.keybindings).toBe(keybindings);
    expect(paths.theme).toBe(theme);
  });

  it("ignores blank overrides and blank environment values", () => {
    const paths = resolve({
      env: {
        GITMINAL_CONFIG: "  ",
        GITMINAL_KEYBINDINGS: "",
        GITMINAL_THEME: "   ",
        XDG_CONFIG_HOME: " ",
      },
    });
    const directory = path.join(HOME_DIR, ".config", "gitminal");

    expect(paths.config).toBe(path.join(directory, "config.json"));
    expect(paths.keybindings).toBe(path.join(directory, "keybindings.json"));
    expect(paths.theme).toBe(path.join(directory, "theme.json"));
  });

  it("resolves a relative GITMINAL_CONFIG against the launch working directory", () => {
    const paths = resolve({ env: { GITMINAL_CONFIG: path.join("conf", "gitminal.json") } });
    const directory = path.join(LAUNCH_DIR, "conf");

    expect(paths).toEqual({
      config: path.join(directory, "gitminal.json"),
      keybindings: path.join(directory, "keybindings.json"),
      theme: path.join(directory, "theme.json"),
    });
  });

  it("resolves relative keybindings and theme overrides against the launch directory", () => {
    const paths = resolve({
      env: { GITMINAL_KEYBINDINGS: "keys.json", GITMINAL_THEME: "colors.json" },
    });

    expect(paths.keybindings).toBe(path.join(LAUNCH_DIR, "keys.json"));
    expect(paths.theme).toBe(path.join(LAUNCH_DIR, "colors.json"));
  });

  it("ignores a relative override when the launch working directory is unavailable", () => {
    const paths = resolve({
      env: { GITMINAL_CONFIG: "config.json", XDG_CONFIG_HOME: XDG_DIR },
      cwd: "",
    });

    expect(paths.config).toBe(path.join(XDG_DIR, "gitminal", "config.json"));
  });

  it("ignores a relative XDG_CONFIG_HOME and falls back to the home directory", () => {
    const paths = resolve({ env: { XDG_CONFIG_HOME: path.join("xdg", "config") } });

    expect(paths.config).toBe(path.join(HOME_DIR, ".config", "gitminal", "config.json"));
  });

  it("ignores a relative home directory", () => {
    const paths = resolve({ env: {}, homeDir: path.join("home", "tester") });

    expect(paths).toEqual({ config: null, keybindings: null, theme: null });
  });

  it("reports unresolved paths when no location exists", () => {
    const paths = resolve({ env: { APPDATA: APPDATA_DIR }, homeDir: "" });

    expect(paths).toEqual({ config: null, keybindings: null, theme: null });
  });
});

describe("resolveConfigPaths on Windows", () => {
  it("falls back to APPDATA when XDG and home are unavailable", () => {
    const paths = resolve({
      env: { APPDATA: APPDATA_DIR },
      platform: "windows",
      homeDir: "",
    });
    const directory = path.join(APPDATA_DIR, "gitminal");

    expect(paths.config).toBe(path.join(directory, "config.json"));
    expect(paths.keybindings).toBe(path.join(directory, "keybindings.json"));
    expect(paths.theme).toBe(path.join(directory, "theme.json"));
  });

  it("prefers the home directory over APPDATA", () => {
    const paths = resolve({
      env: { APPDATA: APPDATA_DIR },
      platform: "windows",
      homeDir: HOME_DIR,
    });

    expect(paths.config).toBe(path.join(HOME_DIR, ".config", "gitminal", "config.json"));
  });

  it("reports unresolved paths when APPDATA is blank", () => {
    const paths = resolve({ env: { APPDATA: " " }, platform: "windows", homeDir: "" });

    expect(paths).toEqual({ config: null, keybindings: null, theme: null });
  });

  it("resolves a relative GITMINAL_CONFIG against the launch working directory", () => {
    const paths = resolve({
      env: { GITMINAL_CONFIG: "gitminal.json" },
      platform: "windows",
      homeDir: "",
    });

    expect(paths.config).toBe(path.join(LAUNCH_DIR, "gitminal.json"));
  });

  it("ignores a relative XDG_CONFIG_HOME and keeps the home fallback", () => {
    const paths = resolve({
      env: { XDG_CONFIG_HOME: path.join("xdg", "config") },
      platform: "windows",
    });

    expect(paths.config).toBe(path.join(HOME_DIR, ".config", "gitminal", "config.json"));
  });

  it("ignores a relative APPDATA and reports unresolved paths", () => {
    const paths = resolve({
      env: { APPDATA: path.join("appdata", "roaming") },
      platform: "windows",
      homeDir: "",
    });

    expect(paths).toEqual({ config: null, keybindings: null, theme: null });
  });
});

describe("resolveConfigPaths with a missing home directory", () => {
  it("returns companion overrides even when no base directory resolves", () => {
    const keybindings = path.join("/custom", "keys.json");
    const paths = resolve({ env: { GITMINAL_KEYBINDINGS: keybindings }, homeDir: "" });

    expect(paths.config).toBeNull();
    expect(paths.keybindings).toBe(keybindings);
    expect(paths.theme).toBeNull();
  });
});
