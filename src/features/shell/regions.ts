import type {
  LayoutMode,
  RegionCursor,
  RegionId,
  ShellLayoutMode,
  SidebarRegionId,
} from "@/features/shell/focus.types";

/** Every region id in screen order, including the console drawer. */
export const REGION_IDS: readonly RegionId[] = Object.freeze([
  "top-bar",
  "branches",
  "remotes",
  "tags",
  "stashes",
  "worktrees",
  "graph",
  "right-pane",
  "diff",
  "console",
]);

/** The five sidebar panels in their stacked order. */
export const SIDEBAR_REGION_IDS: readonly SidebarRegionId[] = Object.freeze([
  "branches",
  "remotes",
  "tags",
  "stashes",
  "worktrees",
]);

/** Tab traversal order from the product spec. The console is reached by its toggle and digit only. */
export const TAB_ORDER: readonly RegionId[] = Object.freeze([
  "top-bar",
  "branches",
  "remotes",
  "tags",
  "stashes",
  "worktrees",
  "graph",
  "right-pane",
  "diff",
]);

/** Direct focus action id for every region. */
export const FOCUS_ACTION_BY_REGION: Readonly<Record<RegionId, string>> = Object.freeze({
  "top-bar": "focus.region.topBar",
  branches: "focus.region.branches",
  remotes: "focus.region.remotes",
  tags: "focus.region.tags",
  stashes: "focus.region.stashes",
  worktrees: "focus.region.worktrees",
  graph: "focus.region.graph",
  "right-pane": "focus.region.rightPane",
  diff: "focus.region.diff",
  console: "focus.region.console",
});

/** Target minimum terminal width in columns. */
export const MIN_TERMINAL_WIDTH = 100;

/** Target minimum terminal height in rows. */
export const MIN_TERMINAL_HEIGHT = 30;

/** Width below which the shell is replaced by the too-small notice. */
export const ENFORCED_MIN_TERMINAL_WIDTH = 80;

/** Height below which the shell is replaced by the too-small notice. */
export const ENFORCED_MIN_TERMINAL_HEIGHT = 24;

/** Width below which the sidebar collapses to a single panel with its switcher. */
const SIDEBAR_COLLAPSE_WIDTH = 90;

/** Id of the native switcher used by the collapsed sidebar. */
export const SIDEBAR_SWITCHER_ID = "sidebar-panel-switcher";

/** Minimum columns required for the too-small notice ASCII wordmark. */
export const NOTICE_WORDMARK_MIN_COLUMNS = 40;

/** Minimum rows required for the too-small notice ASCII wordmark. */
export const NOTICE_WORDMARK_MIN_ROWS = 10;

/** Sidebar width per layout mode. */
export const SIDEBAR_WIDTHS: Readonly<Record<ShellLayoutMode, number>> = Object.freeze({
  full: 26,
  narrow: 20,
  "sidebar-collapsed": 26,
});

/**
 * Builds the stable renderable id of a region frame.
 *
 * @param regionId - The region whose frame id is needed.
 * @returns The frame id in the `region-<id>` form.
 */
export function regionFrameId(regionId: RegionId): string {
  return `region-${regionId}`;
}

/**
 * Builds a composite cursor identity from stable parts.
 *
 * The separator is printable ASCII so the value satisfies the glyph rules and can be logged in
 * tests without escaping.
 *
 * @param parts - Stable identity parts, such as a section name and a file path.
 * @returns The joined cursor identity.
 */
export function cursorKey(...parts: readonly (string | number)[]): RegionCursor {
  return parts.join("::");
}

/**
 * Reports whether a value is one of the documented region ids.
 *
 * @param value - Candidate id.
 * @returns True when the value names a region.
 */
function isRegionId(value: string): value is RegionId {
  return (REGION_IDS as readonly string[]).includes(value);
}

/**
 * Resolves the region that owns a region frame id.
 *
 * The frame id is the only marker focus derivation needs, so the lookup is a direct prefix strip
 * plus catalogue validation.
 *
 * @param id - Renderable id.
 * @returns The region id, or `null` when the renderable is not a region frame.
 */
export function regionFromFrameId(id: string): RegionId | null {
  if (!id.startsWith("region-")) {
    return null;
  }

  const candidate = id.slice("region-".length);

  return isRegionId(candidate) ? candidate : null;
}

/**
 * Reports whether a region is one of the five sidebar panels.
 *
 * @param regionId - Region to inspect.
 * @returns True for the sidebar panel regions.
 */
export function isSidebarRegion(regionId: RegionId): regionId is SidebarRegionId {
  return (SIDEBAR_REGION_IDS as readonly RegionId[]).includes(regionId);
}

/**
 * Returns the sidebar switcher index for a panel region.
 *
 * @param regionId - Sidebar panel region.
 * @returns The zero-based panel index.
 */
export function sidebarPanelIndex(regionId: SidebarRegionId): number {
  return SIDEBAR_REGION_IDS.indexOf(regionId);
}

/**
 * Resolves the responsive layout mode from terminal dimensions.
 *
 * Below 80 columns or 24 rows the shell cannot render usefully and the too-small notice replaces
 * it. Between 80 and 89 columns the sidebar collapses to one panel. Between 90 and 99 columns the
 * sidebar narrows but all five panels stay visible.
 *
 * @param width - Terminal width in columns.
 * @param height - Terminal height in rows.
 * @returns The layout mode for the current size.
 */
export function resolveLayoutMode(width: number, height: number): LayoutMode {
  if (width < ENFORCED_MIN_TERMINAL_WIDTH || height < ENFORCED_MIN_TERMINAL_HEIGHT) {
    return "too-small";
  }

  if (width < SIDEBAR_COLLAPSE_WIDTH) {
    return "sidebar-collapsed";
  }

  if (width < MIN_TERMINAL_WIDTH) {
    return "narrow";
  }

  return "full";
}

/**
 * Builds the Tab order for a layout mode.
 *
 * The console is never in the Tab cycle. In the collapsed layout only the selected sidebar panel
 * stays visible, so the other four panels are skipped.
 *
 * @param layoutMode - Current shell layout mode.
 * @param activeSidebarPanel - Selected sidebar panel index for the collapsed layout.
 * @returns The visible regions in traversal order.
 */
export function resolveEffectiveTabOrder(
  layoutMode: ShellLayoutMode,
  activeSidebarPanel: number,
): readonly RegionId[] {
  if (layoutMode !== "sidebar-collapsed") {
    return TAB_ORDER;
  }

  const activePanel =
    SIDEBAR_REGION_IDS[clampPanelIndex(activeSidebarPanel)] ?? SIDEBAR_REGION_IDS[0];

  return TAB_ORDER.filter((regionId) => !isSidebarRegion(regionId) || regionId === activePanel);
}

/**
 * Resolves the next or previous region in a Tab order, wrapping at both ends.
 *
 * @param order - Effective traversal order.
 * @param current - Currently focused region, or `null` before the first focus.
 * @param direction - `1` for next and `-1` for previous.
 * @returns The adjacent region, or `null` when the order is empty.
 */
export function resolveAdjacentRegion(
  order: readonly RegionId[],
  current: RegionId | null,
  direction: 1 | -1,
): RegionId | null {
  if (order.length === 0) {
    return null;
  }

  const currentIndex = current === null ? -1 : order.indexOf(current);

  if (currentIndex < 0) {
    return direction === 1 ? (order[0] ?? null) : (order[order.length - 1] ?? null);
  }

  const nextIndex = (currentIndex + direction + order.length) % order.length;

  return order[nextIndex] ?? null;
}

/**
 * Clamps a sidebar panel index into the valid range.
 *
 * @param index - Candidate index.
 * @returns A valid index for the five-panel stack.
 */
function clampPanelIndex(index: number): number {
  if (!Number.isInteger(index) || index < 0) {
    return 0;
  }

  return Math.min(index, SIDEBAR_REGION_IDS.length - 1);
}
