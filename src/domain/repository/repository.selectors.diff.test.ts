import { describe, expect, it } from "bun:test";
import type { StatusEntry, StatusSnapshot } from "@/domain/git/git.types";
import { selectDiffSections } from "@/domain/repository/repository.selectors";
import type { RepositorySnapshot } from "@/domain/repository/repository.types";

/**
 * Builds one ordinary status entry.
 *
 * @param path - Current path.
 * @param index - Index-side change letter.
 * @param worktree - Working-tree-side change letter.
 * @returns The status entry.
 */
function entry(index: string, worktree: string, path: string): StatusEntry {
  return {
    path,
    originalPath: null,
    kind: "ordinary",
    index: letterToKind(index),
    worktree: letterToKind(worktree),
  };
}

/**
 * Builds one rename status entry.
 *
 * @param oldPath - Pre-rename path.
 * @param newPath - Current path.
 * @returns The status entry.
 */
function rename(oldPath: string, newPath: string): StatusEntry {
  return {
    path: newPath,
    originalPath: oldPath,
    kind: "renamed",
    index: "renamed",
    worktree: "unmodified",
  };
}

/**
 * Builds one untracked status entry.
 *
 * @param path - Current path.
 * @returns The status entry.
 */
function untracked(path: string): StatusEntry {
  return {
    path,
    originalPath: null,
    kind: "untracked",
    index: "unmodified",
    worktree: "untracked",
  };
}

/**
 * Builds one conflicted status entry.
 *
 * @param path - Current path.
 * @returns The status entry.
 */
function conflicted(path: string): StatusEntry {
  return {
    path,
    originalPath: null,
    kind: "unmerged",
    index: "conflicted",
    worktree: "conflicted",
  };
}

/**
 * Maps a status letter to a change kind.
 *
 * @param letter - Status letter.
 * @returns The change kind.
 */
function letterToKind(letter: string): StatusEntry["index"] {
  switch (letter) {
    case "M":
      return "modified";
    case "A":
      return "added";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    case "C":
      return "copied";
    case "U":
      return "conflicted";
    case "T":
      return "type-changed";
    case "?":
      return "untracked";
    default:
      return "unmodified";
  }
}

/**
 * Builds a snapshot around a status entry list.
 *
 * @param entries - Status entries.
 * @returns The repository snapshot.
 */
function snapshot(entries: readonly StatusEntry[]): RepositorySnapshot {
  const status: StatusSnapshot = {
    headOid: "abc123",
    branch: "main",
    detached: false,
    upstream: null,
    ahead: 0,
    behind: 0,
    entries,
    conflictedPaths: entries
      .filter((candidate) => candidate.kind === "unmerged")
      .map((candidate) => candidate.path),
    stagedCount: 0,
    unstagedCount: 0,
    untrackedCount: 0,
  };

  return {
    cwd: "/repo",
    root: "/repo",
    gitDir: "/repo/.git",
    branch: "main",
    headOid: "abc123",
    headSubject: "initial",
    shortHash: "abc123",
    detached: false,
    bare: false,
    remotes: [],
    upstream: null,
    ahead: 0,
    behind: 0,
    status,
    branches: [],
    remoteBranches: [],
    tags: [],
    stashes: [],
    worktrees: [],
    currentWorktreePath: "/repo",
    identity: { name: "Test", email: "test@example.com" },
    readAt: 0,
  };
}

describe("selectDiffSections", () => {
  it("returns Working Directory, Staged Files, and Untracked Files in order", () => {
    const sections = selectDiffSections(snapshot([]));

    expect(sections.map((section) => section.section)).toEqual(["working", "staged", "untracked"]);
    expect(sections.map((section) => section.title)).toEqual([
      "Working Directory",
      "Staged Files",
      "Untracked Files",
    ]);
  });

  it("classifies each side of a change into its own section", () => {
    const sections = selectDiffSections(
      snapshot([
        entry("M", ".", "staged.txt"),
        entry(".", "M", "working.txt"),
        untracked("new.txt"),
      ]),
    );

    expect(sections[0]?.files.map((file) => file.path)).toEqual(["working.txt"]);
    expect(sections[1]?.files.map((file) => file.path)).toEqual(["staged.txt"]);
    expect(sections[2]?.files.map((file) => file.path)).toEqual(["new.txt"]);
  });

  it("lists an entry that changed on both sides in both sections", () => {
    const sections = selectDiffSections(snapshot([entry("M", "M", "both.txt")]));

    expect(sections[0]?.files.map((file) => file.path)).toEqual(["both.txt"]);
    expect(sections[1]?.files.map((file) => file.path)).toEqual(["both.txt"]);
    expect(sections[0]?.files[0]?.id).not.toBe(sections[1]?.files[0]?.id);
  });

  it("keeps conflicted entries in Working Directory with the U letter", () => {
    const sections = selectDiffSections(snapshot([conflicted("conflict.txt")]));

    expect(sections[0]?.files[0]).toMatchObject({
      path: "conflict.txt",
      statusLetter: "U",
      status: "conflicted",
      conflicted: true,
    });
    expect(sections[1]?.files).toHaveLength(0);
  });

  it("renders one rename row carrying both paths and scopes both paths to the section", () => {
    const sections = selectDiffSections(
      snapshot([rename("old.txt", "new.txt"), entry("D", ".", "old.txt")]),
    );

    expect(sections[1]?.files).toHaveLength(1);
    expect(sections[1]?.files[0]).toMatchObject({
      path: "new.txt",
      oldPath: "old.txt",
      statusLetter: "R",
      status: "renamed",
    });
    expect(sections[1]?.paths).toEqual(["old.txt", "new.txt"]);
  });

  it("keeps the source row of a copy", () => {
    const sections = selectDiffSections(
      snapshot([
        {
          path: "copy.txt",
          originalPath: "source.txt",
          kind: "copied",
          index: "copied",
          worktree: "unmodified",
        },
        entry("M", ".", "source.txt"),
      ]),
    );

    expect(sections[1]?.files.map((file) => file.path).sort()).toEqual(["copy.txt", "source.txt"]);
    expect(sections[1]?.paths).toEqual(["source.txt", "copy.txt"]);
  });

  it("applies the documented letter priority", () => {
    const sections = selectDiffSections(
      snapshot([entry("A", "M", "added-modified.txt"), entry("D", "M", "deleted-modified.txt")]),
    );

    expect(sections[0]?.files.map((file) => file.statusLetter)).toEqual(["A", "D"]);
  });

  it("ignores ignored records and null snapshots", () => {
    const sections = selectDiffSections(
      snapshot([
        {
          path: "ignored.txt",
          originalPath: null,
          kind: "ignored",
          index: "unmodified",
          worktree: "ignored",
        },
      ]),
    );

    expect(sections.flatMap((section) => section.files)).toHaveLength(0);
    expect(selectDiffSections(null).flatMap((section) => section.files)).toHaveLength(0);
  });
});
