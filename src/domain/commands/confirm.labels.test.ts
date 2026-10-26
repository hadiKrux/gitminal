import { describe, expect, it } from "bun:test";
import {
  CONFIRM_LABEL_WARNING,
  CONFIRM_LABELS,
  formatDeleteAllUntrackedLabel,
  isExactConfirmLabel,
  readConfirmLabelWarning,
} from "@/domain/commands/confirm.labels";

describe("confirm labels", () => {
  it("pins the literal F-15 labels including the untracked delete label", () => {
    expect(Object.values(CONFIRM_LABELS)).toEqual([
      "Discard changes",
      "Delete untracked file",
      "Delete local branch",
      "Delete local and remote branch",
      "Drop stash",
      "Delete tag",
      "Delete worktree",
      "Force push safely",
      "Overwrite remote",
    ]);
  });

  it("accepts every exact F-15 label, the count-naming bulk label, and rejects generic words", () => {
    for (const label of Object.values(CONFIRM_LABELS)) {
      expect(isExactConfirmLabel(label), label).toBe(true);
    }

    expect(isExactConfirmLabel(formatDeleteAllUntrackedLabel(3))).toBe(true);
    expect(formatDeleteAllUntrackedLabel(3)).toBe("Delete 3 untracked files");
    expect(formatDeleteAllUntrackedLabel(1)).toBe("Delete 1 untracked file");
    expect(isExactConfirmLabel("OK")).toBe(false);
    expect(isExactConfirmLabel(" yes ")).toBe(false);
    expect(isExactConfirmLabel("Delete 0 untracked files")).toBe(false);
  });

  it("warns only for a destructive confirmation with an unrecognized label", () => {
    expect(readConfirmLabelWarning(true, CONFIRM_LABELS.overwriteRemote)).toBeNull();
    expect(readConfirmLabelWarning(false, "OK")).toBeNull();
    expect(readConfirmLabelWarning(true, "OK")).toBe(CONFIRM_LABEL_WARNING);
  });
});
