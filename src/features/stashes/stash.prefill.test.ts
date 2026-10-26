import { describe, expect, it } from "bun:test";
import { buildStashMessagePrefill, readStashMessage } from "@/features/stashes/stash.prefill";

describe("buildStashMessagePrefill", () => {
  it("builds the exact attached-HEAD pattern with the HEAD subject", () => {
    expect(
      buildStashMessagePrefill({
        branch: "main",
        shortHash: null,
        headOid: "abc1234567890",
        headSubject: "initial commit",
      }),
    ).toBe("WIP on main: abc1234 initial commit");
  });

  it("keeps the short attached form when no subject was read", () => {
    expect(
      buildStashMessagePrefill({
        branch: "main",
        shortHash: null,
        headOid: "abc1234567890",
        headSubject: null,
      }),
    ).toBe("WIP on main: abc1234");
  });

  it("uses WIP at with the short hash and subject for a detached HEAD", () => {
    expect(
      buildStashMessagePrefill({
        branch: null,
        shortHash: "abc1234",
        headOid: "abc1234567890",
        headSubject: "detached work",
      }),
    ).toBe("WIP at abc1234 detached work");
  });

  it("keeps the existing detached fallback without a subject", () => {
    expect(
      buildStashMessagePrefill({
        branch: null,
        shortHash: "abc1234",
        headOid: "abc1234567890",
        headSubject: null,
      }),
    ).toBe("WIP at abc1234");
  });

  it("keeps the existing attached fallback when HEAD has no commit yet", () => {
    expect(
      buildStashMessagePrefill({
        branch: "main",
        shortHash: null,
        headOid: null,
        headSubject: null,
      }),
    ).toBe("WIP at main");
  });

  it("falls back to WIP before the first snapshot", () => {
    expect(buildStashMessagePrefill(null)).toBe("WIP");
  });
});

describe("readStashMessage", () => {
  it("returns the recorded subject or a placeholder", () => {
    expect(readStashMessage({ subject: "work in progress" })).toBe("work in progress");
    expect(readStashMessage({ subject: "" })).toBe("(no message)");
  });
});
