import { describe, expect, it } from "bun:test";
import { isSamePath, isSubdirectory, toRootRelativePath } from "@/lib/paths";

describe("isSamePath", () => {
  it("treats equivalent absolute paths as the same location", () => {
    expect(isSamePath("/repo", "/repo/")).toBeTrue();
    expect(isSamePath("/repo/src/..", "/repo")).toBeTrue();
  });

  it("rejects different paths", () => {
    expect(isSamePath("/repo", "/repo/src")).toBeFalse();
  });
});

describe("isSubdirectory", () => {
  it("accepts a nested path", () => {
    expect(isSubdirectory("/repo/packages/app", "/repo")).toBeTrue();
  });

  it("rejects the root itself and a sibling", () => {
    expect(isSubdirectory("/repo", "/repo")).toBeFalse();
    expect(isSubdirectory("/repo-other", "/repo")).toBeFalse();
  });

  it("rejects a parent path", () => {
    expect(isSubdirectory("/", "/repo")).toBeFalse();
  });
});

describe("toRootRelativePath", () => {
  it("expresses a nested path relative to the root", () => {
    expect(toRootRelativePath("/repo/src/index.ts", "/repo")).toBe("src/index.ts");
  });

  it("keeps a path outside the root relative", () => {
    expect(toRootRelativePath("/elsewhere/file.txt", "/repo")).toBe("../elsewhere/file.txt");
  });
});
