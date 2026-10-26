import { describe, expect, it } from "bun:test";
import { isMissingFileError, readErrorCode, readErrorMessage } from "@/domain/config/config.errors";

describe("config error helpers", () => {
  it("detects a missing file by its ENOENT code", () => {
    expect(isMissingFileError(Object.assign(new Error("missing"), { code: "ENOENT" }))).toBeTrue();
    expect(isMissingFileError(Object.assign(new Error("denied"), { code: "EACCES" }))).toBeFalse();
    expect(isMissingFileError(new Error("plain"))).toBeFalse();
    expect(isMissingFileError("ENOENT")).toBeFalse();
    expect(isMissingFileError(null)).toBeFalse();
    expect(isMissingFileError(undefined)).toBeFalse();
  });

  it("reads a Node error code and falls back to an empty string", () => {
    expect(readErrorCode({ code: "ENOENT" })).toBe("ENOENT");
    expect(readErrorCode({ code: 2 })).toBe("2");
    expect(readErrorCode(new Error("plain"))).toBe("");
    expect(readErrorCode(undefined)).toBe("");
  });

  it("flattens a thrown error message to one line", () => {
    expect(readErrorMessage(new Error("first\nsecond\nthird"))).toBe("first second third");
    expect(readErrorMessage("plain text")).toBe("plain text");
  });
});
