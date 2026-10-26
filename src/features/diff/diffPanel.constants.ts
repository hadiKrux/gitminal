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

/** Bulk action labels per F-11. */
export const BULK_LABELS = Object.freeze({
  stageAll: "Stage All",
  unstageAll: "Unstage All",
  discardAll: "Discard All",
  deleteAll: "Delete All",
});
