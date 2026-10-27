import { DEFAULT_THEME_NAME } from "@/domain/theme/theme.catppuccin";
import type { ConfigFilePaths, GitminalConfig } from "./config.types";

/** Current configuration schema version. */
export const DEFAULT_CONFIG_VERSION = 1;

/** Allowed commit graph page-size range. */
export const GRAPH_PAGE_SIZE_RANGE = Object.freeze({ min: 100, max: 2000 });

/** Allowed diff context-line range. */
export const DIFF_CONTEXT_LINES_RANGE = Object.freeze({ min: 0, max: 20 });

/** The effective configuration used when no files exist or before any file loads. */
export const DEFAULT_CONFIG: GitminalConfig = Object.freeze({
  version: DEFAULT_CONFIG_VERSION,
  git: Object.freeze({ path: "git" }),
  theme: DEFAULT_THEME_NAME,
  ui: Object.freeze({ mouse: true }),
  graph: Object.freeze({ scope: "all", initialPageSize: 500, style: "rounded" }),
  diff: Object.freeze({ contextLines: 3, expandFirstWorkingFile: true }),
  stash: Object.freeze({ includeUntrackedByDefault: false }),
  remote: Object.freeze({ fetchScope: "local" }),
  keybindings: Object.freeze({}),
});

/** Paths reported before `config.paths.ts` resolves them. */
export const UNRESOLVED_CONFIG_PATHS: ConfigFilePaths = Object.freeze({
  config: null,
  keybindings: null,
  theme: null,
});
