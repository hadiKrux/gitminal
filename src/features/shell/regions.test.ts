import { describe, expect, it } from "bun:test";
import {
  cursorKey,
  FOCUS_ACTION_BY_REGION,
  REGION_IDS,
  regionFrameId,
  regionFromFrameId,
  resolveAdjacentRegion,
  resolveEffectiveTabOrder,
  resolveLayoutMode,
  SIDEBAR_REGION_IDS,
  sidebarPanelIndex,
  TAB_ORDER,
} from "@/features/shell/regions";

describe("region catalogue", () => {
  it("matches the documented region list", () => {
    expect(REGION_IDS).toEqual([
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
  });

  it("uses the product spec Tab order without the console", () => {
    expect(TAB_ORDER).toEqual([
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
    expect(new Set(TAB_ORDER).size).toBe(TAB_ORDER.length);
    expect(TAB_ORDER).not.toContain("console");
  });

  it("gives every region exactly one direct focus action", () => {
    const actions = REGION_IDS.map((regionId) => FOCUS_ACTION_BY_REGION[regionId]);

    expect(actions).toHaveLength(REGION_IDS.length);
    expect(new Set(actions).size).toBe(REGION_IDS.length);
    expect(FOCUS_ACTION_BY_REGION["top-bar"]).toBe("focus.region.topBar");
    expect(FOCUS_ACTION_BY_REGION["right-pane"]).toBe("focus.region.rightPane");
    expect(FOCUS_ACTION_BY_REGION.console).toBe("focus.region.console");
  });

  it("maps frame ids back to regions and rejects unknown ids", () => {
    expect(regionFrameId("branches")).toBe("region-branches");
    expect(regionFromFrameId("region-branches")).toBe("branches");
    expect(regionFromFrameId("region-unknown")).toBeNull();
    expect(regionFromFrameId("panel-branches")).toBeNull();
  });

  it("orders the sidebar panels as the mockup does", () => {
    expect(SIDEBAR_REGION_IDS).toEqual(["branches", "remotes", "tags", "stashes", "worktrees"]);
    expect(sidebarPanelIndex("tags")).toBe(2);
  });

  it("builds composite cursor identities", () => {
    expect(cursorKey("diff", "working", "src/a.ts")).toBe("diff::working::src/a.ts");
  });
});

describe("resolveLayoutMode", () => {
  it("uses the documented breakpoints", () => {
    expect(resolveLayoutMode(120, 40)).toBe("full");
    expect(resolveLayoutMode(100, 30)).toBe("full");
    expect(resolveLayoutMode(99, 30)).toBe("narrow");
    expect(resolveLayoutMode(90, 30)).toBe("narrow");
    expect(resolveLayoutMode(89, 30)).toBe("sidebar-collapsed");
    expect(resolveLayoutMode(80, 24)).toBe("sidebar-collapsed");
    expect(resolveLayoutMode(79, 30)).toBe("too-small");
    expect(resolveLayoutMode(100, 23)).toBe("too-small");
  });
});

describe("resolveEffectiveTabOrder", () => {
  it("keeps every region visible in full and narrow layouts", () => {
    expect(resolveEffectiveTabOrder("full", 0)).toEqual(TAB_ORDER);
    expect(resolveEffectiveTabOrder("narrow", 3)).toEqual(TAB_ORDER);
  });

  it("skips the hidden sidebar panels in the collapsed layout", () => {
    expect(resolveEffectiveTabOrder("sidebar-collapsed", 2)).toEqual([
      "top-bar",
      "tags",
      "graph",
      "right-pane",
      "diff",
    ]);
  });

  it("clamps an invalid collapsed index to the nearest valid panel", () => {
    expect(resolveEffectiveTabOrder("sidebar-collapsed", 99)).toEqual([
      "top-bar",
      "worktrees",
      "graph",
      "right-pane",
      "diff",
    ]);
    expect(resolveEffectiveTabOrder("sidebar-collapsed", -1)).toEqual([
      "top-bar",
      "branches",
      "graph",
      "right-pane",
      "diff",
    ]);
  });
});

describe("resolveAdjacentRegion", () => {
  it("wraps in both directions", () => {
    expect(resolveAdjacentRegion(TAB_ORDER, "diff", 1)).toBe("top-bar");
    expect(resolveAdjacentRegion(TAB_ORDER, "top-bar", -1)).toBe("diff");
  });

  it("enters at the first or last region when nothing is focused", () => {
    expect(resolveAdjacentRegion(TAB_ORDER, null, 1)).toBe("top-bar");
    expect(resolveAdjacentRegion(TAB_ORDER, null, -1)).toBe("diff");
  });

  it("returns null for an empty order", () => {
    expect(resolveAdjacentRegion([], "graph", 1)).toBeNull();
  });
});
