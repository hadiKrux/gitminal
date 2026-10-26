import { describe, expect, it } from "bun:test";
import { deriveWorktreePath, sanitizeBranchForPath } from "@/features/worktrees/worktree.path";

describe("sanitizeBranchForPath", () => {
  it("turns branch separators into one directory component", () => {
    expect(sanitizeBranchForPath("feature/login")).toBe("feature-login");
    expect(sanitizeBranchForPath("feature\\login")).toBe("feature-login");
  });

  it("replaces whitespace, control characters, and unsafe filesystem characters", () => {
    expect(sanitizeBranchForPath("a  b")).toBe("a-b");
    expect(sanitizeBranchForPath('a<>:"|?*b')).toBe("a-b");
    expect(sanitizeBranchForPath("a\u0000b")).toBe("a-b");
  });

  it("collapses separators and removes leading or trailing dots and hyphens", () => {
    expect(sanitizeBranchForPath("..")).toBe("");
    expect(sanitizeBranchForPath("--feature--")).toBe("feature");
    expect(sanitizeBranchForPath("a//b")).toBe("a-b");
  });
});

describe("deriveWorktreePath", () => {
  it("derives a sibling path from a POSIX base path", () => {
    expect(deriveWorktreePath("/home/user/code/repo", "feature/login")).toBe(
      "/home/user/code/feature-login",
    );
  });

  it("normalizes a Windows base path to forward slashes", () => {
    expect(deriveWorktreePath("C:\\Users\\me\\code\\repo", "feature/login")).toBe(
      "C:/Users/me/code/feature-login",
    );
  });

  it("keeps a root-level parent and falls back when no branch remains", () => {
    expect(deriveWorktreePath("/repo", "..")).toBe("/worktree");
  });

  it("returns an empty path when the base path is unknown", () => {
    expect(deriveWorktreePath(null, "feature")).toBe("");
    expect(deriveWorktreePath("", "feature")).toBe("");
  });
});
