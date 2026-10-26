import { describe, expect, it } from "bun:test";
import { parseSourceBranch, parseStashes } from "@/domain/git/parsers/parse.stash";

/** NUL field separator used by the recorded stash format. */
const NUL = "\u0000";

/**
 * Builds one stash list line.
 *
 * @param index - Display selector.
 * @param objectName - Stash commit id.
 * @param subject - Reflog subject.
 * @param committedAt - Commit timestamp.
 * @returns The NUL-separated line.
 */
function stashLine(
  index: string,
  objectName: string,
  subject: string,
  committedAt: string,
): string {
  return [index, objectName, subject, committedAt].join(NUL);
}

describe("parseStashes", () => {
  it("parses a WIP stash with its source branch and timestamp", () => {
    const stdout = [
      stashLine(
        "stash@{0}",
        "aaaa",
        "WIP on feature/login: 1234abc start the login form",
        "1700000000",
      ),
      stashLine("stash@{1}", "bbbb", "On main: manual checkpoint", "1699999999"),
      "",
    ].join("\n");

    expect(parseStashes(stdout)).toEqual([
      {
        index: "stash@{0}",
        objectName: "aaaa",
        subject: "WIP on feature/login: 1234abc start the login form",
        sourceBranch: "feature/login",
        committedAt: 1700000000,
      },
      {
        index: "stash@{1}",
        objectName: "bbbb",
        subject: "On main: manual checkpoint",
        sourceBranch: "main",
        committedAt: 1699999999,
      },
    ]);
  });

  it("keeps distinct object names for every entry", () => {
    const stdout = [
      stashLine("stash@{0}", "aaaa", "WIP on main: one", "10"),
      stashLine("stash@{1}", "bbbb", "WIP on main: two", "20"),
      "",
    ].join("\n");
    const stashes = parseStashes(stdout);

    expect(stashes.map((stash) => stash.objectName)).toEqual(["aaaa", "bbbb"]);
  });

  it("reports no source branch for a message without a git prefix", () => {
    const stdout = stashLine("stash@{0}", "aaaa", "my custom checkpoint", "10");

    expect(parseStashes(stdout)[0]?.sourceBranch).toBeNull();
  });

  it("reports no source branch for a detached stash", () => {
    const stdout = stashLine("stash@{0}", "aaaa", "WIP on (no branch): 1234abc work", "10");

    expect(parseStashes(stdout)[0]?.sourceBranch).toBeNull();
  });

  it("defaults an unparsable timestamp to zero", () => {
    const stdout = stashLine("stash@{0}", "aaaa", "WIP on main: one", "not-a-number");

    expect(parseStashes(stdout)[0]?.committedAt).toBe(0);
  });

  it("skips malformed records", () => {
    const stdout = ["stash@{0}\u0000aaaa", "", "\u0000\u0000\u0000\u0000"].join("\n");

    expect(parseStashes(stdout)).toEqual([]);
  });
});

describe("parseSourceBranch", () => {
  it("reads both documented prefixes", () => {
    expect(parseSourceBranch("WIP on main: 1234abc message")).toBe("main");
    expect(parseSourceBranch("On feature/a-b: message")).toBe("feature/a-b");
  });

  it("reads a branch containing a slash or a dot", () => {
    expect(parseSourceBranch("WIP on release/1.2: 1234abc message")).toBe("release/1.2");
  });

  it("returns null for a prefix without a branch terminator or a message", () => {
    expect(parseSourceBranch("WIP on main")).toBeNull();
    expect(parseSourceBranch("On : message")).toBeNull();
    expect(parseSourceBranch("checkpoint")).toBeNull();
  });

  it("returns null for the detached pseudo branch", () => {
    expect(parseSourceBranch("WIP on (no branch): 1234abc message")).toBeNull();
  });
});
