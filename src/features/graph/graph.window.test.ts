import { describe, expect, it } from "bun:test";
import {
  GRAPH_ROW_HEIGHT,
  GRAPH_SCROLL_MAX_STEPS,
  GRAPH_SCROLL_STEP_ROWS,
} from "@/features/graph/graph.constants";
import {
  computeVisibleWindow,
  moveIndexByRows,
  readScrollRowDelta,
  readStatusFooterLines,
  readTerminalRowCapacity,
  readViewportRowCapacity,
} from "@/features/graph/graph.window";

describe("graph wheel movement", () => {
  it("moves a bounded step in the wheel direction", () => {
    expect(readScrollRowDelta("down", 1)).toBe(GRAPH_SCROLL_STEP_ROWS);
    expect(readScrollRowDelta("up", 1)).toBe(-GRAPH_SCROLL_STEP_ROWS);
  });

  it("caps a large delta and ignores a horizontal wheel", () => {
    expect(readScrollRowDelta("down", 100)).toBe(GRAPH_SCROLL_STEP_ROWS * GRAPH_SCROLL_MAX_STEPS);
    expect(readScrollRowDelta("left", 1)).toBe(0);
    expect(readScrollRowDelta("right", 1)).toBe(0);
  });

  it("treats a missing or zero magnitude as one notch", () => {
    expect(readScrollRowDelta("down", 0)).toBe(GRAPH_SCROLL_STEP_ROWS);
  });

  it("clamps the moved cursor into the list", () => {
    expect(moveIndexByRows(0, 10, 3)).toBe(3);
    expect(moveIndexByRows(1, 10, -5)).toBe(0);
    expect(moveIndexByRows(8, 10, 9)).toBe(9);
    expect(moveIndexByRows(4, 0, 3)).toBe(0);
  });
});

describe("graph visible window", () => {
  it("keeps the selected row inside the first visible rows at the end of the list", () => {
    const window = computeVisibleWindow(30, 29, 7, 4);

    expect(window.start).toBe(23);
    expect(window.end).toBe(30);
    expect(29 - window.start).toBeLessThan(7);
  });

  it("keeps the selected row visible in the middle and at the start", () => {
    const middle = computeVisibleWindow(30, 15, 7, 4);
    const start = computeVisibleWindow(30, 0, 7, 4);

    expect(15 - middle.start).toBeLessThan(7);
    expect(middle.start).toBe(9);
    expect(start).toEqual({ start: 0, end: 11 });
  });

  it("returns an empty window for an empty list", () => {
    expect(computeVisibleWindow(0, 5, 7, 4)).toEqual({ start: 0, end: 0 });
  });
});

describe("graph row capacity", () => {
  it("derives the row count from the measured viewport height", () => {
    expect(readViewportRowCapacity(17)).toBe(Math.floor(17 / GRAPH_ROW_HEIGHT));
    expect(readViewportRowCapacity(15)).toBe(7);
    expect(readViewportRowCapacity(GRAPH_ROW_HEIGHT + 1)).toBe(1);
    expect(readViewportRowCapacity(0)).toBe(1);
  });

  it("reserves panel chrome and footer lines only in the first-frame estimate", () => {
    expect(readTerminalRowCapacity(24)).toBe(10);
    expect(readTerminalRowCapacity(24, 7)).toBe(6);
  });
});

describe("graph status footer lines", () => {
  it("counts only the rows the current state renders", () => {
    expect(
      readStatusFooterLines({
        isLoadingOlder: false,
        hasWalkError: false,
        hasPageError: false,
        hasPageErrorDetails: false,
        isDone: false,
      }),
    ).toBe(0);

    expect(
      readStatusFooterLines({
        isLoadingOlder: true,
        hasWalkError: false,
        hasPageError: false,
        hasPageErrorDetails: false,
        isDone: true,
      }),
    ).toBe(3);
  });

  it("pins the bounded single-line and wrapped footer heights", () => {
    expect(
      readStatusFooterLines({
        isLoadingOlder: false,
        hasWalkError: true,
        hasPageError: true,
        hasPageErrorDetails: false,
        isDone: true,
      }),
    ).toBe(5);

    expect(
      readStatusFooterLines({
        isLoadingOlder: false,
        hasWalkError: false,
        hasPageError: true,
        hasPageErrorDetails: true,
        isDone: false,
      }),
    ).toBe(3);

    expect(
      readStatusFooterLines({
        isLoadingOlder: true,
        hasWalkError: true,
        hasPageError: true,
        hasPageErrorDetails: true,
        isDone: true,
      }),
    ).toBe(7);
  });
});
