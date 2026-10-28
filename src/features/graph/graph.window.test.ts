import type { ScrollBoxRenderable } from "@opentui/core";
import { describe, expect, it } from "bun:test";
import { GRAPH_ROW_HEIGHT } from "@/features/graph/graph.constants";
import { graphRowRenderableId } from "@/features/graph/graph.rows";
import {
  readGraphMoveAnchor,
  readGraphRowOriginLines,
  readGraphVisibleRows,
  readTerminalRowCapacity,
  readViewportRowCapacity,
} from "@/features/graph/graph.window";

describe("graph row capacity", () => {
  it("derives the row count from the measured viewport height", () => {
    expect(readViewportRowCapacity(17)).toBe(Math.floor(17 / GRAPH_ROW_HEIGHT));
    expect(readViewportRowCapacity(15)).toBe(7);
    expect(readViewportRowCapacity(GRAPH_ROW_HEIGHT + 1)).toBe(1);
    expect(readViewportRowCapacity(0)).toBe(1);
  });

  it("reserves the panel chrome only in the first-frame estimate", () => {
    expect(readTerminalRowCapacity(24)).toBe(10);
  });
});

describe("graph visible row range", () => {
  it("maps a native scroll offset to the rows the viewport shows", () => {
    expect(readGraphVisibleRows(0, 10)).toEqual({ first: 0, last: 4 });
    expect(readGraphVisibleRows(6, 10)).toEqual({ first: 3, last: 7 });
    expect(readGraphVisibleRows(1, 10)).toEqual({ first: 0, last: 4 });
    expect(readGraphVisibleRows(0, 0)).toEqual({ first: 0, last: 0 });
    expect(readGraphVisibleRows(Number.NaN, 10)).toEqual({ first: 0, last: 4 });
    expect(readGraphVisibleRows(6, 10, 2)).toEqual({ first: 2, last: 6 });
  });

  it("anchors an out-of-view cursor to the nearest visible edge", () => {
    const visible = { first: 3, last: 7 };

    expect(readGraphMoveAnchor(0, visible)).toBe(3);
    expect(readGraphMoveAnchor(9, visible)).toBe(7);
    expect(readGraphMoveAnchor(5, visible)).toBe(5);
    expect(readGraphMoveAnchor(3, visible)).toBe(3);
    expect(readGraphMoveAnchor(7, visible)).toBe(7);
  });
});

/**
 * Builds a scrollbox stub for the origin reader.
 *
 * @param input - Viewport geometry, native offset, and laid-out rows.
 * @returns A scrollbox-shaped object the helper can read.
 */
function fakeOriginBox(input: {
  readonly viewport: { readonly y: number; readonly height: number };
  readonly scrollTop: number;
  readonly rows: readonly { readonly id: string; readonly y: number; readonly height: number }[];
}): ScrollBoxRenderable {
  return {
    scrollTop: input.scrollTop,
    viewport: input.viewport,
    content: {
      findDescendantById: (id: string) => input.rows.find((row) => row.id === id),
    },
  } as unknown as ScrollBoxRenderable;
}

describe("graph row origin", () => {
  it("converts the first row's laid-out position back into content lines", () => {
    const box = fakeOriginBox({
      viewport: { y: 2, height: 10 },
      scrollTop: 3,
      rows: [{ id: graphRowRenderableId("pending"), y: 5, height: 2 }],
    });

    expect(readGraphRowOriginLines(box, "pending")).toBe(6);
  });

  it("falls back to zero without a row, before layout, or above the content", () => {
    const missing = fakeOriginBox({ viewport: { y: 2, height: 10 }, scrollTop: 3, rows: [] });
    const unlaid = fakeOriginBox({
      viewport: { y: 2, height: 10 },
      scrollTop: 3,
      rows: [{ id: graphRowRenderableId("pending"), y: 5, height: 0 }],
    });
    const above = fakeOriginBox({
      viewport: { y: 5, height: 10 },
      scrollTop: 0,
      rows: [{ id: graphRowRenderableId("pending"), y: 1, height: 2 }],
    });

    expect(readGraphRowOriginLines(missing, "pending")).toBe(0);
    expect(readGraphRowOriginLines(missing, null)).toBe(0);
    expect(readGraphRowOriginLines(unlaid, "pending")).toBe(0);
    expect(readGraphRowOriginLines(above, "pending")).toBe(0);
  });
});
