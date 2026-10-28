import type { DiffSection } from "@/domain/diff/diff.types";

/** Every section expanded by default, per F-11. */
export const INITIAL_SECTION_EXPANSION: Readonly<Record<DiffSection, boolean>> = Object.freeze({
  working: true,
  staged: true,
  untracked: true,
});

/** Empty-state text per section. */
export const SECTION_EMPTY_TEXT: Readonly<Record<DiffSection, string>> = Object.freeze({
  working: "No unstaged changes",
  staged: "No staged changes",
  untracked: "No untracked files",
});

/** Renderable id of the diff panel scroll surface. */
export const DIFF_SCROLL_ID = "diff-scroll";

/** Rows moved by one plain scroll step. */
export const DIFF_SCROLL_LINES = 1;

/** Rows moved by one fast scroll step. */
export const DIFF_SCROLL_FAST_LINES = 5;

/** Columns moved by one horizontal scroll step. */
export const DIFF_SCROLL_COLUMNS = 8;

/**
 * Columns reserved for the diff panel's vertical scrollbar.
 *
 * An explicit column width keeps the bar inside the panel frame, so a diff line that widens the
 * content past the viewport cannot push the auto-sized bar over the panel border.
 */
export const DIFF_SCROLLBAR_WIDTH = 1;

/** Bulk action labels per F-11. */
export const BULK_LABELS = Object.freeze({
  stageAll: "Stage All",
  unstageAll: "Unstage All",
  discardAll: "Discard All",
  deleteAll: "Delete All",
});
