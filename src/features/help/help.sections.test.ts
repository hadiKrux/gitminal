import { describe, expect, it } from "bun:test";
import type { KeymapHelpRow } from "@/domain/keymap/keymap.types";
import {
  buildHelpSections,
  countFilteredRows,
  flattenSections,
  readFocusSection,
  readHelpSectionId,
  readSelectedSection,
  toggleCollapsed,
} from "@/features/help/help.sections";
import type { HelpRowView, HelpSectionId } from "@/features/help/useHelp.types";

/**
 * Builds one help row fixture.
 *
 * @param actionId - Action id.
 * @param sectionId - Section the row belongs to.
 * @returns The row.
 */
function row(actionId: string, sectionId: HelpSectionId): HelpRowView {
  return {
    actionId,
    label: actionId,
    description: `${actionId} description`,
    keys: [],
    sectionId,
    unavailableReason: null,
  };
}

/** A small row set spanning three sections. */
const ROWS: readonly HelpRowView[] = [
  row("app.help", "global"),
  row("graph.search", "graph"),
  row("diff.stage", "diff"),
];

describe("buildHelpSections", () => {
  it("renders every section in the documented order when no query is active", () => {
    const sections = buildHelpSections({
      rows: ROWS,
      query: "",
      collapsedSections: [],
      focusSection: null,
    });

    expect(sections.length).toBeGreaterThan(ROWS.length);
    expect(sections.map((section) => section.id)).toContain("configuration");
    expect(countFilteredRows(sections)).toBe(ROWS.length);
  });

  it("keeps the focus section first and filters matches", () => {
    const sections = buildHelpSections({
      rows: ROWS,
      query: "GRAPH",
      collapsedSections: [],
      focusSection: "graph",
    });

    expect(sections).toHaveLength(1);
    expect(sections[0]?.id).toBe("graph");
    expect(sections[0]?.rows.map((candidate) => candidate.actionId)).toEqual(["graph.search"]);
  });

  it("keeps a collapsed section with its rows so the header still renders", () => {
    const sections = buildHelpSections({
      rows: ROWS,
      query: "",
      collapsedSections: ["global"],
      focusSection: null,
    });
    const global = sections.find((section) => section.id === "global");

    expect(global?.collapsed).toBeTrue();
    expect(global?.rows).toHaveLength(1);
    expect(countFilteredRows(sections)).toBe(ROWS.length);
    expect(flattenSections(sections).map((candidate) => candidate.actionId)).not.toContain(
      "app.help",
    );
  });

  it("expands every matching section while a query is active", () => {
    const sections = buildHelpSections({
      rows: ROWS,
      query: "description",
      collapsedSections: ["global", "graph", "diff"],
      focusSection: null,
    });

    expect(sections.map((section) => section.id)).toEqual(["global", "graph", "diff"]);
    expect(sections.every((section) => !section.collapsed)).toBeTrue();
  });
});

describe("countFilteredRows", () => {
  it("ignores collapse state and counts only filtered rows", () => {
    const collapsed = buildHelpSections({
      rows: ROWS,
      query: "",
      collapsedSections: ["global", "graph", "diff"],
      focusSection: null,
    });

    expect(countFilteredRows(collapsed)).toBe(ROWS.length);

    const filtered = buildHelpSections({
      rows: ROWS,
      query: "nothing-matches",
      collapsedSections: [],
      focusSection: null,
    });

    expect(countFilteredRows(filtered)).toBe(0);
  });
});

describe("readSelectedSection", () => {
  it("reads the section that owns the selected action", () => {
    const sections = buildHelpSections({
      rows: ROWS,
      query: "",
      collapsedSections: [],
      focusSection: null,
    });

    expect(readSelectedSection(sections, "diff.stage")).toBe("diff");
    expect(readSelectedSection(sections, null)).toBeNull();
    expect(readSelectedSection(sections, "not.in.catalogue")).toBeNull();
  });
});

describe("toggleCollapsed", () => {
  it("adds and removes one section without touching the others", () => {
    expect(toggleCollapsed([], "graph", true)).toEqual(["graph"]);
    expect(toggleCollapsed(["graph"], "graph", true)).toEqual(["graph"]);
    expect(toggleCollapsed(["graph", "diff"], "graph", false)).toEqual(["diff"]);
    expect(toggleCollapsed(["graph"], "graph", false)).toEqual([]);
  });
});

describe("readHelpSectionId", () => {
  it("maps categories and context-dependent navigation rows", () => {
    const navigation = {
      actionId: "nav.down",
      label: "Move down",
      description: "down",
      category: "navigation",
      contexts: ["overlay"],
      keys: ["Down"],
      bindingContext: "right-pane",
    } satisfies KeymapHelpRow;

    expect(readHelpSectionId(navigation, true)).toBe("composer");
    expect(readHelpSectionId(navigation, false)).toBe("details");
  });
});

describe("readFocusSection", () => {
  it("maps the focused context and returns null without focus", () => {
    expect(readFocusSection(null, false)).toBeNull();
    expect(readFocusSection("top-bar", false)).toBe("topBar");
    expect(readFocusSection("right-pane", true)).toBe("composer");
  });
});
