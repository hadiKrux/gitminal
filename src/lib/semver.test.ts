import { describe, expect, it } from "bun:test";
import { compareVersions, isNewerVersion, parseVersion } from "@/lib/semver";

describe("parseVersion", () => {
  it("parses a release version", () => {
    expect(parseVersion("1.2.3")).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
      prerelease: [],
      build: [],
    });
  });

  it("parses a v-prefixed version", () => {
    expect(parseVersion("v2.0.1")).toEqual({
      major: 2,
      minor: 0,
      patch: 1,
      prerelease: [],
      build: [],
    });
  });

  it("parses build metadata without treating it as precedence data", () => {
    expect(parseVersion("1.2.3+build.5")).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
      prerelease: [],
      build: ["build", "5"],
    });
  });

  it("parses prerelease identifiers and build metadata together", () => {
    expect(parseVersion("v1.2.3-rc.1+sha.abc")).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
      prerelease: ["rc", "1"],
      build: ["sha", "abc"],
    });
  });

  it("returns null for invalid versions", () => {
    expect(parseVersion("")).toBeNull();
    expect(parseVersion("1.2")).toBeNull();
    expect(parseVersion("1.2.3.4")).toBeNull();
    expect(parseVersion("01.2.3")).toBeNull();
    expect(parseVersion("not-a-version")).toBeNull();
    expect(parseVersion("1.2.3-01")).toBeNull();
  });

  it("rejects whitespace-padded versions", () => {
    expect(parseVersion(" 1.2.3")).toBeNull();
    expect(parseVersion("1.2.3 ")).toBeNull();
    expect(parseVersion("\t1.2.3\n")).toBeNull();
  });

  it("accepts the largest safe release part and rejects larger ones", () => {
    expect(parseVersion(`${Number.MAX_SAFE_INTEGER}.0.0`)).toEqual({
      major: Number.MAX_SAFE_INTEGER,
      minor: 0,
      patch: 0,
      prerelease: [],
      build: [],
    });
    expect(parseVersion(`${Number.MAX_SAFE_INTEGER + 1}.0.0`)).toBeNull();
    expect(parseVersion(`0.${Number.MAX_SAFE_INTEGER + 1}.0`)).toBeNull();
    expect(parseVersion(`0.0.${Number.MAX_SAFE_INTEGER + 1}`)).toBeNull();
  });
});

describe("compareVersions", () => {
  it("orders release versions", () => {
    expect(compareVersions("1.0.0", "1.0.1")).toBe(-1);
    expect(compareVersions("1.2.0", "2.0.0")).toBe(-1);
    expect(compareVersions("2.0.0", "2.0.0")).toBe(0);
    expect(compareVersions("v2.0.0", "2.0.0")).toBe(0);
  });

  it("ignores build metadata", () => {
    expect(compareVersions("1.0.0+build.1", "1.0.0+build.2")).toBe(0);
  });

  it("applies semantic prerelease precedence", () => {
    const ordered = [
      "1.0.0-alpha",
      "1.0.0-alpha.1",
      "1.0.0-alpha.beta",
      "1.0.0-beta",
      "1.0.0-beta.2",
      "1.0.0-beta.11",
      "1.0.0-rc.1",
      "1.0.0",
    ];

    for (let index = 0; index < ordered.length - 1; index += 1) {
      const lower = ordered[index];
      const higher = ordered[index + 1];

      if (lower === undefined || higher === undefined) {
        throw new Error("test fixture is incomplete");
      }

      expect(compareVersions(lower, higher)).toBe(-1);
      expect(compareVersions(higher, lower)).toBe(1);
    }
  });

  it("returns null when either version is invalid", () => {
    expect(compareVersions("1.0.0", "invalid")).toBeNull();
    expect(compareVersions("invalid", "1.0.0")).toBeNull();
    expect(compareVersions(" 1.0.0", "1.0.0")).toBeNull();
    expect(compareVersions("1.0.0", "1.0.0 ")).toBeNull();
  });

  it("compares numeric prerelease identifiers without precision loss", () => {
    expect(compareVersions("1.0.0-9007199254740993", "1.0.0-9007199254740992")).toBe(1);
    expect(compareVersions("1.0.0-9007199254740992", "1.0.0-9007199254740993")).toBe(-1);
    expect(compareVersions("1.0.0-9007199254740993", "1.0.0-9007199254740993")).toBe(0);
    expect(compareVersions("1.0.0-99999999999999999999", "1.0.0-100000000000000000000")).toBe(-1);
  });
});

describe("isNewerVersion", () => {
  it("is true only for a strictly newer candidate", () => {
    expect(isNewerVersion("1.0.1", "1.0.0")).toBe(true);
    expect(isNewerVersion("2.0.0", "1.9.9")).toBe(true);
    expect(isNewerVersion("1.0.0", "1.0.0")).toBe(false);
    expect(isNewerVersion("0.9.0", "1.0.0")).toBe(false);
  });

  it("treats a prerelease as older than its release", () => {
    expect(isNewerVersion("1.0.0", "1.0.0-rc.1")).toBe(true);
    expect(isNewerVersion("1.0.0-rc.1", "1.0.0")).toBe(false);
  });

  it("treats invalid input as no update", () => {
    expect(isNewerVersion("invalid", "1.0.0")).toBe(false);
    expect(isNewerVersion("1.0.0", "invalid")).toBe(false);
  });
});
