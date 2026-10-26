import { describe, expect, it } from "bun:test";
import { createConfigSource } from "@/app/providers/config.source";
import { DEFAULT_CONFIG } from "@/domain/config/config.defaults";
import type { ConfigFileLoad, LoadedConfigFiles } from "@/domain/config/config.types";
import { MOCHA_ROLES } from "@/domain/theme/theme.catppuccin";

/** A real built-in palette token, used as a valid raw theme override value. */
const TEST_THEME_COLOR = MOCHA_ROLES.text;

/** Environment that pins every resolved path inside one directory. */
const ENV = Object.freeze({
  GITMINAL_CONFIG: "/custom/config.json",
  GITMINAL_KEYBINDINGS: "/custom/keybindings.json",
  GITMINAL_THEME: "/custom/theme.json",
});

/**
 * Builds one file load outcome.
 *
 * @param key - File key.
 * @param status - Read status.
 * @param value - Parsed value, or null.
 * @returns The load outcome.
 */
function file(
  key: ConfigFileLoad["key"],
  status: ConfigFileLoad["status"],
  value: unknown = null,
): ConfigFileLoad {
  return { key, status, value, path: `/custom/${key}.json` };
}

/**
 * Builds a loader result with every companion file missing.
 *
 * @param files - File outcomes to use instead of the default missing set.
 * @param warnings - Loader warnings.
 * @returns The loader result.
 */
function loaded(
  files: readonly ConfigFileLoad[] = [
    file("config", "missing"),
    file("keybindings", "missing"),
    file("theme", "missing"),
  ],
  warnings: readonly string[] = [],
): LoadedConfigFiles {
  return { files, warnings };
}

/**
 * Creates a source whose loader returns one fixed result.
 *
 * @param result - Loader result.
 * @returns The source.
 */
function createSource(result: LoadedConfigFiles) {
  return createConfigSource({
    env: ENV,
    platform: "linux",
    homeDir: "/home/developer",
    loadFiles: async () => result,
  });
}

describe("createConfigSource", () => {
  it("resolves every path once at creation", async () => {
    const source = createSource(loaded());

    expect(source.paths).toEqual({
      config: "/custom/config.json",
      keybindings: "/custom/keybindings.json",
      theme: "/custom/theme.json",
    });

    await source.load();
  });

  it("keeps the defaults and reports no warnings when every file is missing", async () => {
    const snapshot = await createSource(loaded()).load();

    expect(snapshot.status).toBe("missing");
    expect(snapshot.config).toEqual(DEFAULT_CONFIG);
    expect(snapshot.files.map((entry) => entry.status)).toEqual(["missing", "missing", "missing"]);
    expect(snapshot.warnings).toEqual([]);
    expect(snapshot.keybindingsFile).toEqual({});
    expect(snapshot.themeOverrides).toBeNull();
  });

  it("applies loaded config, keybindings, and theme values", async () => {
    const snapshot = await createSource(
      loaded([
        file("config", "loaded", { theme: "catppuccin-latte", ui: { mouse: false } }),
        file("keybindings", "loaded", { "app.help": "f1" }),
        file("theme", "loaded", { colors: { text: TEST_THEME_COLOR } }),
      ]),
    ).load();

    expect(snapshot.status).toBe("applied");
    expect(snapshot.config.theme).toBe("catppuccin-latte");
    expect(snapshot.config.ui.mouse).toBe(false);
    expect(snapshot.keybindingsFile).toEqual({ "app.help": "f1" });
    expect(snapshot.themeOverrides).toEqual({ colors: { text: TEST_THEME_COLOR } });
    expect(snapshot.files).toHaveLength(3);
  });

  it("rejects an unsupported config version and keeps the effective configuration", async () => {
    const snapshot = await createSource(
      loaded([file("config", "loaded", { version: 2, theme: "catppuccin-latte" })]),
    ).load();

    expect(snapshot.status).toBe("rejected");
    expect(snapshot.config).toEqual(DEFAULT_CONFIG);
    expect(snapshot.warnings[0]).toContain("Unsupported version 2");
  });

  it("concatenates loader warnings before validation warnings", async () => {
    const snapshot = await createSource(
      loaded(
        [file("config", "loaded", { unknownField: true }), file("theme", "failed")],
        ["theme.json could not be read or parsed; the file was ignored."],
      ),
    ).load();

    expect(snapshot.warnings).toHaveLength(2);
    expect(snapshot.warnings[0]).toContain("theme.json could not be read");
    expect(snapshot.warnings[1]).toContain('Unknown field "unknownField"');
  });

  it("falls back per field to the previous effective configuration", async () => {
    const previous = { ...DEFAULT_CONFIG, theme: "catppuccin-latte" };
    const snapshot = await createSource(
      loaded([file("config", "loaded", { theme: 5, "ui.mouse": true })]),
    ).load(previous);

    expect(snapshot.status).toBe("applied");
    expect(snapshot.config.theme).toBe("catppuccin-latte");
    expect(snapshot.warnings.some((warning) => warning.includes("theme"))).toBeTrue();
  });

  it("bounds a large combined warning list through the shared cap", async () => {
    const warnings = Array.from({ length: 20 }, (_, index) => `loader warning ${index}`);
    const snapshot = await createSource(loaded([], warnings)).load();

    expect(snapshot.warnings).toHaveLength(12);
    expect(snapshot.warnings.at(-1)).toContain("more configuration warnings were omitted");
  });
});
