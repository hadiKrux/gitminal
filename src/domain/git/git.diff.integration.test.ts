import { describe, expect, it } from "bun:test";
import { collapseFileDiff } from "@/domain/diff/diff.collapse";
import { probeSize, readWorkingDiff } from "@/domain/git/git.diff";
import { isGitAvailable, withGitFixture } from "@/test/git.fixture";

const gitAvailable = isGitAvailable();

/**
 * Creates a never-aborted signal for one read.
 *
 * @returns The signal.
 */
function signal(): AbortSignal {
  return new AbortController().signal;
}

describe.skipIf(!gitAvailable)("size probe against a real working tree", () => {
  it("measures working, untracked, and staged files and treats a missing file as unknown", async () => {
    await withGitFixture({}, async (fixture) => {
      fixture.writeFile("untracked.txt", "abc");

      const untracked = await probeSize(fixture.client, {
        cwd: fixture.root,
        signal: signal(),
        path: "untracked.txt",
        section: "untracked",
      });

      expect(untracked).toEqual({ ok: true, sizeBytes: 3, failure: null });

      expect(
        (await fixture.run(["add", "untracked.txt"], { operationClass: "write" })).ok,
      ).toBeTrue();

      const staged = await probeSize(fixture.client, {
        cwd: fixture.root,
        signal: signal(),
        path: "untracked.txt",
        section: "staged",
      });

      expect(staged).toEqual({ ok: true, sizeBytes: 3, failure: null });

      const working = await probeSize(fixture.client, {
        cwd: fixture.root,
        signal: signal(),
        path: "untracked.txt",
        section: "working",
      });

      expect(working).toEqual({ ok: true, sizeBytes: 3, failure: null });

      fixture.removePath("untracked.txt");

      const missing = await probeSize(fixture.client, {
        cwd: fixture.root,
        signal: signal(),
        path: "untracked.txt",
        section: "working",
      });

      expect(missing).toEqual({ ok: true, sizeBytes: null, failure: null });
    });
  });

  it("reads a long unchanged run so the configured collapse produces a marker", async () => {
    await withGitFixture({}, async (fixture) => {
      fixture.writeFile(
        "long.txt",
        Array.from({ length: 40 }, (_, index) => `line ${index + 1}`).join("\n") + "\n",
      );
      expect((await fixture.commit("Add long file")).ok).toBeTrue();

      fixture.writeFile(
        "long.txt",
        Array.from({ length: 40 }, (_, index) =>
          index === 30 ? "line 31 changed" : `line ${index + 1}`,
        ).join("\n") + "\n",
      );

      const read = await readWorkingDiff(fixture.client, {
        cwd: fixture.root,
        signal: signal(),
        path: "long.txt",
        contextLines: 3,
      });

      expect(read.ok).toBeTrue();

      if (read.file === null) {
        return;
      }

      const segments = collapseFileDiff(read.file, 3);

      expect(segments.some((segment) => segment.kind === "collapsed")).toBeTrue();
      expect(
        read.file.hunks.some(
          (hunk) => hunk.lines.filter((line) => line.kind === "context").length > 7,
        ),
      ).toBeTrue();
    });
  });
});
