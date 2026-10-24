import { describe, expect, it } from "bun:test";
import { parseStatus } from "@/domain/git/parsers/parse.status";

/** Record separator used by the canonical `-z` status form. */
const NUL = "\0";

/**
 * Joins status records with the NUL separator.
 *
 * @param records - Status records.
 * @returns The joined status output.
 */
function joinRecords(records: readonly string[]): string {
  return records.map((record) => `${record}${NUL}`).join("");
}

describe("parseStatus", () => {
  it("parses branch headers and every record kind", () => {
    const stdout = joinRecords([
      "# branch.oid abc123",
      "# branch.head main",
      "# branch.upstream origin/main",
      "# branch.ab +2 -1",
      "1 .M N... 100644 100644 100644 h1 h1 src/app.ts",
      "1 M. N... 100644 100644 100644 h1 h1 staged.ts",
      "2 R. N... 100644 100644 100644 h1 h1 R100 new name.ts",
      "old name.ts",
      "u UU N... 100644 100644 100644 100644 h1 h2 h3 conflict.txt",
      "? untracked file.txt",
      "! ignored.log",
    ]);

    const snapshot = parseStatus(stdout);

    expect(snapshot.headOid).toBe("abc123");
    expect(snapshot.branch).toBe("main");
    expect(snapshot.detached).toBeFalse();
    expect(snapshot.upstream).toBe("origin/main");
    expect(snapshot.ahead).toBe(2);
    expect(snapshot.behind).toBe(1);
    expect(snapshot.entries).toHaveLength(6);
    expect(snapshot.conflictedPaths).toEqual(["conflict.txt"]);
    expect(snapshot.stagedCount).toBe(2);
    expect(snapshot.unstagedCount).toBe(1);
    expect(snapshot.untrackedCount).toBe(1);
  });

  it("marks untracked entries with an untracked working-tree side", () => {
    const snapshot = parseStatus(joinRecords(["# branch.oid abc", "? notes.txt"]));

    expect(snapshot.entries[0]).toEqual({
      path: "notes.txt",
      originalPath: null,
      kind: "untracked",
      index: "unmodified",
      worktree: "untracked",
    });
  });

  it("keeps rename and copy original paths", () => {
    const snapshot = parseStatus(
      joinRecords([
        "# branch.oid abc",
        "2 R. N... 100644 100644 100644 h1 h1 R100 renamed.ts",
        "original.ts",
        "2 C. N... 100644 100644 100644 h1 h1 C100 copied.ts",
        "source.ts",
      ]),
    );

    expect(snapshot.entries[0]?.originalPath).toBe("original.ts");
    expect(snapshot.entries[0]?.kind).toBe("renamed");
    expect(snapshot.entries[1]?.originalPath).toBe("source.ts");
    expect(snapshot.entries[1]?.kind).toBe("copied");
  });

  it("parses paths with spaces and newlines", () => {
    const snapshot = parseStatus(
      joinRecords([
        "# branch.oid abc",
        "1 .M N... 100644 100644 100644 h1 h1 a file with spaces.txt",
        "1 .M N... 100644 100644 100644 h1 h1 odd\nname.txt",
      ]),
    );

    expect(snapshot.entries.map((entry) => entry.path)).toEqual([
      "a file with spaces.txt",
      "odd\nname.txt",
    ]);
  });

  it("reports an unborn branch with a null OID", () => {
    const snapshot = parseStatus(joinRecords(["# branch.oid (initial)", "# branch.head main"]));

    expect(snapshot.headOid).toBeNull();
    expect(snapshot.branch).toBe("main");
    expect(snapshot.entries).toHaveLength(0);
  });

  it("reports a detached HEAD with a null branch", () => {
    const snapshot = parseStatus(joinRecords(["# branch.oid abc", "# branch.head (detached)"]));

    expect(snapshot.detached).toBeTrue();
    expect(snapshot.branch).toBeNull();
  });

  it("skips unknown and short records", () => {
    const snapshot = parseStatus(joinRecords(["# branch.oid abc", "x unknown", "1 .M", "? "]));

    expect(snapshot.headOid).toBe("abc");
    expect(snapshot.entries).toHaveLength(0);
  });

  it("falls back to newline-separated records", () => {
    const snapshot = parseStatus(
      ["# branch.oid abc", "# branch.head main", "1 .M N... 100644 100644 100644 h1 h1 a.ts"].join(
        "\n",
      ),
    );

    expect(snapshot.branch).toBe("main");
    expect(snapshot.entries).toHaveLength(1);
  });

  it("returns an empty snapshot for empty output", () => {
    expect(parseStatus("")).toEqual({
      headOid: null,
      branch: null,
      detached: false,
      upstream: null,
      ahead: 0,
      behind: 0,
      entries: [],
      conflictedPaths: [],
      stagedCount: 0,
      unstagedCount: 0,
      untrackedCount: 0,
    });
  });
});
