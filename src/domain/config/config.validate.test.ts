import { describe, expect, it } from "bun:test";
import { DEFAULT_CONFIG } from "@/domain/config/config.defaults";
import type { GitminalConfig, ValidateConfigInput } from "@/domain/config/config.types";
import { buildEffectiveConfig } from "@/domain/config/config.validate";

/**
 * Builds a validation input with only the main file set.
 *
 * @param rawConfig - Raw parsed `config.json`.
 * @returns The validation input.
 */
function mainFile(rawConfig: unknown): ValidateConfigInput {
  return { rawConfig, rawKeybindings: null, rawTheme: null };
}

/**
 * Merges one raw main file and returns the result.
 *
 * @param rawConfig - Raw parsed `config.json`.
 * @returns The merge result.
 */
function merge(rawConfig: unknown): ReturnType<typeof buildEffectiveConfig> {
  return buildEffectiveConfig(mainFile(rawConfig));
}

describe("buildEffectiveConfig with no files", () => {
  it("reports the built-in configuration and a missing status", () => {
    const result = buildEffectiveConfig();

    expect(result.status).toBe("missing");
    expect(result.config).toBe(DEFAULT_CONFIG);
    expect(result.keybindingsFile).toEqual({});
    expect(result.themeFile).toBeNull();
    expect(result.warnings).toEqual([]);
  });
});

describe("buildEffectiveConfig field validation", () => {
  it("applies every valid field", () => {
    const result = merge({
      version: 1,
      git: { path: "/usr/bin/git" },
      theme: "catppuccin-latte",
      ui: { mouse: false },
      graph: { scope: "local", initialPageSize: 250, style: "sharp" },
      diff: { contextLines: 5, expandFirstWorkingFile: false },
      stash: { includeUntrackedByDefault: true },
      remote: { fetchScope: "current" },
    });

    expect(result.status).toBe("applied");
    expect(result.warnings).toEqual([]);
    expect(result.config).toEqual({
      version: 1,
      git: { path: "/usr/bin/git" },
      theme: "catppuccin-latte",
      ui: { mouse: false },
      graph: { scope: "local", initialPageSize: 250, style: "sharp" },
      diff: { contextLines: 5, expandFirstWorkingFile: false },
      stash: { includeUntrackedByDefault: true },
      remote: { fetchScope: "current" },
      keybindings: {},
    });
  });

  it("keeps the previous value for each invalid field and warns once", () => {
    const result = merge({
      git: { path: "   " },
      theme: 7,
      ui: { mouse: "yes" },
      graph: { scope: "sideways", initialPageSize: 5, style: "fancy" },
      diff: { contextLines: 40, expandFirstWorkingFile: "no" },
      stash: { includeUntrackedByDefault: 1 },
      remote: { fetchScope: "everything" },
    });

    expect(result.status).toBe("applied");
    expect(result.config).toMatchObject({
      git: { path: DEFAULT_CONFIG.git.path },
      theme: DEFAULT_CONFIG.theme,
      ui: { mouse: DEFAULT_CONFIG.ui.mouse },
      graph: DEFAULT_CONFIG.graph,
      diff: DEFAULT_CONFIG.diff,
      stash: DEFAULT_CONFIG.stash,
      remote: DEFAULT_CONFIG.remote,
    });
    expect(result.warnings).toContain(
      'Invalid value for "graph.scope" in config.json; the previous value was kept.',
    );
    expect(result.warnings).toContain(
      'Invalid value for "diff.contextLines" in config.json; the previous value was kept.',
    );
    expect(result.warnings).toContain(
      'Invalid value for "graph.style" in config.json; the previous value was kept.',
    );
    expect(result.warnings).toHaveLength(10);
  });

  it("keeps the previous effective value from the previous configuration", () => {
    const previous: GitminalConfig = {
      ...DEFAULT_CONFIG,
      graph: { scope: "current", initialPageSize: 800, style: "sharp" },
      theme: "catppuccin-frappe",
    };
    const result = buildEffectiveConfig({
      ...mainFile({ graph: { scope: "nonsense" }, theme: "catppuccin-latte" }),
      previousConfig: previous,
    });

    expect(result.config.graph).toEqual({
      scope: "current",
      initialPageSize: 800,
      style: "sharp",
    });
    expect(result.config.theme).toBe("catppuccin-latte");
  });

  it("reports a group that is not an object and keeps every value in it", () => {
    const result = merge({ graph: 3 });

    expect(result.config.graph).toEqual(DEFAULT_CONFIG.graph);
    expect(result.warnings).toContain(
      'Group "graph" in config.json must be a JSON object; it was ignored.',
    );
  });
});

describe("buildEffectiveConfig unknown fields", () => {
  it("reports unknown top-level and nested fields", () => {
    const result = merge({ extra: true, graph: { scope: "all", lanes: 4 } });

    expect(result.warnings).toContain('Unknown field "extra" in config.json; it was ignored.');
    expect(result.warnings).toContain(
      'Unknown field "graph.lanes" in config.json; it was ignored.',
    );
    expect(result.config.graph.scope).toBe("all");
  });

  it("reports every safety field and never accepts it", () => {
    const result = merge({
      safety: { confirmations: true },
      disableConfirmations: true,
      git: { path: "git", alwaysForce: true },
    });

    expect(result.warnings).toContain(
      'Safety behavior cannot be configured; "safety" in config.json was ignored.',
    );
    expect(result.warnings).toContain(
      'Safety behavior cannot be configured; "disableConfirmations" in config.json was ignored.',
    );
    expect(result.warnings).toContain(
      'Safety behavior cannot be configured; "git.alwaysForce" in config.json was ignored.',
    );
    expect(result.config).toMatchObject({ git: { path: "git" } });
  });
});

describe("buildEffectiveConfig keybindings", () => {
  it("accepts every override form for a known action", () => {
    const result = merge({
      keybindings: {
        "app.refresh": ["x"],
        "app.help": "f3",
        "app.console": null,
        "app.palette": [],
        "graph.selectCommit": ["y"],
        "not.an.action": "z",
      },
    });

    expect(result.config.keybindings).toEqual({
      "app.refresh": ["x"],
      "app.help": "f3",
      "app.console": null,
      "app.palette": [],
    });
    expect(result.warnings).toContain(
      'Unknown action ID "graph.selectCommit" in config.json; it was ignored.',
    );
    expect(result.warnings).toContain(
      'Unknown action ID "not.an.action" in config.json; it was ignored.',
    );
  });

  it("reports a binding with an unusable shape and keeps the previous map", () => {
    const previous: GitminalConfig = {
      ...DEFAULT_CONFIG,
      keybindings: { "app.refresh": ["z"] },
    };
    const result = buildEffectiveConfig({
      ...mainFile({ keybindings: 4 }),
      previousConfig: previous,
    });

    expect(result.config.keybindings).toEqual({ "app.refresh": ["z"] });
    expect(result.warnings).toContain(
      '"keybindings" in config.json must be an object; it was ignored.',
    );
  });

  it("validates keybindings.json independently of the main file", () => {
    const result = buildEffectiveConfig({
      rawConfig: { keybindings: { "app.refresh": ["x"] } },
      rawKeybindings: { "app.refresh": ["z"], "graph.selectCommit": ["y"] },
      rawTheme: null,
    });

    expect(result.config.keybindings).toEqual({ "app.refresh": ["x"] });
    expect(result.keybindingsFile).toEqual({ "app.refresh": ["z"] });
    expect(result.warnings).toContain(
      'Unknown action ID "graph.selectCommit" in keybindings.json; it was ignored.',
    );
  });

  it("ignores a keybindings.json that is not an object", () => {
    const result = buildEffectiveConfig({
      rawConfig: null,
      rawKeybindings: ["app.refresh"],
      rawTheme: null,
    });

    expect(result.keybindingsFile).toEqual({});
    expect(result.warnings).toContain("keybindings.json must be a JSON object; it was ignored.");
  });
});

describe("buildEffectiveConfig version handling", () => {
  it("treats a missing version as one", () => {
    const result = merge({ theme: "catppuccin-latte" });

    expect(result.status).toBe("applied");
    expect(result.config.version).toBe(1);
  });

  it("ignores a newer version with a warning", () => {
    const result = merge({ version: 2, theme: "catppuccin-latte" });

    expect(result.status).toBe("rejected");
    expect(result.config).toBe(DEFAULT_CONFIG);
    expect(result.warnings).toEqual([
      "Unsupported version 2 in config.json; the file was ignored.",
    ]);
  });

  it("ignores a non-numeric version with a warning", () => {
    const result = merge({ version: "1", theme: "catppuccin-latte" });

    expect(result.status).toBe("rejected");
    expect(result.warnings).toEqual(["Invalid version in config.json; the file was ignored."]);
  });
});

describe("buildEffectiveConfig rejection", () => {
  it("rejects a file that is not an object", () => {
    const result = merge([1, 2, 3]);

    expect(result.status).toBe("rejected");
    expect(result.config).toBe(DEFAULT_CONFIG);
    expect(result.warnings).toEqual(["config.json is not a JSON object; the file was ignored."]);
  });

  it("rejects a file the loader could not read", () => {
    const result = buildEffectiveConfig({
      rawConfig: null,
      rawKeybindings: null,
      rawTheme: null,
      configFileStatus: "failed",
    });

    expect(result.status).toBe("rejected");
    expect(result.warnings).toEqual([
      "config.json could not be read or parsed; the file was ignored.",
    ]);
  });

  it("rejects a loaded file that parsed to null", () => {
    const result = buildEffectiveConfig({
      rawConfig: null,
      rawKeybindings: null,
      rawTheme: null,
      configFileStatus: "loaded",
    });

    expect(result.status).toBe("rejected");
  });

  it("passes the raw theme layer through for the theme resolver", () => {
    const theme = { colors: { accent: "accent" } };
    const result = buildEffectiveConfig({
      rawConfig: null,
      rawKeybindings: null,
      rawTheme: theme,
    });

    expect(result.themeFile).toBe(theme);
  });
});
