import { describe, expect, it } from "bun:test";
import { collapseFileDiff } from "@/domain/diff/diff.collapse";
import { probeSize, readWorkingDiff } from "@/domain/git/git.diff";
import { readCommitDiff } from "@/domain/git/git.diff.read-only";
import type { GitClient } from "@/domain/git/git.types";
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

describe.skipIf(!gitAvailable)("commit diff against a large real patch", () => {
  it("falls back to per-file reads when a many-file commit exceeds the capture limit", async () => {
    await withGitFixture({}, async (fixture) => {
      for (let file = 0; file < 85; file += 1) {
        const lines = Array.from(
          { length: 300 },
          (_, line) => `file ${file} line ${line} ${"x".repeat(60)}`,
        );

        fixture.writeFile(`bulk/file-${file}.txt`, `${lines.join("\n")}\n`);
      }

      expect((await fixture.commit("Add many files")).ok).toBeTrue();

      const head = await fixture.run(["rev-parse", "HEAD"]);
      const calls: string[] = [];
      const client: GitClient = {
        gitPath: fixture.client.gitPath,
        invoke: async (options) => {
          calls.push(options.args.join(" "));

          return await fixture.client.invoke(options);
        },
      };

      const result = await readCommitDiff(client, {
        cwd: fixture.root,
        signal: signal(),
        sha: head.stdout.trim(),
        contextLines: 3,
      });

      expect(result.ok).toBeTrue();
      expect(result.failure).toBeNull();
      expect(result.files).toHaveLength(85);
      expect(calls[0]).toContain("--diff-merges=first-parent");
      expect(calls[1]).toContain("--name-status");
      expect(calls).toHaveLength(87);
    });
  });
});
