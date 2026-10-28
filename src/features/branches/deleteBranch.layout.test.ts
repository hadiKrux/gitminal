import { describe, expect, it } from "bun:test";
import {
  DELETE_BRANCH_HAS_MORE_NOTICE,
  DELETE_BRANCH_RESERVED_ROWS,
  DELETE_BRANCH_SCROLL_HINT,
} from "@/features/branches/DeleteBranchModal.constants";
import {
  readDeleteBranchFooterLabels,
  readDeleteBranchLayout,
} from "@/features/branches/deleteBranch.layout";
import { MODAL_VERTICAL_INSET } from "@/ui/ModalFrame.constants";

/** One layout case: terminal size and the at-risk commit count it reads. */
interface LayoutCase {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly commitCount: number;
  readonly hasMore: boolean;
  readonly expectedHeight: number;
  readonly expectedListHeight: number;
}

/**
 * Layout cases at the enforced minimum and at the target terminal size.
 *
 * The branch name is deliberately absent from the layout input: every fixed line is truncated to
 * the content width and rendered on one row, so a long branch name cannot consume a reserved row.
 * The long-name rendering itself is covered by the Delete Branch modal test.
 */
const LAYOUT_CASES: readonly LayoutCase[] = [
  {
    name: "80x24 with no commits",
    width: 80,
    height: 24,
    commitCount: 0,
    hasMore: false,
    expectedHeight: 20,
    expectedListHeight: 0,
  },
  {
    name: "80x24 with two commits",
    width: 80,
    height: 24,
    commitCount: 2,
    hasMore: false,
    expectedHeight: 20,
    expectedListHeight: 1,
  },
  {
    name: "80x24 with twenty commits",
    width: 80,
    height: 24,
    commitCount: 20,
    hasMore: false,
    expectedHeight: 20,
    expectedListHeight: 1,
  },
  {
    name: "80x24 with a capped twenty-one commit read",
    width: 80,
    height: 24,
    commitCount: 21,
    hasMore: true,
    expectedHeight: 20,
    expectedListHeight: 1,
  },
  {
    name: "100x32 with no commits",
    width: 100,
    height: 32,
    commitCount: 0,
    hasMore: false,
    expectedHeight: 20,
    expectedListHeight: 0,
  },
  {
    name: "100x32 with two commits",
    width: 100,
    height: 32,
    commitCount: 2,
    hasMore: false,
    expectedHeight: 22,
    expectedListHeight: 2,
  },
  {
    name: "100x32 with twenty commits",
    width: 100,
    height: 32,
    commitCount: 20,
    hasMore: false,
    expectedHeight: 28,
    expectedListHeight: 9,
  },
  {
    name: "100x32 with a capped twenty-one commit read",
    width: 100,
    height: 32,
    commitCount: 21,
    hasMore: true,
    expectedHeight: 28,
    expectedListHeight: 9,
  },
];

describe("readDeleteBranchLayout", () => {
  for (const layoutCase of LAYOUT_CASES) {
    it(`reserves the fixed rows and keeps the list inside the modal at ${layoutCase.name}`, () => {
      const layout = readDeleteBranchLayout({
        terminalWidth: layoutCase.width,
        terminalHeight: layoutCase.height,
        commitCount: layoutCase.commitCount,
        hasMore: layoutCase.hasMore,
      });
      const availableHeight = layoutCase.height - MODAL_VERTICAL_INSET * 2;

      expect(layout.modalHeight).toBe(layoutCase.expectedHeight);
      expect(layout.listHeight).toBe(layoutCase.expectedListHeight);
      expect(layout.listHeight).toBeLessThanOrEqual(layoutCase.commitCount);
      expect(layout.modalHeight).toBeLessThanOrEqual(availableHeight);
      expect(layout.modalHeight).toBeGreaterThanOrEqual(
        DELETE_BRANCH_RESERVED_ROWS + layout.listHeight,
      );
      expect(layout.contentWidth).toBe(60);
    });
  }

  it("keeps one row for the shortened cap notice at the modal content width", () => {
    expect(DELETE_BRANCH_HAS_MORE_NOTICE.length).toBeLessThanOrEqual(62);
    expect(DELETE_BRANCH_SCROLL_HINT.length).toBeLessThanOrEqual(62);
  });

  it("keeps both footer labels inside a narrow content width", () => {
    const footer = readDeleteBranchFooterLabels({
      contentWidth: 22,
      confirmLabel: "Delete local and remote branch",
      cancelLabel: "Cancel",
    });

    expect(footer.cancelLabel).toBe("Cancel");
    expect(footer.confirmLabel.length + footer.cancelLabel.length).toBeLessThanOrEqual(17);
    expect(footer.confirmLabel).toContain("...");
  });

  it("leaves the footer labels unchanged when they already fit", () => {
    const footer = readDeleteBranchFooterLabels({
      contentWidth: 62,
      confirmLabel: "Delete local and remote branch",
      cancelLabel: "Cancel",
    });

    expect(footer).toEqual({
      confirmLabel: "Delete local and remote branch",
      cancelLabel: "Cancel",
    });
  });
});
