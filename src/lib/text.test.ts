import { describe, expect, it } from "bun:test";
import { outdentLeadingIndent, TEXT_INDENT_UNIT, truncateText } from "@/lib/text";

describe("truncateText", () => {
  it("returns text that already fits", () => {
    expect(truncateText("Branches", 10)).toBe("Branches");
  });

  it("shortens text and appends the ellipsis", () => {
    expect(truncateText("Commit graph search results", 15)).toBe("Commit graph...");
  });

  it("returns an empty string for a non-positive budget", () => {
    expect(truncateText("anything", 0)).toBe("");
    expect(truncateText("anything", -4)).toBe("");
  });

  it("cuts the text when the ellipsis itself does not fit", () => {
    expect(truncateText("Branches", 2)).toBe("Br");
  });
});

describe("outdentLeadingIndent", () => {
  it("removes up to one indent unit of spaces", () => {
    expect(outdentLeadingIndent("    child")).toEqual({ text: "  child", removed: 2 });
    expect(outdentLeadingIndent(" child")).toEqual({ text: "child", removed: 1 });
  });

  it("removes a single leading tab as one unit", () => {
    expect(outdentLeadingIndent("\tchild")).toEqual({ text: "child", removed: 1 });
  });

  it("does nothing when the line has no leading indent", () => {
    expect(outdentLeadingIndent("child")).toEqual({ text: "child", removed: 0 });
  });

  it("uses the shared two-space indent unit", () => {
    expect(TEXT_INDENT_UNIT).toBe("  ");
  });
});
