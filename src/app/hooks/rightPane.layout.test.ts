import { describe, expect, it } from "bun:test";
import { RIGHT_PANE_MIN_ROWS, readRightPaneRows } from "@/app/hooks/rightPane.layout";

describe("readRightPaneRows", () => {
  it("reserves the composer minimum while the one-fifth share is smaller", () => {
    expect(readRightPaneRows(0)).toBe(RIGHT_PANE_MIN_ROWS);
    expect(readRightPaneRows(20)).toBe(RIGHT_PANE_MIN_ROWS);
    expect(readRightPaneRows(36)).toBe(RIGHT_PANE_MIN_ROWS);
  });

  it("follows the one-fifth share once it exceeds the minimum", () => {
    expect(readRightPaneRows(61)).toBe(12);
    expect(readRightPaneRows(66)).toBe(13);
    expect(readRightPaneRows(76)).toBe(15);
  });

  it("clamps when the column cannot hold both surface minimums", () => {
    expect(readRightPaneRows(8)).toBe(4);
  });
});
