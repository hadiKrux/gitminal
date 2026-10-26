import { describe, expect, it } from "bun:test";
import { INITIAL_HELP_VIEW_STATE, reduceHelpView } from "@/features/help/help.view";

describe("help view transitions", () => {
  it("starts with an empty query and the cursor on the first row", () => {
    expect(INITIAL_HELP_VIEW_STATE).toEqual({ query: "", selectedIndex: 0 });
  });

  it("returns the cursor to the first row when the query changes", () => {
    const moved = reduceHelpView(
      { query: "nav", selectedIndex: 3 },
      { type: "setQuery", query: "nav.down" },
    );

    expect(moved).toEqual({ query: "nav.down", selectedIndex: 0 });
  });

  it("returns the cursor to the first row when the query is cleared", () => {
    expect(reduceHelpView({ query: "nav", selectedIndex: 3 }, { type: "clearQuery" })).toEqual({
      query: "",
      selectedIndex: 0,
    });
  });

  it("keeps the query while the cursor moves", () => {
    expect(
      reduceHelpView({ query: "nav", selectedIndex: 0 }, { type: "setIndex", index: 2 }),
    ).toEqual({ query: "nav", selectedIndex: 2 });
  });
});
