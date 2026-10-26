import { describe, expect, it } from "bun:test";
import type { StashRecord } from "@/domain/git/git.types";
import { resolveCreatedStash } from "@/features/stashes/stash.resolve";

/**
 * Builds one stash row for the resolver.
 *
 * @param objectName - Immutable object name.
 * @param subject - Recorded subject.
 * @returns The stash record.
 */
function stash(objectName: string, subject: string): StashRecord {
  return {
    index: "stash@{0}",
    objectName,
    subject,
    sourceBranch: "main",
    committedAt: 1_700_000_000,
  };
}

describe("resolveCreatedStash", () => {
  it("selects the newest row matching the created message", () => {
    const rows = [
      stash("newer", "WIP on main: abc123 my work"),
      stash("older", "WIP on main: def456 my work"),
      stash("other", "WIP on main: aaa111 unrelated"),
    ];

    expect(resolveCreatedStash(rows, "my work", 2)?.objectName).toBe("newer");
  });

  it("falls back to the newest row when the list grew and git recorded another subject shape", () => {
    const rows = [stash("newest", "On main: message"), stash("older", "WIP on main: aaa111 old")];

    expect(resolveCreatedStash(rows, "my work", 1)?.objectName).toBe("newest");
  });

  it("returns null when the list did not grow and no row matches", () => {
    const rows = [stash("old", "WIP on main: aaa111 old")];

    expect(resolveCreatedStash(rows, "my work", 1)).toBeNull();
  });

  it("returns null for an empty refreshed list", () => {
    expect(resolveCreatedStash([], "my work", 0)).toBeNull();
  });
});
