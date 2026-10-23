import { describe, expect, it } from "bun:test";
import {
  DEFAULT_CONFIG,
  DEFAULT_CONFIG_VERSION,
  DIFF_CONTEXT_LINES_RANGE,
  GRAPH_PAGE_SIZE_RANGE,
  UNRESOLVED_CONFIG_PATHS,
} from "@/domain/config/config.defaults";
import { DEFAULT_THEME_NAME, getThemeFlavor } from "@/domain/theme/theme.catppuccin";

describe("DEFAULT_CONFIG", () => {
  it("matches the documented schema defaults", () => {
    expect(DEFAULT_CONFIG).toEqual({
      version: DEFAULT_CONFIG_VERSION,
      git: { path: "git" },
      theme: "catppuccin-mocha",
      ui: { mouse: true },
      graph: { scope: "all", initialPageSize: 500 },
      diff: { contextLines: 3, expandFirstWorkingFile: true },
      stash: { includeUntrackedByDefault: false },
      remote: { fetchScope: "local" },
      keybindings: {},
    });
  });

  it("is frozen at every level", () => {
    expect(Object.isFrozen(DEFAULT_CONFIG)).toBe(true);
    expect(Object.isFrozen(DEFAULT_CONFIG.git)).toBe(true);
    expect(Object.isFrozen(DEFAULT_CONFIG.ui)).toBe(true);
    expect(Object.isFrozen(DEFAULT_CONFIG.graph)).toBe(true);
    expect(Object.isFrozen(DEFAULT_CONFIG.diff)).toBe(true);
    expect(Object.isFrozen(DEFAULT_CONFIG.stash)).toBe(true);
    expect(Object.isFrozen(DEFAULT_CONFIG.remote)).toBe(true);
    expect(Object.isFrozen(DEFAULT_CONFIG.keybindings)).toBe(true);
  });

  it("uses a built-in default theme", () => {
    expect(DEFAULT_CONFIG.theme).toBe(DEFAULT_THEME_NAME);
    expect(getThemeFlavor(DEFAULT_CONFIG.theme)).toBeDefined();
  });

  it("keeps the documented ranges", () => {
    expect(GRAPH_PAGE_SIZE_RANGE).toEqual({ min: 100, max: 2000 });
    expect(DIFF_CONTEXT_LINES_RANGE).toEqual({ min: 0, max: 20 });
    expect(DEFAULT_CONFIG.graph.initialPageSize).toBeGreaterThanOrEqual(GRAPH_PAGE_SIZE_RANGE.min);
    expect(DEFAULT_CONFIG.graph.initialPageSize).toBeLessThanOrEqual(GRAPH_PAGE_SIZE_RANGE.max);
    expect(DEFAULT_CONFIG.diff.contextLines).toBeGreaterThanOrEqual(DIFF_CONTEXT_LINES_RANGE.min);
    expect(DEFAULT_CONFIG.diff.contextLines).toBeLessThanOrEqual(DIFF_CONTEXT_LINES_RANGE.max);
  });
});

describe("UNRESOLVED_CONFIG_PATHS", () => {
  it("reports every path as unresolved", () => {
    expect(UNRESOLVED_CONFIG_PATHS).toEqual({ config: null, keybindings: null, theme: null });
    expect(Object.isFrozen(UNRESOLVED_CONFIG_PATHS)).toBe(true);
  });
});
