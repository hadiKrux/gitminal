import type { ScrollBoxRenderable } from "@opentui/core";
import { describe, expect, it } from "bun:test";
import { searchResultRowId } from "@/features/graph/graph.rows";
import type { SearchResultView } from "@/features/graph/graph.types";
import { readSearchMoveAnchor, readSearchMoveIndex } from "@/features/graph/search.reveal";

/** Results whose ids match the fixture row renderables. */
const RESULTS = [
  { id: "a" },
  { id: "b" },
  { id: "c" },
  { id: "d" },
] as unknown as readonly SearchResultView[];

/** One mounted body row in the fake scrollbox. */
interface MountedRow {
  readonly id: string;
  readonly y: number;
  readonly height: number;
}

/**
 * Builds a scrollbox stub whose content reports the given mounted rows.
 *
 * @param input - Viewport geometry and mounted rows in render order.
 * @returns A scrollbox-shaped object for the search reveal helpers.
 */
function fakeBox(input: {
  readonly viewport: { readonly y: number; readonly height: number };
  readonly rows: readonly MountedRow[];
}): ScrollBoxRenderable {
  return {
    viewport: input.viewport,
    content: {
      getChildren: () => [{ getChildren: () => input.rows }],
    },
  } as unknown as ScrollBoxRenderable;
}

/**
 * Builds a ref holding one fake scrollbox.
 *
 * @param box - Fake scrollbox, or null.
 * @returns The ref object the helpers read.
 */
function refTo(box: ScrollBoxRenderable | null): { current: ScrollBoxRenderable | null } {
  return { current: box };
}

/** Builds the mounted row for one result at a position. */
function resultRow(id: string, y: number, height: number = 2): MountedRow {
  return { id: searchResultRowId(id), y, height };
}

describe("search result reveal", () => {
  it("ignores mounted rows that are not results", () => {
    const box = fakeBox({
      viewport: { y: 2, height: 8 },
      rows: [
        { id: "search-error", y: 2, height: 2 },
        resultRow("a", 4),
        resultRow("b", 6),
        resultRow("c", 8),
        resultRow("d", 10),
      ],
    });

    expect(readSearchMoveAnchor({ scrollRef: refTo(box), results: RESULTS, currentIndex: 9 })).toBe(
      2,
    );
    expect(
      readSearchMoveIndex({
        scrollRef: refTo(box),
        results: RESULTS,
        currentIndex: 9,
        direction: "down",
      }),
    ).toBe(2);
    expect(
      readSearchMoveIndex({
        scrollRef: refTo(box),
        results: RESULTS,
        currentIndex: 1,
        direction: "down",
      }),
    ).toBe(2);
  });

  it("reads variable row heights instead of a fixed row height", () => {
    const box = fakeBox({
      viewport: { y: 0, height: 10 },
      rows: [resultRow("a", 0, 3), resultRow("b", 3), resultRow("c", 5, 5), resultRow("d", 10)],
    });

    expect(readSearchMoveAnchor({ scrollRef: refTo(box), results: RESULTS, currentIndex: 3 })).toBe(
      2,
    );
    expect(readSearchMoveAnchor({ scrollRef: refTo(box), results: RESULTS, currentIndex: 1 })).toBe(
      1,
    );
  });

  it("falls back to the current index before layout or without a box", () => {
    const collapsed = fakeBox({
      viewport: { y: 0, height: 0 },
      rows: [resultRow("a", 0), resultRow("b", 2)],
    });
    const noResults = fakeBox({
      viewport: { y: 0, height: 10 },
      rows: [{ id: "search-loading", y: 0, height: 1 }],
    });

    for (const box of [null, collapsed, noResults]) {
      expect(
        readSearchMoveAnchor({ scrollRef: refTo(box), results: RESULTS, currentIndex: 2 }),
      ).toBe(2);
      expect(
        readSearchMoveIndex({
          scrollRef: refTo(box),
          results: RESULTS,
          currentIndex: 2,
          direction: "down",
        }),
      ).toBe(3);
    }
  });
});
