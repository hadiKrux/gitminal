import { describe, expect, it } from "bun:test";
import {
  isSamePath,
  isSubdirectory,
  shortenPath,
  toHomeRelativePath,
  toRootRelativePath,
} from "@/lib/paths";

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

describe("toHomeRelativePath", () => {
  it("abbreviates the home directory and paths below it", () => {
    expect(toHomeRelativePath("/Users/hadi", "/Users/hadi")).toBe("~");
    expect(toHomeRelativePath("/Users/hadi/repos/gitminal", "/Users/hadi")).toBe(
      "~/repos/gitminal",
    );
  });

  it("keeps paths outside home and relative values unchanged", () => {
    expect(toHomeRelativePath("/opt/repo", "/Users/hadi")).toBe("/opt/repo");
    expect(toHomeRelativePath("repos/gitminal", "/Users/hadi")).toBe("repos/gitminal");
  });
});

describe("shortenPath", () => {
  it("keeps a path that fits", () => {
    expect(shortenPath("/repo/src", 20)).toBe("/repo/src");
  });

  it("keeps the final segments when the path is too long", () => {
    const shortened = shortenPath("/Users/hadi/repos/gitminal", 20);

    expect(shortened.length).toBe(20);
    expect(shortened.startsWith("...")).toBeTrue();
    expect(shortened.endsWith("gitminal")).toBeTrue();
  });

  it("never exceeds the budget and handles a tiny budget", () => {
    expect(shortenPath("/Users/hadi/repos/gitminal", 3)).toBe("nal");
    expect(shortenPath("/Users/hadi/repos/gitminal", 0)).toBe("");
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
