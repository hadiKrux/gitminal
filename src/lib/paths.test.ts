import { describe, expect, it } from "bun:test";
import {
  isSamePath,
  isSubdirectory,
  shortenPath,
  toHomeRelativePath,
  toRootRelativePath,
} from "@/lib/paths";

/** True when `node:path` resolves with POSIX separators. */
const posixHost = process.platform !== "win32";

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

  it("shortens repository-relative and home-relative paths by their tail", () => {
    expect(shortenPath("packages/app/src/index.ts", 20)).toBe(".../app/src/index.ts");
    expect(shortenPath("~/repos/gitminal", 10)).toBe("...itminal");
  });

  it("shortens Windows-separated paths without host path parsing", () => {
    // shortenPath only slices the tail, so a Windows separator is an ordinary character and the
    // same budget applies on every host.
    expect(shortenPath("C:\\repo\\src", 20)).toBe("C:\\repo\\src");
    expect(shortenPath("C:\\Users\\hadi\\repos\\gitminal", 20)).toBe("...di\\repos\\gitminal");
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

describe.skipIf(!posixHost)("Windows separators on a POSIX host", () => {
  it("documents that node:path helpers use the host separator instead of parsing a Windows path", () => {
    // `isSamePath`, `isSubdirectory`, `toHomeRelativePath`, and `toRootRelativePath` deliberately
    // normalize with `node:path`, whose separator is the host's. On a POSIX host a Windows path is
    // one opaque segment, so these assertions record the platform limitation rather than a rule the
    // helpers claim to implement. The same helpers handle Windows separators on a Windows host.
    expect(isSamePath("C:\\repo", "C:\\repo\\")).toBeFalse();
    expect(isSubdirectory("C:\\repo\\src", "C:\\repo")).toBeFalse();
    expect(toHomeRelativePath("C:\\Users\\hadi\\repos\\gitminal", "/Users/hadi")).toBe(
      "C:\\Users\\hadi\\repos\\gitminal",
    );
    expect(toRootRelativePath("C:\\repo\\src", "C:\\repo")).toBe("../C:\\repo\\src");
  });
});
