import { describe, expect, it } from "bun:test";
import {
  CONFIRM_LABEL_WARNING,
  CONFIRM_LABELS,
  isExactConfirmLabel,
  readConfirmLabelWarning,
} from "@/domain/commands/confirm.labels";

describe("confirm labels", () => {
  it("pins the literal eight F-15 labels", () => {
    expect(Object.values(CONFIRM_LABELS)).toEqual([
      "Discard changes",
      "Delete local branch",
      "Delete local and remote branch",
      "Drop stash",
      "Delete tag",
      "Delete worktree",
      "Force push safely",
      "Overwrite remote",
    ]);
  });

  it("accepts every exact F-15 label and rejects generic approval words", () => {
    for (const label of Object.values(CONFIRM_LABELS)) {
      expect(isExactConfirmLabel(label), label).toBe(true);
    }

    expect(isExactConfirmLabel("OK")).toBe(false);
    expect(isExactConfirmLabel(" yes ")).toBe(false);
  });

  it("warns only for a destructive confirmation with an unrecognized label", () => {
    expect(readConfirmLabelWarning(true, CONFIRM_LABELS.overwriteRemote)).toBeNull();
    expect(readConfirmLabelWarning(false, "OK")).toBeNull();
    expect(readConfirmLabelWarning(true, "OK")).toBe(CONFIRM_LABEL_WARNING);
  });
});
